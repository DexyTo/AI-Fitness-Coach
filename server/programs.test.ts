import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app.js';
import { openDatabase, migrate } from './database.js';
import { TrainingController } from '../src/training/session';
import { validProgramRecord, type ProgramPlan, type ProgramRecord, type ProgramSnapshot } from '../shared/program';
const cleanups:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function setup() {
  const directory=mkdtempSync(join(tmpdir(),'playfit-programs-'));cleanups.push(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'test.sqlite'),db=openDatabase(path);migrate(db);const app=buildApp(db);cleanups.push(()=>app.close());
  const req=(method:'GET'|'POST'|'DELETE',url:string,payload?:unknown,cookie?:string)=>app.inject({method,url,payload:payload as object,headers:{'x-playfit-request':'1',...(cookie?{cookie}:{})}});
  const register=async(login:string)=>{const r=await req('POST','/api/auth/register',{login,password:'Local-Pass-123'});expect(r.statusCode).toBe(201);return String(r.headers['set-cookie']).split(';')[0];};
  return {db,path,app,req,register};
}
function result(snapshot:ProgramSnapshot,id:string,date:string):ProgramRecord {
  return {schemaVersion:2,kind:'program',id,date,program:structuredClone(snapshot.program),mode:snapshot.mode,conditions:snapshot.conditions,ended:'completed',duration:10,
    steps:snapshot.program.steps.map((s,i)=>{const c=new TrainingController(s.exercise,snapshot.mode,s.goal,snapshot.conditions,0,new Date(Date.parse(date)+i*2000).toISOString(),`${id}:${i}`);for(let j=0;j<s.goal.sets;j++){if(j)c.resume(j*10);c.endSet(j*10+1,j*10+1);}return c.finish(1000,1000);})};
}
describe('program catalog and immutable results',()=>{
  it('seeds seven executable templates once and preserves edited data across migrations/reopen',async()=>{
    const {req,db,path,app}=setup();const data=(await req('GET','/api/programs')).json().programs as ProgramPlan[];
    expect(data).toHaveLength(7);expect(data.every(p=>p.steps.length&&p.steps.every(s=>['squat','pushup'].includes(s.exercise)))).toBe(true);
    expect((await req('GET','/api/programs/missing')).statusCode).toBe(404);
    db.prepare("UPDATE programs SET title='kept' WHERE id=?").run(data[0].id);expect(migrate(db)).toEqual([]);
    await app.close();const reopened=openDatabase(path);cleanups.push(()=>reopened.close());expect(migrate(reopened)).toEqual([]);expect(reopened.prepare('SELECT title FROM programs WHERE id=?').get(data[0].id)).toEqual({title:'kept'});
  });
  it('isolates owners, freezes adjusted plans, validates order/status/aggregates and saves exactly once',async()=>{
    const {req,db,register,app,path}=setup(),alice=await register('alice'),bob=await register('bob');
    const plan=(await req('GET','/api/programs/squat-pushup')).json().program as ProgramPlan;plan.steps.forEach(s=>{s.goal={sets:1,reps:1,restSeconds:0};s.transitionSeconds=0;});
    const snapshot:ProgramSnapshot={kind:'program',program:plan,mode:'demo',conditions:''};
    expect((await req('POST','/api/runs',{...snapshot,requestId:'one'})).statusCode).toBe(401);
    const begin=await req('POST','/api/runs',{...snapshot,requestId:'one'},alice);expect(begin.statusCode,begin.body).toBe(201);const run=begin.json();
    expect((await req('POST','/api/runs',{...snapshot,requestId:'one'},alice)).json().id).toBe(run.id);
    expect((await req('POST','/api/runs',{...snapshot,mode:'video',requestId:'video'},alice)).statusCode).toBe(400);
    expect((await req('POST','/api/runs',{...snapshot,program:{...plan,title:'fake'},requestId:'fake'},alice)).statusCode).toBe(409);
    const record=result(snapshot,run.id,run.createdAt);expect(validProgramRecord(record)).toBe(true);
    const complete=(r:ProgramRecord,cookie=alice)=>req('POST',`/api/runs/${run.id}/complete`,{record:r},cookie);
    expect((await complete(record,bob)).statusCode).toBe(404);
    expect((await complete({...record,steps:[record.steps[1],record.steps[0]]})).statusCode).toBe(400);
    expect((await complete({...record,steps:[record.steps[0]]})).statusCode).toBe(400);
    const bad=structuredClone(record);bad.steps[0].sets[0].result.reps=100;expect((await complete(bad)).statusCode).toBe(400);
    const changed=structuredClone(record);changed.program.steps[0].goal.reps=3;changed.steps[0].goal.reps=3;expect((await complete(changed)).statusCode).toBe(409);
    expect((await req('POST',`/api/runs/${run.id}/complete`,{record:{...record,landmarks:[]}},alice)).statusCode).toBe(400);
    db.prepare("UPDATE programs SET title='new version',version=2 WHERE id=?").run(plan.id);
    expect((await req('POST','/api/runs',{...snapshot,requestId:'one'},alice)).json().id).toBe(run.id);
    const saved=await complete(record);expect(saved.statusCode,saved.body).toBe(201);expect((await complete(record)).statusCode).toBe(200);expect((await complete({...record,duration:11})).statusCode).toBe(409);
    const id=saved.json().result.id;expect(saved.json().result.sourceVersion).toBe(2);
    expect((await req('GET','/api/history',undefined,bob)).json().results).toEqual([]);expect((await req('GET',`/api/history/${id}`,undefined,bob)).statusCode).toBe(404);
    expect((await req('GET','/api/profile',undefined,alice)).json().stats).toMatchObject({workouts:0,demos:1});
    expect((await req('GET','/api/history',undefined,alice)).json().results).toHaveLength(1);
    await app.close();const reopened=openDatabase(path);expect(migrate(reopened)).toEqual([]);const next=buildApp(reopened);cleanups.push(()=>next.close());
    const after=await next.inject({url:`/api/history/${id}`,headers:{cookie:alice}});expect(after.json().result.record).toEqual(record);
    await next.inject({method:'DELETE',url:`/api/history/${id}`,headers:{cookie:alice,'x-playfit-request':'1'}});
    const retry=await next.inject({method:'POST',url:`/api/runs/${run.id}/complete`,payload:{record},headers:{cookie:alice,'x-playfit-request':'1'}});expect(retry.statusCode).toBe(200);
    expect((await next.inject({url:'/api/history',headers:{cookie:alice}})).json().results).toEqual([]);
  });
  it('persists interrupted prefixes and empty early exits without inventing future steps',async()=>{
    const {req,register}=setup(),cookie=await register('alice');const plan=(await req('GET','/api/programs/squat-pushup')).json().program as ProgramPlan;
    const snapshot:ProgramSnapshot={kind:'program',program:plan,mode:'camera',conditions:''};
    for(const empty of [true,false]) {
      const run=(await req('POST','/api/runs',{...snapshot,requestId:String(empty)},cookie)).json();
      const record=result(snapshot,run.id,run.createdAt);record.ended='interrupted';record.steps=empty?[]:[record.steps[0]];
      expect((await req('POST',`/api/runs/${run.id}/complete`,{record},cookie)).statusCode).toBe(201);
    }
    expect((await req('GET','/api/history',undefined,cookie)).json().results.map((r:{record:ProgramRecord})=>r.record.steps.length)).toEqual([0,1]);
  });
});
