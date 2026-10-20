import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isWorkoutRecord } from '../shared/historyValidation.js';
import type { WorkoutRecord, TrainingGoal } from '../shared/workout.js';
import { importSchema, obj, snapshotSchema, workoutSchema } from './workoutSchema.js';
import { availablePrograms, registerPrograms, programRecordSchema, programSnapshotSchema } from './programs.js';
import { isProgram, same, validPlan, validProgramRecord, type HistoryRecord, type ProgramSnapshot } from '../shared/program.js';
import { accountCompletion, progression, receipt, RULES_VERSION } from './progression.js';
import { activeChallenges, challengeReceipt, completeChallenge, registerChallenges } from './challenges.js';
import { checkDuelCompletion, completeDuel, listDuels, registerDuels } from './duels.js';
import { registerLeaderboard } from './leaderboard.js';

export class ApiError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); }
}
function fail(status: number, code: string, message: string): never { throw new ApiError(status, code, message); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
});
async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt-65536-8-1$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
interface User { id: string; login: string; nickname: string; avatar: string; createdAt: string; isDemo?: boolean }
interface ResultRow { id: string; user_id: string; run_id: string | null; source: string; source_version: number; original_id: string | null; record_json: string; created_at: string; archived_at: string | null }
type Snapshot = { exercise: WorkoutRecord['exercise']; mode: WorkoutRecord['mode']; goal: TrainingGoal; conditions: string } | ProgramSnapshot;
const userColumns = 'u.id, u.login, u.nickname, u.avatar, u.created_at AS createdAt, EXISTS(SELECT 1 FROM demo_users d WHERE d.user_id=u.id) AS isDemo';
const idSchema = { type: 'string', minLength: 1, maxLength: 128 };
const credentials = obj({ login: { type: 'string', pattern: '^[a-zA-Z0-9_]{3,32}$' }, password: { type: 'string', minLength: 8, maxLength: 128 } });
const emptyQuery = obj({});
function validateRecord(value: unknown): asserts value is WorkoutRecord {
  if (!isWorkoutRecord(value) || value.sets.reduce((n,s) => n + s.result.attempts.length,0) > 5000 ||
    value.sets.some(s => s.observation.sampledMs > s.durationMs + 1) ||
    value.sets.reduce((n,s) => n + s.durationMs,0) > value.duration * 1000 + 1) fail(400, 'INVALID_RESULT', 'Результат содержит несогласованные показатели.');
}
export function registerAccounts(app: FastifyInstance, db: Database.Database) {
  const serializedResult = (row: ResultRow) => {
    const challenge = challengeReceipt(db,row.id);
    return { id: row.id, runId: row.run_id, source: row.source, sourceVersion: row.source_version, originalId: row.original_id, createdAt: row.created_at, archivedAt: row.archived_at, isDemo: !!db.prepare('SELECT 1 FROM demo_users WHERE user_id=?').get(row.user_id), record: JSON.parse(row.record_json) as HistoryRecord, reward: { ...receipt(db,row.user_id,row.id,row.source), ...(challenge ? { challenge } : {}) } };
  };
  const token = (req: FastifyRequest) => {
    const candidate = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('playfit_session='))?.slice(16);
    return candidate && /^[a-f0-9]{64}$/.test(candidate) ? candidate : null;
  };
  const current = (req: FastifyRequest) => {
    const raw = token(req);
    const row = raw ? db.prepare(`SELECT ${userColumns} FROM users u JOIN auth_sessions s ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(hash(raw), new Date().toISOString()) as User | undefined : undefined;
    return row ? { ...row, isDemo: Boolean(row.isDemo) } : undefined;
  };
  const requireUser = (req: FastifyRequest) => {
    const user = current(req) ?? fail(401, 'AUTH_REQUIRED', 'Войди в аккаунт и повтори действие.');
    if (req.headers['x-playfit-user'] !== undefined && req.headers['x-playfit-user'] !== user.id) fail(409,'ACCOUNT_CHANGED','Аккаунт изменился в другом окне. Обнови страницу.');
    return user;
  };
  const createSession = (req: FastifyRequest, reply: FastifyReply, userId: string) => {
    const raw = randomBytes(32).toString('hex');
    db.transaction(() => {
      const old = token(req);
      if (old) db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hash(old));
      db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(new Date().toISOString());
      db.prepare('INSERT INTO auth_sessions VALUES (?,?,?)').run(hash(raw), userId, new Date(Date.now() + 30 * 86400000).toISOString());
    })();
    reply.header('set-cookie', `playfit_session=${raw}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=2592000`);
  };
  registerPrograms(app,db,requireUser,req => req.headers['x-playfit-user'] !== undefined ? requireUser(req) : current(req),fail);
  registerChallenges(app,db,requireUser,req => req.headers['x-playfit-user'] !== undefined ? requireUser(req) : current(req),fail);
  registerDuels(app,db,requireUser,fail);
  registerLeaderboard(app,db,req => req.headers['x-playfit-user'] !== undefined ? requireUser(req) : current(req),fail);
  const attempts = new Map<string, { count: number; until: number }>();
  let activeKdf = 0;
  async function authLimit(req: FastifyRequest, work: () => Promise<User>) {
    const now = Date.now();
    for (const [ip,v] of attempts) if (v.until <= now) attempts.delete(ip);
    const attempt = attempts.get(req.ip) ?? { count: 0, until: now + 15 * 60000 };
    attempts.set(req.ip, attempt);
    if (++attempt.count > 30 || activeKdf >= 2) fail(429, 'AUTH_RATE_LIMIT', 'Слишком много попыток. Повтори вход позже.');
    activeKdf++;
    try { return await work(); } finally { activeKdf--; }
  }
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    reply.header('cache-control','no-store');
    if (['GET','HEAD','OPTIONS'].includes(req.method)) return;
    // Custom header cannot be sent by a cross-origin form. No CORS is enabled.
    if (req.headers['x-playfit-request'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site' ||
      (req.headers.origin !== undefined && req.headers.origin !== `${req.protocol}://${req.headers.host}`)) {
      fail(403, 'ORIGIN_REJECTED', 'Запрос должен исходить из приложения PlayFit.');
    }
  });
  app.post<{ Body: { login: string; password: string } }>('/api/auth/register', { schema: { body: credentials, querystring: emptyQuery } }, async (req, reply) => {
    const user = await authLimit(req, async () => {
      const login = req.body.login.toLowerCase();
      if (db.prepare('SELECT id FROM users WHERE login=?').get(login)) fail(409, 'LOGIN_TAKEN', 'Этот логин уже занят.');
      const password = await passwordHash(req.body.password);
      const user: User = { id: randomUUID(), login, nickname: login, avatar: 'sprout', createdAt: new Date().toISOString() };
      try { db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(user.id,login,password,user.nickname,user.avatar,user.createdAt); }
      catch (e) { if (db.prepare('SELECT id FROM users WHERE login=?').get(login)) fail(409, 'LOGIN_TAKEN', 'Этот логин уже занят.'); throw e; }
      return user;
    });
    createSession(req,reply,user.id);
    return reply.code(201).send({ user });
  });
  app.post<{ Body: { login: string; password: string } }>('/api/auth/login', { schema: { body: credentials, querystring: emptyQuery } }, async (req,reply) => {
    const user = await authLimit(req, async () => {
      const row = db.prepare(`SELECT ${userColumns}, u.password_hash FROM users u WHERE login=?`).get(req.body.login.toLowerCase()) as (User & { password_hash: string }) | undefined;
      const [,salt,key] = row?.password_hash.split('$') ?? ['', '0'.repeat(32), '0'.repeat(128)];
      const actual = await derive(req.body.password,salt);
      if (!row || !timingSafeEqual(actual,Buffer.from(key,'hex'))) fail(401, 'INVALID_CREDENTIALS', 'Неверный логин или пароль.');
      return { id: row.id, login: row.login, nickname: row.nickname, avatar: row.avatar, createdAt: row.createdAt, isDemo: 'isDemo' in row && Boolean(row.isDemo) };
    });
    createSession(req,reply,user.id);
    return { user };
  });
  app.get('/api/auth/me', { schema: { querystring: emptyQuery } }, async req => ({ user: current(req) ?? null }));
  app.post('/api/auth/logout', { schema: { body: obj({}), querystring: emptyQuery } }, async (req,reply) => {
    if (current(req)) requireUser(req);
    const raw = token(req);
    if (raw) db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hash(raw));
    reply.header('set-cookie','playfit_session=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0');
    return { ok: true };
  });
  app.patch<{ Body: { nickname: string; avatar: string } }>('/api/profile', { schema: { body: obj({ nickname: { type:'string', minLength:1, maxLength:32, pattern: '\\S' }, avatar: { enum:['sprout','bolt','sun','mountain'] } }), querystring: emptyQuery } }, async req => {
    const user = requireUser(req);
    db.prepare('UPDATE users SET nickname=?, avatar=? WHERE id=?').run(req.body.nickname.trim(),req.body.avatar,user.id);
    return { user: current(req) };
  });
  app.get('/api/profile', { schema: { querystring: emptyQuery } }, async req => {
    const user = requireUser(req);
    const rows = db.prepare('SELECT * FROM workout_results WHERE user_id=? AND archived_at IS NULL').all(user.id) as ResultRow[];
    const personal = rows.filter(r => JSON.parse(r.record_json).mode !== 'demo');
    return { user, stats: { workouts: personal.length, reps: personal.reduce((n,r) => { const record = JSON.parse(r.record_json) as HistoryRecord; return n + (isProgram(record) ? record.steps : [record]).reduce((m,c) => m+c.sets.reduce((k,s) => k+s.result.reps,0),0); },0), seconds: Math.round(personal.reduce((n,r) => n + JSON.parse(r.record_json).duration,0)), demos: rows.length-personal.length } };
  });
  app.post<{ Body: Snapshot & { requestId: string } }>('/api/runs', { schema: { body: {anyOf:[obj({ ...snapshotSchema.properties, requestId: idSchema }),obj({...programSnapshotSchema.properties,requestId:idSchema})]}, querystring: emptyQuery } }, async (req,reply) => {
    const user = requireUser(req);
    const body = req.body;
    const snapshot: Snapshot = 'kind' in body ? {kind:'program',program:body.program,mode:body.mode,conditions:body.conditions.trim()} : { exercise:body.exercise, mode:body.mode, goal:body.goal, conditions:body.conditions.trim() };
    const json = canonical(snapshot);
    const row = db.prepare('SELECT * FROM workout_runs WHERE user_id=? AND request_id=?').get(user.id,req.body.requestId) as { id: string; snapshot_json: string; created_at: string } | undefined;
    if (row && row.snapshot_json !== json) fail(409,'RUN_CONFLICT','Этот запрос уже связан с другой целью.');
    if (!row && 'kind' in snapshot) {
      const plan = snapshot.program, template = availablePrograms(db,user.id).find(p => p.id === plan.id);
      if (!validPlan(plan) || !template || !same({...plan,steps:plan.steps.map(s => ({id:s.id,exercise:s.exercise}))},{...template,steps:template.steps.map(s => ({id:s.id,exercise:s.exercise}))})) fail(409,'PROGRAM_CHANGED','Шаблон изменился или недоступен. Открой программу заново.');
    }
    const id = row?.id ?? randomUUID(), createdAt = row?.created_at ?? new Date().toISOString();
    if (!row) db.prepare('INSERT INTO workout_runs (id,user_id,request_id,snapshot_json,created_at,reward_rules_version) VALUES (?,?,?,?,?,?)').run(id,user.id,req.body.requestId,json,createdAt,RULES_VERSION);
    return reply.code(row ? 200 : 201).send({ id, snapshot, createdAt });
  });
  const findResult = (userId: string, id: string) => db.prepare('SELECT * FROM workout_results WHERE id=? AND user_id=?').get(id,userId) as ResultRow | undefined;
  app.post<{ Params: { id: string }; Body: { record: HistoryRecord } }>('/api/runs/:id/complete', { bodyLimit: 4 * 1024 * 1024, schema: { params: obj({ id:idSchema }), body: obj({ record:{anyOf:[workoutSchema,programRecordSchema]} }), querystring: emptyQuery } }, async (req,reply) => {
    const user = requireUser(req);
    const run = db.prepare('SELECT * FROM workout_runs WHERE id=? AND user_id=?').get(req.params.id,user.id) as { snapshot_json: string; reward_rules_version: string | null } | undefined;
    if (!run) fail(404,'NOT_FOUND','Запуск не найден.');
    const record = req.body.record;
    if (isProgram(record)) {
      if (!validProgramRecord(record)) fail(400,'INVALID_RESULT','Нарушена последовательность шагов или показатели программы.');
    } else validateRecord(record);
    const snapshot = JSON.parse(run.snapshot_json) as Snapshot;
    const resultSnapshot: Snapshot = isProgram(record) ? {kind:'program',program:record.program,mode:record.mode,conditions:record.conditions} : {exercise:record.exercise,mode:record.mode,goal:record.goal,conditions:record.conditions};
    if (record.id !== req.params.id || canonical(resultSnapshot) !== canonical(snapshot) || (isProgram(record) && record.date !== (db.prepare('SELECT created_at FROM workout_runs WHERE id=?').get(req.params.id) as {created_at:string}).created_at)) fail(409,'SNAPSHOT_MISMATCH','Результат не соответствует цели запуска.');
    const json = canonical(record);
    const saved = db.transaction(() => {
      const existing = db.prepare('SELECT * FROM workout_results WHERE run_id=? AND user_id=?').get(req.params.id,user.id) as ResultRow | undefined;
      if (existing && existing.record_json !== json) fail(409,'RESULT_CONFLICT','Запуск уже завершён с другим результатом.');
      const id = existing?.id ?? randomUUID();
      if (!existing) {
        const eventAt = new Date().toISOString();
        checkDuelCompletion(db,user.id,req.params.id,record,eventAt,fail);
        db.prepare("INSERT INTO workout_results (id,user_id,run_id,source,source_version,record_json,created_at) VALUES (?,?,?,'training',?,?,?)").run(id,user.id,req.params.id,isProgram(record) ? 2 : 1,json,eventAt);
        accountCompletion(db,user.id,id,record,run.reward_rules_version,eventAt);
        completeChallenge(db,user.id,req.params.id,id,record,eventAt);
        completeDuel(db,user.id,req.params.id,id,record,eventAt);
      }
      return { existing:!!existing, result:serializedResult(findResult(user.id,id)!) };
    }).immediate();
    return reply.code(saved.existing ? 200 : 201).send({ result:saved.result });
  });
  app.get('/api/me/progression', { schema:{ querystring:emptyQuery } }, async req => {
    const user = requireUser(req);
    return { progression:progression(db,user.id) };
  });
  app.get('/api/me/overview', { schema:{ querystring:emptyQuery } }, async req => {
    const user = requireUser(req);
    const duels = listDuels(db,user.id,new Date().toISOString()).filter(d => ['invited','accepted','waiting'].includes(d.state));
    return { progression:progression(db,user.id), duels, challenges:activeChallenges(db,user.id,new Date().toISOString()), recent:(db.prepare('SELECT * FROM workout_results WHERE user_id=? AND archived_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 3').all(user.id) as ResultRow[]).map(serializedResult) };
  });
  app.get('/api/history', { schema: { querystring:emptyQuery } }, async req => {
    const user = requireUser(req);
    return { results: (db.prepare('SELECT * FROM workout_results WHERE user_id=? AND archived_at IS NULL ORDER BY created_at, id').all(user.id) as ResultRow[]).map(serializedResult) };
  });
  app.get<{ Params:{ id:string } }>('/api/history/:id', { schema: { params:obj({ id:idSchema }), querystring:emptyQuery } }, async req => {
    const user = requireUser(req);
    const row = findResult(user.id,req.params.id) ?? fail(404,'NOT_FOUND','Результат не найден.');
    return { result: serializedResult(row) };
  });
  app.delete<{ Params:{ id:string } }>('/api/history/:id', { schema: { params:obj({ id:idSchema }), querystring:emptyQuery } }, async req => {
    const user = requireUser(req);
    if (!findResult(user.id,req.params.id)) fail(404,'NOT_FOUND','Результат не найден.');
    db.prepare('UPDATE workout_results SET archived_at=COALESCE(archived_at,?) WHERE id=? AND user_id=?').run(new Date().toISOString(),req.params.id,user.id);
    return { ok:true };
  });
  type ImportBody = { schemaVersion:1; source:'playfit.workouts.v1'; records:WorkoutRecord[] };
  for (const preview of [true,false]) app.post<{ Body:ImportBody }>(`/api/history/import${preview ? '/preview' : ''}`, { bodyLimit:4*1024*1024, schema: { body:importSchema, querystring:emptyQuery } }, async req => {
    const user = requireUser(req);
    req.body.records.forEach(validateRecord);
    if (new Set(req.body.records.map(r => r.id)).size !== req.body.records.length) fail(400,'INVALID_RESULT','В наборе повторяются исходные ID.');
    return db.transaction(() => {
      let added=0, existing=0;
      for (const record of req.body.records) {
        const previous = db.prepare("SELECT record_json FROM workout_results WHERE user_id=? AND source='historical_import' AND original_id=?").get(user.id,record.id) as { record_json:string } | undefined;
        const json = canonical(record);
        if (previous) {
          if (previous.record_json !== json) fail(409,'IMPORT_CONFLICT','Ранее импортированная запись с таким ID отличается. Исходные данные сохранены.');
          existing++;
        } else {
          added++;
          if (!preview) db.prepare("INSERT INTO workout_results (id,user_id,source,source_version,original_id,record_json,created_at) VALUES (?,?,'historical_import',1,?,?,?)").run(randomUUID(),user.id,record.id,json,new Date().toISOString());
        }
      }
      return { added, existing, total:req.body.records.length };
    })();
  });
}
