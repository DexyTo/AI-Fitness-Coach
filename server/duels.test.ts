import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from './app.js';
import { migrate, openDatabase } from './database.js';
import { availablePrograms } from './programs.js';
import { progression } from './progression.js';
import { finalizeDuel } from './duels.js';
import { duelScore, type DuelView } from '../shared/duels.js';
import { type ProgramRecord, type ProgramSnapshot } from '../shared/program.js';
import { TrainingController } from '../src/training/session';
import { demoPose } from '../src/pose/demo';
import { projectRoot } from './config.js';
const cleanups: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const f of cleanups.splice(0).reverse())
    await f(); });
interface Run {
    id: string;
    createdAt: string;
    snapshot: ProgramSnapshot;
}
// Synthetic camera-labelled records exercise server accounting, never recognition on people.
function fixture(run: Run, fraction = 1): ProgramRecord {
    let offset = 0;
    const steps = run.snapshot.program.steps.map((s, i) => {
        const c = new TrainingController(s.exercise, 'camera', s.goal, '', 0, new Date(Date.parse(run.createdAt) + offset).toISOString(), `${run.id}:${i}`);
        let t = 90;
        for (; t < 180000 && c.phase !== 'completed'; t += 90)
            c.sample(demoPose(s.exercise, t - 90), t, 1.6, t);
        const child = c.finish(t, t);
        expect(child.sets[0].result.reps).toBe(s.goal.reps);
        offset += t;
        return child;
    });
    const record: ProgramRecord = { schemaVersion: 2, id: run.id, date: run.createdAt, ...structuredClone(run.snapshot), ended: 'completed', duration: offset / 1000, steps };
    if (fraction === 0) {
        record.steps = [];
        record.ended = 'interrupted';
    }
    else if (fraction < 1) {
        record.steps.pop();
        record.ended = 'interrupted';
    }
    return record;
}
async function setup() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T10:00:00.000Z'));
    const dir = mkdtempSync(join(tmpdir(), 'playfit-duels-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'test.sqlite'), db = (await openDatabase(path));
    (await migrate(db));
    const app = buildApp(db);
    cleanups.push(async () => (await app.close()));
    for (const user of ['alice', 'bob', 'carol']) {
        (await db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(user, user, 'test-only', user, 'sprout', new Date().toISOString()));
        (await db.prepare('INSERT INTO auth_sessions VALUES (?,?,?)').run(createHash('sha256').update(user[0].repeat(64)).digest('hex'), user, '2099-01-01T00:00:00.000Z'));
    }
    const headers = (user = 'alice') => ({ cookie: `playfit_session=${user[0].repeat(64)}`, 'x-playfit-user': user, 'x-playfit-request': '1' });
    const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, user = 'alice') => app.inject({ method, url, payload: payload as object, headers: headers(user) });
    const program = (await availablePrograms(db, null)).find(p => p.id === 'squat-pushup')!;
    program.steps.forEach(s => { s.goal = { sets: 1, reps: 2, restSeconds: 0 }; s.transitionSeconds = 0; });
    const create = async () => { const r = await req('POST', '/api/duels', { requestId: randomUUID(), program, hours: 24 }); expect(r.statusCode, r.body).toBe(201); return r.json().duel as DuelView; };
    const accept = async (d: DuelView) => { const r = await req('POST', `/api/duel-invitations/${d.code}/accept`, {}, 'bob'); expect(r.statusCode, r.body).toBe(200); };
    const begin = async (d: DuelView, user = 'alice') => { const r = await req('POST', `/api/duels/${d.id}/run`, {}, user); expect(r.statusCode, r.body).toBe(201); return r.json() as Run; };
    const draft = async (d: DuelView, record: ProgramRecord, user = 'alice', revision = 1) => { const r = await req('PUT', `/api/duels/${d.id}/draft`, { revision, record }, user); expect(r.statusCode, r.body).toBe(200); };
    const submit = async (run: Run, record: ProgramRecord, user = 'alice') => { const r = await req('POST', `/api/runs/${run.id}/complete`, { record }, user); expect(r.statusCode, r.body).toBe(201); return r.json().result; };
    const detail = async (d: DuelView, user = 'alice') => { const r = await req('GET', `/api/duels/${d.id}`, undefined, user); expect(r.statusCode, r.body).toBe(200); return r.json().duel as DuelView; };
    return { dir, path, db, app, headers, req, program, create, accept, begin, draft, submit, detail };
}
describe('asynchronous duels and immutable accounting', () => {
    it('creates, previews, accepts and independently submits two accounts, awarding a tie once across connections/restarts', async () => {
        const s = (await setup()), d = await s.create();
        const invite = (await s.req('GET', `/api/duel-invitations/${d.code}`, undefined, 'bob')).json().invitation;
        expect(invite).toMatchObject({ task: d.task, rules: d.rules, creator: { nickname: 'alice' } });
        expect(Object.keys(invite).sort()).toEqual(['code', 'creator', 'endsAt', 'id', 'rules', 'state', 'task']);
        await s.accept(d);
        const a = await s.begin(d), b = await s.begin(d, 'bob'), ar = fixture(a), br = fixture(b);
        await s.draft(d, ar);
        expect((await progression(s.db, 'alice')).xp).toBe(0);
        await s.submit(a, ar);
        expect((await s.detail(d)).state).toBe('waiting');
        expect((await s.detail(d, 'bob')).myAttempt.draft).toBeNull();
        expect((await s.detail(d, 'bob')).participants[0]).toMatchObject({ submittedAt: expect.any(String), event: null });
        await s.draft(d, br, 'bob');
        const second = buildApp((await openDatabase(s.path)));
        cleanups.push(async () => (await second.close()));
        const replies = await Promise.all([s.req('POST', `/api/runs/${b.id}/complete`, { record: br }, 'bob'), second.inject({ method: 'POST', url: `/api/runs/${b.id}/complete`, headers: s.headers('bob'), payload: { record: br } })]);
        expect(replies.map(r => r.statusCode).sort()).toEqual([200, 201]);
        expect(replies[0].json()).toEqual(replies[1].json());
        const final = await s.detail(d);
        expect(final.state).toBe('completed');
        expect(final.participants.map(p => p.event)).toEqual([0, 1].map(() => expect.objectContaining({ outcome: 'draw', score: 10000, xp: 20, points: 10, eventAt: '2026-10-20T10:00:00.000Z' })));
        for (const user of ['alice', 'bob'])
            expect((await progression(s.db, user))).toMatchObject({ xp: 40, todayXp: 20, duelXp: 20, competitionPoints: 10 });
        expect((await s.db.prepare('SELECT COUNT(*) AS n FROM duel_events').get())).toEqual({ n: 2 });
        expect((await s.db.prepare("SELECT COUNT(*) AS n FROM user_achievements WHERE achievement_id='first-duel'").get())).toEqual({ n: 2 });
        const prior = (await s.db.prepare('SELECT * FROM reward_ledger').all());
        vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));
        await s.detail(d);
        (await s.db.transaction(async () => (await finalizeDuel(s.db, d.id, new Date().toISOString()))).immediate());
        expect((await s.req('POST', `/api/runs/${a.id}/complete`, { record: ar })).statusCode).toBe(200);
        expect((await s.db.prepare('SELECT * FROM reward_ledger').all())).toEqual(prior);
        await second.close();
        await s.app.close();
        const reopened = (await openDatabase(s.path));
        expect((await migrate(reopened))).toEqual([]);
        const third = buildApp(reopened);
        cleanups.push(async () => (await third.close()));
        expect((await third.inject({ url: `/api/duels/${d.id}`, headers: s.headers() })).json().duel).toEqual(final);
    });
    it('protects invitation acceptance, cancellation, ownership and private history; all idempotent requests keep one participant/run', async () => {
        const s = (await setup()), requestId = randomUUID(), body = { requestId, program: s.program, hours: 24 };
        const created = await s.req('POST', '/api/duels', body), d = created.json().duel as DuelView;
        expect(created.statusCode).toBe(201);
        expect((await s.req('POST', '/api/duels', body)).json()).toEqual(created.json());
        expect((await s.req('POST', '/api/duels', { ...body, hours: 1 })).statusCode).toBe(409);
        expect((await s.req('POST', `/api/duels/${d.id}/run`, {})).statusCode).toBe(409);
        expect((await s.req('POST', `/api/duel-invitations/${d.code}/accept`, {})).json().error.code).toBe('DUEL_SELF');
        await Promise.all([s.accept(d), s.accept(d)]);
        expect((await s.req('POST', `/api/duel-invitations/${d.code}/accept`, {}, 'carol')).statusCode).toBe(409);
        expect((await s.req('GET', `/api/duels/${d.id}`, undefined, 'carol')).statusCode).toBe(404);
        expect((await s.req('POST', `/api/duels/${d.id}/cancel`, {})).statusCode).toBe(409);
        const a = await s.begin(d), ar = fixture(a);
        expect((await s.req('POST', `/api/duels/${d.id}/run`, {})).json()).toEqual(a);
        expect((await s.req('PUT', `/api/duels/${d.id}/draft`, { record: ar, revision: 1 }, 'bob')).statusCode).toBe(409);
        expect((await s.req('POST', `/api/runs/${a.id}/complete`, { record: ar }, 'bob')).statusCode).toBe(404);
        expect((await s.req('POST', `/api/runs/${a.id}/complete`, { record: ar })).json().error.code).toBe('DUEL_DRAFT');
        await s.draft(d, ar);
        const result = await s.submit(a, ar);
        expect((await s.req('GET', `/api/history/${result.id}`, undefined, 'bob')).statusCode).toBe(404);
        const changed = structuredClone(ar);
        changed.duration++;
        expect((await s.req('POST', `/api/runs/${a.id}/complete`, { record: changed })).statusCode).toBe(409);
        expect((await s.req('PUT', `/api/duels/${d.id}/draft`, { record: changed, revision: 2 })).statusCode).toBe(409);
        expect((await s.req('GET', '/api/duels?userId=bob')).statusCode).toBe(400);
        expect((await s.app.inject({ url: '/api/duels' })).statusCode).toBe(401);
        const cancelled = await s.create();
        await s.req('POST', `/api/duels/${cancelled.id}/cancel`, {});
        expect((await s.req('POST', `/api/duels/${cancelled.id}/cancel`, {})).statusCode).toBe(200);
        expect((await s.req('POST', `/api/duel-invitations/${cancelled.code}/accept`, {}, 'bob')).statusCode).toBe(409);
        expect((await s.detail(cancelled)).state).toBe('cancelled');
    });
    it('scores equally weighted steps with set caps and one rounding; incomplete/unassessed attempts do not count', async () => {
        const s = (await setup()), d = await s.create();
        await s.accept(d);
        const a = await s.begin(d), record = fixture(a);
        record.program.steps[1].goal.reps = 1000;
        record.steps[1].sets[0].result.reps = 1000;
        expect(duelScore(record)).toBe(10000);
        record.steps[1].sets[0].result.reps = 0;
        expect(duelScore(record)).toBe(5000);
        record.steps[0].sets[0].result.reps = 9999;
        expect(duelScore(record)).toBe(5000);
        record.program.steps[0].goal.sets = 2;
        expect(duelScore(record)).toBe(2500);
        record.program.steps[0].goal.sets = 1;
        record.program.steps[0].goal.reps = 3;
        record.steps[0].sets[0].result.reps = 1;
        expect(duelScore(record)).toBe(1667);
        record.steps[0].sets[0].result.reps = 0;
        expect(duelScore(record)).toBe(0);
        // The wire validator separately enforces rep/attempt classifications; scoring reads full reps only.
    });
    it.each([['win', 1, .5], ['draw', 0, 0], ['win', 1, 0]] as const)('defines %s when scores use fractions %s and %s', async (outcome, af, bf) => {
        const s = (await setup()), d = await s.create();
        await s.accept(d);
        const a = await s.begin(d), b = await s.begin(d, 'bob'), ar = fixture(a, af), br = fixture(b, bf);
        await s.draft(d, ar);
        await s.draft(d, br, 'bob');
        await s.submit(a, ar);
        await s.submit(b, br, 'bob');
        const final = await s.detail(d);
        expect(final.state).toBe('completed');
        expect(final.participants[0].event?.outcome).toBe(outcome);
        expect(final.participants[1].event?.outcome).toBe(outcome === 'win' ? 'loss' : 'draw');
        expect(final.participants[1].event?.xp).toBe(bf === 0 ? 0 : 10);
        if (af === 0)
            expect((await s.db.prepare('SELECT COUNT(*) AS n FROM reward_ledger').get())).toEqual({ n: 0 });
    });
    it.each(['invited', 'none', 'zero', 'positive', 'draft'] as const)('finalizes %s at the deadline, dating events at the deadline even on a late read', async (kind) => {
        const s = (await setup()), d = await s.create();
        if (kind !== 'invited') {
            await s.accept(d);
            const a = await s.begin(d), ar = fixture(a, kind === 'zero' ? 0 : 1);
            await s.draft(d, ar);
            if (kind === 'zero' || kind === 'positive')
                await s.submit(a, ar);
        }
        vi.setSystemTime(new Date(d.endsAt));
        if (kind === 'invited')
            expect((await s.req('POST', `/api/duel-invitations/${d.code}/accept`, {}, 'bob')).statusCode).toBe(409);
        vi.setSystemTime(new Date(Date.parse(d.endsAt) + 86400000));
        const final = await s.detail(d);
        expect(final).toMatchObject({ state: kind === 'positive' ? 'completed' : 'expired', finalizedAt: d.endsAt });
        expect(final.participants[0].event).toMatchObject({ outcome: kind === 'positive' ? 'win' : 'expired', eventAt: d.endsAt, xp: kind === 'positive' ? 30 : 0 });
        const ledger = (await s.db.prepare('SELECT * FROM reward_ledger').all());
        await s.detail(d);
        expect((await s.db.prepare('SELECT * FROM reward_ledger').all())).toEqual(ledger);
        expect((await s.req('GET', '/api/me/overview')).json().duels).toEqual([]);
    });
    it('rejects first late submission at the exact boundary and retains the first timely result on retry', async () => {
        const s = (await setup()), d = await s.create();
        await s.accept(d);
        const a = await s.begin(d), b = await s.begin(d, 'bob'), ar = fixture(a), br = fixture(b);
        await s.draft(d, ar);
        await s.draft(d, br, 'bob');
        vi.setSystemTime(new Date(Date.parse(d.endsAt) - 1));
        await s.submit(a, ar);
        vi.setSystemTime(new Date(d.endsAt));
        expect((await s.req('POST', `/api/runs/${b.id}/complete`, { record: br }, 'bob')).statusCode).toBe(409);
        expect((await s.req('POST', `/api/runs/${a.id}/complete`, { record: ar })).statusCode).toBe(200);
        expect((await s.db.prepare('SELECT COUNT(*) AS n FROM workout_results').get())).toEqual({ n: 1 });
        expect((await s.detail(d)).participants[0].event).toMatchObject({ outcome: 'win', reason: 'opponent_absent', eventAt: d.endsAt });
    });
    it('persists revisioned progress, rejects stale/replaced steps and wrong provenance/order, and freezes template snapshots', async () => {
        const s = (await setup()), d = await s.create();
        await s.accept(d);
        const a = await s.begin(d), ar = fixture(a), partial = fixture(a, .5);
        await s.draft(d, partial);
        await s.draft(d, partial);
        expect((await s.detail(d)).myAttempt).toMatchObject({ revision: 1, draft: partial, run: a });
        expect((await s.req('PUT', `/api/duels/${d.id}/draft`, { record: ar, revision: 1 })).statusCode).toBe(409);
        for (const mode of ['demo', 'video']) {
            const wrong = { ...ar, mode };
            expect((await s.req('PUT', `/api/duels/${d.id}/draft`, { record: wrong, revision: 2 })).statusCode).toBeGreaterThanOrEqual(400);
        }
        const wrong = structuredClone(ar);
        wrong.steps.reverse();
        expect((await s.req('PUT', `/api/duels/${d.id}/draft`, { record: wrong, revision: 2 })).statusCode).toBe(409);
        const replaced = structuredClone(ar);
        replaced.steps[0].duration++;
        expect((await s.req('PUT', `/api/duels/${d.id}/draft`, { record: replaced, revision: 2 })).statusCode).toBe(409);
        (await s.db.prepare("UPDATE programs SET title='Новый шаблон',version=version+1,archived_at=? WHERE id=?").run(new Date().toISOString(), d.task.program.id));
        await s.draft(d, ar, 'alice', 2);
        expect((await s.detail(d)).task).toEqual(d.task);
        await s.submit(a, ar);
        const b = await s.begin(d, 'bob');
        expect(b.snapshot).toEqual(d.task);
        (await expect((async () => (await s.db.exec("UPDATE duels SET task_json='{}'")))()).rejects.toThrow(/Immutable/));
        (await expect((async () => (await s.db.exec("UPDATE workout_runs SET duel_participant_id=NULL")))()).rejects.toThrow(/Immutable/));
        (await expect((async () => (await s.db.exec("UPDATE duel_submissions SET score=999")))()).rejects.toThrow(/Immutable/));
        expect((await s.req('POST', '/api/runs', { ...a.snapshot, requestId: randomUUID(), duelParticipantId: 'fake' })).statusCode).toBe(400);
    });
    it('rolls back final submission, rewards, state and badges together on failure; safe retry awards once', async () => {
        const s = (await setup()), d = await s.create();
        await s.accept(d);
        const a = await s.begin(d), b = await s.begin(d, 'bob'), ar = fixture(a), br = fixture(b);
        await s.draft(d, ar);
        await s.draft(d, br, 'bob');
        await s.submit(a, ar);
        const prior = (await s.db.prepare('SELECT * FROM reward_ledger').all());
        (await s.db.exec("CREATE TRIGGER test_fail_duel BEFORE INSERT ON user_achievements WHEN NEW.achievement_id='first-duel' BEGIN SELECT RAISE(ABORT,'test-only'); END"));
        expect((await s.req('POST', `/api/runs/${b.id}/complete`, { record: br }, 'bob')).statusCode).toBe(500);
        expect((await s.detail(d)).state).toBe('waiting');
        expect((await s.db.prepare('SELECT * FROM reward_ledger').all())).toEqual(prior);
        expect((await s.db.prepare('SELECT COUNT(*) AS n FROM workout_results').get())).toEqual({ n: 1 });
        expect((await s.db.prepare('SELECT COUNT(*) AS n FROM duel_events').get())).toEqual({ n: 0 });
        (await s.db.exec('DROP TRIGGER test_fail_duel'));
        await s.submit(b, br, 'bob');
        const result = await s.detail(d);
        expect(result.state).toBe('completed');
        expect((await s.req('GET', '/api/me/progression')).json().progression.achievements.find((a: {
            id: string;
        }) => a.id === 'first-duel')).toMatchObject({ progress: 1, earnedAt: expect.any(String) });
        expect((await s.req('GET', '/api/me/overview')).json().duels).toEqual([]);
    });
    it('serializes competing accept/run/finalization operations from separate connections and awards the first badge only once', async () => {
        const s = (await setup()), d = await s.create(), second = buildApp((await openDatabase(s.path)));
        cleanups.push(async () => (await second.close()));
        const accepts = await Promise.all([
            s.req('POST', `/api/duel-invitations/${d.code}/accept`, {}, 'bob'),
            second.inject({ method: 'POST', url: `/api/duel-invitations/${d.code}/accept`, headers: s.headers('carol'), payload: {} }),
        ]);
        expect(accepts.map(r => r.statusCode).sort()).toEqual([200, 409]);
        expect((await s.db.prepare('SELECT COUNT(*) AS n FROM duel_participants WHERE duel_id=?').get(d.id))).toEqual({ n: 2 });
        const starts = await Promise.all([s.req('POST', `/api/duels/${d.id}/run`, {}), second.inject({ method: 'POST', url: `/api/duels/${d.id}/run`, headers: s.headers(), payload: {} })]);
        expect(starts.map(r => r.statusCode).sort()).toEqual([200, 201]);
        expect(starts[0].json()).toEqual(starts[1].json());
        const a = starts[0].json() as Run, b = await s.begin(d, 'bob'), ar = fixture(a), br = fixture(b);
        await s.draft(d, ar);
        await s.draft(d, br, 'bob');
        const finals = await Promise.all([s.req('POST', `/api/runs/${a.id}/complete`, { record: ar }), second.inject({ method: 'POST', url: `/api/runs/${b.id}/complete`, headers: s.headers('bob'), payload: { record: br } })]);
        expect(finals.map(r => r.statusCode)).toEqual([201, 201]);
        expect((await s.detail(d)).state).toBe('completed');
        const d2 = await s.create();
        await s.accept(d2);
        const x = await s.begin(d2), y = await s.begin(d2, 'bob'), xr = fixture(x), yr = fixture(y);
        await s.draft(d2, xr);
        await s.draft(d2, yr, 'bob');
        await s.submit(x, xr);
        await s.submit(y, yr, 'bob');
        expect((await s.db.prepare("SELECT COUNT(*) AS n FROM user_achievements WHERE achievement_id='first-duel'").get())).toEqual({ n: 2 });
        const saved = finals[0].json().result;
        await s.req('DELETE', `/api/history/${saved.id}`);
        expect((await s.detail(d)).participants[0].event?.points).toBe(10);
        expect((await progression(s.db, 'alice'))).toMatchObject({ duelXp: 40, competitionPoints: 20 });
    });
    it('upgrades stage 6 without backfill and preserves repeatable migrations', async () => {
        const s = (await setup()), oldDir = join(s.dir, 'old');
        mkdirSync(oldDir);
        for (const name of readdirSync(join(projectRoot, 'server/migrations')).filter(n => n < '007'))
            copyFileSync(join(projectRoot, 'server/migrations', name), join(oldDir, name));
        const db = (await openDatabase(join(s.dir, 'old.sqlite')));
        cleanups.push(async () => (await db.close()));
        (await migrate(db, oldDir));
        (await db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('old', 'old', 'test-only', 'old', 'sprout', new Date().toISOString()));
        (await db.prepare('INSERT INTO workout_runs (id,user_id,request_id,snapshot_json,created_at) VALUES (?,?,?,?,?)').run('old', 'old', 'old', '{}', new Date().toISOString()));
        expect((await migrate(db))).toEqual(['007_duels.sql', '008_leaderboard_demo.sql', '009_exercise_units.sql', '010_program_catalog.sql']);
        expect((await migrate(db))).toEqual([]);
        expect((await db.prepare('SELECT duel_participant_id FROM workout_runs').get())).toEqual({ duel_participant_id: null });
        expect((await db.prepare('SELECT COUNT(*) AS n FROM duel_events').get())).toEqual({ n: 0 });
    });
});
