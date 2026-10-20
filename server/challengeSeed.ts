import type Database from 'better-sqlite3';
import type { ChallengeDefinition } from '../shared/challenges.js';
import { same, validPlan } from '../shared/program.js';
import { availablePrograms } from './programs.js';
import { projectDay, TIME_ZONE } from './progression.js';

// Convert a Kyiv calendar midnight independently of the machine timezone and DST.
function midnight(day: string) {
  const noon = new Date(`${day}T12:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }).format(noon));
  return new Date(Date.parse(`${day}T00:00:00Z`) - (hour - 12) * 3600000).toISOString();
}
export function projectWeek(now: Date) {
  const date = new Date(`${projectDay(now)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  const monday = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 7);
  return { key: monday, startsAt: midnight(monday), endsAt: midnight(date.toISOString().slice(0, 10)) };
}
// Internal authoring contract. New revisions append; never mutate published conditions.
export function publishChallenge(db: Database.Database, definition: ChallengeDefinition) {
  if (!definition.id || definition.id.length > 100 || !Number.isInteger(definition.version) || definition.version < 1 ||
    !definition.title.trim() || definition.title.length > 100 || definition.description.length > 1000 ||
    definition.educational !== true || definition.rulesVersion !== 'challenges-v1' ||
    !['program','workouts'].includes(definition.type) || !Number.isInteger(definition.target) || definition.target < 1 || definition.target > 10 || (definition.type === 'program' && definition.target !== 1) ||
    !Number.isFinite(Date.parse(definition.startsAt)) || !Number.isFinite(Date.parse(definition.endsAt)) || definition.startsAt !== new Date(definition.startsAt).toISOString() || definition.endsAt !== new Date(definition.endsAt).toISOString() || definition.startsAt >= definition.endsAt ||
    definition.task.kind !== 'program' || definition.task.mode !== 'camera' || !validPlan(definition.task.program) || definition.task.conditions.length > 200 ||
    ![definition.reward.xp, definition.reward.points].every(v => Number.isInteger(v) && v >= 1 && v <= 100)) throw new Error('Invalid challenge definition');
  const previous = db.prepare('SELECT definition_json FROM challenge_definitions WHERE id=? AND version=?').get(definition.id, definition.version) as { definition_json: string } | undefined;
  if (previous) {
    if (!same(JSON.parse(previous.definition_json), definition)) throw new Error('Challenge version conflict');
    return false;
  }
  db.prepare('INSERT INTO challenge_definitions VALUES (?,?,?)').run(definition.id, definition.version, JSON.stringify(definition));
  return true;
}
export function seedChallenges(db: Database.Database, now = new Date()) {
  return db.transaction(() => {
    const week = projectWeek(now), next = projectWeek(new Date(Date.parse(week.endsAt) + 12 * 3600000));
    const programs = availablePrograms(db, null);
    const examples = [
      { slug: 'two-moves', program: 'squat-pushup', title: 'Два движения — одна цель', description: 'Выполни программу из приседаний и отжиманий один раз до конца недели.', type: 'program', target: 1, xp: 30, points: 10, period: week },
      { slug: 'three-sessions', program: 'squat-intro', title: 'Три встречи с движением', description: 'Трижды выполни принятый план приседаний в течение недели. Отдыхай между тренировками по своему самочувствию.', type: 'workouts', target: 3, xp: 50, points: 20, period: week },
      { slug: 'pushup-start', program: 'pushup-intro', title: 'Опора на себя', description: 'Два подхода отжиманий — отдельное задание этой недели.', type: 'program', target: 1, xp: 30, points: 10, period: week },
      { slug: 'two-moves', program: 'squat-pushup', title: 'Два движения — одна цель', description: 'Выполни программу из приседаний и отжиманий один раз до конца недели.', type: 'program', target: 1, xp: 30, points: 10, period: next },
    ] as const;
    let added = 0;
    for (const e of examples) {
      const id = `${e.slug}:${e.period.key}`;
      // Rerunning in the same period must preserve the original program snapshot.
      if (db.prepare('SELECT 1 FROM challenge_definitions WHERE id=?').get(id)) continue;
      const program = programs.find(p => p.id === e.program);
      if (!program) throw new Error(`Missing educational program: ${e.program}`);
      if (publishChallenge(db, { id, version: 1, title: e.title, description: e.description, educational: true, startsAt: e.period.startsAt, endsAt: e.period.endsAt, type: e.type, target: e.target,
        task: { kind: 'program', program, mode: 'camera', conditions: '' }, reward: { xp: e.xp, points: e.points }, rulesVersion: 'challenges-v1' })) added++;
    }
    return added;
  }).immediate();
}
