import { exerciseRegistry, isHold, optionsFor } from './registry';
import { observeExercise, type MetricsFrame } from './observation';
import { reasonText, type BodySide, type CriterionResults, type ExerciseAnalysisResult, type ExerciseAnalyzer, type ExerciseOptions, type ExerciseResult, type ExerciseType, type FeedbackCode, type HoldInterval, type MovementAttempt, type ObservationReason, type PoseLandmarks, type UnavailableSourceReason } from './types';

export const multiTiming = { entryMs:450, positionMs:140, smoothingMs:80, maxGapMs:250, findingMs:300 };
interface Pending {
  start:number; target:boolean; side?:BodySide; minAngle:number; peak:number; criteria:CriterionResults;
  reasons:ObservationReason[]; baseline:Record<string,number>; measurements:Record<string,number>;
  armTargets:Partial<Record<BodySide,number>>; armReturned:Partial<Record<BodySide,boolean>>;
}
const blank = (id: ExerciseType): ExerciseResult => ({kind:isHold(id)?'hold':'repetitions',reps:0,incomplete:0,unassessed:0,withoutFindings:0,withErrors:0,errors:{},attempts:[],
  ...(isHold(id)?{hold:{creditedMs:0,longestMs:0,deviationMs:0,unassessedMs:0,intervals:[]}}:{}),
  ...(['reverse_lunge','side_bend'].includes(id)?{sides:{left:0,right:0}}:{})});
const passed = () => ({status:'passed' as const, observedFrames:1,reasons:[]});
const addReason = (to: ObservationReason[], reason:ObservationReason) => { if(!to.some(r=>JSON.stringify(r)===JSON.stringify(reason)))to.push(structuredClone(reason)); };

// Source-time state machines shared by the registry's new exercises. Exercise-specific
// geometry and start/target/return guards are explicit; legacy analyzers are untouched.
export class MultiExerciseAnalyzer implements ExerciseAnalyzer {
  private result:ExerciseResult;
  private frame:MetricsFrame;
  private lastAt:number|null=null;
  private filtered:Record<string,number>={};
  private confirmations=new Map<string,number>();
  private baseline:Record<string,number>={};
  private prepared=false;
  private activeHold=false;
  private continuousMs=0;
  private previousHold:HoldInterval['status']='unassessed';
  private pending:Pending|null=null;
  private phase:ExerciseAnalysisResult['state']='Подготовка';
  private finished=false;
  private viewConfirmed=false;
  private findingSince=new Map<string,number>();
  private phaseName='';
  readonly options:ExerciseOptions;
  private readonly definition;
  constructor(private readonly id:ExerciseType, options?:Partial<ExerciseOptions>) {
    this.definition=structuredClone(exerciseRegistry[id]);
    this.options=optionsFor(id,options);this.result=blank(id);
    this.frame={reasons:[{code:'no_pose'}],criteria:{},metrics:{},view:'unknown',side:this.options.side,hint:''};
  }
  confirmSideView(){this.viewConfirmed=true;}
  reset(){this.result=blank(this.id);this.lastAt=null;this.finished=false;this.viewConfirmed=false;this.clearMotion();this.frame={...this.frame,reasons:[{code:'no_pose'}],criteria:{},metrics:{}};}
  private clearMotion(){this.prepared=false;this.activeHold=false;this.continuousMs=0;this.previousHold='unassessed';this.pending=null;this.baseline={};this.filtered={};this.confirmations.clear();this.findingSince.clear();this.phase='Подготовка';this.phaseName='';}
  private confirmed(key:string,condition:boolean,at:number,duration=multiTiming.positionMs) {
    if(!condition){this.confirmations.delete(key);return false;}
    if(!this.confirmations.has(key))this.confirmations.set(key,at);
    return at-this.confirmations.get(key)!>=duration;
  }
  snapshot():ExerciseAnalysisResult {
    const usable=!this.frame.reasons.length;
    const stage=this.pending||this.activeHold?'active':this.prepared?'ready':'preparing';
    const message=!usable?this.frame.reasons.map(r=>r.code==='unsuitable_view'?`Неподходящий ракурс. ${this.definition.camera}`:reasonText(r)).join(' ')
      :this.frame.hint?this.frame.hint:!this.prepared?this.definition.initial:this.phaseName||'Исходная позиция подтверждена.';
    const deviation=Object.entries(this.frame.criteria).find(([,c])=>c.status==='deviation');
    const observationReasons=this.frame.reasons.filter(r=>r.code!=='unsuitable_view'&&r.code!=='view_unknown');
    return structuredClone({preparation:{stage,view:this.frame.view,viewConfirmed:this.viewConfirmed,message},
      state:usable?this.phase:'Оценка приостановлена',angle:usable&&Number.isFinite(this.filtered.angle)?Math.round(this.filtered.angle):null,
      observation:{status:!observationReasons.length?'ready':this.frame.metrics.angle===undefined?'unavailable':'partial',side:this.options.side,reasons:observationReasons},
      metrics:usable?this.frame.metrics:{},criteria:this.frame.criteria,feedback:usable&&deviation?[{code:deviation[0] as FeedbackCode,message:this.frame.hint}]:[],result:this.result});
  }
  interrupt(at:number,reason:'tracking_gap'|'timeline_reset'|'session_paused'):ExerciseAnalysisResult {
    if(this.finished)return this.snapshot();
    if(this.pending){addReason(this.pending.reasons,{code:reason});this.close(Math.max(at,this.lastAt??at),reason,false);}
    this.clearMotion();this.viewConfirmed=false;this.lastAt=null;
    this.frame={...this.frame,reasons:[{code:reason}],criteria:{},metrics:{}};return this.snapshot();
  }
  finish(at:number):ExerciseAnalysisResult {
    if(this.finished)return this.snapshot();
    if(this.pending){if(this.lastAt!==null&&at-this.lastAt>multiTiming.maxGapMs)addReason(this.pending.reasons,{code:'tracking_gap'});this.close(Math.max(at,this.lastAt??at),'session_finished',false);}
    // No source interval is inferred from finish or wall-clock time.
    this.clearMotion();this.finished=true;this.frame={...this.frame,criteria:{},reasons:[{code:'movement_pending'}],metrics:{}};return this.snapshot();
  }
  analyze(points:PoseLandmarks,at:number,aspect:number,sourceReason?:UnavailableSourceReason):ExerciseAnalysisResult {
    if(this.finished||!Number.isFinite(at)||at<0)return this.snapshot();
    if(at===this.lastAt&&!sourceReason)return this.snapshot();
    let dt=this.lastAt===null?0:at-this.lastAt;
    if(dt<0||dt>multiTiming.maxGapMs) {
      if(isHold(this.id)&&dt>multiTiming.maxGapMs)this.interval(this.lastAt!,at,'unassessed',{},[{code:'tracking_gap'}]);
      this.interrupt(dt<0?this.lastAt!:at,dt<0?'timeline_reset':'tracking_gap');dt=0;
    }
    const previousFrame=this.frame;
    this.frame=observeExercise(this.id,points,aspect,this.options,sourceReason,this.viewConfirmed,this.definition);
    const usable=!this.frame.reasons.length;
    const previousAt=this.lastAt;
    this.lastAt=at;
    if(!usable) {
      if(isHold(this.id)&&dt>0)this.interval(previousAt!,at,'unassessed',{},this.frame.reasons);
      if(this.pending){this.frame.reasons.forEach(r=>addReason(this.pending!.reasons,r));this.collect(at);this.close(at,'tracking_gap',false);}
      this.clearMotion();return this.snapshot();
    }
    const raw=this.frame.metrics;
    const alpha=1-Math.exp(-dt/multiTiming.smoothingMs);
    for(const [key,value] of Object.entries(raw))this.filtered[key]=this.filtered[key]===undefined||!dt?value:this.filtered[key]+alpha*(value-this.filtered[key]);
    if(isHold(this.id)) {
      const good=Object.values(this.frame.criteria).every(c=>c.status==='passed');
      const entered=this.confirmed('hold',good,at,multiTiming.entryMs);
      const credit=good&&entered&&this.activeHold&&this.previousHold==='credited'&&!previousFrame.reasons.length;
      const status:HoldInterval['status']=credit?'credited':good?'unassessed':'deviation';
      if(dt>0)this.interval(previousAt!,at,status,this.frame.criteria,status==='unassessed'?[{code:'movement_pending'}]:[]);
      if(!good){this.activeHold=false;this.prepared=false;this.continuousMs=0;}
      else if(entered){this.activeHold=true;this.prepared=true;}
      // Entry confirmation frame starts a new segment. It never backfills preparation.
      this.previousHold=good&&entered?'credited':status;
      this.phase=this.activeHold?'Удержание':'Подготовка';this.phaseName=this.activeHold?'Удержание засчитывается. Сохраняйте позу.':'';
      return this.snapshot();
    }
    const initial=this.initial(raw)&&this.initial(this.filtered);
    if(!this.prepared) {
      if(this.confirmed('prepare',initial,at,multiTiming.entryMs)) {this.prepared=true;this.baseline={...raw};this.phase='Готов';}
      return this.snapshot();
    }
    const progress=this.progress(this.filtered);
    const departure=this.departure(raw)&&this.departure(this.filtered);
    if(!this.pending&&this.confirmed('departure',departure,at)) {
      this.pending={start:at,target:false,side:this.id==='reverse_lunge'?this.options.side:this.id==='side_bend'?(raw.angle>0?'left':'right'):undefined,
        minAngle:Math.abs(raw.angle),peak:progress,criteria:{depth:{status:'unassessed',observedFrames:0,reasons:[]},extension:{status:'unassessed',observedFrames:0,reasons:[]}},reasons:[],baseline:{...this.baseline},measurements:{},armTargets:{},armReturned:{}};
      this.phase=this.id==='reverse_lunge'?'Шаг назад':'Движение';this.phaseName=this.id==='reverse_lunge'?'Шагните выбранной ногой назад.':'Наблюдаем движение к целевой позиции.';
      this.confirmations.delete('return');this.confirmations.delete('target');
    }
    const p=this.pending;
    if(!p)return this.snapshot();
    if(['overhead_press','lateral_raise'].includes(this.id)&&Math.abs(raw.centerHipX-p.baseline.centerHipX)/p.baseline.scale>this.definition.thresholds.trunkTravel) {
      this.frame.criteria.lean={status:'deviation',observedFrames:1,reasons:[]};this.frame.hint='Наблюдаем смещение корпуса. Уменьшите раскачивание.';
    }
    if(this.id==='lateral_raise'&&dt>0&&!previousFrame.reasons.length&&['left','right'].some(side=>Math.abs(raw[`${side}Arm`]-previousFrame.metrics[`${side}Arm`])*1000/dt>this.definition.thresholds.speed)) {
      this.frame.criteria.line={status:'deviation',observedFrames:1,reasons:[]};this.frame.hint='Положение рук меняется резко. Поднимайте и опускайте их плавнее.';
    }
    p.minAngle=Math.min(p.minAngle,Math.abs(raw.angle));p.peak=Math.max(p.peak,progress);
    if(this.id==='glute_bridge'){p.measurements.peakHipAngle=Math.max(p.measurements.peakHipAngle??0,raw.angle);p.measurements.hipRise=Math.max(p.measurements.hipRise??0,(p.baseline.hipY-raw.hipY)/p.baseline.scale);}
    if(this.id==='side_bend')p.measurements.peakTilt=Math.max(p.measurements.peakTilt??0,Math.abs(raw.angle));
    if(this.id==='reverse_lunge'){
      p.measurements.minKnee=Math.min(p.measurements.minKnee??180,raw.knee);
      if(this.step(raw)){const supportDrift=Math.abs(raw.supportX-p.baseline.supportX)/p.baseline.scale;if(supportDrift>.15){this.frame.criteria.line={status:'deviation',observedFrames:1,reasons:[]};this.frame.hint='Опорная нога заметно сместилась. Сверьте выбранную сторону.';}}
    }
    if(this.id==='glute_bridge') {
      if(Math.hypot(raw.shoulderX-p.baseline.shoulderX,raw.shoulderY-p.baseline.shoulderY)/p.baseline.scale>this.definition.thresholds.shoulderTravel){this.frame.criteria.lean={status:'deviation',observedFrames:1,reasons:[]};this.frame.hint='Оставьте плечи внизу; поднимайте таз, а не корпус целиком.';}
    }
    if(this.id==='side_bend'&&Math.abs(raw.hipX-p.baseline.hipX)/p.baseline.scale>this.definition.thresholds.hipTravel) {
      this.frame.criteria.lean={status:'deviation',observedFrames:1,reasons:[]};this.frame.hint='Сместился таз: старайтесь наклонять корпус без перемещения всего тела.';
    }
    this.collect(at);
    if(this.id==='reverse_lunge'&&this.confirmed('step',this.step(raw)&&this.step(this.filtered),at)&&!p.target){this.phase='Опускаетесь';this.phaseName='Шаг назад подтверждён. Опуститесь и вернитесь в стойку.';}
    if(this.id==='overhead_press'||this.id==='lateral_raise') {
      for(const side of ['left','right'] as const) {
        if(!p.armTargets[side]&&this.confirmed(`target-${side}`,this.armTarget(side,raw)&&this.armTarget(side,this.filtered),at))p.armTargets[side]=at;
        if(p.armTargets[side]&&this.confirmed(`return-${side}`,this.armInitial(side,raw)&&this.armInitial(side,this.filtered),at))p.armReturned[side]=true;
        p.measurements[`${side}PeakArm`]=Math.max(p.measurements[`${side}PeakArm`]??0,raw[`${side}Arm`]);
        p.measurements[`${side}MaxElbow`]=Math.max(p.measurements[`${side}MaxElbow`]??0,raw[`${side}Elbow`]);
        p.measurements[`${side}Target`]=p.armTargets[side]===undefined?0:1;p.measurements[`${side}Returned`]=p.armReturned[side]?1:0;
      }
      p.target=p.armTargets.left!==undefined&&p.armTargets.right!==undefined&&Math.abs(p.armTargets.left-p.armTargets.right)<=this.definition.thresholds.syncMs;
    } else if(this.confirmed('target',this.target(raw)&&this.target(this.filtered),at))p.target=true;
    if(p.target){this.phase='Целевая позиция';this.phaseName='Целевая позиция подтверждена. Вернитесь в исходную.';}
    if(p.peak-progress>this.reversal()&& !initial){this.phase='Возврат';this.phaseName='Возвращайтесь в исходную позицию.';}
    if(this.confirmed('return',initial,at)) {
      const bilateral=this.id==='overhead_press'||this.id==='lateral_raise';
      this.close(at,'returned_to_top',p.target&&(!bilateral||(!!p.armReturned.left&&!!p.armReturned.right)));
      this.confirmations.clear();this.phase='Готов';this.phaseName='Возврат подтверждён. Можно начать следующую попытку.';this.baseline={...raw};
    }
    return this.snapshot();
  }
  private initial(m:Record<string,number>) {
    const t=this.definition.thresholds;
    switch(this.id) {
      case 'reverse_lunge': return m.knee>t.standing&&m.otherKnee>t.standing&&Math.abs(m.split)<=t.returnSplit;
      case 'glute_bridge': return m.angle<=t.bottom&&m.hipY>=m.shoulderY-.05&&this.frame.criteria.line?.status==='passed'&&this.frame.criteria.lean?.status==='passed'&&(!this.pending||(this.pending.baseline.hipY-m.hipY)/this.pending.baseline.scale<=t.returnRise);
      case 'side_bend': return Math.abs(m.angle)<=t.neutral&&this.frame.criteria.line?.status==='passed';
      case 'overhead_press': case 'lateral_raise': return this.armInitial('left',m)&&this.armInitial('right',m)&&this.frame.criteria.line?.status==='passed';
      default: return false;
    }
  }
  private armInitial(side:BodySide,m:Record<string,number>) {
    const t=this.definition.thresholds;
    return this.id==='overhead_press'?m[`${side}Elbow`]>=t.bottomMin&&m[`${side}Elbow`]<=t.bottomMax&&Math.abs(m[`${side}WristHeight`])<=t.bottomWrist&&m[`${side}Arm`]>=t.pressInitialArmMin&&m[`${side}Arm`]<=t.pressInitialArmMax:m[`${side}Arm`]<=t.bottom;
  }
  private armTarget(side:BodySide,m:Record<string,number>) {
    const t=this.definition.thresholds;
    return this.id==='overhead_press'?m[`${side}Elbow`]>=t.top&&m[`${side}Arm`]>=t.armTop&&m[`${side}WristHeight`]>=t.wristHeight:
      m[`${side}Arm`]>=t.targetMin&&m[`${side}Arm`]<=t.targetMax&&m[`${side}Elbow`]>=t.elbowMin&&m[`${side}Elbow`]<=t.elbowMax&&m[`${side}Outward`]>=t.lateralOutward&&Math.abs(m[`${side}WristHeight`])<=t.lateralWrist;
  }
  private progress(m:Record<string,number>) {
    switch(this.id){case 'reverse_lunge':return 180-m.knee;case 'glute_bridge':return (this.baseline.hipY-m.hipY)/this.baseline.scale*100;case 'side_bend':return Math.abs(m.angle);default:return Math.max(m.leftArm,m.rightArm);}
  }
  private departure(m:Record<string,number>) {
    switch(this.id){case 'reverse_lunge':return m.knee<145||m.split>.3;case 'glute_bridge':return this.progress(m)>10;case 'side_bend':return Math.abs(m.angle)>this.definition.thresholds.departure;case 'overhead_press':return Math.max(m.leftArm,m.rightArm)>115;case 'lateral_raise':return Math.max(m.leftArm,m.rightArm)>38;default:return false;}
  }
  private reversal(){return this.id==='side_bend'?4:8;}
  private step(m:Record<string,number>) {
    const t=this.definition.thresholds,b=this.baseline;
    return m.split>=t.split&&(b.rearX-m.rearX)/b.scale>=t.step&&Math.abs(m.supportX-b.supportX)/b.scale<.22;
  }
  private target(m:Record<string,number>) {
    const t=this.definition.thresholds;
    switch(this.id){
      case 'reverse_lunge':return this.confirmations.has('step')&&this.lastAt!-this.confirmations.get('step')!>=multiTiming.positionMs&&this.step(m)&&m.knee>=t.kneeMin&&m.knee<=t.kneeMax&&(m.hipY-this.baseline.hipY)/this.baseline.scale>=t.hipDrop;
      case 'glute_bridge':return m.angle>=t.top&&this.progress(m)>=t.rise*100&&this.frame.criteria.line?.status==='passed'&&Math.hypot(m.shoulderX-this.baseline.shoulderX,m.shoulderY-this.baseline.shoulderY)/this.baseline.scale<=t.shoulderTravel;
      case 'side_bend':return Math.abs(m.angle)>=t.target&&(m.angle>0)===(this.pending!.side==='left')&&Math.abs(m.hipX-this.baseline.hipX)/this.baseline.scale<=t.hipTravel;
      default:return false;
    }
  }
  private collect(at:number) {
    const p=this.pending!;
    for(const code of ['lean','line'] as const) {
      const check=this.frame.criteria[code];if(!check)continue;
      const previous=p.criteria[code]??{status:'unassessed',observedFrames:0,reasons:[]};
      previous.observedFrames+=check.observedFrames;
      if(check.status==='deviation') {
        if(!this.findingSince.has(code))this.findingSince.set(code,at);
        if(at-this.findingSince.get(code)!>=multiTiming.findingMs)previous.status='deviation';
      } else {this.findingSince.delete(code);if(previous.status!=='deviation')previous.status='passed';}
      p.criteria[code]=previous;
    }
  }
  private close(at:number,endReason:MovementAttempt['endReason'],complete:boolean) {
    const p=this.pending!,missing=p.reasons.length>0;
    p.criteria.depth={...passed(),status:p.target?'passed':missing?'unassessed':'deviation',reasons:missing&&!p.target?structuredClone(p.reasons):[]};
    p.criteria.extension={...passed(),status:endReason==='returned_to_top'?'passed':missing?'unassessed':'deviation',reasons:missing?structuredClone(p.reasons):[]};
    for(const code of ['lean','line'] as const) {
      const c=p.criteria[code]??{status:'unassessed',observedFrames:0,reasons:[{code:'movement_pending'}]};
      if(missing){p.reasons.forEach(r=>addReason(c.reasons,r));if(c.status!=='deviation')c.status='unassessed';}
      p.criteria[code]=c;
    }
    const remarks=Object.entries(p.criteria).filter(([,c])=>c.status==='deviation').map(([code])=>code as FeedbackCode);
    const outcome=missing||Object.values(p.criteria).some(c=>c.status==='unassessed')?'insufficient_data':complete?'complete':'incomplete';
    const attempt:MovementAttempt={id:this.result.attempts.length+1,startedAt:p.start,endedAt:at,outcome,endReason,motionComplete:complete,minAngle:Math.round(p.minAngle),criteria:p.criteria,remarks,reasons:p.reasons,...(p.side?{side:p.side}:{}),measurements:p.measurements};
    this.result.attempts.push(structuredClone(attempt));
    if(outcome==='complete'){this.result.reps++;if(!remarks.length)this.result.withoutFindings++;if(p.side&&this.result.sides)this.result.sides[p.side]++;}
    else if(outcome==='incomplete')this.result.incomplete++;else this.result.unassessed++;
    if(remarks.length)this.result.withErrors++;
    for(const code of remarks)this.result.errors[code]=(this.result.errors[code]??0)+1;
    this.pending=null;this.findingSince.clear();
  }
  private interval(start:number,end:number,status:HoldInterval['status'],criteria:CriterionResults,reasons:ObservationReason[]) {
    const hold=this.result.hold!,dt=end-start;if(dt<=0)return;
    hold[status==='credited'?'creditedMs':status==='deviation'?'deviationMs':'unassessedMs']+=dt;
    if(status==='credited'){this.continuousMs+=dt;hold.longestMs=Math.max(hold.longestMs,this.continuousMs);}else this.continuousMs=0;
    const last=hold.intervals.at(-1);
    if(last&&last.endedAt===start&&last.status===status&&JSON.stringify(last.criteria)===JSON.stringify(criteria)&&JSON.stringify(last.reasons)===JSON.stringify(reasons))last.endedAt=end;
    else hold.intervals.push({startedAt:start,endedAt:end,status,criteria:structuredClone(criteria),reasons:structuredClone(reasons)});
  }
}
