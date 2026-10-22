import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { labels, exerciseIds, type ExerciseType } from '../exercises/types';
import type { HistoryRecord } from '../../shared/program';
import { summarizeHistory, type Period, type HistoryRange } from './workoutAnalytics';
import { Icon } from './Icon';
import { Link } from 'react-router-dom';

export function HistorySummary({ records }: { records: HistoryRecord[] }) {
  const data = summarizeHistory(records, 'week');
  return <section className='history-summary surface' aria-label='Сводка за последние 7 дней'>
    <div className='section-title'><h2>За последние 7 дней</h2><Link to='/progress'>Весь прогресс <Icon name='chevron' /></Link></div>
    <dl><div><dt>Тренировок</dt><dd>{data.workouts}</dd></div><div><dt>Полных повторов</dt><dd>{data.reps}</dd></div><div><dt>Подходы с достигнутой целью</dt><dd>{data.sets ? <>{data.targetSets}<small> из {data.sets}</small></> : '—'}</dd></div></dl>
    {!data.workouts && <p>Здесь появятся результаты камеры и видео. Демо в прогресс не входит.</p>}
  </section>;
}

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
  const [chartWidth, setChartWidth] = useState(720);
  const chartRef = useRef<SVGSVGElement>(null);
  const data = summarizeHistory(records, period), hasData = data.selected.length > 0;
  useEffect(() => {
    const svg = chartRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => setChartWidth(Math.max(260, Math.floor(entry.contentRect.width))));
    observer.observe(svg);
    return () => observer.disconnect();
  }, [hasData]);
  const max = Math.max(3, Math.ceil(Math.max(0, ...data.buckets.map(b => b.reps)) / 3) * 3);
  const chartX = (index: number) => 28 + index * (chartWidth - 48) / (data.buckets.length - 1);
  const points = data.buckets.map((b, i) => `${chartX(i)},${156 - b.withoutFindings / max * 120}`).join(' ');
  const colors = ['#1245ff', '#cdff00', '#15c997', '#a899ed', '#f4b563', '#84a4f4', '#6ba89a', '#d897ab', '#8e9c67', '#68b4c6'];
  let offset = 0;
  const gradient = data.distribution.map(([, count], index) => {
    const start = offset; offset += count / data.selected.length * 100;
    return `${colors[index]} ${start}% ${offset}%`;
  }).join(',');
  return <section className='analytics-section' aria-label='Статистика тренировок'>
    <div className='section-title'><h2>Твой прогресс</h2><div className='period-switch' role='group' aria-label='Период статистики'>{(['week', 'month', 'year'] as const).map(p => <button aria-pressed={period === p} key={p} onClick={() => setPeriod(p)}>{({ week: 'Неделя', month: 'Месяц', year: 'Год' })[p]}</button>)}</div></div>
    <div className='analytics-layout'><div className='chart-card surface'><div className='section-title'><h3>Активность и повторения</h3><span className='chart-legend'><i />Полные <i />Без замечаний</span></div>
      {hasData ? <><svg ref={chartRef} className='activity-chart' viewBox={`0 0 ${chartWidth} 200`} role='img' aria-label='Полные повторы и повторы без замечаний за выбранный период'>
        {[0, 1, 2, 3].map(n => <g key={n}><line x1='28' y1={36 + n * 40} x2={chartWidth - 20} y2={36 + n * 40} stroke='#edf0f5' /><text x='2' y={40 + n * 40} fontSize='12' fill='#596478'>{max * (3 - n) / 3}</text></g>)}
        {data.buckets.map((b, i) => <g key={b.key}><title>{b.label}: тренировок {b.workouts}, полных {b.reps}, без замечаний {b.withoutFindings}</title><rect x={chartX(i) - (period === 'month' ? 2 : 5)} y={156 - b.reps / max * 120} width={period === 'month' ? 4 : 10} height={b.reps / max * 120} rx='2' fill='#c0d2ff' />{(period === 'month' ? i % 5 === 0 : period === 'year' && chartWidth < 480 ? i % 2 === 0 : true) && <text x={chartX(i)} y='185' textAnchor='middle' fontSize='12' fill='#596478'>{b.label}</text>}</g>)}
        <polyline points={points} fill='none' stroke='#1245ff' strokeWidth='2.5' />
        {data.buckets.map((b, i) => <circle key={b.key} cx={chartX(i)} cy={156 - b.withoutFindings / max * 120} r='3.5' fill='#1245ff' />)}
      </svg><div className='chart-accessible'>{data.buckets.map(b => <span key={b.key}>{b.label}: {b.reps} полных, {b.withoutFindings} без замечаний. </span>)}</div></> : <div className='chart-empty'><Icon name='activity' /><b>Здесь начинается твой прогресс</b><span>За выбранный период нет записанных упражнений.</span></div>}
      <p className='fine-print'>Камера и видео, включая импорт. Повторы включают шаги программ. Демо исключено.</p>
    </div><div className='analytics-stats surface'>
      <div><span className='stat-icon'><Icon name='history' /></span><span>Тренировок<strong>{data.workouts}</strong><small>за выбранный период</small></span></div>
      <div><span className='stat-icon green'><Icon name='check' /></span><span>Полных повторов<strong>{data.reps}</strong><small>{data.withoutFindings} без замечаний</small></span></div>
      <div><Ring value={data.completion} label={data.completion === null ? '—' : `${data.completion}%`} /><span>Подходы с достигнутой целью<strong>{data.targetSets}<small> из {data.sets}</small></strong><small>за выбранный период</small></span></div>
    </div></div>
    {data.distribution.length > 0 && <details className='distribution surface'><summary>Распределение упражнений</summary><div className='distribution-content'><div className='distribution-ring' style={{ background: `conic-gradient(${gradient})` }} role='img' aria-label={`Записей упражнений: ${data.selected.length}`}><span>{data.selected.length}<small>упражнений</small></span></div><ul>{data.distribution.map(([exercise, count], index) => <li key={exercise}><span><i style={{ background: colors[index] }} />{labels[exercise]}</span><progress value={count} max={data.selected.length} aria-label={labels[exercise]} /><b>{count}</b></li>)}</ul></div></details>}
  </section>;
}
