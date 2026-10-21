import { Link } from 'react-router-dom';
import { metrics } from '../training/history';
import type { WorkoutRecord } from '../training/session';
import { criterionName, isHold } from '../exercises/registry';
import { labels, type FeedbackCode } from '../exercises/types';
import { nextTask } from '../exercises/coaching';
import { ExerciseVisual, muscleGroups } from './ExerciseVisual';
import { Ring } from './HistoryAnalytics';
import { Icon } from './Icon';

export function ResultOverview({ record }: { record: WorkoutRecord }) {
  const { result, criteria, targetSets } = metrics(record), hold = isHold(record.exercise);
  const findings = Object.entries(criteria).filter(([, c]) => c.deviations > 0);
  return <section className='result-overview' aria-label='Итоги тренировки'>
    <div className='result-photo'><ExerciseVisual exercise={record.exercise} /><div><h2>{labels[record.exercise]}</h2><span>{muscleGroups[record.exercise]}</span></div></div>
    <div className='result-main'><div className='result-primary-stats'>
      <article className='surface result-stat'><span>{hold ? 'Засчитано секунд' : 'Полные повторы'}</span><strong>{hold ? ((result.hold?.creditedMs ?? 0) / 1000).toFixed(1) : result.reps}</strong><span className='stat-icon'><Icon name='squat' /></span></article>
      <article className='surface result-stat'><span>{hold ? 'Непрерывно, с' : 'Без замечаний'}</span><strong>{hold ? ((result.hold?.longestMs ?? 0) / 1000).toFixed(1) : result.withoutFindings}</strong><span className='stat-icon green'><Icon name='check' /></span></article>
      <article className='surface result-goal-stat'><span>Цели подходов</span><Ring value={Math.round(targetSets / record.goal.sets * 100)} label={`${targetSets}/${record.goal.sets}`} /><small>достигнуто по твоему плану</small></article>
    </div><div className='result-insights'><article className='surface result-findings'><h3>Замечания по движению</h3>{hold ? <p>Отклонения: {((result.hold?.deviationMs ?? 0) / 1000).toFixed(1)} с. Не оценено: {((result.hold?.unassessedMs ?? 0) / 1000).toFixed(1)} с.</p> : <><ul>{findings.map(([code, c]) => <li key={code}><span className='finding-icon'>!</span><span>{criterionName(record.exercise, code as FeedbackCode)}</span><b>{c.deviations} / {c.denominator}</b></li>)}</ul>{!findings.length && <p>{Object.values(criteria).some(c => c.denominator > 0) ? 'Отклонений по проверенным критериям не обнаружено.' : 'Для проверки движений пока недостаточно данных.'}</p>}<div className='result-attempt-counts'><span>Неполные <b>{result.incomplete}</b></span><span>Не оценены <b>{result.unassessed}</b></span><span>С замечаниями <b>{result.withErrors}</b></span></div></>}</article><article className='surface coach-summary'><h3><span className='stat-icon green'><Icon name='star' /></span>Следующий шаг</h3><p>{hold ? 'Сохраняй исходную позицию. Если точки пропали из кадра, поправь ракурс и начни наблюдение снова.' : nextTask(result, record.exercise)}</p><div className='coach-tip'><Icon name='camera' />Ровный свет и всё тело в кадре помогут наблюдать движение.</div></article></div></div>
    <p className='fine-print result-observation-note'>«Без замечаний» — полные повторы без выявленных отклонений по проверенным критериям. Это не общая оценка техники или безопасности.</p>
  </section>;
}
export function ResultLinks({ repeat, disabled = false }: { repeat: () => void; disabled?: boolean }) {
  return <div className='result-primary-actions'><button className='button button-primary' disabled={disabled} onClick={repeat}><Icon name='history' />Повторить тренировку <Icon name='arrow' /></button><Link className='button' to='/history' aria-disabled={disabled} tabIndex={disabled ? -1 : 0} onClick={event => { if (disabled) event.preventDefault(); }}>Посмотреть историю <Icon name='arrow' /></Link></div>;
}
