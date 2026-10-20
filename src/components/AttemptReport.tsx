import type { ExerciseType, MovementAttempt } from '../exercises/types';
import { criterionLabels, criterionStatusLabels, endReasonLabels, outcomeLabels, reasonText, type FeedbackCode } from '../exercises/types';
import { attemptExplanation, attemptMeasurements } from '../exercises/coaching';

export function AttemptReport({ attempt, exercise, compact = false }: { attempt: MovementAttempt; exercise: ExerciseType; compact?: boolean }) {
  const measures = attemptMeasurements(attempt, exercise);
  const details = <>
    <p>{endReasonLabels[attempt.endReason]}</p>
    <p>{measures ? `${measures.amplitude}. Длительность наблюдаемой части движения: ${measures.duration} с.`
      : 'Амплитуда и длительность не оценены: в наблюдении есть пропуски.'}</p>
    <p className='muted'>Угол — проекция по точкам камеры, не глубина в сантиметрах. Время — от обнаруженного начала попытки до её закрытия.</p>
    {attempt.reasons.length > 0 && <ul>{[...new Set(attempt.reasons.map(reasonText))].map(text => <li key={text}>{text}</li>)}</ul>}
    <ul className='criterion-list'>
      {Object.entries(attempt.criteria).map(([code, check]) => <li key={code}>
        <b>{criterionLabels[code as FeedbackCode]}</b>: {criterionStatusLabels[check.status]}
        {check.reasons.length > 0 && <span> · {[...new Set(check.reasons.map(reasonText))].join(' ')}</span>}
      </li>)}
    </ul>
  </>;
  return <article className='attempt-item'>
    <h3>#{attempt.id} · {outcomeLabels[attempt.outcome]}</h3>
    <p>{attemptExplanation(attempt, exercise)}</p>
    {attempt.remarks.length > 0 && <p>Замечания: {attempt.remarks.map(c => criterionLabels[c]).join(', ')}.</p>}
    {compact ? <details><summary>Показать измерения и проверки попытки #{attempt.id}</summary>{details}</details> : details}
  </article>;
}
