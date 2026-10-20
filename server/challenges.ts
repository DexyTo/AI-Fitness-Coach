import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ChallengeDefinition, ChallengeDetail, ChallengeReceipt, ChallengeView } from '../shared/challenges.js';
import { isProgram, same, type HistoryRecord } from '../shared/program.js';
import { appendReward, RULES_VERSION } from './progression.js';
import { obj } from './workoutSchema.js';

interface ParticipationRow { id: string; user_id: string; challenge_id: string; snapshot_json: string; joined_at: string; completed_at: string | null }
const count = (db: Database.Database, id: string) => (db.prepare('SELECT COUNT(*) AS n FROM challenge_events WHERE participation_id=? AND eligible=1').get(id) as { n: number }).n;
export function challengeView(db: Database.Database, definition: ChallengeDefinition, row: ParticipationRow | undefined, now: string): ChallengeView {
  if (row) definition = JSON.parse(row.snapshot_json) as ChallengeDefinition;
  return { definition, participation: row ? { id: row.id, joinedAt: row.joined_at, completedAt: row.completed_at, progress: count(db, row.id) } : null,
    state: row?.completed_at ? 'completed' : now < definition.startsAt ? 'upcoming' : now >= definition.endsAt ? 'expired' : 'active',
    participantCount: (db.prepare('SELECT COUNT(*) AS n FROM challenge_participations WHERE challenge_id=? AND definition_version=?').get(definition.id, definition.version) as { n: number }).n };
}
export function listChallenges(db: Database.Database, userId: string | null, now: string): ChallengeView[] {
  const rows = db.prepare('SELECT d.definition_json FROM challenge_definitions d WHERE version=(SELECT MAX(version) FROM challenge_definitions WHERE id=d.id) ORDER BY d.id').all() as { definition_json: string }[];
  return rows.map(r => {
    const definition = JSON.parse(r.definition_json) as ChallengeDefinition;
    const participation = db.prepare('SELECT * FROM challenge_participations WHERE user_id=? AND challenge_id=?').get(userId, definition.id) as ParticipationRow | undefined;
    return challengeView(db, definition, participation, now);
  });
}
export function activeChallenges(db: Database.Database, userId: string, now: string) {
  return listChallenges(db, userId, now).filter(c => c.participation && c.state === 'active');
}
export function challengeReceipt(db: Database.Database, resultId: string): ChallengeReceipt | undefined {
  const row = db.prepare('SELECT receipt_json FROM challenge_events WHERE result_id=?').get(resultId) as { receipt_json: string } | undefined;
  return row ? JSON.parse(row.receipt_json) as ChallengeReceipt : undefined;
}

// Runs have one explicit participation. A result never fans out to other challenges.
// Called after accountCompletion, within the SAME immediate completion transaction.
export function completeChallenge(db: Database.Database, userId: string, runId: string, resultId: string, record: HistoryRecord, eventAt: string) {
  if (!db.inTransaction) throw new Error('Challenge completion requires transaction');
  const run = db.prepare('SELECT challenge_participation_id,created_at FROM workout_runs WHERE id=? AND user_id=?').get(runId, userId) as { challenge_participation_id: string | null; created_at: string };
  if (!run.challenge_participation_id) return;
  const p = db.prepare('SELECT * FROM challenge_participations WHERE id=? AND user_id=?').get(run.challenge_participation_id, userId) as ParticipationRow | undefined;
  if (!p) throw new Error('Challenge owner mismatch');
  const d = JSON.parse(p.snapshot_json) as ChallengeDefinition;
  const event = db.prepare('SELECT eligible FROM progression_events WHERE result_id=? AND user_id=?').get(resultId, userId) as { eligible: number };
  const task = isProgram(record) ? { kind: 'program', program: record.program, mode: record.mode, conditions: record.conditions } : null;
  let reason: ChallengeReceipt['reason'] = p.completed_at ? 'already_completed' : eventAt >= d.endsAt ? 'expired' : run.created_at < p.joined_at || run.created_at < d.startsAt || eventAt < d.startsAt ? 'before_join' : record.mode !== 'camera' ? 'source' : !same(task, d.task) ? 'task' : !event.eligible ? 'incomplete' : 'counted';
  const eligible = reason === 'counted';
  const progress = count(db, p.id) + Number(eligible);
  const completed = eligible && progress >= d.target;
  if (completed) {
    reason = 'completed';
    db.prepare('UPDATE challenge_participations SET completed_at=? WHERE id=? AND completed_at IS NULL').run(eventAt, p.id);
    for (const [currency, amount] of [['xp', d.reward.xp], ['competition_points', d.reward.points]] as const) {
      appendReward(db, { userId, currency, amount, sourceType: 'challenge', sourceId: p.id, eventAt, rulesVersion: d.rulesVersion });
    }
    db.prepare('INSERT OR IGNORE INTO user_achievements VALUES (?,?,?,?,?)').run(userId, 'first-challenge', resultId, eventAt, d.rulesVersion);
  }
  const receipt: ChallengeReceipt = { participationId: p.id, title: d.title, reason, progress, target: d.target, xp: completed ? d.reward.xp : 0, points: completed ? d.reward.points : 0 };
  db.prepare('INSERT INTO challenge_events VALUES (?,?,?,?,?)').run(resultId, p.id, Number(eligible), JSON.stringify(receipt), eventAt);
}

export function registerChallenges(app: FastifyInstance, db: Database.Database,
  requireUser: (req: FastifyRequest) => { id: string }, optionalUser: (req: FastifyRequest) => { id: string } | undefined,
  fail: (status: number, code: string, message: string) => never) {
  const id = { type: 'string', minLength: 1, maxLength: 128 }, params = obj({ id }), empty = obj({});
  const owned = (participationId: string, userId: string) => db.prepare('SELECT * FROM challenge_participations WHERE id=? AND user_id=?').get(participationId, userId) as ParticipationRow | undefined ?? fail(404, 'NOT_FOUND', 'Участие не найдено.');
  const current = (challengeId: string) => {
    const row = db.prepare('SELECT definition_json FROM challenge_definitions WHERE id=? ORDER BY version DESC LIMIT 1').get(challengeId) as { definition_json: string } | undefined;
    return row ? JSON.parse(row.definition_json) as ChallengeDefinition : fail(404, 'NOT_FOUND', 'Испытание не найдено.');
  };
  app.get<{ Querystring: { filter?: 'available' | 'mine' | 'completed' } }>('/api/challenges', { schema: { querystring: { type: 'object', properties: { filter: { enum: ['available', 'mine', 'completed'] } }, additionalProperties: false } } }, async req => {
    const user = optionalUser(req), filter = req.query.filter ?? 'available';
    if (filter !== 'available' && !user) requireUser(req);
    const now = new Date().toISOString();
    return { serverNow: now, challenges: listChallenges(db, user?.id ?? null, now).filter(c => filter === 'available' ? !c.participation && c.state !== 'expired' : filter === 'completed' ? c.state === 'completed' : c.participation && c.state !== 'completed') };
  });
  app.get<{ Params: { id: string } }>('/api/challenges/:id', { schema: { params, querystring: empty } }, async req => {
    const user = optionalUser(req), definition = current(req.params.id), now = new Date().toISOString();
    const participation = db.prepare('SELECT * FROM challenge_participations WHERE user_id=? AND challenge_id=?').get(user?.id ?? null, definition.id) as ParticipationRow | undefined;
    const view = challengeView(db, definition, participation, now);
    const participants = db.prepare(`SELECT u.nickname,u.avatar,(SELECT COUNT(*) FROM challenge_events e WHERE e.participation_id=p.id AND e.eligible=1) AS progress
      FROM challenge_participations p JOIN users u ON u.id=p.user_id WHERE p.challenge_id=? AND p.definition_version=? ORDER BY p.joined_at,p.id LIMIT 50`).all(definition.id, view.definition.version) as ChallengeDetail['participants'];
    return { serverNow: now, challenge: { ...view, participants } };
  });
  app.post<{ Params: { id: string }; Body: { version: number } }>('/api/challenges/:id/join', { schema: { params, querystring: empty, body: obj({ version: { type: 'integer', minimum: 1 } }) } }, async (req, reply) => {
    const user = requireUser(req);
    const result = db.transaction(() => {
      const definition = current(req.params.id), now = new Date().toISOString();
      const previous = db.prepare('SELECT * FROM challenge_participations WHERE user_id=? AND challenge_id=?').get(user.id, definition.id) as ParticipationRow | undefined;
      if (previous) return { existing: true, challenge: challengeView(db, definition, previous, now) };
      if (definition.version !== req.body.version) fail(409, 'CHALLENGE_CHANGED', 'Условия обновились. Открой испытание заново.');
      if (now < definition.startsAt) fail(409, 'CHALLENGE_UPCOMING', 'Испытание ещё не началось.');
      if (now >= definition.endsAt) fail(409, 'CHALLENGE_EXPIRED', 'Срок испытания истёк.');
      const p: ParticipationRow = { id: randomUUID(), user_id: user.id, challenge_id: definition.id, snapshot_json: JSON.stringify(definition), joined_at: now, completed_at: null };
      db.prepare('INSERT INTO challenge_participations (id,user_id,challenge_id,definition_version,snapshot_json,joined_at) VALUES (?,?,?,?,?,?)').run(p.id, user.id, definition.id, definition.version, p.snapshot_json, now);
      return { existing: false, challenge: challengeView(db, definition, p, now) };
    }).immediate();
    return reply.code(result.existing ? 200 : 201).send({ challenge: result.challenge });
  });
  app.post<{ Params: { id: string }; Body: { requestId: string } }>('/api/challenge-participations/:id/runs', { schema: { params, querystring: empty, body: obj({ requestId: id }) } }, async (req, reply) => {
    const user = requireUser(req);
    const result = db.transaction(() => {
      const p = owned(req.params.id, user.id), d = JSON.parse(p.snapshot_json) as ChallengeDefinition;
      const previous = db.prepare('SELECT id,created_at,challenge_participation_id,snapshot_json FROM workout_runs WHERE user_id=? AND request_id=?').get(user.id, req.body.requestId) as { id: string; created_at: string; challenge_participation_id: string | null; snapshot_json: string } | undefined;
      if (previous && previous.challenge_participation_id !== p.id) fail(409, 'RUN_CONFLICT', 'Этот запрос связан с другим заданием.');
      if (previous) return { existing: true, id: previous.id, createdAt: previous.created_at, snapshot: JSON.parse(previous.snapshot_json) };
      const now = new Date().toISOString();
      if (p.completed_at) fail(409, 'CHALLENGE_COMPLETED', 'Испытание уже выполнено.');
      if (now < d.startsAt || now >= d.endsAt) fail(409, 'CHALLENGE_EXPIRED', 'Сейчас испытание недоступно для выполнения.');
      const runId = randomUUID();
      // Canonical comparison in /complete accepts this server-owned JSON snapshot.
      db.prepare('INSERT INTO workout_runs (id,user_id,request_id,snapshot_json,created_at,reward_rules_version,challenge_participation_id) VALUES (?,?,?,?,?,?,?)').run(runId, user.id, req.body.requestId, JSON.stringify(d.task), now, RULES_VERSION, p.id);
      return { existing: false, id: runId, createdAt: now, snapshot: d.task };
    }).immediate();
    return reply.code(result.existing ? 200 : 201).send({ id: result.id, createdAt: result.createdAt, snapshot: result.snapshot });
  });
}
