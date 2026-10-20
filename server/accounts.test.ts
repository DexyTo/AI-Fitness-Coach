import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildApp } from './app.js';
import { openDatabase, migrate } from './database.js';
import { TrainingController, type WorkoutRecord } from '../src/training/session';
import { demoPose } from '../src/pose/demo';

const cleanups:(() => unknown | Promise<unknown>)[]=[];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function setup() {
  const directory = mkdtempSync(join(tmpdir(),'playfit-accounts-'));
  cleanups.push(() => rmSync(directory,{ recursive:true,force:true }));
  const path = join(directory,'account.sqlite'); const db = openDatabase(path); migrate(db);
  const app = buildApp(db); cleanups.push(() => app.close());
  const request = (method:'GET'|'POST'|'PATCH'|'DELETE',url:string,payload?:unknown,cookie?:string,headers:Record<string,string>={}) => app.inject({ method,url,payload:payload as object,headers:{ 'x-playfit-request':'1',...cookie ? { cookie } : {},...headers } });
  const register = async (login='alice') => {
    const response = await request('POST','/api/auth/register',{ login,password:'Local-Pass-123' });
    expect(response.statusCode,response.body).toBe(201);
    return { cookie:String(response.headers['set-cookie']).split(';')[0], user:response.json().user };
  };
  const begin = async (cookie:string,requestId='request-1',mode='camera') => {
    const response = await request('POST','/api/runs',{ requestId,exercise:'squat',mode,goal:{ sets:1,reps:2,restSeconds:0 },conditions:'' },cookie);
    expect(response.statusCode,response.body).toBe(201);
    return response.json();
  };
  return { db,app,path,request,register,begin };
}
function record(id='old-1',mode:WorkoutRecord['mode']='camera') {
  return new TrainingController('squat',mode,{ sets:1,reps:2,restSeconds:0 },'',0,'2026-10-20T10:00:00.000Z',id).finish(1000,1000);
}
describe('accounts and protected workout history',() => {
  it('salts KDF passwords, never returns hashes, persists sessions, rotates login and invalidates logout',async () => {
    const { db,app,path,request,register }=setup();
    const alice=await register(), bob=await register('bob');
    const users=db.prepare('SELECT password_hash FROM users').all() as {password_hash:string}[];
    expect(users[0].password_hash).toMatch(/^scrypt-65536-8-1\$/); expect(users[0].password_hash).not.toBe(users[1].password_hash);
    expect(JSON.stringify(alice.user)).not.toMatch(/password|hash|Local-Pass/);
    const token=alice.cookie.split('=')[1]; const sessions=db.prepare('SELECT token_hash FROM auth_sessions').all();
    expect(JSON.stringify(sessions)).not.toContain(token); expect(sessions).toContainEqual({token_hash:createHash('sha256').update(token).digest('hex')});
    expect((await request('GET','/api/auth/me',undefined,alice.cookie)).json().user.id).toBe(alice.user.id);
    const wrong=await request('POST','/api/auth/login',{login:'alice',password:'wrong-password'});
    expect(wrong.statusCode).toBe(401);
    await app.close(); const reopened=openDatabase(path); expect(migrate(reopened)).toEqual([]); const next=buildApp(reopened); cleanups.push(() => next.close());
    expect((await next.inject({ url:'/api/auth/me',headers:{cookie:alice.cookie} })).json().user.id).toBe(alice.user.id);
    const login=await next.inject({method:'POST',url:'/api/auth/login',headers:{'x-playfit-request':'1',cookie:alice.cookie},payload:{login:'ALICE',password:'Local-Pass-123'}});
    expect(login.statusCode).toBe(200); expect(login.headers['set-cookie']).toMatch(/HttpOnly; SameSite=Strict; Max-Age=/); expect(login.headers['set-cookie']).not.toMatch(/Secure|Domain=/);
    expect((await next.inject({url:'/api/auth/me',headers:{cookie:alice.cookie}})).json().user).toBeNull();
    const fresh=String(login.headers['set-cookie']).split(';')[0];
    await next.inject({method:'POST',url:'/api/auth/logout',headers:{'x-playfit-request':'1',cookie:fresh},payload:{}});
    expect((await next.inject({url:'/api/auth/me',headers:{cookie:fresh}})).json().user).toBeNull();
    expect((await next.inject({url:'/api/auth/me',headers:{cookie:bob.cookie}})).json().user.id).toBe(bob.user.id);
  });
  it('validates credentials, rejects case-insensitive duplicate login and protects origin on auth and all writes',async () => {
    const { app,request,register }=setup(); await register();
    expect((await request('POST','/api/auth/register',{login:'ALICE',password:'Another-pass'})).statusCode).toBe(409);
    for (const body of [{login:'a',password:'12345678'},{login:'alice',password:'short'},{login:'alice',password:'12345678',userId:'other'}]) expect((await request('POST','/api/auth/login',body)).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:'/api/auth/login',payload:{login:'alice',password:'Local-Pass-123'}})).statusCode).toBe(403);
    expect((await request('POST','/api/auth/logout',{},undefined,{origin:'http://evil.invalid'})).statusCode).toBe(403);
    expect((await request('POST','/api/auth/logout',{},undefined,{'sec-fetch-site':'cross-site'})).statusCode).toBe(403);
    expect((await request('POST','/api/auth/logout',{},undefined,{origin:'http://localhost:80'})).statusCode).toBe(200);
  });
  it('requires auth, expires sessions and isolates profiles without accepting foreign user IDs',async () => {
    const {db,request,register}=setup(); const alice=await register(),bob=await register('bob');
    for (const url of ['/api/profile','/api/history']) expect((await request('GET',url)).statusCode).toBe(401);
    expect((await request('PATCH','/api/profile',{nickname:'Алиса',avatar:'sun'},alice.cookie)).json().user.nickname).toBe('Алиса');
    expect((await request('GET','/api/profile',undefined,bob.cookie)).json().user.nickname).toBe('bob');
    expect((await request('PATCH','/api/profile',{nickname:'Hack',avatar:'sun',userId:bob.user.id},alice.cookie)).statusCode).toBe(400);
    expect((await request('GET','/api/profile?userId=other',undefined,alice.cookie)).statusCode).toBe(400);
    expect((await request('GET','/api/profile',undefined,bob.cookie,{'x-playfit-user':alice.user.id})).statusCode).toBe(409);
    expect((await request('PATCH','/api/profile',{nickname:'   ',avatar:'sun'},alice.cookie)).statusCode).toBe(400);
    expect((await request('PATCH','/api/profile',{nickname:'Name',avatar:'remote-url'},alice.cookie)).statusCode).toBe(400);
    db.prepare("UPDATE auth_sessions SET expires_at='2000-01-01T00:00:00Z'").run();
    expect((await request('GET','/api/history',undefined,alice.cookie)).statusCode).toBe(401);
  });
  it('binds immutable snapshots to an owner, rejects fabricated aggregates and accepts exact retries only',async () => {
    const {request,register,begin,db}=setup(); const alice=await register(),bob=await register('bob'); const run=await begin(alice.cookie);
    const snapshot={requestId:'request-1',...run.snapshot};
    expect((await request('POST','/api/runs',snapshot,alice.cookie)).json().id).toBe(run.id);
    expect((await request('POST','/api/runs',{...snapshot,mode:'demo'},alice.cookie)).statusCode).toBe(409);
    const r=record(run.id);
    expect((await request('POST',`/api/runs/${run.id}/complete`,{record:r},bob.cookie)).statusCode).toBe(404);
    expect((await request('POST',`/api/runs/${run.id}/complete`,{record:{...r,mode:'video'}},alice.cookie)).statusCode).toBe(409);
    const fake=structuredClone(r); fake.sets[0].result.reps=100;
    expect((await request('POST',`/api/runs/${run.id}/complete`,{record:fake},alice.cookie)).statusCode).toBe(400);
    const badTime=structuredClone(r); badTime.sets[0].durationMs=2000;
    expect((await request('POST',`/api/runs/${run.id}/complete`,{record:badTime},alice.cookie)).statusCode).toBe(400);
    expect((await request('POST',`/api/runs/${run.id}/complete`,{record:{...r,landmarks:[{x:1}]}},alice.cookie)).statusCode).toBe(400);
    const saved=await request('POST',`/api/runs/${run.id}/complete`,{record:r},alice.cookie); expect(saved.statusCode,saved.body).toBe(201);
    const retry=await request('POST',`/api/runs/${run.id}/complete`,{record:r},alice.cookie); expect(retry.statusCode).toBe(200); expect(retry.json()).toEqual(saved.json());
    expect((await request('POST',`/api/runs/${run.id}/complete`,{record:{...r,duration:2}},alice.cookie)).statusCode).toBe(409);
    expect(db.prepare('SELECT COUNT(*) AS count FROM workout_results').get()).toEqual({count:1});
    const id=saved.json().result.id;
    expect((await request('GET',`/api/history/${id}`,undefined,bob.cookie)).statusCode).toBe(404);
    expect((await request('DELETE',`/api/history/${id}`,undefined,bob.cookie)).statusCode).toBe(404);
    expect((await request('GET','/api/history',undefined,bob.cookie)).json().results).toEqual([]);
    expect((await request('GET','/api/history',undefined,alice.cookie)).json().results).toHaveLength(1);
  });
  it('previews import without writes, deduplicates per owner, preserves provenance and rolls conflicts back',async () => {
    const {request,register,db}=setup(); const alice=await register(),bob=await register('bob');
    const payload={schemaVersion:1,source:'playfit.workouts.v1',records:[record('old-camera'),record('old-demo','demo')]};
    const preview=await request('POST','/api/history/import/preview',payload,alice.cookie); expect(preview.statusCode,preview.body).toBe(200); expect(preview.json()).toEqual({added:2,existing:0,total:2});
    expect(db.prepare('SELECT COUNT(*) AS count FROM workout_results').get()).toEqual({count:0});
    expect((await request('POST','/api/history/import',payload,alice.cookie)).json()).toEqual({added:2,existing:0,total:2});
    expect((await request('POST','/api/history/import',payload,alice.cookie)).json()).toEqual({added:0,existing:2,total:2});
    expect((await request('POST','/api/history/import',payload,bob.cookie)).json().added).toBe(2);
    const list=(await request('GET','/api/history',undefined,alice.cookie)).json().results;
    const imported=list.find((r:{originalId:string}) => r.originalId === 'old-camera');
    expect(imported).toMatchObject({source:'historical_import',sourceVersion:1,originalId:'old-camera',runId:null});
    expect(db.prepare('SELECT COUNT(*) AS count FROM workout_runs').get()).toEqual({count:0});
    const conflict={...payload,records:[record('new-id'),{...record('old-camera'),duration:2}]};
    expect((await request('POST','/api/history/import',conflict,alice.cookie)).statusCode).toBe(409);
    expect((await request('GET','/api/history',undefined,alice.cookie)).json().results).toHaveLength(2);
    const stats=(await request('GET','/api/profile',undefined,alice.cookie)).json().stats;
    expect(stats).toEqual({workouts:1,reps:0,seconds:1,demos:1});
    expect((await request('DELETE',`/api/history/${imported.id}`,undefined,alice.cookie)).statusCode).toBe(200);
    expect((await request('DELETE',`/api/history/${imported.id}`,undefined,alice.cookie)).statusCode).toBe(200);
    expect((await request('GET',`/api/history/${imported.id}`,undefined,alice.cookie)).json().result.archivedAt).toBeTruthy();
    expect((await request('POST','/api/history/import',payload,alice.cookie)).json().added).toBe(0);
    expect((await request('GET','/api/history',undefined,alice.cookie)).json().results).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM workout_results').get()).toEqual({count:4});
  });
  it('calculates nonzero profile totals from attempts and excludes demos and archived records',async () => {
    const {request,register}=setup(); const alice=await register();
    const records=(['camera','video','demo'] as const).map(mode => {
      const controller=new TrainingController('squat',mode,{sets:1,reps:2,restSeconds:0},'',0,'2026-10-20T10:00:00Z',`stats-${mode}`);
      for (let t=90;t<=3600;t+=90) controller.sample(demoPose('squat',t-90),t,1.6,t);
      const result=controller.finish(3600,3600); expect(result.sets[0].result.reps).toBe(1); return result;
    });
    expect((await request('POST','/api/history/import',{schemaVersion:1,source:'playfit.workouts.v1',records},alice.cookie)).statusCode).toBe(200);
    expect((await request('GET','/api/profile',undefined,alice.cookie)).json().stats).toEqual({workouts:2,reps:2,seconds:7,demos:1});
    const list=(await request('GET','/api/history',undefined,alice.cookie)).json().results;
    const camera=list.find((r:{record:WorkoutRecord}) => r.record.mode === 'camera');
    await request('DELETE',`/api/history/${camera.id}`,undefined,alice.cookie);
    expect((await request('GET','/api/profile',undefined,alice.cookie)).json().stats).toEqual({workouts:1,reps:1,seconds:4,demos:1});
  });
  it('keeps completed workouts on disk across server restart and repeated migrations',async () => {
    const {app,path,request,register,begin}=setup(); const alice=await register(); const run=await begin(alice.cookie,'disk','demo');
    const response=await request('POST',`/api/runs/${run.id}/complete`,{record:record(run.id,'demo')},alice.cookie); expect(response.statusCode,response.body).toBe(201);
    await app.close(); const reopened=openDatabase(path); expect(migrate(reopened)).toEqual([]); const next=buildApp(reopened); cleanups.push(() => next.close());
    const saved=await next.inject({url:'/api/history',headers:{cookie:alice.cookie}}); expect(saved.json().results[0].runId).toBe(run.id);
    expect(saved.json().results[0].record.mode).toBe('demo');
  });
  it('limits authentication attempts without returning credentials in errors',async () => {
    const {request}=setup();
    for (let i=0;i<30;i++) expect((await request('POST','/api/auth/login',{login:'missing',password:'wrong-password'})).statusCode).toBe(401);
    const limited=await request('POST','/api/auth/login',{login:'missing',password:'wrong-password'}); expect(limited.statusCode).toBe(429); expect(limited.body).not.toContain('wrong-password');
  },30000);
});
