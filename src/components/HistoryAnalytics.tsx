import { useState, type CSSProperties } from 'react';
import { labels, exerciseIds, type ExerciseType } from '../exercises/types';
import type { HistoryRecord } from '../../shared/program';
import { summarizeHistory, type Period, type HistoryRange } from './workoutAnalytics';
import { Icon } from './Icon';

export function Ring({ value, label, caption }: { value: number | null; label: string; caption?: string }) {
  return <div className='ring-metric'><div className='progress-ring' style={{ '--progress': `${value ?? 0}%` } as CSSProperties}><strong>{label}</strong></div>{caption && <span>{caption}</span>}</div>;
}
export function ExerciseFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className='filter-pills' role='group' aria-label='Фильтр по упражнению'>{['all', ...exerciseIds].map(id => <button key={id} aria-pressed={value === id} onClick={() => onChange(id)}>{id === 'all' ? 'Все' : labels[id as ExerciseType]}</button>)}</div>;
}
export function HistoryDateFilter({ value, onChange }: { value: HistoryRange; onChange: (value: HistoryRange) => void }) {
  return <label className='history-date-filter'>Период записей<select value={value} onChange={e => onChange(e.target.value as HistoryRange)}><option value='all'>Все даты</option><option value='week'>Последние 7 дней</option><option value='month'>Последние 30 дней</option><option value='year'>Последние 12 месяцев</option></select></label>;
}
export function HistoryAnalytics({ records }: { records: HistoryRecord[] }) {
  const [period, setPeriod] = useState<Period>('week');
  const data = summarizeHistory(records, period), max = Math.max(1, ...data.buckets.map(b => b.reps));
  const points = data.buckets.map((b, i) => `${20 + i * 660 / (data.buckets.length - 1)},${156 - b.withoutFindings / max * 120}`).join(' ');
  const colors = ['#1245ff', '#cdff00', '#15c997', '#a899ed', '#f4b563', '#84a4f4', '#6ba89a', '#d897ab', '#8e9c67', '#68b4c6'];
  let offset = 0;
  const gradient = data.distribution.map(([, count], index) => {
    const start = offset; offset += count / data.selected.length * 100;
    return `${colors[index]} ${start}% ${offset}%`;
  }).join(',');
  return <section className='analytics-section' aria-label='Статистика тренировок'>
    <div className='section-title'><h2>Твой прогресс</h2><div className='period-switch' role='group' aria-label='Период статистики'>{(['week', 'month', 'year'] as const).map(p => <button aria-pressed={period === p} key={p} onClick={() => setPeriod(p)}>{({ week: 'Неделя', month: 'Месяц', year: 'Год' })[p]}</button>)}</div></div>
    <div className='analytics-layout'><div className='chart-card surface'><div className='section-title'><h3>Активность и повторения</h3><span className='chart-legend'><i />Полные <i />Без замечаний</span></div>
      {data.selected.length ? <><svg className='activity-chart' viewBox='0 0 720 200' role='img' aria-label='Полные повторы и повторы без замечаний за выбранный период'>
        {[0, 1, 2, 3].map(n => <g key={n}><line x1='20' y1={36 + n * 40} x2='700' y2={36 + n * 40} stroke='#edf0f5' /><text x='2' y={39 + n * 40} fontSize='9' fill='#788094'>{Math.round(max * (1 - n / 3))}</text></g>)}
        {data.buckets.map((b, i) => <g key={b.key}><title>{b.label}: тренировок {b.workouts}, полных {b.reps}, без замечаний {b.withoutFindings}</title><rect x={20 + i * 660 / (data.buckets.length - 1) - 4} y={156 - b.reps / max * 120} width={period === 'month' ? 8 : 14} height={b.reps / max * 120} rx='3' fill='#c0d2ff' />{(period !== 'month' || i % 5 === 0) && <text x={20 + i * 660 / (data.buckets.length - 1)} y='185' textAnchor='middle' fontSize='10' fill='#788094'>{b.label}</text>}</g>)}
        <polyline points={points} fill='none' stroke='#1245ff' strokeWidth='2.5' />
        {data.buckets.map((b, i) => <circle key={b.key} cx={20 + i * 660 / (data.buckets.length - 1)} cy={156 - b.withoutFindings / max * 120} r='3.5' fill='#1245ff' />)}
      </svg><div className='chart-accessible'>{data.buckets.map(b => <span key={b.key}>{b.label}: {b.reps} полных, {b.withoutFindings} без замечаний. </span>)}</div></> : <div className='chart-empty'><Icon name='activity' /><b>Здесь начинается твой прогресс</b><span>За выбранный период нет записанных упражнений.</span></div>}
      <p className='fine-print'>Камера и видео, включая импорт. Повторы включают шаги программ. Демо исключено.</p>
    </div><div className='analytics-stats surface'>
      <div><span className='stat-icon'><Icon name='history' /></span><span>Тренировок<strong>{data.workouts}</strong><small>за выбранный период</small></span></div>
      <div><span className='stat-icon green'><Icon name='check' /></span><span>Полных повторов<strong>{data.reps}</strong><small>{data.withoutFindings} без замечаний</small></span></div>
      <div><Ring value={data.completion} label={data.completion === null ? '—' : `${data.completion}%`} /><span>Цели подходов<strong>{data.targetSets}<small> / {data.sets}</small></strong><small>достигнуто из запланированных</small></span></div>
    </div></div>
    {data.distribution.length > 0 && <details className='distribution surface'><summary>Распределение упражнений</summary><div className='distribution-content'><div className='distribution-ring' style={{ background: `conic-gradient(${gradient})` }} role='img' aria-label={`Записей упражнений: ${data.selected.length}`}><span>{data.selected.length}<small>упражнений</small></span></div><ul>{data.distribution.map(([exercise, count], index) => <li key={exercise}><span><i style={{ background: colors[index] }} />{labels[exercise]}</span><progress value={count} max={data.selected.length} aria-label={labels[exercise]} /><b>{count}</b></li>)}</ul></div></details>}
  </section>;
}
