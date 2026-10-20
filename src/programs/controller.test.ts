import { describe, expect, it } from 'vitest';
import { ProgramController } from './controller';
import { TrainingController } from '../training/session';
import { demoPose } from '../pose/demo';
import { validProgramRecord, type ProgramSnapshot } from '../../shared/program';
import { parseHistory } from '../training/history';
const date = '2026-10-20T10:00:00.000Z';
export const snapshot = ():ProgramSnapshot => ({kind:'program',mode:'demo',conditions:'',program:{schemaVersion:1,id:'mixed',version:1,origin:'catalog',ownerId:null,title:'Два упражнения',description:'',steps:[{id:'one',exercise:'squat',goal:{sets:1,reps:1,restSeconds:0},transitionSeconds:2},{id:'two',exercise:'pushup',goal:{sets:1,reps:1,restSeconds:0},transitionSeconds:0}]}});
function child(s:ProgramSnapshot,index:number,start:number,id='run') {
  const step=s.program.steps[index];
  return new TrainingController(step.exercise,s.mode,step.goal,s.conditions,start,new Date(Date.parse(date)+start).toISOString(),`${id}:${index}`);
}
describe('program orchestration',()=>{
  it('runs both analyzers from fresh readiness, freezes plan, pauses transition and returns one result',()=>{
    const plan=snapshot(), program=new ProgramController(plan,'run',date,0);
    plan.program.steps[0].goal.reps=999;
    const first=child(program.snapshot,0,0);
    for(let t=0;t<10000&&first.phase!=='completed';t+=85)first.sample(demoPose('squat',t),t,1.6,t);
    expect(first.phase).toBe('completed');
    const a=first.finish(10000,10000);program.accept(a,10000);program.accept(a,10000);
    expect(program.children).toHaveLength(1);expect(program.next(10500)).toBe(false);
    program.pause(10500);expect(program.remaining(100000)).toBe(2);expect(program.phase).toBe('paused');
    program.resume(100000);expect(program.next(101499)).toBe(false);expect(program.next(101500)).toBe(true);
    const second=child(program.snapshot,1,101500);
    expect(second.phase).toBe('preparing');expect(second.analyzer.snapshot().result.attempts).toHaveLength(0);
    for(let t=0;t<10000&&second.phase!=='completed';t+=85)second.sample(demoPose('pushup',t),101500+t,1.6,101500+t);
    expect(second.phase).toBe('completed');
    program.accept(second.finish(111500,111500),111500);
    const record=program.finish(111500);expect(record.ended).toBe('completed');expect(record.steps.map(r=>r.exercise)).toEqual(['squat','pushup']);expect(record.steps.every(r=>r.sets[0].result.reps===1)).toBe(true);expect(validProgramRecord(record)).toBe(true);
    expect(program.finish(999999,true)).toEqual(record);
    expect(parseHistory(JSON.stringify({schemaVersion:1,records:[a],programs:[record]}))).toEqual([a]);
  });
  it('keeps only an ordered prefix on interruption, never counts future steps and rejects substitution',()=>{
    const s=snapshot(),p=new ProgramController(s,'run',date,0),c=child(s,0,0);
    c.pause(10);c.resume(20);const r=c.finish(30,30);p.accept(r,30);
    const interrupted=p.finish(1000);expect(interrupted.ended).toBe('interrupted');expect(interrupted.steps).toHaveLength(1);expect(validProgramRecord(interrupted)).toBe(true);
    expect(validProgramRecord({...interrupted,ended:'completed'})).toBe(false);
    expect(()=>new ProgramController(s,'run',date,0).accept({...r,exercise:'pushup'},30)).toThrow();
    const empty=new ProgramController(s,'run',date,0).finish(1000,true);expect(empty.steps).toEqual([]);expect(validProgramRecord(empty)).toBe(true);
  });
  it('allows manual set completion, stops at transition and never mutates a finished result',()=>{
    const s=snapshot(),p=new ProgramController(s,'run',date,0),c=child(s,0,0);
    c.endSet(1000,1000);p.accept(c.finish(1000,1000),1000);p.pause(1200);
    const result=p.finish(1500,true);expect(result.ended).toBe('interrupted');expect(result.steps[0].sets[0].result.reps).toBe(0);expect(validProgramRecord(result)).toBe(true);
    result.program.title='changed';expect(p.finish(2000).program.title).toBe(s.program.title);
  });
});
