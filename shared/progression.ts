export type RewardReason = 'awarded' | 'daily_limit' | 'demo' | 'video' | 'incomplete' | 'legacy' | 'import';
export interface RewardReceipt {
  reason: RewardReason; xp: number; earnedAt: string | null; achievements: string[];
}
export interface Progression {
  xp: number; level: number; levelXp: number; nextLevelXp: number;
  todayXp: number; dailyLimit: number; workoutXp: number; timeZone: string;
  stats: { workouts: number; reps: number; days: number; exercises: number };
  activity: { day: string; workouts: number }[];
  achievements: { id: string; title: string; description: string; target: number; progress: number; earnedAt: string | null; reward: string }[];
}
export const rewardMessages: Record<RewardReason, string> = {
  awarded: 'Цель выполнена. Награда сохранена в аккаунте.',
  daily_limit: 'Дневной предел XP достигнут. Тренировка учтена в активности и достижениях.',
  demo: 'Синтетическое демо не даёт XP и прогресс достижений.',
  video: 'Анализ видеофайла не даёт XP и прогресс достижений.',
  incomplete: 'Для награды выполни все шаги и цель полных повторов в каждом подходе. Прерванные задания не дают прогресс достижений.',
  legacy: 'Этот запуск создан до введения наград. XP и достижения задним числом не начисляются.',
  import: 'Исторический импорт не даёт XP и прогресс достижений.',
};
