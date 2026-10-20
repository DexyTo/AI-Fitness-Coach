import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, openDatabase } from './database.js';
import { buildApp } from './app.js';
import { appendReward, progression } from './progression.js';
import { leaderboard } from './leaderboard.js';
import { DEMO_IDS, DEMO_PASSWORD, seedDemo } from './demoSeed.js';
import { seedChallenges } from './challengeSeed.js';
import { availablePrograms } from './programs.js';
import { demoRecord } from './demoFixtures.js';
import type { ChallengeView } from '../shared/challenges.js';
import type { ProgramSnapshot } from '../shared/program.js';

const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function setup() {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-20T10:00:00.000Z'));
  const dir = mkdtempSync(join(tmpdir(), 'playfit-ranking-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'test.sqlite'), db = openDatabase(path); migrate(db);
  const app = buildApp(db); cleanups.push(() => app.close());
  const addUser = (id: string) => db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id, id, 'test-only', id, 'sun', new Date().toISOString());
  const headers = (id: string) => {
    const token = createHash('sha256').update(id).digest('hex');
    db.prepare('INSERT OR IGNORE INTO auth_sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'), id, '2099-01-01T00:00:00.000Z');
    return { cookie: `playfit_session=${token}`, 'x-playfit-request': '1', 'x-playfit-user': id };
  };
  const req = (user: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) => app.inject({ method, url, payload, headers: headers(user) });
  const points = (userId: string, amount: number, sourceId: string, eventAt = new Date().toISOString(), currency: 'xp' | 'competition_points' = 'competition_points') => db.transaction(() => appendReward(db, { userId, currency, sourceType: 'challenge', sourceId, amount, eventAt, rulesVersion: 'test-fixture' })).immediate();
  return { db, app, path, addUser, headers, req, points };
}
describe('ranking and explicitly isolated educational platform data', () => {
  it('ranks journal points, shares places with gaps and stable ties, keeps own position outside the page and rejects untrusted query fields', async () => {
    const s = setup();
    for (let i = 0; i < 15; i++) { const id = `user_${String(i).padStart(2, '0')}`; s.addUser(id); s.points(id, i < 2 ? 100 : 100 - i, `score-${i}`); }
    s.points('user_14', 9000, 'xp-only', undefined, 'xp');
    const page = (await s.req('user_14', 'GET', '/api/leaderboard')).json();
    expect(page).toMatchObject({ total: 15, limit: 10, me: { id: 'user_14', rank: 15, points: 86, level: 91 } });
    expect(page.rows.map((r: { rank: number }) => r.rank)).toEqual([1, 1, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(page.rows.slice(0, 2).map((r: { id: string }) => r.id)).toEqual(['user_00', 'user_01']);
    expect((await s.req('user_14', 'GET', '/api/leaderboard?offset=10')).json().rows).toHaveLength(5);
    expect((await s.app.inject({ url: '/api/leaderboard?period=all' })).json().me).toBeNull();
    for (const query of ['period=day', 'mode=all', 'offset=-1', 'offset=1.2', 'offset=10000000', 'userId=user_00', 'limit=999']) expect((await s.app.inject({ url: `/api/leaderboard?${query}` })).statusCode).toBe(400);
    expect((await s.app.inject({ url: '/api/leaderboard', headers: { ...s.headers('user_14'), 'x-playfit-user': 'user_00' } })).statusCode).toBe(409);
  });
  it.each([
    ['2026-07-06T00:00:00.000Z', '2026-07-05T21:00:00.000Z', '2026-07-12T21:00:00.000Z'],
    ['2026-01-05T00:00:00.000Z', '2026-01-04T22:00:00.000Z', '2026-01-11T22:00:00.000Z'],
    ['2026-03-29T10:00:00.000Z', '2026-03-22T22:00:00.000Z', '2026-03-29T21:00:00.000Z'],
    ['2026-10-25T10:00:00.000Z', '2026-10-18T21:00:00.000Z', '2026-10-25T22:00:00.000Z'],
  ])('uses fixed event timestamps and half-open Kyiv week including DST: %s', (now, startsAt, endsAt) => {
    const s = setup(); s.addUser('alice');
    s.points('alice', 99, 'before', new Date(Date.parse(startsAt) - 1).toISOString());
    s.points('alice', 10, 'start', startsAt); s.points('alice', 20, 'last', new Date(Date.parse(endsAt) - 1).toISOString()); s.points('alice', 88, 'after', endsAt);
    expect(leaderboard(s.db, 'alice', 'week', 'regular', 0, 10, new Date(now))).toMatchObject({ startsAt, endsAt, me: { points: 30 } });
    expect(leaderboard(s.db, 'alice', 'all', 'regular').me?.points).toBe(217);
  });
  it('seeds real linked accounting once, persists on restart, hides demo from normal views and exposes only public fields', async () => {
    const s = setup(); s.addUser('ordinary'); s.addUser('inactive'); s.points('ordinary', 7, 'normal');
    const ordinary = s.db.prepare('SELECT * FROM users WHERE id=?').get('ordinary');
    expect(seedDemo(s.db)).toBe(true);
    const ledger = s.db.prepare('SELECT * FROM reward_ledger ORDER BY id').all();
    expect(seedDemo(s.db)).toBe(false); expect(s.db.prepare('SELECT * FROM reward_ledger ORDER BY id').all()).toEqual(ledger);
    expect(s.db.prepare('SELECT * FROM users WHERE id=?').get('ordinary')).toEqual(ordinary);
    const regular = (await s.req('ordinary', 'GET', '/api/leaderboard')).json();
    expect(regular.rows.map((r: { id: string }) => r.id)).toEqual(['ordinary']);
    const demo = (await s.req(DEMO_IDS[11], 'GET', '/api/leaderboard?mode=demo')).json();
    expect(demo.total).toBe(12); expect(demo.rows).toHaveLength(10); expect(demo.me.id).toBe(DEMO_IDS[11]); expect(demo.me.rank).toBe(7);
    expect((await s.req('inactive', 'GET', '/api/leaderboard')).json().me).toBeNull();
    expect((await s.req('ordinary', 'GET', '/api/leaderboard?mode=demo')).json().me).toBeNull();
    const p = (await s.app.inject({ url: `/api/participants/${DEMO_IDS[0]}` })).json().participant;
    expect(Object.keys(p).sort()).toEqual(['achievements','avatar','id','isDemo','level','nickname','points','results']);
    expect(p).toMatchObject({ isDemo: true, points: 25, level: 2 });
    expect(p.achievements.map((a: { id: string }) => a.id)).toContain('first-duel');
    expect(p.results.map((r: { outcome: string }) => r.outcome)).toContain('win');
    expect((await s.req(DEMO_IDS[0], 'GET', '/api/history')).json().results.every((r: { isDemo: boolean }) => r.isDemo)).toBe(true);
    expect((await s.req(DEMO_IDS[0], 'GET', '/api/me/overview')).json().recent.every((r: { isDemo: boolean }) => r.isDemo)).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/password|login|conditions|record_json|snapshot|token|result_id/);
    expect((await s.app.inject({ url: '/api/participants/missing' })).statusCode).toBe(404);
    expect((await s.req('ordinary', 'GET', '/api/challenges')).json().challenges).toHaveLength(0);
    const demoChallenges = (await s.req(DEMO_IDS[0], 'GET', '/api/challenges?filter=mine')).json().challenges;
    expect(demoChallenges).toHaveLength(1);
    const challengeId = demoChallenges[0].definition.id;
    expect((await s.req('ordinary', 'GET', `/api/challenges/${challengeId}`)).statusCode).toBe(404);
    expect((await s.req('ordinary', 'POST', `/api/challenges/${challengeId}/join`, { version: 1 })).statusCode).toBe(404);
    const duel = s.db.prepare("SELECT code FROM duels WHERE state='accepted' LIMIT 1").get() as { code: string };
    expect((await s.req('ordinary', 'POST', `/api/duel-invitations/${duel.code}/accept`, {})).json().error.code).toBe('DEMO_SEPARATE');
    const login = await s.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-playfit-request': '1' }, payload: { login: 'demo_01', password: DEMO_PASSWORD } });
    expect(login.statusCode, login.body).toBe(200); expect(login.json().user.isDemo).toBe(true);
    await s.app.close(); const db = openDatabase(s.path); expect(migrate(db)).toEqual([]); const reopened = buildApp(db); cleanups.push(() => reopened.close());
    expect(seedDemo(db)).toBe(false); expect(db.prepare('SELECT * FROM reward_ledger ORDER BY id').all()).toEqual(ledger);
    expect((await reopened.inject({ url: '/api/leaderboard?mode=demo' })).json().total).toBe(12);
    vi.setSystemTime(new Date('2026-10-27T10:00:00.000Z')); expect(seedDemo(db)).toBe(true); expect(seedDemo(db)).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM demo_users').get()).toEqual({ n: 12 });
    expect(db.prepare('SELECT * FROM users WHERE id=?').get('ordinary')).toEqual(ordinary);
    expect(leaderboard(db, DEMO_IDS[0], 'all', 'demo').me!.points).toBeGreaterThan(leaderboard(db, DEMO_IDS[0], 'week', 'demo').me!.points);
  }, 15000);
  it('rolls the entire batch back on a reserved login collision or failed award', () => {
    const s = setup(); s.addUser('demo_02');
    expect(() => seedDemo(s.db)).toThrow(/занят/);
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM demo_users').get()).toEqual({ n: 0 });
    s.db.exec("DELETE FROM users; CREATE TRIGGER fail_seed BEFORE INSERT ON reward_ledger BEGIN SELECT RAISE(ABORT,'test refusal'); END;");
    expect(() => seedDemo(s.db)).toThrow(/test refusal/);
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM demo_seed_batches').get()).toEqual({ n: 0 });
    s.db.exec('DROP TRIGGER fail_seed'); expect(seedDemo(s.db)).toBe(true);
  }, 20000);
  it('runs two ordinary accounts through programs, history, XP/badges, a challenge, duel, archive and ranking via API', async () => {
    const s = setup(); s.addUser('alice'); s.addUser('bob'); seedChallenges(s.db);
    const program = structuredClone(availablePrograms(s.db, null).find(p => p.id === 'squat-pushup')!);
    program.steps.forEach(step => { step.goal = { sets: 1, reps: 1, restSeconds: 0 }; step.transitionSeconds = 0; });
    const task: ProgramSnapshot = { kind: 'program', program, mode: 'camera', conditions: 'Тест учёта · вымышленные движения' };
    const run = (await s.req('alice', 'POST', '/api/runs', { ...task, requestId: 'program-test' })).json();
    const record = demoRecord(run.id, run.createdAt, run.snapshot);
    const result = await s.req('alice', 'POST', `/api/runs/${run.id}/complete`, { record }); expect(result.statusCode, result.body).toBe(201);
    expect(result.json().result.reward).toMatchObject({ xp: 20, achievements: ['Первый шаг', 'Два движения'] });
    expect((await s.req('bob', 'GET', `/api/history/${result.json().result.id}`)).statusCode).toBe(404);
    const challenges = (await s.req('alice', 'GET', '/api/challenges')).json().challenges as ChallengeView[];
    const challenge = challenges.find(c => c.definition.id.startsWith('two-moves:'))!;
    const joined = (await s.req('alice', 'POST', `/api/challenges/${challenge.definition.id}/join`, { version: 1 })).json().challenge;
    const cr = (await s.req('alice', 'POST', `/api/challenge-participations/${joined.participation.id}/runs`, { requestId: 'challenge-test' })).json();
    const done = await s.req('alice', 'POST', `/api/runs/${cr.id}/complete`, { record: demoRecord(cr.id, cr.createdAt, cr.snapshot) });
    expect(done.statusCode, done.body).toBe(201); expect(done.json().result.reward.challenge).toMatchObject({ reason: 'completed', points: 10 });
    const d = (await s.req('alice', 'POST', '/api/duels', { program, hours: 1, requestId: 'duel-test' })).json().duel;
    expect((await s.req('bob', 'POST', `/api/duel-invitations/${d.code}/accept`, {})).statusCode).toBe(200);
    for (const user of ['alice', 'bob']) {
      const r = (await s.req(user, 'POST', `/api/duels/${d.id}/run`, {})).json(); const record = demoRecord(r.id, r.createdAt, r.snapshot);
      expect((await s.req(user, 'PUT', `/api/duels/${d.id}/draft`, { revision: 1, record })).statusCode).toBe(200);
      expect((await s.req(user, 'POST', `/api/runs/${r.id}/complete`, { record })).statusCode).toBe(201);
    }
    expect(progression(s.db, 'alice')).toMatchObject({ xp: 110, competitionPoints: 20 });
    expect(progression(s.db, 'bob')).toMatchObject({ xp: 40, competitionPoints: 10 });
    expect((await s.req('alice', 'GET', '/api/leaderboard')).json().rows.map((r: { points: number }) => r.points)).toEqual([20, 10]);
    expect((await s.req('alice', 'GET', '/api/history')).json().results).toHaveLength(3);
    expect((await s.req('alice', 'DELETE', `/api/history/${result.json().result.id}`)).statusCode).toBe(200);
    expect((await s.req('alice', 'GET', '/api/leaderboard')).json().me.points).toBe(20);
    // No one opens the duel after its deadline. A later ranking read must settle
    // it using the deadline's week, rather than the time of this late request.
    vi.setSystemTime(new Date('2026-10-25T20:00:00.000Z'));
    const late = (await s.req('alice', 'POST', '/api/duels', { program, hours: 1, requestId: 'late-duel' })).json().duel;
    await s.req('bob', 'POST', `/api/duel-invitations/${late.code}/accept`, {});
    const lr = (await s.req('alice', 'POST', `/api/duels/${late.id}/run`, {})).json();
    const lrecord = demoRecord(lr.id, lr.createdAt, lr.snapshot);
    await s.req('alice', 'PUT', `/api/duels/${late.id}/draft`, { revision: 1, record: lrecord });
    await s.req('alice', 'POST', `/api/runs/${lr.id}/complete`, { record: lrecord });
    vi.setSystemTime(new Date('2026-10-27T10:00:00.000Z'));
    expect((await s.req('alice', 'GET', '/api/leaderboard')).json()).toMatchObject({ total: 0, me: null });
    expect((await s.req('alice', 'GET', '/api/leaderboard?period=all')).json().me.points).toBe(35);
    expect(s.db.prepare("SELECT event_at FROM reward_ledger WHERE source_id=? AND currency='competition_points'").get(late.id)).toEqual({ event_at: late.endsAt });
  });
});
