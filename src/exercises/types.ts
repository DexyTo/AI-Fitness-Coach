export type ExerciseType = 'squat' | 'pushup';
export type InputMode = 'camera' | 'demo' | 'video';
export type ExerciseState =
  | 'Готов'
  | 'Опускаетесь'
  | 'Нижняя точка'
  | 'Поднимаетесь';
export type FeedbackCode = 'depth' | 'lean' | 'extension' | 'line';
export interface ExerciseFeedback {
  code: FeedbackCode;
  message: string;
}
export interface PosePoint {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
}
export type PoseLandmarks = PosePoint[];
export interface ExerciseResult {
  reps: number;
  correct: number;
  withErrors: number;
  scoreSum: number;
  errors: Partial<Record<FeedbackCode, number>>;
}
export interface ExerciseAnalysisResult {
  state: ExerciseState;
  angle: number | null;
  score: number;
  feedback: ExerciseFeedback[];
  result: ExerciseResult;
}
export interface ExerciseAnalyzer {
  reset(): void;
  analyze(
    points: PoseLandmarks,
    timestamp: number,
    aspect: number,
  ): ExerciseAnalysisResult;
  snapshot(): ExerciseAnalysisResult;
}
export interface TrainingSession {
  exercise: ExerciseType;
  mode: InputMode;
  duration: number;
  result: ExerciseResult;
  averageScore: number;
  mainError: FeedbackCode | null;
}
export const labels: Record<ExerciseType, string> = {
  squat: 'Приседания',
  pushup: 'Отжимания',
};
export const feedbackText: Record<FeedbackCode, string> = {
  depth: 'Присядьте немного ниже.',
  lean: 'Старайтесь держать корпус ровнее.',
  extension: 'Полностью выпрямитесь перед следующим повторением.',
  line: 'Держите плечи, таз и лодыжки на одной линии.',
};
