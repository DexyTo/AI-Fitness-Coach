import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { buildApp } from './app.js';
import { migrate, openDatabase } from './database.js';
import { projectRoot } from './config.js';
import { TrainingController } from '../src/training/session';
import { demoPose } from '../src/pose/demo';
import type { ProgramPlan, ProgramRecord } from '../shared/program.js';
import type { WorkoutRecord } from '../shared/workout.js';
import { appendReward, levelFor, projectDay, progression } from './progression.js';

const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'playfit-progression-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'test.sqlite'), db = openDatabase(path); migrate(db);
  const app = buildApp(db); cleanups.push(() => app.close());
  // Test-only accounts avoid KDF noise; auth ownership is still exercised through real API sessions.
  for (const id of ['alice', 'bob']) {
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id,id,'test-only',id,'sprout','2026-10-01T00:00:00Z');
    db.prepare('INSERT INTO auth_sessions VALUES (?,?,?)').run(createHash('sha256').update(id === 'alice' ? 'a'.repeat(64) : 'b'.repeat(64)).digest('hex'),id,'2099-01-01T00:00:00Z');
  }
  const headers = (user = 'alice') => ({ cookie:`playfit_session=${(user === 'alice' ? 'a' : 'b').repeat(64)}`, 'x-playfit-request':'1', 'x-playfit-user':user });
  const req = (method:'GET'|'POST'|'DELETE',url:string,payload?:unknown,user='alice') => app.inject({ method,url,payload:payload as object,headers:headers(user) });
  const begin = async (mode='camera',exercise='squat',reps=1) => {
    const response = await req('POST','/api/runs',{ requestId:randomUUID(),exercise,mode,goal:{ sets:1,reps,restSeconds:0 },conditions:'' });
    expect(response.statusCode,response.body).toBe(201); return response.json() as {id:string;createdAt:string};
  };
  const complete = async (mode:WorkoutRecord['mode']='camera',exercise:WorkoutRecord['exercise']='squat',reps=1) => {
    const run = await begin(mode,exercise,reps), record = fixture(run.id,run.createdAt,mode,exercise,reps);
    const response = await req('POST',`/api/runs/${run.id}/complete`,{record});
    expect(response.statusCode,response.body).toBe(201); return {run,record,result:response.json().result};
  };
  return {dir,path,db,app,headers,req,begin,complete};
}
// Synthetic fixtures labelled as camera solely to exercise server accounting, not camera accuracy.
function fixture(id:string,date:string,mode:WorkoutRecord['mode']='camera',exercise:WorkoutRecord['exercise']='squat',reps=1) {
  const controller = new TrainingController(exercise,mode,{sets:1,reps,restSeconds:0},'',0,date,id);
  let t = 90;
  for (; t < 180000 && controller.phase !== 'completed'; t += 90) controller.sample(demoPose(exercise,t-90),t,1.6,t);
  const record = controller.finish(t,t); expect(record.sets[0].result.reps).toBe(reps); return record;
}
const freeze = (now:string) => { vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(new Date(now)); };

describe('server progression accounting', () => {
  it('uses Kyiv calendar boundaries including DST and exact level thresholds', () => {
    expect(projectDay('2026-10-20T20:59:59Z')).toBe('2026-10-20');
    expect(projectDay('2026-10-20T21:00:00Z')).toBe('2026-10-21');
    expect(projectDay('2026-12-01T21:59:59Z')).toBe('2026-12-01');
    expect(projectDay('2026-12-01T22:00:00Z')).toBe('2026-12-02');
    expect(projectDay('2026-10-25T00:59:59Z')).toBe('2026-10-25');
    expect(projectDay('2026-10-25T01:00:00Z')).toBe('2026-10-25');
    expect(levelFor(0)).toEqual({xp:0,level:1,levelXp:0,nextLevelXp:100});
    expect(levelFor(99).level).toBe(1); expect(levelFor(100)).toMatchObject({level:2,levelXp:0}); expect(levelFor(220)).toMatchObject({level:3,levelXp:20});
  });
  it('awards once under competing connections, persists receipt across retry/restart and isolates users', async () => {
    const {db,path,app,headers,req,begin} = setup(); freeze('2026-10-20T10:00:00Z');
    const run = await begin(), record = fixture(run.id,'2090-01-01T00:00:00Z');
    const other = buildApp(openDatabase(path)); cleanups.push(() => other.close());
    const url = `/api/runs/${run.id}/complete`;
    const responses = await Promise.all([req('POST',url,{record}),other.inject({method:'POST',url,payload:{record},headers:headers()})]);
    expect(responses.map(r=>r.statusCode).sort()).toEqual([200,201]);
    expect(responses[0].json()).toEqual(responses[1].json());
    const saved = responses[0].json().result;
    expect(saved.reward).toEqual({reason:'awarded',xp:20,earnedAt:'2026-10-20T10:00:00.000Z',achievements:['Первый шаг']});
    expect(db.prepare('SELECT COUNT(*) AS n FROM reward_ledger').get()).toEqual({n:1});
    expect((await req('POST',url,{record},'bob')).statusCode).toBe(404);
    expect((await req('GET',`/api/history/${saved.id}`,undefined,'bob')).statusCode).toBe(404);
    expect((await req('GET','/api/me/overview',undefined,'bob')).json()).toMatchObject({progression:{xp:0},recent:[]});
    expect((await req('GET','/api/me/progression?userId=alice')).statusCode).toBe(400);
    expect((await app.inject({url:'/api/me/overview'})).statusCode).toBe(401);
    await req('DELETE',`/api/history/${saved.id}`);
    expect((await req('GET','/api/me/overview')).json()).toMatchObject({progression:{xp:20,stats:{workouts:1,days:1}},recent:[]});
    await app.close(); const reopened = openDatabase(path); expect(migrate(reopened)).toEqual([]);
    const next = buildApp(reopened); cleanups.push(()=>next.close());
    expect((await next.inject({url:`/api/history/${saved.id}`,headers:headers()})).json().result.reward).toEqual(saved.reward);
    expect((await next.inject({url:'/api/me/progression',headers:headers()})).json().progression).toMatchObject({xp:20,level:1,stats:{workouts:1}});
  });
  it('enforces daily XP cap on server completion day, continues badge progress and unlocks all six badges once', async () => {
    const {complete,db,req} = setup(); freeze('2026-10-20T20:59:59Z');
    for(let i=0;i<4;i++) expect((await complete('camera',i===1?'pushup':'squat',10)).result.reward).toMatchObject({xp:i<3?20:0,reason:i<3?'awarded':'daily_limit'});
    expect((await req('GET','/api/me/progression')).json().progression).toMatchObject({xp:60,todayXp:60,stats:{workouts:4,reps:40,days:1,exercises:2}});
    vi.setSystemTime(new Date('2026-10-20T21:00:00Z'));
    expect((await complete('camera','squat',10)).result.reward).toMatchObject({xp:20,achievements:['В своём ритме']});
    vi.setSystemTime(new Date('2026-10-21T21:00:00Z'));
    for(let i=5;i<10;i++)await complete('camera','squat',10);
    const data=(await req('GET','/api/me/progression')).json().progression;
    expect(data).toMatchObject({xp:140,level:2,levelXp:40,todayXp:60,stats:{workouts:10,reps:100,days:3,exercises:2}});
    expect(data.achievements.every((a:{earnedAt:string;progress:number;target:number})=>a.earnedAt&&a.progress===a.target)).toBe(true);
    expect(data.activity.slice(-3).map((d:{workouts:number})=>d.workouts)).toEqual([4,1,5]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_achievements').get()).toEqual({n:6});
    await complete(); expect(db.prepare('SELECT COUNT(*) AS n FROM user_achievements').get()).toEqual({n:6});
  });
  it('excludes demo, video, import, legacy runs, interrupted and manually ended below-target sessions', async () => {
    const {begin,req,complete,db} = setup(); freeze('2026-10-20T10:00:00Z');
    for(const mode of ['demo','video'] as const) expect((await complete(mode)).result.reward).toMatchObject({reason:mode,xp:0,achievements:[]});
    const run=await begin('camera','squat',2);
    const incomplete=fixture(run.id,run.createdAt); incomplete.goal.reps=2;
    expect((await req('POST',`/api/runs/${run.id}/complete`,{record:incomplete})).json().result.reward.reason).toBe('incomplete');
    const interrupted=await begin();const r=fixture(interrupted.id,interrupted.createdAt);r.sets[0].ended='interrupted';
    expect((await req('POST',`/api/runs/${interrupted.id}/complete`,{record:r})).json().result.reward.reason).toBe('incomplete');
    const legacy=await begin();db.prepare('UPDATE workout_runs SET reward_rules_version=NULL WHERE id=?').run(legacy.id);
    expect((await req('POST',`/api/runs/${legacy.id}/complete`,{record:fixture(legacy.id,legacy.createdAt)})).json().result.reward.reason).toBe('legacy');
    const imported={schemaVersion:1,source:'playfit.workouts.v1',records:[fixture('imported','2000-01-01T00:00:00Z')]};
    await req('POST','/api/history/import',imported); await req('POST','/api/history/import',imported);
    expect((await req('GET','/api/history')).json().results.find((r:{source:string})=>r.source==='historical_import').reward.reason).toBe('import');
    expect((await req('GET','/api/me/progression')).json().progression).toMatchObject({xp:0,stats:{workouts:0,reps:0,days:0,exercises:0}});
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_achievements').get()).toEqual({n:0});
    expect((await req('POST',`/api/runs/${legacy.id}/complete`,{record:fixture(legacy.id,legacy.createdAt),xp:100})).statusCode).toBe(400);
  });
  it('serializes different completions competing for the last daily reward', async () => {
    const {complete,begin,req,path,headers,db}=setup();freeze('2026-10-20T20:59:59Z');
    await complete();await complete();
    const runs=await Promise.all([begin(),begin()]);
    const other=buildApp(openDatabase(path));cleanups.push(()=>other.close());
    const records=runs.map(r=>fixture(r.id,r.createdAt));
    const responses=await Promise.all([req('POST',`/api/runs/${runs[0].id}/complete`,{record:records[0]}),other.inject({method:'POST',url:`/api/runs/${runs[1].id}/complete`,payload:{record:records[1]},headers:headers()})]);
    expect(responses.map(r=>r.statusCode)).toEqual([201,201]);
    expect(responses.map(r=>r.json().result.reward.xp).sort((a,b)=>a-b)).toEqual([0,20]);
    expect(progression(db,'alice')).toMatchObject({xp:60,stats:{workouts:4}});
    vi.setSystemTime(new Date('2026-10-20T21:00:00Z'));
    expect((await req('POST',`/api/runs/${runs[0].id}/complete`,{record:records[0]})).json()).toEqual(responses[0].json());
    expect(progression(db,'alice').todayXp).toBe(0);
  });
  it('rewards an entire program once, checks every step target and rejects snapshot substitution', async () => {
    const {req,db} = setup(); freeze('2026-10-20T10:00:00Z');
    const plan=(await req('GET','/api/programs/squat-pushup')).json().program as ProgramPlan;
    plan.steps.forEach(s=>{s.goal={sets:1,reps:1,restSeconds:0};s.transitionSeconds=0;});
    const run=(await req('POST','/api/runs',{kind:'program',program:plan,mode:'camera',conditions:'',requestId:'program'})).json();
    const record:ProgramRecord={schemaVersion:2,kind:'program',id:run.id,date:run.createdAt,program:plan,mode:'camera',conditions:'',ended:'completed',duration:60,steps:plan.steps.map((s,i)=>fixture(`${run.id}:${i}`,new Date(Date.parse(run.createdAt)+i*20000).toISOString(),'camera',s.exercise))};
    const url=`/api/runs/${run.id}/complete`;
    const wrong=structuredClone(record);wrong.program.steps[0].goal.reps=2;wrong.steps[0].goal.reps=2;
    expect((await req('POST',url,{record:wrong})).statusCode).toBe(409);
    const stopped=structuredClone(record);stopped.ended='interrupted';
    expect((await req('POST',url,{record:stopped})).json().result.reward.reason).toBe('incomplete');
    const second=(await req('POST','/api/runs',{kind:'program',program:plan,mode:'camera',conditions:'',requestId:'program-2'})).json();
    record.id=second.id;record.date=second.createdAt;record.steps.forEach((s,i)=>{s.id=`${second.id}:${i}`;});
    const saved=await req('POST',`/api/runs/${second.id}/complete`,{record});expect(saved.statusCode,saved.body).toBe(201);
    expect(saved.json().result.reward).toMatchObject({xp:20,achievements:['Первый шаг','Два движения']});
    expect(progression(db,'alice').stats).toEqual({workouts:1,reps:2,days:1,exercises:2});
    const underPlan=structuredClone(plan);underPlan.steps[1].goal.reps=2;
    const third=(await req('POST','/api/runs',{kind:'program',program:underPlan,mode:'camera',conditions:'',requestId:'program-3'})).json();
    const under=structuredClone(record);under.id=third.id;under.date=third.createdAt;under.program=underPlan;
    under.steps.forEach((s,i)=>{s.id=`${third.id}:${i}`;s.goal=underPlan.steps[i].goal;});
    expect((await req('POST',`/api/runs/${third.id}/complete`,{record:under})).json().result.reward.reason).toBe('incomplete');
    expect(progression(db,'alice').stats.workouts).toBe(1);
  });
  it('rolls back result, event, XP and badges together on failure, then safely retries', async () => {
    const {db,req,begin} = setup(); const run=await begin(),record=fixture(run.id,run.createdAt),url=`/api/runs/${run.id}/complete`;
    db.exec("CREATE TRIGGER test_failure BEFORE INSERT ON user_achievements BEGIN SELECT RAISE(ABORT,'test only'); END;");
    expect((await req('POST',url,{record})).statusCode).toBe(500);
    for(const table of ['workout_results','progression_events','reward_ledger','user_achievements']) expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({n:0});
    db.exec('DROP TRIGGER test_failure');expect((await req('POST',url,{record})).json().result.reward.xp).toBe(20);
    expect(()=>db.exec('DELETE FROM reward_ledger')).toThrow(/Immutable/);
    expect(()=>db.exec('UPDATE progression_events SET reps=100')).toThrow(/Immutable/);
    expect(()=>db.exec('DELETE FROM user_achievements')).toThrow(/Immutable/);
  });
  it('caps counted repetitions at the goal, separates currencies and requires internal transactional rewards', async () => {
    const {db,req,begin}=setup(),run=await begin();const record=fixture(run.id,run.createdAt,'camera','squat',2);record.goal.reps=1;
    expect((await req('POST',`/api/runs/${run.id}/complete`,{record})).json().result.reward.xp).toBe(20);
    expect(progression(db,'alice').stats.reps).toBe(1);
    const event={userId:'alice',currency:'competition_points' as const,sourceType:'challenge' as const,sourceId:'future-test',amount:99,eventAt:new Date().toISOString(),rulesVersion:'test'};
    expect(()=>appendReward(db,event)).toThrow(/transaction/);
    db.transaction(()=>{appendReward(db,event);appendReward(db,event);}).immediate();
    expect(progression(db,'alice').xp).toBe(20);
    expect(()=>db.transaction(()=>appendReward(db,{...event,amount:100})).immediate()).toThrow(/conflict/);
  });
  it('upgrades stage 4 without retroactive events, preserves old runs/results and repeats migrations safely', () => {
    const {dir}=setup(),oldDir=join(dir,'old');mkdirSync(oldDir);
    for(const name of ['001_foundation.sql','002_accounts.sql','003_programs.sql','004_builder.sql'])copyFileSync(join(projectRoot,'server/migrations',name),join(oldDir,name));
    const db=openDatabase(join(dir,'old.sqlite'));cleanups.push(()=>db.close());migrate(db,oldDir);
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('old','old','test','old','sprout','2026-10-01T00:00:00Z');
    const record=fixture('old-run','2026-10-01T00:00:00Z');
    db.prepare('INSERT INTO workout_runs VALUES (?,?,?,?,?)').run('old-run','old','old-request','{}',record.date);
    db.prepare("INSERT INTO workout_results (id,user_id,run_id,source,source_version,record_json,created_at) VALUES ('old-result','old','old-run','training',1,?,?)").run(JSON.stringify(record),record.date);
    expect(migrate(db)).toEqual(['005_progression.sql']);expect(migrate(db)).toEqual([]);
    expect(db.prepare('SELECT reward_rules_version FROM workout_runs').get()).toEqual({reward_rules_version:null});
    expect(progression(db,'old').xp).toBe(0);expect(db.prepare('SELECT COUNT(*) AS n FROM workout_results').get()).toEqual({n:1});
  });
});
