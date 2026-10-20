import { observePose, criterionPoints, visible } from '../pose/landmarks';
import { variant } from './config';
import { reasonText, type ExerciseAnalysisResult, type ExerciseResult, type ExerciseType,
  type FeedbackCode, type MovementAttempt, type PoseLandmarks } from './types';

export interface CoachingCue {
  key: string;
  kind: 'observation' | 'phase' | 'technique' | 'improvement';
  message: string;
  target?: { points: number[]; label: string };
}

export const COACHING_POLICY_VERSION = 'phase-cues-v1';
export const coachingTiming = { confirmMs: 450, dwellMs: 1800, correctionMs: 900, improvementMs: 1600 };

function phaseCue(exercise: ExerciseType, analysis: ExerciseAnalysisResult): CoachingCue {
  const messages: Partial<Record<ExerciseAnalysisResult['state'], string>> = {
    'Готов': 'Исходная позиция подтверждена. Можно начать следующую попытку.',
    'Опускаетесь': 'Наблюдаем опускание. Сохраняйте положение камеры.',
    'Нижняя точка': 'Нижняя точка зафиксирована по предварительному критерию.',
    'Поднимаетесь': exercise === 'squat' ? 'Возвращайтесь в исходное положение стоя.' : 'Возвращайтесь в исходное положение на руках.',
  };
  return { key: `phase:${analysis.state}`, kind: 'phase', message: messages[analysis.state] ?? analysis.preparation.message };
}

// Presentation policy only. Analyzer evidence and provisional biomechanical rules stay unchanged.
// Priority: unavailable observation/view → preparation → current trunk finding → phase.
// Depth and extension are event criteria: explain them in the previous attempt, never say "deeper" live.
export class CoachingController {
  private context = '';
  private candidateSince: number | null = null;
  private shownAt: number | null = null;
  private correctedSince: number | null = null;
  private improvedAt: number | null = null;
  private findingActive = false;
  private nextFindingAt = 0;
  private lastAt: number | null = null;
  reset() {
    this.context = '';
    this.candidateSince = this.shownAt = this.correctedSince = this.improvedAt = this.lastAt = null;
    this.findingActive = false;
    this.nextFindingAt = 0;
  }
  constructor(private readonly exercise: ExerciseType) {}
  update(analysis: ExerciseAnalysisResult, points: PoseLandmarks, aspect: number, now: number): CoachingCue {
    if (this.lastAt !== null && (now < this.lastAt || now - this.lastAt > 700)) this.reset();
    this.lastAt = now;
    const context = `${analysis.result.attempts.length}:${analysis.state}:${analysis.preparation.stage}:${analysis.observation.side}`;
    if (context !== this.context) {
      this.reset(); this.context = context; this.lastAt = now;
    }
    if (analysis.observation.status !== 'ready' || analysis.state === 'Оценка приостановлена') {
      this.candidateSince = this.shownAt = this.correctedSince = this.improvedAt = null;
      this.findingActive = false;
      const reason = analysis.observation.reasons[0];
      const message = reason ? reasonText(reason) : analysis.preparation.message;
      const action = !reason || ['missing_points', 'detector_error', 'unsuitable_view', 'view_unknown', 'timeline_reset'].includes(reason.code)
        ? '' : reason.code === 'source_unavailable'
          ? ' Возобновите видео или проверьте подключение камеры.'
          : ' Проверьте свет и кадр, затем удерживайте исходную позицию.';
      return { key: `observation:${reason?.code ?? analysis.preparation.view}`, kind: 'observation', message: message + action };
    }
    if (analysis.preparation.stage !== 'active') return phaseCue(this.exercise, analysis);
    const code = this.exercise === 'squat' ? 'lean' : 'line';
    const live = observePose(points, this.exercise, aspect, analysis.observation.side).criteria[code];
    const confirmed = analysis.feedback.some(f => f.code === code);
    const deviation = live?.status === 'deviation' && confirmed;
    const base = phaseCue(this.exercise, analysis);
    if (deviation) {
      this.correctedSince = this.improvedAt = null;
      this.candidateSince ??= now;
      if (now - this.candidateSince >= coachingTiming.confirmMs && now >= this.nextFindingAt) {
        this.shownAt ??= now;
        this.findingActive = true;
        const indices = criterionPoints(this.exercise, analysis.observation.side!)[code]!;
        return {
          key: `technique:${code}:${context}`, kind: 'technique',
          message: code === 'lean'
            ? 'Наблюдаем устойчивый наклон корпуса. Попробуйте держать корпус ровнее.'
            : 'Наблюдаем отклонение линии тела. Попробуйте выровнять плечо, таз и лодыжку.',
          target: indices.every(i => visible(points[i])) ? { points: indices, label: code === 'lean' ? 'Корпус' : 'Линия тела' } : undefined,
        };
      }
      return base;
    }
    // A stale finding disappears immediately; a positive message needs continuous fresh evidence.
    this.candidateSince = null;
    if (this.findingActive) {
      this.findingActive = false;
      this.nextFindingAt = now + coachingTiming.dwellMs;
    }
    if (this.shownAt !== null && live?.status === 'passed') {
      this.correctedSince ??= now;
      if (now - this.correctedSince >= coachingTiming.correctionMs && now - this.shownAt >= coachingTiming.dwellMs) {
        this.improvedAt ??= now;
        if (now - this.improvedAt < coachingTiming.improvementMs)
          return { key: `improved:${code}:${context}`, kind: 'improvement', message: code === 'lean' ? 'Наклон корпуса уменьшился по наблюдаемым точкам.' : 'Линия тела стала ровнее по наблюдаемым точкам.' };
      }
    } else this.correctedSince = null;
    return base;
  }
}

export function attemptExplanation(attempt: MovementAttempt, exercise: ExerciseType): string {
  if (attempt.outcome === 'insufficient_data') return 'Не засчитано: в обязательных проверках есть пропуски. Это не оценка техники.';
  const joint = exercise === 'squat' ? 'колена' : 'локтя';
  const reasons = [];
  if (attempt.criteria.depth?.status === 'deviation') reasons.push(`нижняя точка не подтверждена (предварительный порог угла ${joint} ≤ ${variant(exercise).lowerAngle}°)`);
  if (attempt.criteria.extension?.status === 'deviation') reasons.push(`возврат в верхнюю точку не подтверждён (предварительный порог ≥ ${variant(exercise).upperAngle}°)`);
  return attempt.outcome === 'complete'
    ? 'Засчитано: нижняя точка и возврат подтверждены; замечания проверяются отдельно.'
    : `Не засчитано: ${reasons.join('; ') || 'движение не завершено'}. Не увеличивайте глубину только ради счётчика: критерий ещё не проверен на людях.`;
}

export function attemptMeasurements(attempt: MovementAttempt, exercise: ExerciseType) {
  if (attempt.outcome === 'insufficient_data' || attempt.reasons.length) return null;
  return {
    amplitude: `Нижняя точка амплитуды: минимальный 2D-угол ${exercise === 'squat' ? 'колена' : 'локтя'} ${attempt.minAngle}°`,
    duration: ((attempt.endedAt - attempt.startedAt) / 1000).toFixed(1),
  };
}

export function criterionTotals(result: ExerciseResult) {
  const totals: Partial<Record<FeedbackCode, { passed: number; deviation: number; unassessed: number }>> = {};
  for (const attempt of result.attempts) for (const [code, check] of Object.entries(attempt.criteria)) {
    const total = totals[code as FeedbackCode] ??= { passed: 0, deviation: 0, unassessed: 0 };
    total[check.status]++;
  }
  return totals;
}

export function nextTask(result: ExerciseResult, exercise: ExerciseType): string {
  const assessed = result.attempts.filter(a => a.outcome !== 'insufficient_data');
  if (assessed.length < 2 || assessed.length < result.attempts.length / 2)
    return 'Следующая задача: настройте съёмку сбоку так, чтобы нужная сторона тела оставалась целиком видна в двух последовательных попытках.';
  const priority: FeedbackCode[] = [exercise === 'squat' ? 'lean' : 'line', 'extension', 'depth'];
  const counts = priority.map(code => ({ code, count: assessed.filter(a => a.criteria[code]?.status === 'deviation').length }));
  counts.sort((a, b) => b.count - a.count);
  const finding = counts[0];
  if (finding.count < 2) return 'Следующая задача: повторите две попытки с тем же боковым ракурсом, чтобы проверить повторяемость наблюдений.';
  const tasks: Record<FeedbackCode, string> = {
    lean: 'в следующем подходе сосредоточьтесь на более ровном положении корпуса при том же ракурсе',
    line: 'в следующем подходе сосредоточьтесь на выравнивании плеча, таза и лодыжки',
    extension: exercise === 'squat' ? 'перед новой попыткой возвращайтесь в исходное положение стоя' : 'перед новой попыткой возвращайтесь в исходное положение на руках',
    depth: 'сверьте боковой ракурс и разбор нижней точки с тренером; не увеличивайте глубину только ради счётчика',
  };
  return `Следующая задача: ${tasks[finding.code]}. Основание: отклонение в ${finding.count} из ${assessed.length} попыток с достаточными данными. Правила предварительные.`;
}
