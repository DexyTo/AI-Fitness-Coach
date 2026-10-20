import type { ProgramSnapshot } from './program.js';

export type ChallengeState = 'upcoming' | 'active' | 'completed' | 'expired';
export interface ChallengeDefinition {
  id: string; version: number; title: string; description: string; educational: true;
  startsAt: string; endsAt: string; type: 'program' | 'workouts'; target: number;
  task: ProgramSnapshot; reward: { xp: number; points: number }; rulesVersion: 'challenges-v1';
}
export interface ChallengeParticipation {
  id: string; joinedAt: string; completedAt: string | null; progress: number;
}
export interface ChallengeView {
  definition: ChallengeDefinition; participation: ChallengeParticipation | null; state: ChallengeState;
  participantCount: number;
}
export interface ChallengeDetail extends ChallengeView {
  participants: { nickname: string; avatar: string; progress: number }[];
}
export type ChallengeReason = 'counted' | 'completed' | 'expired' | 'before_join' | 'source' | 'task' | 'incomplete' | 'already_completed';
export interface ChallengeReceipt {
  participationId: string; title: string; reason: ChallengeReason; progress: number; target: number;
  xp: number; points: number;
}
export const challengeMessages: Record<ChallengeReason, string> = {
  counted: 'Тренировка зачтена в испытании. Продолжай в своём ритме.',
  completed: 'Цель испытания выполнена. Отдельная награда сохранена.',
  expired: 'Результат сохранён после срока испытания. В его прогресс он не входит.',
  before_join: 'Запуск создан до вступления или начала испытания и не засчитан.',
  source: 'В испытании учитываются только новые связанные камерные запуски.',
  task: 'Программа или условия не соответствуют принятому заданию.',
  incomplete: 'Для прогресса испытания выполни все шаги и полные повторы каждого подхода.',
  already_completed: 'Испытание уже выполнено. Повторная награда не начисляется.',
};
