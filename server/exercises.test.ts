import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app.js';
import { migrate, openDatabase } from './database.js';
import { projectRoot } from './config.js';
import { exerciseIds, type ExerciseType } from '../src/exercises/types.js';
import { exerciseRegistry, isHold, optionsFor } from '../src/exercises/registry.js';
import { TrainingController } from '../src/training/session.js';
import { demoPose } from '../src/pose/demo.js';
import type { TrainingGoal } from '../shared/workout.js';
import { isWorkoutRecord, parseHistory } from '../shared/historyValidation.js';
import { validProgramRecord, type ProgramPlan, type ProgramRecord } from '../shared/program.js';
import { seedChallenges } from './challengeSeed.js';

const cleanup:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
const goalFor=(id:ExerciseType):TrainingGoal=>isHold(id)?{schemaVersion:2,unit:'seconds',seconds:2,sets:1,restSeconds:0,options:optionsFor(id)}:{schemaVersion:2,unit:'reps',reps:1,sets:1,restSeconds:0,options:optionsFor(id)};
function setup(old=false) {
  const dir=mkdtempSync(join(tmpdir(),'playfit-exercises-'));cleanup.push(()=>rmSync(dir,{recursive:true,force:true}));
  const db=openDatabase(join(dir,'test.sqlite'));cleanup.push(()=>db.close());
  if(old){const path=join(dir,'migrations');mkdirSync(path);for(const name of readdirSync(join(projectRoot,'server/migrations')).filter(n=>n<'009'))copyFileSync(join(projectRoot,'server/migrations',name),join(path,name));migrate(db,path);}
  else migrate(db);
  for(const [id,token] of [['alice','a'],['bob','b']]) {
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id,'test-only-not-a-login',id,'sprout','2026-10-01T00:00:00Z');
    db.prepare('INSERT INTO auth_sessions VALUES (?,?,?)').run(createHash('sha256').update(token.repeat(64)).digest('hex'),id,'2099-01-01T00:00:00Z');
  }
  const app=buildApp(db);cleanup.push(()=>app.close());
  const req=(method:'GET'|'POST'|'PUT',url:string,payload?:unknown,user='alice')=>app.inject({method,url,payload:payload as object,headers:{'x-playfit-request':'1','x-playfit-user':user,cookie:`playfit_session=${(user==='alice'?'a':'b').repeat(64)}`}});
  return {db,app,req};
}
function simulated(id:ExerciseType,goal:TrainingGoal,run:{id:string;createdAt:string},stepIndex?:number,mode:'camera'|'demo'|'video'='camera') {
  const c=new TrainingController(id,mode,goal,'SYNTHETIC API TEST; no camera',0,run.createdAt,stepIndex===undefined?run.id:`${run.id}:${stepIndex}`);
  for(let t=0;t<=5900;t+=100)c.sample(demoPose(id,t,goal.options),t,1.6,t);
  return c.finish(5900,5900);
}
describe('new exercise storage and reward compatibility (synthetic camera fixtures)',()=>{
  it.each(exerciseIds.slice(2))('%s: stores, reads, exports/imports and completes idempotently across owners',async id=>{
    const {req,db}=setup(),goal=goalFor(id);if(id==='overhead_press')goal.options!.weightKg=5;
    const begin=await req('POST','/api/runs',{requestId:`new-${id}`,exercise:id,mode:'camera',goal,conditions:'SYNTHETIC API TEST; no camera'});expect(begin.statusCode,begin.body).toBe(201);
    const run=begin.json(),record=simulated(id,goal,run);expect(isWorkoutRecord(record)).toBe(true);
    const complete=await req('POST',`/api/runs/${run.id}/complete`,{record});expect(complete.statusCode,complete.body).toBe(201);
    expect(complete.json().result.sourceVersion).toBe(3);expect(complete.json().result.reward).toMatchObject({reason:isHold(id)?'unsupported_hold':'awarded',xp:isHold(id)?0:20});
    expect((await req('POST',`/api/runs/${run.id}/complete`,{record})).statusCode).toBe(200);
    expect(db.prepare('SELECT COUNT(*) n FROM progression_events').get()).toEqual({n:1});
    const saved=(await req('GET',`/api/history/${complete.json().result.id}`)).json().result.record;
    expect(saved).toEqual(record);expect(parseHistory(JSON.stringify({schemaVersion:1,records:[saved]}))).toEqual([record]);
    expect((await req('GET',`/api/history/${complete.json().result.id}`,undefined,'bob')).statusCode).toBe(404);
    expect((await req('POST',`/api/runs/${run.id}/complete`,{record},'bob')).statusCode).toBe(404);
    const body={schemaVersion:1,source:'playfit.workouts.v1',records:[record]};
    expect((await req('POST','/api/history/import/preview',body,'bob')).json().added).toBe(1);
    expect((await req('POST','/api/history/import',body,'bob')).json().added).toBe(1);
    expect((await req('POST','/api/history/import',body,'bob')).json().existing).toBe(1);
    expect((await req('GET','/api/history',undefined,'bob')).json().results[0].reward).toMatchObject({reason:'import',xp:0});
    expect(db.prepare('SELECT COUNT(*) n FROM reward_ledger WHERE user_id=?').get('bob')).toEqual({n:0});
    expect(db.prepare("SELECT COUNT(*) n FROM reward_ledger WHERE currency='competition_points'").get()).toEqual({n:0});
  });
  it.each(['demo','video'] as const)('new %s summaries never earn rewards',async mode=>{
    const {req,db}=setup(),id='lateral_raise',goal=goalFor(id);
    const run=(await req('POST','/api/runs',{requestId:mode,exercise:id,goal,mode,conditions:'SYNTHETIC API TEST; no camera'})).json();
    const record=simulated(id,goal,run,undefined,mode),saved=await req('POST',`/api/runs/${run.id}/complete`,{record});
    expect(saved.statusCode,saved.body).toBe(201);expect(saved.json().result.reward).toMatchObject({reason:mode,xp:0});expect(db.prepare('SELECT COUNT(*) n FROM reward_ledger').get()).toEqual({n:0});
  });
  it('does not replace the legacy squat/pushup variety badge with two new exercises',async()=>{
    const {req}=setup();
    for(const id of ['reverse_lunge','side_bend'] as const){const goal=goalFor(id),run=(await req('POST','/api/runs',{requestId:id,exercise:id,mode:'camera',goal,conditions:'SYNTHETIC API TEST; no camera'})).json();expect((await req('POST',`/api/runs/${run.id}/complete`,{record:simulated(id,goal,run)})).statusCode).toBe(201);}
    expect((await req('GET','/api/me/progression')).json().progression.achievements.find((a:{id:string})=>a.id==='variety')).toMatchObject({progress:0,earnedAt:null});
  });
  it('rejects mismatched units/options, corrupted hold totals and substituted rule snapshots',async()=>{
    const {req}=setup(),id='front_hold',goal=goalFor(id);
    for(const bad of [{sets:1,reps:10,restSeconds:0},{...goal,reps:3},{...goal,options:{...goal.options,weightKg:-1}},{...goal,options:{...goal.options,variant:'seated'}}])expect((await req('POST','/api/runs',{requestId:'invalid',exercise:id,mode:'camera',conditions:'',goal:bad})).statusCode).toBe(400);
    const run=(await req('POST','/api/runs',{requestId:'good',exercise:id,mode:'camera',conditions:'SYNTHETIC API TEST; no camera',goal})).json();
    const record=simulated(id,goal,run),bad=structuredClone(record);bad.sets[0].result.hold!.creditedMs+=100;
    expect((await req('POST',`/api/runs/${run.id}/complete`,{record:bad})).statusCode).toBe(400);
    const substituted=structuredClone(record);substituted.metadata.exerciseSnapshot!.thresholds.elbow=120;
    expect((await req('POST',`/api/runs/${run.id}/complete`,{record:substituted})).statusCode).toBe(409);
    const options=structuredClone(record);options.goal.options!.weightKg=10;options.metadata.exerciseSnapshot!.options.weightKg=10;
    expect((await req('POST',`/api/runs/${run.id}/complete`,{record:options})).statusCode).toBe(409);
    expect((await req('POST',`/api/runs/${run.id}/complete`,{record})).statusCode).toBe(201);
  });
  it('persists mixed-unit program revisions and freezes a run through editing',async()=>{
    const {req,db}=setup(),steps=(['wall_sit','overhead_press'] as const).map((exercise,i)=>({id:`s${i}`,exercise,goal:goalFor(exercise),transitionSeconds:0}));
    const created=await req('POST','/api/programs',{title:'Секунды и повторы',description:'synthetic test',steps});expect(created.statusCode,created.body).toBe(201);
    const plan=created.json().program as ProgramPlan;expect((await req('GET',`/api/programs/${plan.id}`)).json().program).toEqual(plan);
    const snapshot={kind:'program',program:plan,mode:'camera',conditions:'SYNTHETIC API TEST; no camera'};
    const begin=await req('POST','/api/runs',{requestId:'mixed',...snapshot});expect(begin.statusCode,begin.body).toBe(201);const run=begin.json();
    expect((await req('PUT',`/api/programs/${plan.id}`,{title:'Изменён',description:'changed',steps:steps.slice(1),version:1})).statusCode).toBe(200);
    expect((await req('POST','/api/runs',{requestId:'mixed',...snapshot})).statusCode).toBe(200);
    const record:ProgramRecord={schemaVersion:2,kind:'program',id:run.id,date:run.createdAt,program:plan,mode:'camera',conditions:snapshot.conditions,ended:'completed',duration:12,steps:steps.map((s,i)=>simulated(s.exercise,s.goal,{id:run.id,createdAt:new Date(Date.parse(run.createdAt)+i*6000).toISOString()},i))};
    expect(validProgramRecord(record)).toBe(true);
    const saved=await req('POST',`/api/runs/${run.id}/complete`,{record});expect(saved.statusCode,saved.body).toBe(201);expect(saved.json().result.reward).toMatchObject({reason:'unsupported_hold',xp:0});
    expect(db.prepare('SELECT COUNT(*) n FROM reward_ledger').get()).toEqual({n:0});
  });
  it('uses the rules frozen when analysis and the server run began',async()=>{
    const {req}=setup(),id='side_bend',goal=goalFor(id),conditions='SYNTHETIC API TEST; no camera';
    const run=(await req('POST','/api/runs',{requestId:'frozen',exercise:id,mode:'camera',goal,conditions})).json();
    const c=new TrainingController(id,'camera',goal,conditions,0,run.createdAt,run.id),old=exerciseRegistry[id].thresholds.target;
    try {exerciseRegistry[id].thresholds.target=100;for(let t=0;t<=5900;t+=100)c.sample(demoPose(id,t),t,1.6,t);}
    finally {exerciseRegistry[id].thresholds.target=old;}
    const record=c.finish(5900,5900);expect(record.sets[0].result.reps).toBe(1);expect(record.metadata.exerciseSnapshot!.thresholds.target).toBe(old);
    expect((await req('POST',`/api/runs/${run.id}/complete`,{record})).statusCode).toBe(201);
  });
  it('upgrades a populated v8 database without rewriting versions, repeats migration/seed and preserves legacy history',()=>{
    const {db}=setup(true);
    const versions=db.prepare('SELECT * FROM program_versions').all();
    db.prepare('INSERT INTO program_favorites VALUES (?,?,?)').run('alice','squat-intro','2026-10-01T00:00:00Z');
    const old=new TrainingController('squat','demo',{sets:1,reps:1,restSeconds:0},'',0);for(let t=0;t<10000;t+=100)old.sample(demoPose('squat',t),t,1.6,t);const record=old.finish(10000,10000);
    expect(isWorkoutRecord(record)).toBe(true);
    const raw=JSON.stringify(record);
    db.prepare("INSERT INTO workout_results (id,user_id,source,source_version,original_id,record_json,created_at) VALUES ('old-history','alice','historical_import',1,?,?,?)").run(record.id,raw,record.date);
    expect(migrate(db)).toEqual(['009_exercise_units.sql']);expect(migrate(db)).toEqual([]);
    expect(db.prepare('SELECT * FROM program_versions').all()).toEqual(versions);expect(db.prepare('SELECT COUNT(*) n FROM program_favorites').get()).toEqual({n:1});
    expect(db.prepare("SELECT record_json FROM workout_results WHERE id='old-history'").get()).toEqual({record_json:raw});
    const before=db.prepare('SELECT * FROM program_steps').all();seedChallenges(db,new Date('2026-10-21T12:00:00Z'));const count=db.prepare('SELECT COUNT(*) n FROM challenge_definitions').get();seedChallenges(db,new Date('2026-10-21T12:00:00Z'));expect(db.prepare('SELECT COUNT(*) n FROM challenge_definitions').get()).toEqual(count);expect(db.prepare('SELECT * FROM program_steps').all()).toEqual(before);
    expect(parseHistory(JSON.stringify({schemaVersion:1,records:[record]}))).toEqual([record]);
    expect(()=>db.prepare('INSERT INTO program_steps (program_id,position,id,exercise,sets,reps,rest_seconds,transition_seconds) VALUES (?,?,?,?,?,?,?,?)').run('squat-intro',3,'bad','wall_sit',1,10,0,0)).toThrow();
    expect(db.pragma('foreign_key_check')).toEqual([]);expect(db.pragma('integrity_check',{simple:true})).toBe('ok');
  });
});
