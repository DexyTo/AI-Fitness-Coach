import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from './app.js';
import { migrate, openDatabase } from './database.js';
import { projectRoot } from './config.js';
import { publishChallenge, projectWeek, seedChallenges } from './challengeSeed.js';
import { availablePrograms } from './programs.js';
import { progression } from './progression.js';
import { TrainingController } from '../src/training/session';
import { demoPose } from '../src/pose/demo';
import type { ChallengeDefinition } from '../shared/challenges.js';
import type { ProgramRecord, ProgramSnapshot } from '../shared/program.js';

const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const f of cleanups.splice(0).reverse()) await f(); });
const freeze = (time: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(time)); };
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'playfit-challenges-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'test.sqlite'), db = openDatabase(path); migrate(db);
  const app = buildApp(db); cleanups.push(() => app.close());
  for (const id of ['alice', 'bob']) {
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id, id, 'test-only', id, 'sprout', '2026-10-01T00:00:00.000Z');
    db.prepare('INSERT INTO auth_sessions VALUES (?,?,?)').run(createHash('sha256').update((id === 'alice' ? 'a' : 'b').repeat(64)).digest('hex'), id, '2099-01-01T00:00:00.000Z');
  }
  const headers = (user = 'alice') => ({ cookie: `playfit_session=${(user === 'alice' ? 'a' : 'b').repeat(64)}`, 'x-playfit-request': '1', 'x-playfit-user': user });
  const req = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, user = 'alice') => app.inject({ method, url, payload: payload as object, headers: headers(user) });
  const task: ProgramSnapshot = { kind: 'program', program: availablePrograms(db, null).find(p => p.id === 'squat-pushup')!, mode: 'camera', conditions: '' };
  // Small synthetic targets make fixed-clock accounting tests fast. No camera/people are tested.
  task.program.steps.forEach(s => { s.goal = { sets: 1, reps: 1, restSeconds: 0 }; s.transitionSeconds = 0; });
  const definition = (id = 'test-program', type: ChallengeDefinition['type'] = 'program', target = 1): ChallengeDefinition => ({ id, version: 1, title: `Тестовое испытание ${id}`, description: 'Искусственные данные для проверки учёта.', educational: true,
    startsAt: '2026-10-19T00:00:00.000Z', endsAt: '2026-10-26T00:00:00.000Z', type, target, task: structuredClone(task), reward: { xp: 30, points: 10 }, rulesVersion: 'challenges-v1' });
  const publish = (d = definition()) => { publishChallenge(db, d); return d; };
  const joinChallenge = async (d = definition(), user = 'alice') => {
    const r = await req('POST', `/api/challenges/${d.id}/join`, { version: d.version }, user); expect(r.statusCode, r.body).toBe(201); return r.json().challenge.participation.id as string;
  };
  const begin = async (p: string, requestId = randomUUID(), user = 'alice') => {
    const r = await req('POST', `/api/challenge-participations/${p}/runs`, { requestId }, user); expect(r.statusCode, r.body).toBe(201); return r.json() as Run;
  };
  const finish = async (run: Run) => {
    const record = fixture(run), r = await req('POST', `/api/runs/${run.id}/complete`, { record }); expect(r.statusCode, r.body).toBe(201); return { record, result: r.json().result };
  };
  freeze('2026-10-20T10:00:00.000Z');
  return { dir, path, db, app, headers, req, task, definition, publish, joinChallenge, begin, finish };
}
interface Run { id: string; createdAt: string; snapshot: ProgramSnapshot }
function fixture(run: Run): ProgramRecord {
  run = structuredClone(run);
  let offset = 0;
  const steps = run.snapshot.program.steps.map((s, i) => {
    const c = new TrainingController(s.exercise, run.snapshot.mode, s.goal, run.snapshot.conditions, 0, new Date(Date.parse(run.createdAt) + offset).toISOString(), `${run.id}:${i}`);
    let t = 90;
    for (; t < 180000 && c.phase !== 'completed'; t += 90) c.sample(demoPose(s.exercise, t - 90), t, 1.6, t);
    const r = c.finish(t, t); expect(r.sets[0].result.reps).toBe(s.goal.reps); offset += t; return r;
  });
  return { schemaVersion: 2, id: run.id, date: run.createdAt, ...run.snapshot, duration: offset / 1000, steps, ended: 'completed' };
}

describe('challenge participation, events and rewards (synthetic fixtures)', () => {
  it('completes the full path once across competing connections, persists after restart and keeps history private', async () => {
    const s = setup(), d = s.publish(), p = await s.joinChallenge(d), run = await s.begin(p), record = fixture(run);
    const second = buildApp(openDatabase(s.path)); cleanups.push(() => second.close());
    const url = `/api/runs/${run.id}/complete`;
    const replies = await Promise.all([s.req('POST', url, { record }), second.inject({ method: 'POST', url, payload: { record }, headers: s.headers() })]);
    expect(replies.map(r => r.statusCode).sort()).toEqual([200, 201]); expect(replies[0].json()).toEqual(replies[1].json());
    const saved = replies[0].json().result;
    expect(saved.reward).toMatchObject({ xp: 20, challenge: { reason: 'completed', progress: 1, target: 1, xp: 30, points: 10 }, achievements: expect.arrayContaining(['Испытание пройдено']) });
    expect(progression(s.db, 'alice')).toMatchObject({ xp: 50, todayXp: 20, competitionPoints: 10, challengeXp: 30 });
    expect(progression(s.db, 'bob')).toMatchObject({ xp: 0, competitionPoints: 0 });
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM reward_ledger').get()).toEqual({ n: 3 });
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM challenge_events').get()).toEqual({ n: 1 });
    const detail = (await s.req('GET', `/api/challenges/${d.id}`, undefined, 'bob')).json().challenge;
    expect(detail.participation).toBeNull(); expect(detail.participants).toEqual([{ nickname: 'alice', avatar: 'sprout', progress: 1 }]);
    expect((await s.req('GET', `/api/history/${saved.id}`, undefined, 'bob')).statusCode).toBe(404);
    await s.req('DELETE', `/api/history/${saved.id}`);
    expect((await s.req('GET', '/api/challenges?filter=completed')).json().challenges).toHaveLength(1);
    expect((await s.req('GET', '/api/me/overview')).json()).toMatchObject({ challenges: [], progression: { xp: 50 } });
    vi.setSystemTime(new Date('2026-10-27T00:00:00Z'));
    expect((await s.req('POST', url, { record })).json().result).toEqual({ ...saved, archivedAt: expect.any(String) });
    await second.close(); await s.app.close(); const reopened = openDatabase(s.path); expect(migrate(reopened)).toEqual([]);
    const third = buildApp(reopened); cleanups.push(() => third.close());
    expect((await third.inject({ url: `/api/history/${saved.id}`, headers: s.headers() })).json().result.reward).toEqual(saved.reward);
  });
  it('serializes joining and starting; enforces ownership, strict input and immutable run context', async () => {
    const s = setup(), d = s.publish();
    const second = buildApp(openDatabase(s.path)); cleanups.push(() => second.close());
    const url = `/api/challenges/${d.id}/join`;
    const joined = await Promise.all([s.req('POST', url, { version: 1 }), second.inject({ method: 'POST', url, payload: { version: 1 }, headers: s.headers() })]);
    expect(joined.map(r => r.statusCode).sort()).toEqual([200, 201]); expect(joined[0].json()).toEqual(joined[1].json());
    const p = joined[0].json().challenge.participation.id, requestId = randomUUID(), runUrl = `/api/challenge-participations/${p}/runs`;
    const runs = await Promise.all([s.req('POST', runUrl, { requestId }), second.inject({ method: 'POST', url: runUrl, payload: { requestId }, headers: s.headers() })]);
    expect(runs.map(r => r.statusCode).sort()).toEqual([200, 201]); expect(runs[0].json()).toEqual(runs[1].json());
    expect((await s.req('POST', runUrl, { requestId: randomUUID() }, 'bob')).statusCode).toBe(404);
    expect((await s.req('POST', `/api/runs/${runs[0].json().id}/complete`, { record: fixture(runs[0].json()) }, 'bob')).statusCode).toBe(404);
    expect((await s.req('POST', runUrl, { requestId: 'bad', mode: 'demo' })).statusCode).toBe(400);
    expect((await s.req('POST', '/api/runs', { ...s.task, requestId: 'old', challengeParticipationId: p })).statusCode).toBe(400);
    expect((await s.req('GET', '/api/challenges?userId=bob')).statusCode).toBe(400);
    expect((await s.app.inject({ url: '/api/challenges?filter=mine' })).statusCode).toBe(401);
    expect((await s.app.inject({ method: 'POST', url, headers: { 'x-playfit-request': '1' }, payload: { version: 1 } })).statusCode).toBe(401);
    const other = s.publish(s.definition('other')), op = await s.joinChallenge(other);
    expect((await s.req('POST', `/api/challenge-participations/${op}/runs`, { requestId })).statusCode).toBe(409);
    expect(() => s.db.prepare('UPDATE workout_runs SET challenge_participation_id=? WHERE id=?').run(op, runs[0].json().id)).toThrow(/Immutable/);
  });
  it('uses fixed server time at start/join/end, rejects late first saves but preserves accepted retries', async () => {
    const s = setup(), d = s.publish();
    vi.setSystemTime(new Date('2026-10-18T23:59:59Z'));
    expect((await s.req('GET', `/api/challenges/${d.id}`)).json().challenge.state).toBe('upcoming');
    expect((await s.req('POST', `/api/challenges/${d.id}/join`, { version: 1 })).json().error.code).toBe('CHALLENGE_UPCOMING');
    vi.setSystemTime(new Date(d.startsAt)); const p = await s.joinChallenge(d), run = await s.begin(p);
    vi.setSystemTime(new Date(Date.parse(d.endsAt) - 1));
    const good = await s.finish(run);
    vi.setSystemTime(new Date(d.endsAt));
    expect((await s.req('POST', `/api/runs/${run.id}/complete`, { record: good.record })).json().result.reward.challenge.reason).toBe('completed');
    expect((await s.req('POST', `/api/challenges/${d.id}/join`, { version: 1 }, 'bob')).json().error.code).toBe('CHALLENGE_EXPIRED');
    expect((await s.req('POST', `/api/challenge-participations/${p}/runs`, { requestId: randomUUID() })).json().error.code).toBe('CHALLENGE_COMPLETED');
    // A separate incomplete participation launched before the deadline is saved at the exact boundary.
    vi.setSystemTime(new Date('2026-10-20T10:00:00Z')); const lateD = s.publish(s.definition('late')), lateP = await s.joinChallenge(lateD), late = await s.begin(lateP);
    vi.setSystemTime(new Date(lateD.endsAt)); const rejected = await s.finish(late);
    expect(rejected.result.reward.challenge).toMatchObject({ reason: 'expired', progress: 0, xp: 0, points: 0 });
    expect((await s.req('GET', `/api/challenges/${lateD.id}`)).json().challenge).toMatchObject({ state: 'expired', participation: { progress: 0, completedAt: null } });
    expect((await s.req('POST', `/api/challenge-participations/${lateP}/runs`, { requestId: randomUUID() })).statusCode).toBe(409);
    expect((await s.req('POST', `/api/challenge-participations/${lateP}/runs`, { requestId: (s.db.prepare('SELECT request_id FROM workout_runs WHERE id=?').get(late.id) as {request_id:string}).request_id })).statusCode).toBe(200);
    expect((await s.req('POST', `/api/challenges/${lateD.id}/join`, { version: 1 })).statusCode).toBe(200);
  });
  it('counts unique events only in their explicit participation and awards a fixed bonus beyond the workout daily cap', async () => {
    const s = setup(), d = s.publish(s.definition('three', 'workouts', 3)), p = await s.joinChallenge(d);
    const other = s.publish(s.definition('other', 'workouts', 2)), op = await s.joinChallenge(other);
    const extra = await s.begin(p), runs = [await s.begin(p), await s.begin(p), await s.begin(p)];
    for (const [i, run] of runs.entries()) {
      const saved = await s.finish(run);
      expect(saved.result.reward.challenge).toMatchObject({ progress: i + 1, reason: i === 2 ? 'completed' : 'counted', xp: i === 2 ? 30 : 0 });
      expect((await s.req('POST', `/api/runs/${run.id}/complete`, { record: saved.record })).statusCode).toBe(200);
    }
    const later = await s.finish(extra); expect(later.result.reward).toMatchObject({ xp: 0, challenge: { reason: 'already_completed', progress: 3, xp: 0 } });
    expect(progression(s.db, 'alice')).toMatchObject({ todayXp: 60, xp: 90, competitionPoints: 10 });
    expect((await s.req('GET', `/api/challenges/${other.id}`)).json().challenge.participation).toMatchObject({ id: op, progress: 0 });
    expect((await s.req('GET', '/api/me/progression')).json().progression.achievements.find((a: {id:string}) => a.id === 'first-challenge')).toMatchObject({ progress: 1, earnedAt: expect.any(String) });
    await s.finish(await s.begin(op)); await s.finish(await s.begin(op));
    expect(s.db.prepare("SELECT COUNT(*) AS n FROM user_achievements WHERE achievement_id='first-challenge'").get()).toEqual({ n: 1 });
  });
  it('rejects changed result programs and excludes incomplete, old, demo, video, imported and unrelated events', async () => {
    const s = setup(), d = s.publish(), p = await s.joinChallenge(d), run = await s.begin(p);
    const wrong = fixture(run); wrong.program.steps[0].goal.reps++;
    expect((await s.req('POST', `/api/runs/${run.id}/complete`, { record: wrong })).statusCode).toBeGreaterThanOrEqual(400);
    const partial = fixture(run); partial.ended = 'interrupted'; partial.steps.pop();
    expect((await s.req('POST', `/api/runs/${run.id}/complete`, { record: partial })).json().result.reward.challenge).toMatchObject({ reason: 'incomplete', progress: 0 });
    // Defense in depth: test-only DB insertion simulates bad provenance that public routes cannot create.
    for (const kind of ['demo', 'video', 'old', 'task'] as const) {
      const id = randomUUID(), snapshot = structuredClone(s.task);
      if (kind === 'task') snapshot.program.steps.reverse();
      if (kind === 'demo') snapshot.mode = 'demo';
      if (kind === 'video') (snapshot as {mode:string}).mode = 'video';
      const createdAt = kind === 'old' ? '2026-10-01T00:00:00.000Z' : new Date().toISOString();
      const payload = kind === 'video' ? { exercise: 'squat', mode: 'video', goal: { sets: 1, reps: 1, restSeconds: 0 }, conditions: '' } : snapshot;
      s.db.prepare('INSERT INTO workout_runs (id,user_id,request_id,snapshot_json,created_at,reward_rules_version,challenge_participation_id) VALUES (?,?,?,?,?,?,?)').run(id, 'alice', id, JSON.stringify(payload), createdAt, 'progression-v1', p);
      let record;
      if (kind === 'video') {
        const c = new TrainingController('squat', 'video', { sets: 1, reps: 1, restSeconds: 0 }, '', 0, createdAt, id);
        for (let t=90;t<10000&&c.phase!=='completed';t+=90)c.sample(demoPose('squat',t-90),t,1.6,t);
        record = c.finish(10000,10000);
      } else record = fixture({ id, createdAt, snapshot });
      const r = await s.req('POST', `/api/runs/${id}/complete`, { record }); expect(r.statusCode, r.body).toBe(201);
      expect(r.json().result.reward.challenge.reason).toBe(kind === 'old' ? 'before_join' : kind === 'task' ? 'task' : 'source');
    }
    const ordinary = await s.req('POST', '/api/runs', { ...s.task, requestId: randomUUID() }); expect(ordinary.statusCode).toBe(201);
    const unrelated = await s.finish(ordinary.json()); expect(unrelated.result.reward.challenge).toBeUndefined();
    const c = new TrainingController('squat','camera',{sets:1,reps:1,restSeconds:0},'',0,'2026-10-01T00:00:00Z','historical');
    const record = c.finish(1000,1000);
    expect((await s.req('POST','/api/history/import',{schemaVersion:1,source:'playfit.workouts.v1',records:[record]})).statusCode).toBe(200);
    expect((await s.req('GET', `/api/challenges/${d.id}`)).json().challenge.participation.progress).toBe(0);
    expect(s.db.prepare("SELECT COUNT(*) AS n FROM reward_ledger WHERE source_type='challenge'").get()).toEqual({ n: 0 });
  });
  it('freezes program/definition versions, refuses stale join conditions and retains the accepted version after publication changes', async () => {
    const s = setup(), d = s.publish(), p = await s.joinChallenge(d);
    const revised = { ...structuredClone(d), version: 2, reward: { xp: 80, points: 80 } }; revised.task.program.steps[0].goal.reps = 8; s.publish(revised);
    s.db.prepare("UPDATE programs SET title='Изменённый шаблон',archived_at=? WHERE id=?").run(new Date().toISOString(), d.task.program.id);
    expect((await s.req('POST', `/api/challenges/${d.id}/join`, { version: 1 }, 'bob')).json().error.code).toBe('CHALLENGE_CHANGED');
    const run = await s.begin(p); expect(run.snapshot).toEqual(d.task);
    const result = await s.finish(run); expect(result.result.reward.challenge).toMatchObject({ xp: 30, points: 10 });
    const detail = (await s.req('GET', `/api/challenges/${d.id}`)).json().challenge; expect(detail.definition.version).toBe(1);
    expect(detail.participants).toHaveLength(1);
    const bob = await s.joinChallenge(revised, 'bob'); expect(bob).not.toBe(p);
    expect(() => s.db.exec("UPDATE challenge_definitions SET definition_json='{}'")).toThrow(/Immutable/);
    expect(() => s.db.exec("UPDATE challenge_participations SET snapshot_json='{}'")).toThrow(/Immutable/);
    expect(() => s.db.exec('DELETE FROM challenge_events')).toThrow(/Immutable/);
    expect(() => s.db.exec('DELETE FROM reward_ledger')).toThrow(/Immutable/);
  });
  it('rolls back workout, progression, participation, bonus and achievement together, then safely retries', async () => {
    const s = setup(), d = s.publish(), p = await s.joinChallenge(d), run = await s.begin(p), record = fixture(run);
    s.db.exec("CREATE TRIGGER fail_test_challenge BEFORE INSERT ON user_achievements WHEN NEW.achievement_id='first-challenge' BEGIN SELECT RAISE(ABORT,'test-only'); END");
    const url = `/api/runs/${run.id}/complete`;
    expect((await s.req('POST',url,{record})).statusCode).toBe(500);
    for (const table of ['workout_results','progression_events','reward_ledger','user_achievements','challenge_events']) expect(s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({n:0});
    expect((await s.req('GET',`/api/challenges/${d.id}`)).json().challenge.participation).toMatchObject({completedAt:null,progress:0});
    s.db.exec('DROP TRIGGER fail_test_challenge'); expect((await s.req('POST',url,{record})).statusCode).toBe(201);
  });
  it('serializes different final events and never exceeds the target or issues two challenge bonuses', async () => {
    const s=setup(), d=s.publish(s.definition('two','workouts',2)), p=await s.joinChallenge(d);
    await s.finish(await s.begin(p));
    const a=await s.begin(p),b=await s.begin(p), second=buildApp(openDatabase(s.path));cleanups.push(()=>second.close());
    const results=await Promise.all([s.req('POST',`/api/runs/${a.id}/complete`,{record:fixture(a)}),second.inject({method:'POST',url:`/api/runs/${b.id}/complete`,headers:s.headers(),payload:{record:fixture(b)}})]);
    expect(results.every(r=>r.statusCode===201)).toBe(true);
    expect(results.map(r=>r.json().result.reward.challenge.reason).sort()).toEqual(['already_completed','completed']);
    expect((await s.req('GET',`/api/challenges/${d.id}`)).json().challenge.participation.progress).toBe(2);
    expect(s.db.prepare("SELECT COUNT(*) AS n FROM reward_ledger WHERE source_type='challenge'").get()).toEqual({n:2});
  });
});

describe('repeatable weekly challenge seeding and migration',()=>{
  it('uses Kyiv Monday boundaries across summer/winter, DST changes and year rollover',()=>{
    expect(projectWeek(new Date('2026-10-20T10:00:00Z'))).toEqual({key:'2026-10-19',startsAt:'2026-10-18T21:00:00.000Z',endsAt:'2026-10-25T22:00:00.000Z'});
    expect(projectWeek(new Date('2026-03-25T10:00:00Z'))).toEqual({key:'2026-03-23',startsAt:'2026-03-22T22:00:00.000Z',endsAt:'2026-03-29T21:00:00.000Z'});
    expect(projectWeek(new Date('2027-01-01T10:00:00Z')).key).toBe('2026-12-28');
    expect(projectWeek(new Date('2026-10-18T20:59:59Z')).key).toBe('2026-10-12');
    expect(projectWeek(new Date('2026-10-18T21:00:00Z')).key).toBe('2026-10-19');
  });
  it('keeps prior weeks and joined snapshots stable on rerun, new week and restart without fabricated participants',async()=>{
    const s=setup();expect(seedChallenges(s.db)).toBe(4);expect(seedChallenges(s.db)).toBe(0);
    const old=(s.db.prepare('SELECT * FROM challenge_definitions ORDER BY id').all());
    const list=(await s.req('GET','/api/challenges')).json().challenges;expect(list).toHaveLength(4);expect(list.every((c:{participantCount:number})=>c.participantCount===0)).toBe(true);
    expect(list.filter((c:{state:string})=>c.state==='upcoming')).toHaveLength(1);
    const d=list.find((c:{definition:ChallengeDefinition;state:string})=>c.definition.task.program.id==='squat-pushup'&&c.state==='active').definition as ChallengeDefinition;
    const p=await s.joinChallenge(d),run=await s.begin(p); await s.finish(run);
    s.db.prepare("UPDATE programs SET title='Изменено' WHERE id=?").run(d.task.program.id);
    expect(seedChallenges(s.db)).toBe(0);expect(s.db.prepare('SELECT * FROM challenge_definitions ORDER BY id').all()).toEqual(old);
    vi.setSystemTime(new Date('2026-10-27T10:00:00Z'));expect(seedChallenges(s.db)).toBe(3);
    for(const row of old as {id:string;version:number;definition_json:string}[])expect(s.db.prepare('SELECT * FROM challenge_definitions WHERE id=? AND version=?').get(row.id,row.version)).toEqual(row);
    expect((await s.req('GET',`/api/challenges/${encodeURIComponent(d.id)}`)).json().challenge.state).toBe('completed');
    expect(s.db.prepare("SELECT COUNT(*) AS n FROM reward_ledger WHERE source_type='challenge'").get()).toEqual({n:2});
    expect(()=>publishChallenge(s.db,{...d,reward:{xp:101,points:1}})).toThrow(/Invalid/);
    expect(()=>publishChallenge(s.db,{...d,title:'Изменено'})).toThrow(/conflict/);
  });
  it('upgrades a populated stage 5 database without retroactive participation or reward',()=>{
    const s=setup(),oldDir=join(s.dir,'old');mkdirSync(oldDir);
    for(const name of ['001_foundation.sql','002_accounts.sql','003_programs.sql','004_builder.sql','005_progression.sql'])copyFileSync(join(projectRoot,'server/migrations',name),join(oldDir,name));
    const db=openDatabase(join(s.dir,'old.sqlite'));cleanups.push(()=>db.close());migrate(db,oldDir);
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('old','old','test-only','old','sprout','2026-10-01T00:00:00Z');
    db.prepare('INSERT INTO workout_runs (id,user_id,request_id,snapshot_json,created_at,reward_rules_version) VALUES (?,?,?,?,?,?)').run('old-run','old','request','{}','2026-10-01T00:00:00Z','progression-v1');
    expect(migrate(db)).toEqual(['006_challenges.sql']);expect(migrate(db)).toEqual([]);
    expect(db.prepare('SELECT challenge_participation_id FROM workout_runs').get()).toEqual({challenge_participation_id:null});
    seedChallenges(db);expect(db.prepare('SELECT COUNT(*) AS n FROM challenge_participations').get()).toEqual({n:0});expect(progression(db,'old').xp).toBe(0);
  });
});
