import type Database from 'better-sqlite3';
import { isProgram, type HistoryRecord } from '../shared/program.js';
import type { Progression, RewardReceipt, RewardReason } from '../shared/progression.js';

export const RULES_VERSION = 'progression-v1';
export const WORKOUT_XP = 20;
export const DAILY_XP_LIMIT = 60;
export const LEVEL_XP = 100;
export const TIME_ZONE = 'Europe/Kyiv';
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
export function projectDay(time: string | Date): string { return dayFormat.format(new Date(time)); }
export function levelFor(xp: number) { return { xp, level: Math.floor(xp / LEVEL_XP) + 1, levelXp: xp % LEVEL_XP, nextLevelXp: LEVEL_XP }; }
const achievements = [
  { id: 'first', title: 'Первый шаг', description: 'Выполни 1 тренировку', metric: 'workouts', target: 1 },
  { id: 'five', title: 'В своём ритме', description: 'Выполни 5 тренировок', metric: 'workouts', target: 5 },
  { id: 'ten', title: 'Десятка', description: 'Выполни 10 тренировок', metric: 'workouts', target: 10 },
  { id: 'days', title: 'Возвращайся к движению', description: 'Занимайся в 3 разных дня по Europe/Kyiv', metric: 'days', target: 3 },
  { id: 'reps', title: 'Сотня движений', description: 'Накопи 100 полных повторов в пределах целей', metric: 'reps', target: 100 },
  { id: 'variety', title: 'Два движения', description: 'Выполни приседания и отжимания', metric: 'exercises', target: 2 },
] as const;
function totals(db: Database.Database, userId: string) {
  const events = db.prepare('SELECT reps, exercises_json, project_day FROM progression_events WHERE user_id=? AND eligible=1').all(userId) as { reps: number; exercises_json: string; project_day: string }[];
  return { workouts: events.length, reps: events.reduce((n, e) => n + e.reps, 0), days: new Set(events.map(e => e.project_day)).size, exercises: new Set(events.flatMap(e => JSON.parse(e.exercises_json) as string[])).size };
}
const xpTotal = (db: Database.Database, userId: string, day?: string) => (db.prepare(`SELECT COALESCE(SUM(amount),0) AS xp FROM reward_ledger WHERE user_id=? AND currency='xp'${day ? " AND source_type='workout' AND project_day=?" : ''}`).get(...(day ? [userId, day] : [userId])) as { xp: number }).xp;

// Internal extension point. Call only inside the source-event's immediate transaction,
// after server-side validation; never expose an endpoint accepting client XP/points.
export interface RewardEvent {
  userId: string; currency: 'xp' | 'competition_points'; sourceType: 'workout' | 'challenge' | 'duel';
  sourceId: string; amount: number; eventAt: string; rulesVersion: string;
}
export function appendReward(db: Database.Database, event: RewardEvent) {
  if (!db.inTransaction || !Number.isSafeInteger(event.amount) || event.amount <= 0) throw new Error('Reward requires a transaction and positive integer amount');
  const previous = db.prepare('SELECT amount, rules_version FROM reward_ledger WHERE user_id=? AND currency=? AND source_type=? AND source_id=?').get(event.userId, event.currency, event.sourceType, event.sourceId) as { amount: number; rules_version: string } | undefined;
  if (previous) {
    if (previous.amount !== event.amount || previous.rules_version !== event.rulesVersion) throw new Error('Reward source conflict');
    return;
  }
  db.prepare('INSERT INTO reward_ledger (user_id,currency,source_type,source_id,amount,event_at,project_day,rules_version) VALUES (?,?,?,?,?,?,?,?)').run(event.userId, event.currency, event.sourceType, event.sourceId, event.amount, event.eventAt, projectDay(event.eventAt), event.rulesVersion);
}

// The caller has already checked ownership, immutable goal snapshot and record consistency.
// Creating the result, accounting event, XP and badges is one immediate transaction.
export function accountCompletion(db: Database.Database, userId: string, resultId: string, record: HistoryRecord, runRules: string | null, eventAt: string) {
  if (!db.inTransaction) throw new Error('Completion requires a transaction');
  const children = isProgram(record) ? record.steps : [record];
  const completed = (!isProgram(record) || record.ended === 'completed') && children.length > 0 && children.every(r => r.sets.length === r.goal.sets && r.sets.every(s => s.ended === 'completed' && s.result.reps >= r.goal.reps));
  let reason: RewardReason = runRules !== RULES_VERSION ? 'legacy' : record.mode === 'demo' ? 'demo' : record.mode === 'video' ? 'video' : !completed ? 'incomplete' : 'awarded';
  const eligible = reason === 'awarded';
  const day = projectDay(eventAt);
  const xp = eligible ? Math.min(WORKOUT_XP, Math.max(0, DAILY_XP_LIMIT - xpTotal(db, userId, day))) : 0;
  if (eligible && xp === 0) reason = 'daily_limit';
  const reps = eligible ? children.reduce((n, r) => n + r.goal.sets * r.goal.reps, 0) : 0;
  db.prepare('INSERT INTO progression_events VALUES (?,?,?,?,?,?,?,?,?)').run(resultId, userId, reason, Number(eligible), reps, JSON.stringify(eligible ? [...new Set(children.map(r => r.exercise))] : []), eventAt, day, RULES_VERSION);
  if (xp) appendReward(db, { userId, currency: 'xp', sourceType: 'workout', sourceId: resultId, amount: xp, eventAt, rulesVersion: RULES_VERSION });
  if (eligible) {
    const stats = totals(db, userId);
    for (const a of achievements) if (stats[a.metric] >= a.target) db.prepare('INSERT OR IGNORE INTO user_achievements VALUES (?,?,?,?,?)').run(userId, a.id, resultId, eventAt, RULES_VERSION);
  }
}
export function receipt(db: Database.Database, userId: string, resultId: string, source: string): RewardReceipt {
  const event = db.prepare('SELECT reason,event_at FROM progression_events WHERE user_id=? AND result_id=?').get(userId, resultId) as { reason: RewardReason; event_at: string } | undefined;
  const xp = (db.prepare("SELECT amount FROM reward_ledger WHERE user_id=? AND currency='xp' AND source_type='workout' AND source_id=?").get(userId, resultId) as { amount: number } | undefined)?.amount ?? 0;
  const earned = db.prepare('SELECT achievement_id FROM user_achievements WHERE user_id=? AND result_id=? ORDER BY achievement_id').all(userId, resultId) as { achievement_id: string }[];
  return { reason: event?.reason ?? (source === 'historical_import' ? 'import' : 'legacy'), xp, earnedAt: event?.event_at ?? null, achievements: earned.map(r => r.achievement_id === 'first-challenge' ? 'Испытание пройдено' : achievements.find(a => a.id === r.achievement_id)?.title ?? r.achievement_id) };
}
export function progression(db: Database.Database, userId: string, now = new Date()): Progression {
  const stats = totals(db, userId);
  const earned = db.prepare('SELECT achievement_id,earned_at FROM user_achievements WHERE user_id=?').all(userId) as { achievement_id: string; earned_at: string }[];
  const activity = Array.from({ length: 7 }, (_, i) => {
    // Calendar arithmetic at UTC noon avoids DST-length days; date labels use project zone.
    const date = new Date(`${projectDay(now)}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - 6 + i);
    const day = date.toISOString().slice(0, 10);
    const count = db.prepare('SELECT COUNT(*) AS n FROM progression_events WHERE user_id=? AND eligible=1 AND project_day=?').get(userId, day) as { n: number };
    return { day, workouts: count.n };
  });
  const challengeCount = (db.prepare('SELECT COUNT(*) AS n FROM challenge_participations WHERE user_id=? AND completed_at IS NOT NULL').get(userId) as { n: number }).n;
  const competitionPoints = (db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM reward_ledger WHERE user_id=? AND currency='competition_points'").get(userId) as { n: number }).n;
  const challengeXp = (db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM reward_ledger WHERE user_id=? AND currency='xp' AND source_type='challenge'").get(userId) as { n: number }).n;
  return { ...levelFor(xpTotal(db, userId)), todayXp: xpTotal(db, userId, projectDay(now)), dailyLimit: DAILY_XP_LIMIT, workoutXp: WORKOUT_XP, timeZone: TIME_ZONE, stats, activity, competitionPoints, challengeXp,
    achievements: [...achievements.map(a => ({ id: a.id, title: a.title, description: a.description, target: a.target, progress: Math.min(stats[a.metric], a.target), earnedAt: earned.find(e => e.achievement_id === a.id)?.earned_at ?? null, reward: 'Значок в профиле · без бонусных XP' })),
      { id: 'first-challenge', title: 'Испытание пройдено', description: 'Выполни первое испытание', target: 1, progress: Math.min(1,challengeCount), earnedAt: earned.find(e => e.achievement_id === 'first-challenge')?.earned_at ?? null, reward: 'Значок в профиле · без бонусных XP' }] };
}
