import { mapSeries } from './sequence.js';
import type { Database } from './database.js';
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DUEL_RULES, duelScore, type DuelEvent, type DuelInvitation, type DuelRules, type DuelState, type DuelView } from '../shared/duels.js';
import { isProgram, same, validPlan, validProgramRecord, type HistoryRecord, type ProgramPlan, type ProgramRecord, type ProgramSnapshot } from '../shared/program.js';
import { availablePrograms, planSchema, programRecordSchema } from './programs.js';
import { appendReward, RULES_VERSION } from './progression.js';
import { obj } from './workoutSchema.js';
interface DuelRow {
    id: string;
    creator_id: string;
    code: string;
    task_json: string;
    rules_json: string;
    created_at: string;
    ends_at: string;
    accepted_at: string | null;
    finalized_at: string | null;
    state: DuelState;
}
interface Member {
    id: string;
    user_id: string;
    slot: number;
    joined_at: string;
}
interface Submission {
    participant_id: string;
    result_id: string;
    score: number;
    submitted_at: string;
}
const members = async (db: Database, id: string) => (await db.prepare('SELECT * FROM duel_participants WHERE duel_id=? ORDER BY slot').all(id)) as Member[];
const terminal = (d: DuelRow) => ['completed', 'cancelled', 'expired'].includes(d.state);
const find = async (db: Database, id: string) => (await db.prepare('SELECT * FROM duels WHERE id=?').get(id)) as DuelRow | undefined;
// All callers hold an immediate transaction. A deadline event is dated at ends_at,
// even when the first read happens days later. Finalization never rewrites events.
export async function finalizeDuel(db: Database, id: string, now: string) {
    if (!db.inTransaction)
        throw new Error('Duel finalization requires transaction');
    const d = (await find(db, id));
    if (!d || terminal(d))
        return;
    const people = (await members(db, id));
    const submissions = (await db.prepare('SELECT s.* FROM duel_submissions s JOIN duel_participants p ON p.id=s.participant_id WHERE p.duel_id=?').all(id)) as Submission[];
    const expired = now >= d.ends_at;
    if (submissions.length < 2 && !expired)
        return;
    const completed = submissions.length === 2 || (people.length === 2 && submissions.some(s => s.score > 0));
    const eventAt = submissions.length === 2 ? submissions.map(s => s.submitted_at).sort().at(-1)! : d.ends_at;
    (await db.prepare('UPDATE duels SET state=?,finalized_at=? WHERE id=?').run(completed ? 'completed' : 'expired', eventAt, id));
    const rules = JSON.parse(d.rules_json) as DuelRules;
    for (const p of people) {
        const own = submissions.find(s => s.participant_id === p.id), other = submissions.find(s => s.participant_id !== p.id);
        const outcome: DuelEvent['outcome'] = !completed ? 'expired' : !own ? 'loss' : !other ? 'win' : own.score === other.score ? 'draw' : own.score > other.score ? 'win' : 'loss';
        const reward = completed && own && own.score > 0 && outcome !== 'expired' ? rules.rewards[outcome] : { xp: 0, points: 0 };
        const event: DuelEvent = { outcome, reason: !completed ? 'no_positive_submission' : submissions.length === 2 ? 'scores' : 'opponent_absent', score: own?.score ?? null, ...reward, eventAt };
        (await db.prepare('INSERT INTO duel_events VALUES (?,?,?,?,?,?)').run(id, p.user_id, own?.result_id ?? null, eventAt, rules.version, JSON.stringify(event)));
        for (const [currency, amount] of [['xp', reward.xp], ['competition_points', reward.points]] as const) {
            if (amount)
                (await appendReward(db, { userId: p.user_id, currency, amount, sourceType: 'duel', sourceId: id, eventAt, rulesVersion: rules.version }));
        }
        if (reward.xp && own)
            (await db.prepare("INSERT INTO user_achievements VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING").run(p.user_id, 'first-duel', own.result_id, eventAt, rules.version));
    }
}
export async function duelView(db: Database, id: string, userId: string): Promise<DuelView> {
    const d = (await find(db, id))!;
    const people = (await members(db, id)), mine = people.find(p => p.user_id === userId)!;
    const run = (await db.prepare('SELECT id,created_at FROM workout_runs WHERE duel_participant_id=?').get(mine.id)) as {
        id: string;
        created_at: string;
    } | undefined;
    const draft = (await db.prepare('SELECT revision,record_json FROM duel_drafts WHERE participant_id=?').get(mine.id)) as {
        revision: number;
        record_json: string;
    } | undefined;
    const task = JSON.parse(d.task_json) as ProgramSnapshot;
    return { id, code: d.code, task, rules: JSON.parse(d.rules_json), state: d.state, createdAt: d.created_at, acceptedAt: d.accepted_at, endsAt: d.ends_at, finalizedAt: d.finalized_at,
        participants: (await mapSeries(people, async (p) => {
            const user = (await db.prepare('SELECT nickname,avatar FROM users WHERE id=?').get(p.user_id)) as {
                nickname: string;
                avatar: string;
            };
            const s = (await db.prepare('SELECT submitted_at FROM duel_submissions WHERE participant_id=?').get(p.id)) as {
                submitted_at: string;
            } | undefined;
            const e = (await db.prepare('SELECT receipt_json FROM duel_events WHERE duel_id=? AND user_id=?').get(id, p.user_id)) as {
                receipt_json: string;
            } | undefined;
            return { userId: p.user_id, ...user, slot: p.slot, submittedAt: s?.submitted_at ?? null, event: e ? JSON.parse(e.receipt_json) as DuelEvent : null };
        })),
        myAttempt: { run: run ? { id: run.id, createdAt: run.created_at, snapshot: task } : null, revision: draft?.revision ?? 0, draft: draft ? JSON.parse(draft.record_json) as ProgramRecord : null } };
}
export async function listDuels(db: Database, userId: string, now: string): Promise<DuelView[]> {
    return (await db.transaction(async () => {
        const ids = (await db.prepare("SELECT duel_id FROM duel_participants WHERE user_id=? ORDER BY id DESC").all(userId)) as {
            duel_id: string;
        }[];
        return (await mapSeries(ids, async (r) => { (await finalizeDuel(db, r.duel_id, now)); return (await duelView(db, r.duel_id, userId)); }));
    }).immediate());
}
// Invoked before inserting a NEW result in the common completion transaction.
export async function checkDuelCompletion(db: Database, userId: string, runId: string, record: HistoryRecord, now: string, fail: (status: number, code: string, message: string) => never) {
    const run = (await db.prepare('SELECT duel_participant_id,created_at FROM workout_runs WHERE id=? AND user_id=?').get(runId, userId)) as {
        duel_participant_id: string | null;
        created_at: string;
    };
    if (!run.duel_participant_id)
        return;
    const p = (await db.prepare('SELECT * FROM duel_participants WHERE id=? AND user_id=?').get(run.duel_participant_id, userId)) as (Member & {
        duel_id: string;
    }) | undefined;
    if (!p)
        fail(404, 'NOT_FOUND', 'Участник не найден.');
    const d = (await find(db, p.duel_id))!;
    const draft = (await db.prepare('SELECT record_json FROM duel_drafts WHERE participant_id=?').get(p.id)) as {
        record_json: string;
    } | undefined;
    if (terminal(d) || !d.accepted_at || now >= d.ends_at)
        fail(409, 'DUEL_CLOSED', 'Дуэль завершена или срок отправки истёк. Обнови статус.');
    if (!isProgram(record) || record.mode !== 'camera' || run.created_at < d.accepted_at || run.created_at < p.joined_at || !same({ kind: 'program', program: record.program, mode: record.mode, conditions: record.conditions }, JSON.parse(d.task_json)))
        fail(409, 'DUEL_TASK', 'Результат не соответствует камерному запуску дуэли.');
    if (!draft || !same(JSON.parse(draft.record_json), record))
        fail(409, 'DUEL_DRAFT', 'Сначала сохрани этот итог как черновик дуэли.');
}
export async function completeDuel(db: Database, userId: string, runId: string, resultId: string, record: HistoryRecord, now: string) {
    if (!db.inTransaction)
        throw new Error('Duel completion requires transaction');
    const run = (await db.prepare('SELECT duel_participant_id FROM workout_runs WHERE id=? AND user_id=?').get(runId, userId)) as {
        duel_participant_id: string | null;
    };
    if (!run.duel_participant_id)
        return;
    const p = (await db.prepare('SELECT * FROM duel_participants WHERE id=?').get(run.duel_participant_id)) as Member & {
        duel_id: string;
    };
    const rules = JSON.parse((await find(db, p.duel_id))!.rules_json) as DuelRules;
    (await db.prepare('INSERT INTO duel_submissions VALUES (?,?,?,?)').run(p.id, resultId, duelScore(record as ProgramRecord, rules), now));
    (await db.prepare("UPDATE duels SET state='waiting' WHERE id=?").run(p.duel_id));
    (await finalizeDuel(db, p.duel_id, now));
}
export function registerDuels(app: FastifyInstance, db: Database, requireUser: (req: FastifyRequest) => Promise<{ id: string }>, fail: (status: number, code: string, message: string) => never) {
    const id = { type: 'string', minLength: 1, maxLength: 128 }, params = obj({ id }), empty = obj({});
    const owned = async (duelId: string, userId: string) => {
        const p = (await db.prepare('SELECT * FROM duel_participants WHERE duel_id=? AND user_id=?').get(duelId, userId)) as Member | undefined;
        if (!p)
            fail(404, 'NOT_FOUND', 'Дуэль не найдена.');
        return p;
    };
    const refresh = async (duelId: string) => (await db.transaction(async () => (await finalizeDuel(db, duelId, new Date().toISOString()))).immediate());
    const active = (d: DuelRow) => { if (!['accepted', 'waiting'].includes(d.state) || new Date().toISOString() >= d.ends_at)
        fail(409, 'DUEL_CLOSED', 'Дуэль пока не принята или уже завершена. Обнови статус.'); };
    app.get('/api/duels', { schema: { querystring: empty } }, async (req) => ({ duels: (await listDuels(db, (await requireUser(req)).id, new Date().toISOString())) }));
    app.post<{
        Body: {
            requestId: string;
            program: ProgramPlan;
            hours: number;
        };
    }>('/api/duels', { schema: { querystring: empty, body: obj({ requestId: id, program: planSchema, hours: { type: 'integer', minimum: 1, maximum: 168 } }) } }, async (req, reply) => {
        const user = (await requireUser(req));
        const result = (await db.transaction(async () => {
            const { program, hours, requestId } = req.body;
            const previous = (await db.prepare('SELECT id,request_json FROM duels WHERE creator_id=? AND request_id=?').get(user.id, requestId)) as {
                id: string;
                request_json: string;
            } | undefined;
            if (previous) {
                if (!same(JSON.parse(previous.request_json), { program, hours }))
                    fail(409, 'DUEL_CONFLICT', 'Запрос уже связан с другим приглашением.');
                (await finalizeDuel(db, previous.id, new Date().toISOString()));
                return { existing: true, duel: (await duelView(db, previous.id, user.id)) };
            }
            if (program.steps.some(s => s.goal.unit === 'seconds'))
                fail(400, 'UNSUPPORTED_UNIT', 'Удержания не входят в правила дуэлей v1.');
            const template = (await availablePrograms(db, null)).find(p => p.id === program.id && p.origin === 'catalog');
            const identity = (p: ProgramPlan) => ({ ...p, steps: p.steps.map(s => ({ id: s.id, exercise: s.exercise })) });
            if (!validPlan(program) || !template || !same(identity(program), identity(template)))
                fail(409, 'PROGRAM_CHANGED', 'Выбери актуальную программу из каталога.');
            const duelId = randomUUID(), now = new Date().toISOString(), endsAt = new Date(Date.now() + hours * 3600000).toISOString();
            const code = randomBytes(8).toString('hex').toUpperCase();
            const task: ProgramSnapshot = { kind: 'program', program, mode: 'camera', conditions: '' };
            (await db.prepare("INSERT INTO duels (id,creator_id,request_id,request_json,code,task_json,rules_json,created_at,ends_at,state) VALUES (?,?,?,?,?,?,?,?,?,'invited')").run(duelId, user.id, requestId, JSON.stringify({ program, hours }), code, JSON.stringify(task), JSON.stringify(DUEL_RULES), now, endsAt));
            (await db.prepare('INSERT INTO duel_participants VALUES (?,?,?,?,?)').run(randomUUID(), duelId, user.id, 1, now));
            return { existing: false, duel: (await duelView(db, duelId, user.id)) };
        }).immediate());
        return reply.code(result.existing ? 200 : 201).send({ duel: result.duel });
    });
    const codeParams = obj({ code: { type: 'string', pattern: '^[A-Fa-f0-9]{16}$' } });
    const byCode = async (code: string) => (await db.prepare('SELECT * FROM duels WHERE code=?').get(code.toUpperCase())) as DuelRow | undefined ?? fail(404, 'NOT_FOUND', 'Приглашение не найдено. Проверь код.');
    app.get<{
        Params: {
            code: string;
        };
    }>('/api/duel-invitations/:code', { schema: { params: codeParams, querystring: empty } }, async (req) => {
        const user = (await requireUser(req)), d = (await byCode(req.params.code));
        const demo = async (id: string) => !!(await db.prepare('SELECT 1 FROM demo_users WHERE user_id=?').get(id));
        if ((await demo(user.id)) !== (await demo(d.creator_id)))
            fail(409, 'DEMO_SEPARATE', 'Учебные участники играют только с учебными аккаунтами.');
        (await refresh(d.id));
        const fresh = (await find(db, d.id))!;
        const creator = (await db.prepare('SELECT nickname,avatar FROM users WHERE id=?').get(d.creator_id)) as DuelInvitation['creator'];
        const invitation: DuelInvitation = { id: d.id, code: d.code, state: fresh.state, endsAt: d.ends_at, task: JSON.parse(d.task_json), rules: JSON.parse(d.rules_json), creator };
        return { invitation };
    });
    app.post<{
        Params: {
            code: string;
        };
    }>('/api/duel-invitations/:code/accept', { schema: { params: codeParams, querystring: empty, body: empty } }, async (req) => {
        const user = (await requireUser(req)), d = (await byCode(req.params.code));
        (await refresh(d.id));
        return (await db.transaction(async () => {
            const fresh = (await find(db, d.id))!;
            const demo = async (id: string) => !!(await db.prepare('SELECT 1 FROM demo_users WHERE user_id=?').get(id));
            if ((await demo(user.id)) !== (await demo(fresh.creator_id)))
                fail(409, 'DEMO_SEPARATE', 'Учебные участники играют только с учебными аккаунтами.');
            if (user.id === fresh.creator_id)
                fail(409, 'DUEL_SELF', 'Пригласи другой аккаунт. Нельзя принять свою дуэль.');
            if ((await members(db, d.id)).some(p => p.user_id === user.id))
                return { duel: (await duelView(db, d.id, user.id)) };
            if (fresh.state !== 'invited')
                fail(409, 'DUEL_UNAVAILABLE', 'Приглашение уже принято, отменено или срок истёк.');
            const now = new Date().toISOString();
            if (now >= fresh.ends_at)
                fail(409, 'DUEL_CLOSED', 'Срок приглашения истёк.');
            (await db.prepare('INSERT INTO duel_participants VALUES (?,?,?,?,?)').run(randomUUID(), d.id, user.id, 2, now));
            (await db.prepare("UPDATE duels SET state='accepted',accepted_at=? WHERE id=?").run(now, d.id));
            return { duel: (await duelView(db, d.id, user.id)) };
        }).immediate());
    });
    app.get<{
        Params: {
            id: string;
        };
    }>('/api/duels/:id', { schema: { params, querystring: empty } }, async (req) => {
        const user = (await requireUser(req));
        (await owned(req.params.id, user.id));
        (await refresh(req.params.id));
        return { duel: (await duelView(db, req.params.id, user.id)) };
    });
    app.post<{
        Params: {
            id: string;
        };
    }>('/api/duels/:id/cancel', { schema: { params, querystring: empty, body: empty } }, async (req) => {
        const user = (await requireUser(req));
        (await owned(req.params.id, user.id));
        (await refresh(req.params.id));
        return (await db.transaction(async () => {
            const d = (await find(db, req.params.id))!;
            if (d.creator_id !== user.id || !['invited', 'cancelled'].includes(d.state))
                fail(409, 'DUEL_ACCEPTED', 'Можно отменить только своё непринятое приглашение.');
            if (d.state === 'invited')
                (await db.prepare("UPDATE duels SET state='cancelled',finalized_at=? WHERE id=?").run(new Date().toISOString(), d.id));
            return { duel: (await duelView(db, d.id, user.id)) };
        }).immediate());
    });
    app.post<{
        Params: {
            id: string;
        };
    }>('/api/duels/:id/run', { schema: { params, querystring: empty, body: empty } }, async (req, reply) => {
        const user = (await requireUser(req));
        (await owned(req.params.id, user.id));
        (await refresh(req.params.id));
        const result = (await db.transaction(async () => {
            const p = (await owned(req.params.id, user.id)), d = (await find(db, req.params.id))!;
            const prior = (await db.prepare('SELECT id,created_at FROM workout_runs WHERE duel_participant_id=?').get(p.id)) as {
                id: string;
                created_at: string;
            } | undefined;
            if (prior)
                return { existing: true, id: prior.id, createdAt: prior.created_at, snapshot: JSON.parse(d.task_json) };
            active(d);
            const runId = randomUUID(), now = new Date().toISOString();
            (await db.prepare('INSERT INTO workout_runs (id,user_id,request_id,snapshot_json,created_at,reward_rules_version,duel_participant_id) VALUES (?,?,?,?,?,?,?)').run(runId, user.id, `duel:${p.id}`, d.task_json, now, RULES_VERSION, p.id));
            return { existing: false, id: runId, createdAt: now, snapshot: JSON.parse(d.task_json) };
        }).immediate());
        return reply.code(result.existing ? 200 : 201).send({ id: result.id, createdAt: result.createdAt, snapshot: result.snapshot });
    });
    app.put<{
        Params: {
            id: string;
        };
        Body: {
            revision: number;
            record: ProgramRecord;
        };
    }>('/api/duels/:id/draft', { bodyLimit: 4 * 1024 * 1024, schema: { params, querystring: empty, body: obj({ revision: { type: 'integer', minimum: 1 }, record: programRecordSchema }) } }, async (req) => {
        const user = (await requireUser(req));
        (await owned(req.params.id, user.id));
        (await refresh(req.params.id));
        return (await db.transaction(async () => {
            const p = (await owned(req.params.id, user.id)), d = (await find(db, req.params.id))!;
            const { record, revision } = req.body;
            const previous = (await db.prepare('SELECT revision,record_json FROM duel_drafts WHERE participant_id=?').get(p.id)) as {
                revision: number;
                record_json: string;
            } | undefined;
            if (previous?.revision === revision && same(JSON.parse(previous.record_json), record))
                return { revision };
            active(d);
            if ((await db.prepare('SELECT 1 FROM duel_submissions WHERE participant_id=?').get(p.id)))
                fail(409, 'DUEL_SUBMITTED', 'Итог уже отправлен.');
            if (revision !== (previous?.revision ?? 0) + 1)
                fail(409, 'DRAFT_CONFLICT', 'Черновик изменился в другом окне. Открой дуэль заново.');
            const run = (await db.prepare('SELECT id,created_at FROM workout_runs WHERE duel_participant_id=?').get(p.id)) as {
                id: string;
                created_at: string;
            } | undefined;
            if (!run || record.id !== run.id || record.date !== run.created_at || !validProgramRecord(record) || !same({ kind: 'program', program: record.program, mode: record.mode, conditions: record.conditions }, JSON.parse(d.task_json)))
                fail(409, 'DUEL_TASK', 'Черновик не соответствует запуску и порядку шагов.');
            // Completed recorded steps cannot be replaced with a better attempt on reload.
            if (previous) {
                const prior = JSON.parse(previous.record_json) as ProgramRecord;
                if (prior.steps.length > record.steps.length || !prior.steps.every((step, i) => same(step, record.steps[i])))
                    fail(409, 'DRAFT_CONFLICT', 'Записанные шаги уже зафиксированы.');
            }
            (await db.prepare('INSERT INTO duel_drafts VALUES (?,?,?,?) ON CONFLICT(participant_id) DO UPDATE SET revision=excluded.revision,record_json=excluded.record_json,updated_at=excluded.updated_at').run(p.id, revision, JSON.stringify(record), new Date().toISOString()));
            return { revision };
        }).immediate());
    });
}
