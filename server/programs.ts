import { mapSeries } from './sequence.js';
import { exerciseIds } from '../src/exercises/types.js';
import type { TrainingGoal } from '../shared/workout.js';
import type { Database } from './database.js';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ProgramPlan } from '../shared/program.js';
import { validDraft, type ProgramDraft } from '../shared/programDraft.js';
import { goalSchema, obj, workoutSchema } from './workoutSchema.js';
const id = { type: 'string', minLength: 1, maxLength: 100 };
const seconds = { type: 'integer', minimum: 0, maximum: 3600 };
export const planSchema = obj({ schemaVersion: { const: 1 }, id, version: { type: 'integer', minimum: 1 }, origin: { enum: ['catalog', 'personal'] }, ownerId: { anyOf: [id, { type: 'null' }] }, title: { type: 'string', minLength: 1, maxLength: 100 }, description: { type: 'string', maxLength: 1000 },
    steps: { type: 'array', minItems: 1, maxItems: 12, items: obj({ id: { ...id, maxLength: 64 }, exercise: { enum: [...exerciseIds] }, goal: goalSchema, transitionSeconds: seconds }) } });
export const programSnapshotSchema = obj({ kind: { const: 'program' }, program: planSchema, mode: { enum: ['camera', 'demo'] }, conditions: { type: 'string', maxLength: 200 } });
export const programRecordSchema = obj({ schemaVersion: { const: 2 }, kind: { const: 'program' }, id, date: { type: 'string', minLength: 1, maxLength: 40 }, program: planSchema, mode: { enum: ['camera', 'demo'] }, conditions: { type: 'string', maxLength: 200 }, ended: { enum: ['completed', 'interrupted'] }, duration: { type: 'number', minimum: 0, maximum: 604800 }, steps: { type: 'array', maxItems: 12, items: workoutSchema } });
export async function availablePrograms(db: Database, ownerId: string | null): Promise<ProgramPlan[]> {
    const rows = (await db.prepare("SELECT * FROM programs WHERE archived_at IS NULL AND (origin='catalog' OR owner_id=?) ORDER BY id DESC").all(ownerId)) as {
        id: string;
        version: number;
        title: string;
        description: string;
        origin: ProgramPlan['origin'];
        owner_id: string | null;
    }[];
    const steps = await db.prepare("SELECT s.* FROM program_steps s JOIN programs p ON p.id=s.program_id WHERE p.archived_at IS NULL AND (p.origin='catalog' OR p.owner_id=?) ORDER BY s.program_id,s.position").all(ownerId) as {
            program_id: string;
            id: string;
            exercise: ProgramPlan['steps'][number]['exercise'];
            sets: number;
            reps: number;
            rest_seconds: number;
            transition_seconds: number;
            goal_json: string | null;
        }[];
    return rows.map(row => ({ schemaVersion: 1, id: row.id, version: row.version, title: row.title, description: row.description, origin: row.origin, ownerId: row.owner_id,
        steps: steps.filter(step => step.program_id === row.id).map(s => ({ id: s.id, exercise: s.exercise, goal: s.goal_json ? JSON.parse(s.goal_json) as TrainingGoal : { sets: s.sets, reps: s.reps, restSeconds: s.rest_seconds }, transitionSeconds: s.transition_seconds })) }));
}
export function registerPrograms(app: FastifyInstance, db: Database, requireUser: (req: FastifyRequest) => Promise<{ id: string }>, optionalUser: (req: FastifyRequest) => Promise<{ id: string } | undefined>, fail: (status: number, code: string, message: string) => never) {
    const params = obj({ id });
    const querystring = obj({});
    const draftSchema = obj({ title: planSchema.properties.title, description: planSchema.properties.description, steps: planSchema.properties.steps });
    const find = async (programId: string, userId: string | null) => (await availablePrograms(db, userId)).find(p => p.id === programId) ?? fail(404, 'NOT_FOUND', 'Программа недоступна или удалена из списка. Старые результаты сохранены в истории.');
    const owned = async (programId: string, userId: string) => {
        const plan = (await find(programId, userId));
        if (plan.origin !== 'personal' || plan.ownerId !== userId)
            fail(404, 'NOT_FOUND', 'Личная программа не найдена.');
        return plan;
    };
    const saveSteps = async (p: ProgramPlan) => {
        (await db.prepare('DELETE FROM program_steps WHERE program_id=?').run(p.id));
        const insert = db.prepare('INSERT INTO program_steps (program_id,position,id,exercise,sets,reps,rest_seconds,transition_seconds,goal_json) VALUES (?,?,?,?,?,?,?,?,?)');
        (await mapSeries(p.steps, async (s, i) => (await insert.run(p.id, i, s.id, s.exercise, s.goal.sets, s.goal.reps ?? null, s.goal.restSeconds, s.transitionSeconds, JSON.stringify(s.goal)))));
        (await db.prepare('INSERT INTO program_versions VALUES (?,?,?,?)').run(p.id, p.version, JSON.stringify(p), new Date().toISOString()));
    };
    const create = async (draft: ProgramDraft, userId: string) => {
        if (!validDraft(draft))
            fail(400, 'INVALID_PROGRAM', 'Проверь название, шаги и параметры программы.');
        const program: ProgramPlan = { ...draft, title: draft.title.trim(), description: draft.description.trim(), schemaVersion: 1, id: randomUUID(), version: 1, origin: 'personal', ownerId: userId };
        (await db.prepare('INSERT INTO programs (id,version,owner_id,origin,title,description) VALUES (?,?,?,?,?,?)').run(program.id, 1, userId, 'personal', program.title, program.description));
        (await saveSteps(program));
        return program;
    };
    app.get('/api/programs', { schema: { querystring } }, async (req) => ({ programs: (await availablePrograms(db, (await optionalUser(req))?.id ?? null)) }));
    app.get('/api/me/programs', { schema: { querystring } }, async (req) => ({ programs: (await availablePrograms(db, (await requireUser(req)).id)).filter(p => p.origin === 'personal') }));
    app.get('/api/me/favorites', { schema: { querystring } }, async (req) => {
        const user = (await requireUser(req));
        const ids = new Set(((await db.prepare('SELECT program_id FROM program_favorites WHERE user_id=?').all(user.id)) as {
            program_id: string;
        }[]).map(r => r.program_id));
        return { programs: (await availablePrograms(db, user.id)).filter(p => ids.has(p.id)) };
    });
    app.get<{
        Params: {
            id: string;
        };
    }>('/api/programs/:id', { schema: { params, querystring } }, async (req) => ({ program: (await find(req.params.id, (await optionalUser(req))?.id ?? null)) }));
    app.post<{
        Body: ProgramDraft;
    }>('/api/programs', { schema: { body: draftSchema, querystring } }, async (req, reply) => {
        const user = (await requireUser(req));
        return reply.code(201).send({ program: (await db.transaction(async () => (await create(req.body, user.id)))()) });
    });
    app.put<{
        Params: {
            id: string;
        };
        Body: ProgramDraft & {
            version: number;
        };
    }>('/api/programs/:id', { schema: { params, querystring, body: obj({ ...draftSchema.properties, version: planSchema.properties.version }) } }, async (req) => {
        const user = (await requireUser(req));
        return (await db.transaction(async () => {
            const previous = (await owned(req.params.id, user.id));
            if (previous.version !== req.body.version)
                fail(409, 'PROGRAM_CHANGED', 'Программа изменена в другой вкладке. Сохрани черновик и открой актуальную версию.');
            if (!validDraft(req.body))
                fail(400, 'INVALID_PROGRAM', 'Проверь название, шаги и параметры программы.');
            const program: ProgramPlan = { ...previous, title: req.body.title.trim(), description: req.body.description.trim(), steps: req.body.steps, version: previous.version + 1 };
            (await db.prepare('UPDATE programs SET version=?,title=?,description=? WHERE id=?').run(program.version, program.title, program.description, program.id));
            (await saveSteps(program));
            return { program };
        })());
    });
    app.post<{
        Params: {
            id: string;
        };
        Body: {
            version: number;
        };
    }>('/api/programs/:id/copy', { schema: { params, querystring, body: obj({ version: planSchema.properties.version }) } }, async (req, reply) => {
        const user = (await requireUser(req));
        const program = (await db.transaction(async () => {
            const source = (await find(req.params.id, user.id));
            if (source.version !== req.body.version)
                fail(409, 'PROGRAM_CHANGED', 'Программа изменилась. Открой её заново перед копированием.');
            return (await create({ title: source.title, description: source.description, steps: source.steps }, user.id));
        })());
        return reply.code(201).send({ program });
    });
    app.delete<{
        Params: {
            id: string;
        };
    }>('/api/programs/:id', { schema: { params, querystring } }, async (req) => {
        const user = (await requireUser(req));
        const row = (await db.prepare("SELECT id FROM programs WHERE id=? AND origin='personal' AND owner_id=?").get(req.params.id, user.id));
        if (!row)
            fail(404, 'NOT_FOUND', 'Личная программа не найдена.');
        (await db.prepare('UPDATE programs SET archived_at=COALESCE(archived_at,?) WHERE id=?').run(new Date().toISOString(), req.params.id));
        return { ok: true };
    });
    app.put<{
        Params: {
            id: string;
        };
    }>('/api/programs/:id/favorite', { schema: { params, querystring } }, async (req) => {
        const user = (await requireUser(req));
        (await find(req.params.id, user.id));
        (await db.prepare("INSERT INTO program_favorites VALUES (?,?,?) ON CONFLICT DO NOTHING").run(user.id, req.params.id, new Date().toISOString()));
        return { ok: true };
    });
    app.delete<{
        Params: {
            id: string;
        };
    }>('/api/programs/:id/favorite', { schema: { params, querystring } }, async (req) => {
        const user = (await requireUser(req));
        (await db.prepare('DELETE FROM program_favorites WHERE user_id=? AND program_id=?').run(user.id, req.params.id));
        return { ok: true };
    });
}
