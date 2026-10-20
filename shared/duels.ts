import type { ProgramRecord, ProgramSnapshot } from './program.js';

export type DuelState = 'invited' | 'accepted' | 'waiting' | 'completed' | 'cancelled' | 'expired';
export type DuelOutcome = 'win' | 'loss' | 'draw' | 'expired';
export interface DuelRules {
  version: 'duels-v1'; scale: 10000;
  formula: 'round(10000 * mean(sum(min(fullReps, targetReps)) / (sets * targetReps)))';
  rewards: Record<'win' | 'loss' | 'draw', { xp: number; points: number }>;
}
export const DUEL_RULES: DuelRules = { version: 'duels-v1', scale: 10000,
  formula: 'round(10000 * mean(sum(min(fullReps, targetReps)) / (sets * targetReps)))',
  rewards: { win: { xp: 30, points: 15 }, draw: { xp: 20, points: 10 }, loss: { xp: 10, points: 5 } } };
export interface DuelEvent {
  outcome: DuelOutcome; reason: 'scores' | 'opponent_absent' | 'no_positive_submission';
  score: number | null; xp: number; points: number; eventAt: string;
}
export interface DuelView {
  id: string; code: string; state: DuelState; createdAt: string; acceptedAt: string | null;
  endsAt: string; finalizedAt: string | null; task: ProgramSnapshot; rules: DuelRules;
  participants: { userId: string; nickname: string; avatar: string; slot: number; submittedAt: string | null; event: DuelEvent | null }[];
  myAttempt: { run: { id: string; createdAt: string; snapshot: ProgramSnapshot } | null; revision: number; draft: ProgramRecord | null };
}
export type DuelInvitation = Pick<DuelView, 'id' | 'code' | 'state' | 'endsAt' | 'task' | 'rules'> & { creator: { nickname: string; avatar: string } };
export const duelStates: Record<DuelState, string> = { invited: 'Приглашение', accepted: 'Принято', waiting: 'Ожидается результат', completed: 'Завершено', cancelled: 'Отменено', expired: 'Срок истёк' };
export const duelOutcomes: Record<DuelOutcome, string> = { win: 'Победа', loss: 'Поражение', draw: 'Ничья', expired: 'Срок истёк' };

// Equal weight per step, cap EACH set, then round once for a stable comparison.
export function duelScore(record: ProgramRecord, rules = DUEL_RULES): number {
  if (rules.version !== 'duels-v1' || rules.formula !== DUEL_RULES.formula || rules.scale !== 10000) throw Error('Unknown duel scoring rules');
  const fractions = record.program.steps.map((step, i) => {
    const reps = record.steps[i]?.sets.slice(0, step.goal.sets).reduce((n, set) => n + Math.min(set.result.reps, step.goal.reps), 0) ?? 0;
    return reps / (step.goal.sets * step.goal.reps);
  });
  return Math.round(10000 * fractions.reduce((a, b) => a + b, 0) / fractions.length);
}
