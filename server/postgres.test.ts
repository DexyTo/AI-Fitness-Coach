import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app.js';
import { migrate, openDatabase } from './database.js';
import { postgresDatabase } from './store.js';
import { projectRoot } from './config.js';
import { availablePrograms } from './programs.js';
import { seedChallenges } from './challengeSeed.js';
import { seedDemo, DEMO_IDS } from './demoSeed.js';
import { demoRecord } from './demoFixtures.js';
import type { ProgramSnapshot } from '../shared/program.js';
import { TrainingController } from '../src/training/session.js';

// TEST_DATABASE_URL must point to a dedicated test database with CREATE SCHEMA
// permission. Each test owns a random schema; no existing schema is modified.
const url = process.env.TEST_DATABASE_URL;
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const admin = postgresDatabase(url!);
  const schema = `playfit_test_${randomUUID().replaceAll('-', '')}`;
  await admin.exec(`CREATE SCHEMA ${schema}`);
  cleanups.push(async () => { try { await admin.exec(`DROP SCHEMA ${schema} CASCADE`); } finally { await admin.close(); } });
  const connection = new URL(url!);
  connection.searchParams.set('options', `-c search_path=${schema}`);
  const db = postgresDatabase(connection.toString());
  cleanups.push(() => db.close());
  await migrate(db);
  return { db, connection: connection.toString() };
}
const origin = 'https://playfit-test.onrender.com';
function client(db: ReturnType<typeof postgresDatabase>) {
  const app = buildApp(db, false, { production: true, publicOrigin: origin });
  // The caller closes this app once; the app owns the database connection.
  const request = (cookie: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: object) => app.inject({
    method, url: path, payload: body,
    headers: { cookie, origin, 'x-playfit-request': '1', 'x-forwarded-proto': 'https', 'x-forwarded-for': '192.0.2.42' },
  });
  const register = async (login: string) => {
    const response = await request('', 'POST', '/api/auth/register', { login, password: 'Postgres-Study-2026' });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.headers['set-cookie']).toContain('; Secure');
    expect(response.json().user.createdAt).toMatch(/^\d{4}-/);
    return { cookie: String(response.headers['set-cookie']).split(';')[0], id: response.json().user.id as string };
  };
  return { app, request, register };
}

describe.skipIf(!url)('real PostgreSQL deployment integration (fabricated workout summaries)', () => {
  it('matches SQLite catalog/snapshots, preserves users on repeat migration and rolls back a failed migration batch', async () => {
    const { db, connection } = await fixture();
    const directory = mkdtempSync(join(tmpdir(), 'playfit-pg-migrations-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const sqlite = await openDatabase(join(directory, 'reference.sqlite'));
    cleanups.push(() => sqlite.close());
    await migrate(sqlite);
    expect(await availablePrograms(db, null)).toEqual(await availablePrograms(sqlite, null));
    const snapshots = async (database: typeof db) => (await database.prepare('SELECT program_id,snapshot_json FROM program_versions ORDER BY program_id').all() as { program_id: string; snapshot_json: string }[]).map(row => ({ id: row.program_id, snapshot: JSON.parse(row.snapshot_json) }));
    expect(await snapshots(db)).toEqual(await snapshots(sqlite));
    await db.prepare('INSERT INTO platform_metadata VALUES (?,?)').run('private-data', 'keep');
    const source = join(projectRoot, 'server/migrations/postgres');
    for (const name of readdirSync(source)) writeFileSync(join(directory, name), readFileSync(join(source, name)));
    writeFileSync(join(directory, '011_pending.sql'), "CREATE TABLE pending (id INTEGER); INSERT INTO platform_metadata VALUES ('pending','no');");
    writeFileSync(join(directory, '012_broken.sql'), 'THIS IS NOT SQL;');
    await expect(migrate(db, directory)).rejects.toThrow();
    expect(await db.prepare("SELECT to_regclass('pending') AS name").get()).toEqual({ name: null });
    expect(await db.prepare("SELECT value FROM platform_metadata WHERE key='pending'").get()).toBeUndefined();
    expect(await db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({ version: 10 });
    const second = postgresDatabase(connection); cleanups.push(() => second.close());
    expect(await migrate(second)).toEqual([]);
    expect(await second.prepare("SELECT value FROM platform_metadata WHERE key='private-data'").get()).toEqual({ value: 'keep' });
    writeFileSync(join(directory, '001_foundation.sql'), readFileSync(join(source, '001_foundation.sql'), 'utf8') + '\n-- changed');
    await expect(migrate(db, directory)).rejects.toThrow(/изменена/);
    await expect(db.prepare('INSERT INTO program_steps (program_id,position,id,exercise,sets,reps,rest_seconds,transition_seconds,goal_json) VALUES (?,?,?,?,?,?,?,?,?)').run('squat-intro', 10, 'bad-hold', 'wall_sit', 1, null, 0, 0, '{}')).rejects.toThrow();
  });

  it('keeps HTTPS sessions and account isolation, serializes run retries/completions and enforces the daily XP cap across pools', async () => {
    const { db, connection } = await fixture();
    const first = client(db), secondDb = postgresDatabase(connection), second = client(secondDb);
    cleanups.push(() => second.app.close());
    const alice = await first.register('alice'), bob = await first.register('bob');
    expect((await first.request('', 'POST', '/api/auth/register', { login: 'ALICE', password: 'Another-password' })).statusCode).toBe(409);
    const hostile = await first.app.inject({ method: 'PATCH', url: '/api/profile', headers: { cookie: alice.cookie, origin: 'https://evil.invalid', 'x-playfit-request': '1' }, payload: { nickname: 'bad', avatar: 'sun' } });
    expect(hostile.statusCode).toBe(403);
    const program = structuredClone((await availablePrograms(db, null)).find(p => p.id === 'squat-pushup')!);
    program.steps.forEach(s => { s.goal = { sets: 1, reps: 1, restSeconds: 0 }; s.transitionSeconds = 0; });
    const snapshot: ProgramSnapshot = { kind: 'program', program, mode: 'camera', conditions: '' };
    const requests = await Promise.all([first, second].map(c => c.request(alice.cookie, 'POST', '/api/runs', { ...snapshot, requestId: 'same-request' })));
    expect(requests.map(r => r.statusCode).sort()).toEqual([200, 201]);
    const run = requests[0].json(), record = demoRecord(run.id, run.createdAt, snapshot);
    const completed = await Promise.all([first, second].map(c => c.request(alice.cookie, 'POST', `/api/runs/${run.id}/complete`, { record })));
    expect(completed.map(r => r.statusCode).sort()).toEqual([200, 201]);
    const resultId = completed[0].json().result.id;
    expect((await first.request(bob.cookie, 'GET', `/api/history/${resultId}`)).statusCode).toBe(404);
    expect((await first.request(alice.cookie, 'GET', '/api/me/overview')).json()).toMatchObject({ progression: { xp: 20, todayXp: 20 }, recent: [{ id: resultId }] });
    const begin = await Promise.all(Array.from({ length: 3 }, (_, index) => first.request(alice.cookie, 'POST', '/api/runs', { ...snapshot, requestId: `cap-${index}` })));
    const results = await Promise.all(begin.map((response, index) => {
      const r = response.json(); return [first, second][index % 2].request(alice.cookie, 'POST', `/api/runs/${r.id}/complete`, { record: demoRecord(r.id, r.createdAt, snapshot) });
    }));
    for (const result of results) expect(result.statusCode, result.body).toBe(201);
    expect((await first.request(alice.cookie, 'GET', '/api/me/progression')).json().progression).toMatchObject({ xp: 60, todayXp: 60, stats: { workouts: 4 } });
    // Demo and explicit historical import are stored without awarding XP.
    const demoSnapshot = { ...snapshot, mode: 'demo' as const };
    const demoRun = (await first.request(bob.cookie, 'POST', '/api/runs', { ...demoSnapshot, requestId: 'demo' })).json();
    expect((await first.request(bob.cookie, 'POST', `/api/runs/${demoRun.id}/complete`, { record: demoRecord(demoRun.id, demoRun.createdAt, demoSnapshot) })).json().result.reward).toMatchObject({ xp: 0, reason: 'demo' });
    const historical = new TrainingController('squat', 'camera', { sets: 1, reps: 2, restSeconds: 0 }, '', 0, new Date().toISOString(), 'old-local-result').finish(1000, 1000);
    for (let retry = 0; retry < 2; retry++) expect((await first.request(bob.cookie, 'POST', '/api/history/import', { schemaVersion: 1, source: 'playfit.workouts.v1', records: [historical] })).statusCode).toBe(200);
    expect((await first.request(bob.cookie, 'GET', '/api/me/progression')).json().progression.xp).toBe(0);
    await first.app.close();
    const login = await second.request(alice.cookie, 'GET', '/api/auth/me');
    expect(login.json().user.id).toBe(alice.id);
    expect(await migrate(secondDb)).toEqual([]);
    expect((await second.request(alice.cookie, 'GET', '/api/history')).json().results).toHaveLength(4);
    await expect(secondDb.exec('DELETE FROM reward_ledger')).rejects.toThrow(/Immutable/);
  }, 20000);

  it('completes programs, personal versions, a challenge and a duel through the API and keeps competition points separate', async () => {
    const { db } = await fixture();
    const c = client(db), alice = await c.register('alice'), bob = await c.register('bob');
    expect(await seedChallenges(db)).toBe(4); expect(await seedChallenges(db)).toBe(0);
    const program = structuredClone((await availablePrograms(db, null)).find(p => p.id === 'squat-pushup')!);
    program.steps.forEach(s => { s.goal = { sets: 1, reps: 1, restSeconds: 0 }; s.transitionSeconds = 0; });
    const created = await c.request(alice.cookie, 'POST', '/api/programs', { title: 'Личный план', description: '', steps: program.steps });
    expect(created.statusCode, created.body).toBe(201);
    const personal = created.json().program;
    expect((await c.request(bob.cookie, 'GET', `/api/programs/${personal.id}`)).statusCode).toBe(404);
    const revised = await c.request(alice.cookie, 'PUT', `/api/programs/${personal.id}`, { title: 'Новая версия', description: '', steps: personal.steps, version: 1 });
    expect(revised.json().program.version).toBe(2);
    await expect(db.exec('UPDATE program_versions SET version=99')).rejects.toThrow(/Immutable/);
    const challenge = (await c.request(alice.cookie, 'GET', '/api/challenges')).json().challenges.find((item: { definition: { id: string } }) => item.definition.id.startsWith('two-moves:'));
    const joined = await c.request(alice.cookie, 'POST', `/api/challenges/${encodeURIComponent(challenge.definition.id)}/join`, { version: 1 });
    expect(joined.statusCode, joined.body).toBe(201);
    const p = joined.json().challenge.participation;
    const run = (await c.request(alice.cookie, 'POST', `/api/challenge-participations/${p.id}/runs`, { requestId: 'challenge-run' })).json();
    const done = await c.request(alice.cookie, 'POST', `/api/runs/${run.id}/complete`, { record: demoRecord(run.id, run.createdAt, run.snapshot) });
    expect(done.statusCode, done.body).toBe(201);
    expect(done.json().result.reward.challenge).toMatchObject({ reason: 'completed', xp: 30, points: 10 });
    const invitation = await c.request(alice.cookie, 'POST', '/api/duels', { requestId: 'duel', program, hours: 1 });
    expect(invitation.statusCode, invitation.body).toBe(201);
    const duel = invitation.json().duel;
    expect((await c.request(bob.cookie, 'POST', `/api/duel-invitations/${duel.code}/accept`, {})).statusCode).toBe(200);
    for (const user of [alice, bob]) {
      const r = (await c.request(user.cookie, 'POST', `/api/duels/${duel.id}/run`, {})).json();
      const record = demoRecord(r.id, r.createdAt, r.snapshot);
      expect((await c.request(user.cookie, 'PUT', `/api/duels/${duel.id}/draft`, { revision: 1, record })).statusCode).toBe(200);
      expect((await c.request(user.cookie, 'POST', `/api/runs/${r.id}/complete`, { record })).statusCode).toBe(201);
    }
    const ranking = await c.request(alice.cookie, 'GET', '/api/leaderboard');
    expect(ranking.statusCode, ranking.body).toBe(200);
    expect(ranking.json().rows.map((r: { points: number }) => r.points)).toEqual([20, 10]);
    const publicProfile = await c.request('', 'GET', `/api/participants/${alice.id}`);
    expect(publicProfile.statusCode, publicProfile.body).toBe(200);
    expect(publicProfile.json().participant.results[0].eventAt).toMatch(/^\d{4}-/);
    await c.app.close();
  }, 20000);

  it('rolls back completion, XP and achievements on PostgreSQL trigger failure and safely retries the same result', async () => {
    const { db } = await fixture(); const c = client(db), user = await c.register('alice');
    const program = (await availablePrograms(db, null)).find(p => p.id === 'squat-pushup')!;
    const snapshot: ProgramSnapshot = { kind: 'program', program, mode: 'camera', conditions: '' };
    const r = (await c.request(user.cookie, 'POST', '/api/runs', { ...snapshot, requestId: 'rollback' })).json();
    const record = demoRecord(r.id, r.createdAt, snapshot);
    await db.exec("CREATE FUNCTION fail_award() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test refusal'; END; $$; CREATE TRIGGER test_failure BEFORE INSERT ON user_achievements FOR EACH ROW EXECUTE FUNCTION fail_award();");
    expect((await c.request(user.cookie, 'POST', `/api/runs/${r.id}/complete`, { record })).statusCode).toBe(500);
    for (const table of ['workout_results', 'progression_events', 'reward_ledger', 'user_achievements']) expect(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    await db.exec('DROP TRIGGER test_failure ON user_achievements');
    expect((await c.request(user.cookie, 'POST', `/api/runs/${r.id}/complete`, { record })).json().result.reward.xp).toBe(20);
    expect((await c.request(user.cookie, 'POST', `/api/runs/${r.id}/complete`, { record })).statusCode).toBe(200);
    await c.app.close();
  });

  it('seeds labelled demonstration participants only on explicit request and never repeats their rewards', async () => {
    const { db } = await fixture();
    expect(await db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
    expect(await seedDemo(db)).toBe(true);
    const before = await db.prepare('SELECT * FROM reward_ledger ORDER BY id').all();
    expect(await seedDemo(db)).toBe(false);
    expect(await db.prepare('SELECT * FROM reward_ledger ORDER BY id').all()).toEqual(before);
    const c = client(db);
    expect((await c.request('', 'GET', '/api/leaderboard')).json().total).toBe(0);
    const demo = await c.request('', 'GET', '/api/leaderboard?mode=demo');
    expect(demo.statusCode, demo.body).toBe(200); expect(demo.json().total).toBe(12);
    expect((await c.request('', 'GET', `/api/participants/${DEMO_IDS[0]}`)).json().participant.isDemo).toBe(true);
    await c.app.close();
  }, 30000);
});
