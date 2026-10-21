import { describe, expect, it } from 'vitest';
import { createAnalyzer } from './analyzer';
import { exerciseRegistry, isHold, optionsFor } from './registry';
import { observeExercise } from './observation';
import { exerciseIds, type ExerciseOptions, type ExerciseType, type PoseLandmarks } from './types';
import { demoPose } from '../pose/demo';
import { exercisePose } from '../pose/exerciseDemo';
import { TrainingController } from '../training/session';
import { isWorkoutRecord, parseHistory } from '../../shared/historyValidation';
import type { TrainingGoal } from '../../shared/workout';
import { CoachingController } from './coaching';

const dynamic=exerciseIds.slice(2).filter(id=>!isHold(id)), statics=exerciseIds.filter(isHold);
function run(id:ExerciseType, change?:(p:PoseLandmarks,t:number)=>PoseLandmarks,dt=100,tempo=1,options?:Partial<ExerciseOptions>) {
  const a=createAnalyzer(id,options);
  for(let t=0;t<=5900*tempo;t+=dt)a.analyze(change?change(demoPose(id,t/tempo,options),t/tempo):demoPose(id,t/tempo,options),t,1.6);
  return {a,result:a.finish(5900*tempo).result};
}
function fixed(id:ExerciseType,amount:number,ms=3000) {const a=createAnalyzer(id);for(let t=0;t<=ms;t+=100)a.analyze(exercisePose(id,amount),t,1.6);return a;}
function holdFrame(id:ExerciseType,good:boolean) {
  const p=exercisePose(id,0);
  if(!good) {
    if(id==='forearm_plank')p[23].y+=.14;
    else if(id==='wall_sit')p[25].y+=.16;
    else p[16].y+=.25;
  }
  return p;
}
describe.each(dynamic)('%s source-time phase machine',id=>{
  it.each([33,85,125,200])('full cycle at %i ms/frame; observations and outcome stay separate',dt=>{
    const {result}=run(id,undefined,dt);expect(result.reps).toBe(1);expect(result.attempts).toHaveLength(1);expect(result.attempts[0].motionComplete).toBe(true);
  });
  it.each([.6,1.8])('full cycle at tempo %s',tempo=>expect(run(id,undefined,70,tempo).result.reps).toBe(1));
  it('requires a starting pose and never counts a fixed middle or endpoint',()=>{
    for(const d of [.5,1])expect(fixed(id,d).finish(3000).result.reps).toBe(0);
  });
  it('classifies shallow motion and interrupted return as incomplete',()=>{
    const a=createAnalyzer(id);
    let t=0;
    for(;t<=1000;t+=100)a.analyze(exercisePose(id,0),t,1.6);
    for(;t<=2300;t+=100)a.analyze(exercisePose(id,.5),t,1.6);
    for(;t<=3400;t+=100)a.analyze(exercisePose(id,0),t,1.6);
    const shallow=a.finish(t).result;expect(shallow.reps).toBe(0);expect(shallow.incomplete).toBeGreaterThan(0);
    const b=createAnalyzer(id);for(let at=0;at<=3000;at+=100)b.analyze(demoPose(id,at),at,1.6);
    const unfinished=b.finish(3000);expect(unfinished.result.reps).toBe(0);expect(unfinished.result.incomplete).toBe(1);
    expect(b.finish(3000)).toEqual(unfinished);
  });
  it('does not assemble movements across occlusion, pauses, source loss, or rewind',()=>{
    const missing=run(id,(p,t)=>{if(t===2700)p[exerciseRegistry[id].points[0]].visibility=0;return p;}).result;
    expect(missing.reps).toBe(0);expect(missing.unassessed).toBe(1);
    for(const why of ['session_paused','timeline_reset','tracking_gap'] as const) {
      const a=createAnalyzer(id);for(let t=0;t<=2800;t+=100)a.analyze(demoPose(id,t),t,1.6);
      a.interrupt(2800,why);for(let t=2900;t<=5900;t+=100)a.analyze(demoPose(id,t),t,1.6);
      expect(a.finish(5900).result.reps).toBe(0);expect(a.snapshot().result.unassessed).toBe(1);
    }
    const a=createAnalyzer(id);for(let t=0;t<=2800;t+=100)a.analyze(demoPose(id,t),t,1.6);
    a.analyze([],2800,1.6,'source_unavailable');expect(a.finish(2800).result.unassessed).toBe(1);
  });
  it('ignores duplicate timestamps and rejects nonfinite, absent or out-of-frame required points',()=>{
    const a=createAnalyzer(id);for(let t=0;t<5900;t+=100){const p=demoPose(id,t);a.analyze(p,t,1.6);a.analyze(p,t,1.6);}
    expect(a.finish(5900).result.reps).toBe(1);
    for(const change of [(p:PoseLandmarks)=>{p[11].x=NaN;},(p:PoseLandmarks)=>{p[11].presence=0;},(p:PoseLandmarks)=>{p[11].x=1.1;}]) {
      const p=exercisePose(id,0);change(p);expect(observeExercise(id,p,1.6).reasons[0].code).toBe('missing_points');
    }
  });
  it('does not turn tiny initial-pose noise into attempts',()=>{
    const a=createAnalyzer(id);for(let t=0;t<=5000;t+=50)a.analyze(exercisePose(id,t<1000?0:.025+.015*Math.sin(t)),t,1.6);
    expect(a.finish(5000).result.attempts).toHaveLength(0);
  });
  it('requires a sustained target rather than alternating lucky threshold frames',()=>{
    const a=createAnalyzer(id);
    for(let t=0;t<=1000;t+=50)a.analyze(exercisePose(id,0),t,1.6);
    for(let t=1050;t<=3000;t+=50)a.analyze(exercisePose(id,t%100===0?1:.5),t,1.6);
    for(let t=3050;t<=4200;t+=50)a.analyze(exercisePose(id,0),t,1.6);
    const r=a.finish(4200).result;expect(r.reps).toBe(0);expect(r.incomplete).toBe(1);
  });
});
describe.each(statics)('%s hold accounting',id=>{
  it('credits only supported intervals after entry; no fictional reps',()=>{
    const a=fixed(id,0,2000),h=a.snapshot().result.hold!;
    expect(h.creditedMs).toBe(1500);expect(h.longestMs).toBe(1500);expect(h.unassessedMs).toBe(500);expect(a.snapshot().result.reps).toBe(0);
    const final=a.finish(20000);expect(final.result.hold).toEqual(h);expect(a.finish(20000)).toEqual(final);
  });
  it('stops on deviations immediately, keeps total and requires new stable entry',()=>{
    const a=fixed(id,0,2000);const before=a.snapshot().result.hold!.creditedMs;
    a.analyze(holdFrame(id,false),2100,1.6);expect(a.snapshot().result.hold!.creditedMs).toBe(before);
    for(let t=2200;t<=3000;t+=100)a.analyze(holdFrame(id,false),t,1.6);
    for(let t=3100;t<=4000;t+=100)a.analyze(holdFrame(id,true),t,1.6);
    const h=a.snapshot().result.hold!;expect(h.deviationMs).toBe(1000);expect(h.creditedMs).toBe(before+400);expect(h.longestMs).toBe(before);
  });
  it('never fills frame gaps, frozen timestamps or paused time with credit',()=>{
    const a=fixed(id,0,1000),before=a.snapshot().result.hold!.creditedMs;
    for(let i=0;i<20;i++)a.analyze(exercisePose(id,0),1000,1.6);
    a.analyze(exercisePose(id,0),4000,1.6);expect(a.snapshot().result.hold!.creditedMs).toBe(before);
    a.analyze([],4100,1.6,'source_unavailable');a.interrupt(4100,'session_paused');
    a.analyze(exercisePose(id,0),8000,1.6);expect(a.snapshot().result.hold!.creditedMs).toBe(before);
  });
  it('rejects wrong orientation, occlusion and intermittent entry jitter',()=>{
    const wrong=exercisePose(id==='forearm_plank'?'front_hold':'forearm_plank',0),a=createAnalyzer(id);
    for(let t=0;t<=2000;t+=100)a.analyze(wrong,t,1.6);expect(a.snapshot().result.hold!.creditedMs).toBe(0);
    const b=createAnalyzer(id);for(let t=0;t<=3000;t+=100){const p=exercisePose(id,0);if(t%400===0)p[exerciseRegistry[id].points.at(-1)!].visibility=0;b.analyze(p,t,1.6);}expect(b.snapshot().result.hold!.creditedMs).toBe(0);
  });
  it.each([33,85,200])('hold duration is bounded by source time at %i ms/frame',dt=>{
    const a=createAnalyzer(id);for(let t=0;t<=3000;t+=dt)a.analyze(exercisePose(id,0),t,1.6);
    const h=a.snapshot().result.hold!;expect(h.creditedMs).toBeGreaterThanOrEqual(3000-450-2*dt);expect(h.creditedMs).toBeLessThanOrEqual(2550);
  });
});
describe('exercise-specific guards and presentation',()=>{
  it('does not count a squat without a backward step as a lunge',()=>{
    const {result}=run('reverse_lunge',(_,t)=>{const p=demoPose('squat',t/5900*3600);p[31]={...p[27]};p[32]={...p[28]};return p;});expect(result.reps).toBe(0);
  });
  it('does not count a held bridge or a translated torso as a hip lift',()=>{
    expect(fixed('glute_bridge',1,6000).finish(6000).result.reps).toBe(0);
    const r=run('glute_bridge',(p)=>{const original=exercisePose('glute_bridge',0);const dy=p[23].y-original[23].y;p[11].y+=dy;p[12].y+=dy;return p;}).result;expect(r.reps).toBe(0);
  });
  it.each(['overhead_press','lateral_raise'] as const)('%s requires independent cycles from both arms',id=>{
    const one=run(id,(p)=>{const bottom=exercisePose(id,0);for(const i of [12,14,16])p[i]=bottom[i];return p;}).result;
    expect(one.reps).toBe(0);expect(one.incomplete).toBeGreaterThan(0);
    const bentOnly=run(id,(p)=>{const bottom=exercisePose(id,0);for(const i of [13,14])p[i]=bottom[i];return p;}).result;expect(bentOnly.reps).toBe(0);
    const delayed=run(id,(p,t)=>{const delayed=demoPose(id,Math.max(0,t-300));for(const i of [12,14,16])p[i]=delayed[i];return p;}).result;expect(delayed.reps).toBe(1);
  });
  it('supports seated pressing and fixes the anatomical support side of lunges',()=>{
    expect(run('overhead_press',undefined,100,1,{variant:'seated'}).result.reps).toBe(1);
    for(const side of ['left','right'] as const)for(const facing of ['left','right'] as const) {
      const {result}=run('reverse_lunge',undefined,100,1,{side,facing});expect(result.sides?.[side]).toBe(1);expect(result.sides?.[side==='left'?'right':'left']).toBe(0);
    }
  });
  it('reports signed plank sag and lift, removing a corrected hint immediately',()=>{
    const a=fixed('forearm_plank',0),coach=new CoachingController('forearm_plank');
    const sag=holdFrame('forearm_plank',false);const s=a.analyze(sag,3100,1.6);expect(coach.update(s,sag,1.6,3100).message).toBe('Поднимите таз немного выше.');
    const lifted=exercisePose('forearm_plank',0);lifted[23].y-=.14;expect(a.analyze(lifted,3200,1.6).feedback[0].message).toBe('Опустите таз немного ниже.');
    const fixedPose=exercisePose('forearm_plank',0);expect(coach.update(a.analyze(fixedPose,3300,1.6),fixedPose,1.6,3300).kind).toBe('phase');
  });
  it('rejects missing opposite arms and lateral raises viewed from the front as front holds',()=>{
    const p=exercisePose('front_hold',0);p[16].visibility=0;expect(observeExercise('front_hold',p,1.6).reasons[0].code).toBe('missing_points');
    expect(observeExercise('front_hold',exercisePose('lateral_raise',1),1.6).reasons[0].code).toBe('unsuitable_view');
  });
  it('preserves anatomical side through mirrored image coordinates and source aspect changes',()=>{
    const first=run('side_bend').result,mirror=run('side_bend',p=>p.map(q=>({...q,x:1-q.x}))).result;
    expect(first.sides).toEqual(mirror.sides);
    for(const id of exerciseIds.slice(2)){const p=exercisePose(id,1),a=observeExercise(id,p,1.6),q=p.map(v=>({...v,x:v.x*1.6/2})),b=observeExercise(id,q,2);expect(a.metrics.angle).toBeCloseTo(b.metrics.angle);}
  });
  it('counts either bend side and repeated same-side bends without requiring alternation',()=>{
    const a=createAnalyzer('side_bend');
    for(let t=0;t<18000;t+=100){let p=demoPose('side_bend',t);if(t>=6000&&t<12000)for(const o of [0,1])for(const i of [11,13,15])p[i+o].x=2*p[23+o].x-p[i+o].x;a.analyze(p,t,1.6);}
    expect(a.finish(18000).result.sides).toEqual({left:2,right:1});
  });
  it('separates a full repetition with a finding from an unassessed attempt with the same observed finding',()=>{
    const tilted=(p:PoseLandmarks)=>{const angle=20*Math.PI/180;for(const o of [0,1])for(const i of [11,13,15]){const q=p[i+o],h=p[23+o],x=(q.x-h.x)*1.6,y=q.y-h.y;q.x=h.x+(x*Math.cos(angle)-y*Math.sin(angle))/1.6;q.y=h.y+x*Math.sin(angle)+y*Math.cos(angle);}return p;};
    const full=run('lateral_raise',tilted).result;expect(full.reps).toBe(1);expect(full.withErrors).toBe(1);expect(full.attempts[0].remarks).toContain('lean');
    const broken=run('lateral_raise',(p,t)=>{tilted(p);if(t===3200)p[16].visibility=0;return p;}).result;
    expect(broken.unassessed).toBe(1);expect(broken.attempts[0].remarks).toContain('lean');expect(broken.reps).toBe(0);
  });
  it('rejects degenerate geometry and allows manual side-view confirmation only for otherwise usable points',()=>{
    const p=exercisePose('wall_sit',0);p[23]={...p[11]};expect(observeExercise('wall_sit',p,1.6).reasons).toContainEqual({code:'invalid_geometry'});
    const a=createAnalyzer('wall_sit'),q=exercisePose('wall_sit',0);q[12].visibility=0;q[24].visibility=0;
    expect(a.analyze(q,0,1.6).observation.status).toBe('ready');expect(a.snapshot().state).toBe('Оценка приостановлена');a.confirmSideView();
    for(let t=100;t<=1200;t+=100)a.analyze(q,t,1.6);expect(a.snapshot().result.hold!.creditedMs).toBeGreaterThan(0);
    const overlap=exercisePose('front_hold',0);for(const i of [12,14,16])overlap[i]={...overlap[i-1]};expect(observeExercise('front_hold',overlap,1.6).reasons[0].code).toBe('missing_points');
  });
  it.each(exerciseIds.slice(2))('%s survives controller finish, export and history validation',id=>{
    const options=optionsFor(id),goal:TrainingGoal=isHold(id)?{schemaVersion:2,unit:'seconds',seconds:2,sets:1,restSeconds:0,options}:{schemaVersion:2,unit:'reps',reps:1,sets:1,restSeconds:0,options};
    const c=new TrainingController(id,'demo',goal,'synthetic test',0);
    for(let t=0;t<=5900;t+=100)c.sample(demoPose(id,t,options),t,1.6,t);
    const r=c.finish(5900,5900);expect(isWorkoutRecord(r),JSON.stringify(r)).toBe(true);expect(parseHistory(JSON.stringify({schemaVersion:1,records:[r]}))).toEqual([r]);
    expect(c.finish(9999,9999)).toEqual(r);
  });
});
