import { optionsFor } from '../exercises/registry';
import type { ExerciseOptions, ExerciseType, PoseLandmarks } from '../exercises/types';

// Deliberately synthetic source geometry at aspect 1.6. Exported for deterministic
// analyzer tests and the labelled demo; these points never come from MediaPipe.
export function exercisePose(id:ExerciseType, amount:number, options?:Partial<ExerciseOptions>):PoseLandmarks {
  const opt=optionsFor(id,options), d=Math.max(0,Math.min(1,amount));
  const p:PoseLandmarks=Array.from({length:33},()=>({x:-1,y:-1,visibility:0,presence:0}));
  const put=(i:number,x:number,y:number)=>{p[i]={x:x/1.6,y,visibility:1,presence:1,z:0};};
  for(const o of [0,1]) {
    const shift=o*.035, s=11+o,e=13+o,w=15+o,h=23+o,k=25+o,a=27+o;
    if(['overhead_press','lateral_raise','side_bend'].includes(id)) {
      const sign=o===0?1:-1,x=.8+sign*.14;
      const tilt=id==='side_bend'?d*22*Math.PI/180:0;
      put(s,x+Math.sin(tilt)*.25,.60-Math.cos(tilt)*.25);put(h,x,.60);
      put(k,x,.76);put(a,x,.93);
      if(id==='side_bend'){put(e,p[s].x*1.6,.54);put(w,x,.69);}
      if(id==='overhead_press') {
        put(s,x,.40);put(h,x,.64);
        put(e,x+sign*(.19*(1-d)+.02*d),.43*(1-d)+.22*d);
        put(w,x+sign*(.19*(1-d)+.02*d),.23*(1-d)+.07*d);
        if(opt.variant==='seated'){put(k,x+sign*.19,.66);put(a,x+sign*.19,.86);}
      }
      if(id==='lateral_raise') {
        const angle=(5+85*d)*Math.PI/180;
        const ex=x+sign*Math.sin(angle)*.20,ey=.35+Math.cos(angle)*.20;
        put(e,ex,ey);put(w,ex+sign*Math.sin(angle-.20)*.18,ey+Math.cos(angle-.20)*.18);
      }
    } else if(id==='forearm_plank') {
      put(s,.38+shift,.52);put(e,.38+shift,.72);put(w,.59+shift,.72);
      put(h,.77+shift,.52);put(k,1.02+shift,.52);put(a,1.30+shift,.52);
    } else if(id==='wall_sit') {
      put(s,.62+shift,.28);put(h,.62+shift,.56);put(k,.91+shift,.56);put(a,.91+shift,.85);
      put(e,.72+shift,.4);put(w,.83+shift,.5);
    } else if(id==='glute_bridge') {
      put(s,.40+shift,.78);put(h,.75+shift,.79-.22*d);put(k,1.05+shift,.43);put(a,1.23+shift,.80);
      put(e,.53+shift,.84);put(w,.68+shift,.84);
    } else if(id==='front_hold') {
      put(s,.62+shift,.35);put(h,.62+shift,.62);put(k,.62+shift,.77);put(a,.62+shift,.93);
      put(e,.85+shift,.35);put(w,1.08+shift,.38);
    } else if(id==='reverse_lunge') {
      const support=o===(opt.side==='left'?0:1);
      put(s,.82+shift,.24+.15*d);put(h,.82+shift,.49+.15*d);
      if(support){put(k,.82+shift+.16*d,.70+.06*d);put(a,.82+shift,.93);}
      else {put(k,.82+shift-.02*d,.70+.19*d);put(a,.82+shift-.52*d,.93);}
      put(e,.95+shift,.39+.12*d);put(w,1.07+shift,.42+.12*d);
      put(31+o,p[a].x*1.6+.10,.95);
    }
  }
  if((id==='reverse_lunge'||id==='front_hold')&&opt.facing==='left')for(const q of p)if(q.visibility)q.x=1-q.x;
  put(0,p[11].x*1.6,.15);
  return p;
}
export function exerciseDemo(id:ExerciseType,elapsedMs:number,options?:Partial<ExerciseOptions>) {
  const period=6000,t=((elapsedMs%period)+period)%period;
  const d=t<1100?0:t<2600?(t-1100)/1500:t<3300?1:t<4900?1-(t-3300)/1600:0;
  return exercisePose(id,d,options);
}
