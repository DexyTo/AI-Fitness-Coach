import type Database from 'better-sqlite3';
import { createHash, scryptSync } from 'node:crypto';
import { projectWeek, publishChallenge } from './challengeSeed.js';
import { availablePrograms } from './programs.js';
import { accountCompletion, RULES_VERSION } from './progression.js';
import { completeChallenge } from './challenges.js';
import { checkDuelCompletion, completeDuel, finalizeDuel } from './duels.js';
import { DUEL_RULES } from '../shared/duels.js';
import type { ChallengeDefinition } from '../shared/challenges.js';
import type { ProgramSnapshot } from '../shared/program.js';
import { demoRecord } from './demoFixtures.js';

export const DEMO_PASSWORD = 'PlayFitStudy2026';
export const DEMO_IDS = Array.from({ length: 12 }, (_, i) => `playfit-demo-${String(i + 1).padStart(2, '0')}`);
const names = ['Лайм', 'Комета', 'Кедр', 'Искра', 'Маяк', 'Волна', 'Астра', 'Сокол', 'Ветер', 'Луч', 'Клевер', 'Орион'];
const dataset = 'platform-v1';

// One atomic batch per Kyiv week, with stable source IDs. No arbitrary balances:
// completion and finalization use the same accounting functions as real results.
export function seedDemo(db: Database.Database, now = new Date()) {
  return db.transaction(() => {
    const week = projectWeek(now), batch = `demo:${dataset}:${week.key}`;
    if (db.prepare('SELECT 1 FROM demo_seed_batches WHERE id=?').get(batch)) return false;
    const at = now.toISOString();
    for (const [i, id] of DEMO_IDS.entries()) {
      const login = `demo_${String(i + 1).padStart(2, '0')}`;
      const existing = db.prepare('SELECT id FROM users WHERE id=? OR login=?').all(id, login) as { id: string }[];
      if (existing.length) {
        if (existing.length !== 1 || existing[0].id !== id || !db.prepare('SELECT 1 FROM demo_users WHERE user_id=? AND dataset=?').get(id, dataset)) throw Error(`Учебный логин занят обычным аккаунтом: ${login}. Данные сохранены.`);
        continue;
      }
      const salt = createHash('sha256').update(id).digest('hex').slice(0, 32);
      const password = `scrypt-65536-8-1$${salt}$${scryptSync(DEMO_PASSWORD, salt, 64, { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }).toString('hex')}`;
      db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id, login, password, names[i], ['sprout', 'bolt', 'sun', 'mountain'][i % 4], at);
      db.prepare('INSERT INTO demo_users VALUES (?,?)').run(id, dataset);
    }
    const program = structuredClone(availablePrograms(db, null).find(p => p.id === 'squat-pushup'));
    if (!program) throw Error('Missing catalog program squat-pushup');
    program.steps.forEach(s => { s.goal = { sets: 1, reps: 1, restSeconds: 0 }; s.transitionSeconds = 0; });
    const task: ProgramSnapshot = { kind: 'program', program, mode: 'camera', conditions: 'Вымышленный учебный результат · без камеры' };
    // Demo definitions and participants are isolated from ordinary challenges.
    // Seed never alters an existing definition or accepted snapshot.
    const definition: ChallengeDefinition = { id: `${batch}:challenge`, version: 1, title: 'Учебный пример: два движения', description: 'Вымышленные результаты для показа платформы. Упражнения не выполнялись.',
      educational: true, startsAt: week.startsAt, endsAt: week.endsAt, type: 'program', target: 1, task, reward: { xp: 30, points: 10 }, rulesVersion: 'challenges-v1', isDemo: true };
    publishChallenge(db, definition);
    const save = (userId: string, id: string, snapshot: ProgramSnapshot, fraction: number, challengeId: string | null, duelId: string | null) => {
      const record = demoRecord(id, at, snapshot, fraction), resultId = `${id}:result`;
      db.prepare('INSERT INTO workout_runs (id,user_id,request_id,snapshot_json,created_at,reward_rules_version,challenge_participation_id,duel_participant_id) VALUES (?,?,?,?,?,?,?,?)').run(id, userId, id, JSON.stringify(snapshot), at, RULES_VERSION, challengeId, duelId);
      if (duelId) {
        db.prepare('INSERT INTO duel_drafts VALUES (?,?,?,?)').run(duelId, 1, JSON.stringify(record), at);
        checkDuelCompletion(db, userId, id, record, at, (_status, _code, message) => { throw Error(message); });
      }
      db.prepare('INSERT INTO workout_results VALUES (?,?,?,?,?,?,?,?,?)').run(resultId, userId, id, 'training', 2, null, JSON.stringify(record), at, null);
      accountCompletion(db, userId, resultId, record, RULES_VERSION, at);
      completeChallenge(db, userId, id, resultId, record, at);
      completeDuel(db, userId, id, resultId, record, at);
    };
    for (const [i, user] of DEMO_IDS.entries()) {
      const participation = `${batch}:c${i}`;
      db.prepare('INSERT INTO challenge_participations VALUES (?,?,?,?,?,?,?)').run(participation, user, definition.id, 1, JSON.stringify(definition), at, null);
      // Twelve ranked profiles; a second active participation is added below.
      save(user, `${batch}:c${i}run`, task, 1, participation, null);
    }
    const active = { ...definition, id: `${batch}:active`, title: 'Учебный пример: три встречи', type: 'workouts' as const, target: 3 };
    publishChallenge(db, active);
    db.prepare('INSERT INTO challenge_participations VALUES (?,?,?,?,?,?,?)').run(`${batch}:active01`, DEMO_IDS[0], active.id, 1, JSON.stringify(active), at, null);
    save(DEMO_IDS[0], `${batch}:active01run`, task, 1, `${batch}:active01`, null);
    const outcomes: [number | null, number | null][] = [[1, .5], [1, 1], [.5, 1], [0, 0], [1, null], [null, null]];
    for (const [i, fractions] of outcomes.entries()) {
      const id = `${batch}:d${i}`, code = createHash('sha256').update(id).digest('hex').slice(0, 16).toUpperCase();
      const ends = new Date(now.getTime() + 72 * 3600000).toISOString();
      db.prepare('INSERT INTO duels VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, DEMO_IDS[i * 2], id, JSON.stringify({ program, hours: 72 }), code, JSON.stringify(task), JSON.stringify(DUEL_RULES), at, ends, null, null, 'invited');
      for (const slot of [1, 2]) db.prepare('INSERT INTO duel_participants VALUES (?,?,?,?,?)').run(`${id}:p${slot}`, id, DEMO_IDS[i * 2 + slot - 1], slot, at);
      db.prepare("UPDATE duels SET state='accepted',accepted_at=? WHERE id=?").run(at, id);
      fractions.forEach((fraction, k) => { if (fraction !== null) save(DEMO_IDS[i * 2 + k], `${batch}:d${i}run${k}`, task, fraction, null, `${id}:p${k + 1}`); });
      finalizeDuel(db, id, at);
    }
    db.prepare('INSERT INTO demo_seed_batches VALUES (?,?)').run(batch, at);
    return true;
  }).immediate();
}
