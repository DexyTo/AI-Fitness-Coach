export type ExerciseType = 'squat' | 'pushup';
export type InputMode = 'camera' | 'demo' | 'video';
export type ExerciseState = 'Подготовка' | 'Готов' | 'Опускаетесь' | 'Нижняя точка' | 'Поднимаетесь' | 'Оценка приостановлена';
export type FeedbackCode = 'depth' | 'lean' | 'extension' | 'line';
export interface ExerciseFeedback { code: FeedbackCode; message: string }
export interface PosePoint {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
}
export type PoseLandmarks = PosePoint[];
export type UnavailableSourceReason = 'source_unavailable' | 'detector_error';
export type ObservationReasonCode = 'no_pose' | 'missing_points' | 'invalid_geometry' | 'tracking_gap' | 'timeline_reset' | 'session_paused' | 'movement_pending' | 'unsuitable_view' | 'view_unknown' | UnavailableSourceReason;
export interface ObservationReason {
  code: ObservationReasonCode;
  criterion?: FeedbackCode;
  landmarks?: number[];
}
export type CriterionStatus = 'passed' | 'deviation' | 'unassessed';
export interface CriterionResult {
  status: CriterionStatus;
  observedFrames: number;
  // A detected deviation remains a deviation even when coverage is incomplete.
  reasons: ObservationReason[];
}
export type CriterionResults = Partial<Record<FeedbackCode, CriterionResult>>;
export interface ObservationQuality {
  status: 'ready' | 'partial' | 'unavailable';
  side: 'left' | 'right' | null;
  reasons: ObservationReason[];
}
export type AttemptOutcome = 'complete' | 'incomplete' | 'insufficient_data';
export interface MovementAttempt {
  id: number;
  startedAt: number;
  endedAt: number;
  outcome: AttemptOutcome;
  endReason: 'returned_to_top' | 'reversed_before_top' | 'tracking_gap' | 'timeline_reset' | 'session_paused' | 'session_finished';
  motionComplete: boolean;
  minAngle: number;
  criteria: CriterionResults;
  remarks: FeedbackCode[];
  reasons: ObservationReason[];
}
export interface ExerciseResult {
  reps: number;
  incomplete: number;
  unassessed: number;
  withoutFindings: number;
  // Independent of outcome; includes incomplete and unassessed attempts.
  withErrors: number;
  errors: Partial<Record<FeedbackCode, number>>;
  attempts: MovementAttempt[];
}
export interface ExerciseAnalysisResult {
  preparation: {
    stage: 'preparing' | 'ready' | 'active' | 'recovering';
    view: 'side' | 'unsuitable' | 'unknown' | 'not_required';
    viewConfirmed: boolean;
    message: string;
  };
  state: ExerciseState;
  angle: number | null;
  observation: ObservationQuality;
  criteria: CriterionResults;
  feedback: ExerciseFeedback[];
  result: ExerciseResult;
}
export interface ExerciseAnalyzer {
  confirmSideView(): void;
  reset(): void;
  analyze(points: PoseLandmarks, timestamp: number, aspect: number, sourceReason?: UnavailableSourceReason): ExerciseAnalysisResult;
  interrupt(timestamp: number, reason: 'tracking_gap' | 'timeline_reset' | 'session_paused'): ExerciseAnalysisResult;
  // Idempotent. Flushes a pending movement before the session summary is read.
  finish(timestamp: number): ExerciseAnalysisResult;
  snapshot(): ExerciseAnalysisResult;
}
export const labels: Record<ExerciseType, string> = { squat: 'Приседания', pushup: 'Отжимания' };
export const criterionLabels: Record<FeedbackCode, string> = {
  depth: 'Нижняя точка', extension: 'Возврат к выпрямлению', lean: 'Наклон корпуса', line: 'Линия тела',
};
export const criterionStatusLabels: Record<CriterionStatus, string> = {
  passed: 'Выполнен', deviation: 'Обнаружено отклонение', unassessed: 'Не удалось оценить',
};
export const outcomeLabels: Record<AttemptOutcome, string> = {
  complete: 'Полный повтор', incomplete: 'Неполная попытка', insufficient_data: 'Недостаточно данных',
};
export const endReasonLabels: Record<MovementAttempt['endReason'], string> = {
  returned_to_top: 'Возврат в верхнюю точку', reversed_before_top: 'Новое опускание до выпрямления',
  tracking_gap: 'Прервано отслеживание', timeline_reset: 'Разрыв времени видео', session_finished: 'Завершение тренировки',
  session_paused: 'Пауза пользователя: попытка прервана',
};
export const feedbackText: Record<FeedbackCode, string> = {
  depth: 'Присядьте немного ниже.',
  lean: 'Старайтесь держать корпус ровнее.',
  extension: 'Полностью выпрямитесь перед следующим повторением.',
  line: 'Держите плечи, таз и лодыжки на одной линии.',
};
export function feedbackMessage(exercise: ExerciseType, code: FeedbackCode) {
  if (exercise === 'pushup' && code === 'depth') return 'Опускайтесь ниже в отжимании.';
  if (exercise === 'pushup' && code === 'extension') return 'Полностью выпрямите руки.';
  return feedbackText[code];
}
const pointNames: Record<number, string> = {
  11: 'левое плечо', 12: 'правое плечо', 13: 'левый локоть', 14: 'правый локоть',
  15: 'левое запястье', 16: 'правое запястье', 23: 'левый тазобедренный сустав',
  24: 'правый тазобедренный сустав', 25: 'левое колено', 26: 'правое колено',
  27: 'левая лодыжка', 28: 'правая лодыжка',
};
export function reasonText(reason: ObservationReason): string {
  switch (reason.code) {
    case 'no_pose': return 'Человек не обнаружен.';
    case 'missing_points': return `Не видны или ненадёжны точки: ${reason.landmarks?.map(i => pointNames[i] ?? i).join(', ')}. Отойдите от камеры и уберите перекрытия этой стороны тела.`;
    case 'invalid_geometry': return 'Геометрия точек не позволяет вычислить критерий.';
    case 'tracking_gap': return 'Длительный разрыв отслеживания — движение разделено.';
    case 'timeline_reset': return 'Время видео изменилось — требуется новая верхняя точка.';
    case 'session_paused': return 'Попытка прервана паузой. Перед продолжением нужна новая исходная позиция.';
    case 'movement_pending': return 'Недостаточно наблюдений завершённого движения.';
    case 'unsuitable_view': return 'Повернитесь боком к камере: плечи и таз должны перекрываться в проекции.';
    case 'view_unknown': return 'Ракурс не удалось определить. Сверьтесь с примером съёмки сбоку.';
    case 'source_unavailable': return 'Новые видеокадры не поступают.';
    case 'detector_error': return 'Не удалось обработать видеокадр. Попробуйте перезапустить тренировку.';
  }
}
