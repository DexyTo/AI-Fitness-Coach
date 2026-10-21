import { calculateAngle, distance } from '../pose/geometry';
import { sideView, visible } from '../pose/landmarks';
import { exerciseRegistry, optionsFor, type ExerciseDefinition } from './registry';
import type { BodySide, CriterionResults, ExerciseOptions, ExerciseType, ObservationReason, PoseLandmarks, PosePoint, UnavailableSourceReason } from './types';

export interface MetricsFrame {
  reasons: ObservationReason[]; criteria: CriterionResults; metrics: Record<string, number>;
  view: 'side' | 'unsuitable' | 'unknown' | 'not_required'; side: BodySide; hint: string;
}
const midpoint = (a: PosePoint, b: PosePoint): PosePoint => ({ x:(a.x+b.x)/2,y:(a.y+b.y)/2 });
const between = (x: number, low: number, high: number) => x >= low && x <= high;
// Image x points right, y down. All vectors use source aspect; no z/world coordinates.
export const signedVertical = (a: PosePoint, b: PosePoint, aspect: number) => Math.atan2((a.x-b.x)*aspect,b.y-a.y)*180/Math.PI;
const horizontal = (a: PosePoint, b: PosePoint, aspect: number) => Math.atan2(Math.abs(a.y-b.y), Math.abs((a.x-b.x)*aspect))*180/Math.PI;
export function observeExercise(id: ExerciseType, points: PoseLandmarks, aspect: number, options?: Partial<ExerciseOptions>, sourceReason?: UnavailableSourceReason, viewConfirmed = false, definition?:ExerciseDefinition): MetricsFrame {
  const def = definition??exerciseRegistry[id], opt = optionsFor(id,options), t = def.thresholds;
  const side = opt.side, offset = side === 'left' ? 0 : 1;
  const indices = def.bilateral ? [...def.points] : def.points.map(i=>i+offset);
  const missing = indices.filter(i=>!visible(points[i]));
  const frame: MetricsFrame = { reasons:[], criteria:{}, metrics:{}, view:'unknown', side, hint:'' };
  if (!points.length) frame.reasons.push({code:sourceReason??'no_pose'});
  else if (missing.length) frame.reasons.push({code:'missing_points',landmarks:missing});
  else if (!Number.isFinite(aspect) || aspect <= 0) frame.reasons.push({code:'invalid_geometry'});
  if (frame.reasons.length) return frame;
  const m = frame.metrics;
  const check = (code: keyof CriterionResults, passed: boolean, hint: string) => {
    frame.criteria[code] = {status:passed?'passed':'deviation',observedFrames:1,reasons:[]};
    if (!passed && !frame.hint) frame.hint=hint;
  };
  const chain = (o: number) => {
    const [s,e,w,h,k,a]=[11,13,15,23,25,27].map(i=>points[i+o]);
    return { s,e,w,h,k,a,torso:distance(s,h,aspect),knee:calculateAngle(h,k,a,aspect),hip:calculateAngle(s,h,k,aspect),elbow:e&&w?calculateAngle(s,e,w,aspect):NaN,arm:e?calculateAngle(h,s,e,aspect):NaN };
  };
  const c=chain(offset);
  if (c.torso < t.minTorso || !Number.isFinite(c.torso)) {frame.reasons.push({code:'invalid_geometry'});return frame;}
  const projected = sideView(points,aspect);
  if (def.view === 'side') {
    frame.view=projected;
    if(projected==='unsuitable'||(projected==='unknown'&&!viewConfirmed))frame.reasons.push({code:projected==='unsuitable'?'unsuitable_view':'view_unknown'});
  } else {
    const torso=(distance(points[11],points[23],aspect)+distance(points[12],points[24],aspect))/2;
    const widths=[distance(points[11],points[12],aspect),distance(points[23],points[24],aspect)];
    const front = widths.every(w=>w/torso>=t.frontWidth) && Math.abs(points[11].y-points[12].y)/torso<t.frontShoulderSlope;
    frame.view=front?'not_required':'unsuitable';
    if(!front)frame.reasons.push({code:'unsuitable_view'});
  }
  const lean=Math.abs(signedVertical(c.s,c.h,aspect));
  m.lean=lean;m.knee=c.knee;m.hip=c.hip;m.scale=c.torso;m.hipY=c.h.y;m.shoulderX=c.s.x*aspect;m.shoulderY=c.s.y;
  if(id==='forearm_plank') {
    m.angle=calculateAngle(c.s,c.h,c.a,aspect);
    // Signed vertical residual in the image: positive is sagging, negative raised hips.
    const dx=(c.a.x-c.s.x)*aspect,dy=c.a.y-c.s.y;
    m.hipResidual=((c.h.y-c.s.y)*dx-(c.h.x-c.s.x)*aspect*dy)/(Math.hypot(dx,dy)*Math.sign(dx||1)*c.torso);
    check('depth',horizontal(c.s,c.a,aspect)<=t.horizontal,'Корпус должен быть близок к горизонтальному.');
    check('line',Math.abs(180-m.angle)<=t.line,m.hipResidual>0?'Поднимите таз немного выше.':'Опустите таз немного ниже.');
    check('extension',c.knee>=t.knee,'Удерживайте колено почти выпрямленным.');
    check('lean',Math.abs((c.s.x-c.e.x)*aspect)/c.torso<=t.elbowOffset && c.e.y>c.s.y && horizontal(c.e,c.w,aspect)<=t.forearmHorizontal && between(c.elbow,t.elbowMin,t.elbowMax),'Расположите локоть под плечом, предплечье — вдоль пола.');
  } else if(id==='wall_sit') {
    m.angle=c.knee;
    check('depth',between(c.knee,t.kneeMin,t.kneeMax),'Сверьте положение колена с примером стульчика.');
    check('line',between(c.hip,t.hipMin,t.hipMax)&&horizontal(c.h,c.k,aspect)<=t.thighHorizontal,'Бедро должно быть близко к горизонтальному.');
    check('lean',lean<=t.trunkVertical,'Держите корпус ближе к вертикали.');
    check('extension',c.s.y<c.h.y&&c.k.y<c.a.y,'Сохраняйте положение сидя у стены.');
  } else if(id==='glute_bridge') {
    m.angle=c.hip;m.shoulderMidY=(points[11].y+points[12].y)/2;
    check('line',[0,1].every(o=>{const q=chain(o);return between(q.knee,t.kneeMin,t.kneeMax)&&q.a.y>q.k.y&&q.s.y>q.k.y;}),'Обе ноги согнуты; плечи остаются в нижнем положении.');
    check('lean',horizontal(c.s,c.k,aspect)<t.bodyHorizontal,'Сохраните положение лёжа, поднимайте таз, а не корпус целиком.');
  } else if(id==='reverse_lunge') {
    const support=chain(offset), rear=chain(1-offset), direction=opt.facing==='right'?1:-1;
    m.angle=support.knee;m.otherKnee=rear.knee;
    m.split=(support.a.x-rear.a.x)*aspect*direction/c.torso;
    m.rearX=rear.a.x*aspect*direction;m.supportX=support.a.x*aspect*direction;
    check('lean',lean<=t.lean,'Старайтесь держать корпус ровнее в выпаде.');
    check('line',support.k.y<support.a.y&&rear.k.y<rear.a.y,'Сохраните выбранную опорную ногу впереди.');
  } else {
    const left=chain(0), right=chain(1);
    for(const [name,q] of [['left',left],['right',right]] as const) {
      m[`${name}Arm`]=q.arm;m[`${name}Elbow`]=q.elbow;m[`${name}WristHeight`]=(q.s.y-q.w.y)/q.torso;
      m[`${name}Horizontal`]=horizontal(q.s,q.w,aspect);
      m[`${name}Forward`]=(q.w.x-q.s.x)*aspect*(opt.facing==='right'?1:-1)/q.torso;
      m[`${name}Outward`]=(q.w.x-q.s.x)*Math.sign(q.s.x-(name==='left'?right:left).s.x)*aspect/q.torso;
    }
    m.centerHipX=(left.h.x+right.h.x)*aspect/2;
    const standing=[left,right].every(q=>q.knee>=t.standingKnee&&q.s.y<q.h.y&&q.h.y<q.k.y&&q.k.y<q.a.y);
    const seated=[left,right].every(q=>between(q.hip,t.seatedMin,t.seatedMax)&&between(q.knee,t.seatedMin,t.seatedMax)&&horizontal(q.h,q.k,aspect)<=t.seatedHorizontal&&q.s.y<q.h.y);
    const expected=id==='overhead_press'&&opt.variant==='seated'?seated:standing;
    check('lean',Math.abs(signedVertical(midpoint(left.s,right.s),midpoint(left.h,right.h),aspect))<=(t.lean??t.leanMax), 'Держите корпус ровнее, без выраженного раскачивания.');
    if(id==='front_hold') {
      if([13,15].some(i=>distance(points[i],points[i+1],aspect)/Math.min(left.torso,right.torso)<t.holdSeparation))frame.reasons.push({code:'missing_points',landmarks:[13,14,15,16]});
      m.angle=Math.min(left.arm,right.arm);
      check('depth',[left,right].every(q=>between(q.arm,t.armMin,t.armMax)),'Поднимите обе руки перед собой до уровня плеч.');
      check('extension',[left,right].every(q=>q.elbow>=t.elbow),'Держите обе руки почти выпрямленными.');
      check('line',expected&&['left','right'].every(s=>m[`${s}Horizontal`]<=t.horizontal&&m[`${s}Forward`]>=t.forward),'Обе руки должны быть видны и направлены вперёд, корпус — стоя.');
    } else if(id==='side_bend') {
      const shoulder=midpoint(left.s,right.s), hip=midpoint(left.h,right.h);
      m.angle=signedVertical(shoulder,hip,aspect)*Math.sign(left.s.x-right.s.x);
      m.hipX=hip.x*aspect;m.hipMidY=hip.y;
      check('line',expected&&[left,right].every(q=>q.w.y>q.h.y&&q.arm<35),'Встаньте прямо, руки с гантелями вдоль тела.');
      // Lateral tilt is the motion; do not label that same tilt a trunk error.
      check('lean',Math.abs(m.angle)<=t.leanMax,'Вернитесь в нейтраль, избегайте выраженного раскачивания.');
    } else {
      m.angle=Math.min(left.arm,right.arm);
      check('line',expected&&Math.abs(left.arm-right.arm)<=t.asymmetry,'Сверьте выбранное положение тела и амплитуду обеих рук.');
    }
  }
  if(Object.values(m).some(v=>!Number.isFinite(v)))frame.reasons.push({code:'invalid_geometry'});
  // Every required segment must have positive length even if a particular angle is unused.
  for(const o of (def.bilateral?[0,1]:[offset])) {
    for(const [a,b] of [[11,23],[23,25],[25,27],...(['overhead_press','front_hold','lateral_raise','forearm_plank','side_bend'].includes(id)?[[11,13],[13,15]]:[])]) {
      if(indices.includes(a+o)&&indices.includes(b+o)&&distance(points[a+o],points[b+o],aspect)<t.minSegment)frame.reasons.push({code:'invalid_geometry'});
    }
  }
  return frame;
}
