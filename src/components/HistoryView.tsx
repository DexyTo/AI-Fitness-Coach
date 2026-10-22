import { inHistoryRange, type HistoryRange } from './workoutAnalytics';
import { loadPrograms } from '../programs/history';
import { HistorySummary, ExerciseFilter, HistoryDateFilter } from './HistoryAnalytics';
import { ExerciseVisual } from './ExerciseVisual';
import { HoldSummary, SideSummary } from './ExerciseSetup';
import { goalLabel, resultValue } from '../../shared/workout';
import { isLegacy, criterionName } from '../exercises/registry';
import { useEffect, useState } from 'react';
import { AttemptReport } from './AttemptReport';
import { Icon } from './Icon';
import { criterionLabels, labels } from '../exercises/types';
import { comparableHistory, downloadJson, HistoryStore, metrics } from '../training/history';
import { modeLabels, type WorkoutRecord } from '../training/session';
import { GuestProgramHistory } from '../programs/ProgramViews';

const ratio = (n: number, d: number) => d ? `${n}/${d} (${Math.round(n / d * 100)}%)` : '0/0 · нет оценённых данных';
const durationLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export function WorkoutMetrics({ record }: { record: WorkoutRecord }) {
  const { result, completedSets, targetSets, criteria } = metrics(record);
  if(result.hold)return <div className='history-metrics'><HoldSummary result={result} exercise={record.exercise}/><p>Цели достигнуты в {targetSets}/{record.goal.sets} подходах. Удержания не входят в правила XP v1 и соревнований.</p></div>;
  return <div className='history-metrics'><SideSummary result={result}/>
    <div className='record-stats'><div><strong>{result.reps}</strong><span>Полных повторов</span></div><div><strong>{completedSets}<small> / {record.goal.sets}</small></strong><span>Подходов завершено</span></div><div><strong>{result.incomplete}</strong><span>Неполных попыток</span></div></div>
    <details className='metrics-details'><summary>Замечания и качество наблюдения</summary>
      <p>Достигли цели: {targetSets}/{record.goal.sets} подходов. Неоценённые: {ratio(result.unassessed, result.attempts.length)} от всех попыток.</p>
      <ul>{Object.entries(criteria).filter(([code]) => !isLegacy(record.exercise)||code !== (record.exercise === 'squat' ? 'line' : 'lean')).map(([code, c]) => <li key={code}>{isLegacy(record.exercise)?criterionLabels[code as keyof typeof criterionLabels]:criterionName(record.exercise,code as keyof typeof criterionLabels)}: замечания в {ratio(c.deviations, c.denominator)} попыток, где критерий оценивался.</li>)}</ul>
    </details>
  </div>;
}
export function WorkoutDetails({ record }: { record: WorkoutRecord }) {
  return <section className='workout-details'>
    <h2>Подходы и условия</h2>
    <p>{modeLabels[record.mode]} · {labels[record.exercise]} · {new Date(record.date).toLocaleString('ru-RU')}</p>
    <p>Цель: {record.goal.sets} подходов × {goalLabel(record.goal)}. Отдых {record.goal.restSeconds} с. Длительность с подготовкой, паузами и отдыхом: {Math.round(record.duration)} с.</p>
    <p>Вариант: {record.goal.options?.variant==='seated'?'сидя':record.goal.options?.variant==='standing'?'стоя':'основной'}. {record.goal.options?.weightKg!==undefined?`Вес одной гантели: ${record.goal.options.weightKg} кг (введён пользователем).`:''}</p>
    <p>Условия съёмки: {record.conditions || 'не указаны — сравнение между записями отключено'}.</p>
    <WorkoutMetrics record={record} />
    {record.sets.map(set => <details key={set.number} className='set-details'>
      <summary>Подход {set.number}<span>{resultValue(set.result).toFixed(set.result.hold?1:0)}/{goalLabel(record.goal)} · {set.ended === 'completed' ? 'завершён' : 'прерван'} · {Math.round(set.durationMs / 1000)} с</span></summary>
      <p>Наблюдение без пауз и отдыха: нужные точки видны {Math.round(set.observation.readyMs / 1000)} / {Math.round(set.observation.sampledMs / 1000)} с; частично {Math.round(set.observation.partialMs / 1000)} с; недоступно {Math.round(set.observation.unavailableMs / 1000)} с. Ракурс проверяется отдельно.</p>
      <p>Ручное подтверждение профиля: {set.observation.sideViewConfirmed ? 'использовалось' : 'не использовалось'}. Подготовка и пауза включены в длительность подхода.</p>
      {set.result.hold?<HoldSummary result={set.result} exercise={record.exercise}/>:set.result.attempts.length ? set.result.attempts.map(a => <AttemptReport key={a.id} attempt={a} exercise={record.exercise} compact />) : <p>Наблюдаемых попыток нет.</p>}
    </details>)}
    <details><summary>Версии и параметры анализа</summary><pre>{JSON.stringify(record.metadata, null, 2)}</pre></details>
    <p className='fine-print'>Правила предварительные. Эти данные описывают наблюдаемые движения, а не рост силы, мышц или изменение риска травмы.</p>
  </section>;
}

export function HistoryView({ onHome }: { onHome: () => void }) {
  const [dateRange, setDateRange] = useState<HistoryRange>('all');
  const [exerciseFilter, setExerciseFilter] = useState('all');
  const [store] = useState(() => new HistoryStore());
  const [history, setHistory] = useState(() => store.load());
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const refresh = () => setHistory(store.load());
  useEffect(() => {
    const onStorage = () => { refresh(); setConfirm(null); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [store]);
  const remove = (id: string) => { setError(store.remove(id)); setConfirm(null); refresh(); };
  const clear = () => { setError(store.clear()); setConfirm(null); refresh(); };
  const groups = history.records.filter(r => r.mode !== 'demo').reduce<WorkoutRecord[]>((all, r) => {
    if (!all.some(previous => comparableHistory([previous], r).length)) all.push(r);
    return all;
  }, []);
  const visibleRecords = [...history.records].reverse().filter(record => inHistoryRange(record.date, dateRange) && (exerciseFilter === 'all' || record.exercise === exerciseFilter));
  return <main className='history-page page-enter'>
    <div className='page-heading'><div><span className='eyebrow'>ТВОЙ РИТМ</span><h1>История тренировок<span className='accent'>.</span></h1><p className='muted'>Каждый подход — часть твоего пути.</p></div><button className='button button-primary' onClick={onHome}>К тренировке <Icon name='arrow' /></button></div>
    <div className='local-note'><Icon name='shield' /><p>Сохранено только в этом браузере. Видео не сохраняется.<span> При очистке данных браузера история удалится. Экспортируй результаты, чтобы оставить копию.</span></p></div>
    {(history.error || error) && <p role='alert' className='storage-error'>{error || history.error}</p>}
    {!history.error && <HistorySummary records={[...history.records, ...loadPrograms().records]} />}
    <ExerciseFilter value={exerciseFilter} onChange={setExerciseFilter} />
    <div className='history-toolbar'><h2>Одиночные тренировки <span className='count-badge'>{visibleRecords.length}</span></h2><HistoryDateFilter value={dateRange} onChange={setDateRange} /><div className='history-actions'>
      <button className='button button-ghost' onClick={refresh}>Обновить</button>
      <button className='button button-ghost' disabled={!history.records.length} onClick={() => downloadJson({ schemaVersion: 1, records: history.records }, 'playfit-history.json')}>Экспорт JSON</button>
      {history.error && history.raw !== null && <button className='button' onClick={() => downloadJson(history.raw, 'playfit-history-original.json', true)}>Сохранить исходные данные</button>}
      {(history.records.length > 0 || history.raw !== null) && <button className='button button-ghost danger-text' onClick={() => setConfirm('all')}>Очистить…</button>}
    </div></div>
    {confirm === 'all' && <div role='alert' className='delete-confirm'><p>Удалить все одиночные тренировки гостя? Восстановить их не получится. Сначала можно сохранить JSON. Программы находятся в отдельном разделе ниже.</p><button className='button button-danger' onClick={clear}>Удалить одиночные тренировки</button><button className='button' onClick={() => setConfirm(null)}>Отмена</button></div>}
    {!history.records.length && !history.error && <section className='empty-state'><span className='empty-icon'><Icon name='history' /></span><span className='eyebrow'>НОВАЯ ТОЧКА ОТСЧЁТА</span><h2>Первый подход ещё впереди</h2><p>Заверши тренировку — здесь появятся<br />твои повторы, подходы и подсказки.</p><button className='button button-primary' onClick={onHome}>Выбрать тренировку <Icon name='arrow' /></button></section>}
    {history.records.length > 0 && visibleRecords.length === 0 && <p className='filter-empty' role='status'>Для выбранных фильтров записей пока нет.</p>}
    {visibleRecords.map(record => <article className='history-record' key={record.id}>
      <div className='record-heading'><ExerciseVisual exercise={record.exercise} /><div><span className='record-date'>{new Date(record.date).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><h3>{labels[record.exercise]}</h3></div><span className={`mode-badge ${record.mode === 'demo' ? 'demo' : ''}`}>{modeLabels[record.mode]}</span></div>
      <WorkoutMetrics record={record} />
      <details><summary>Подробности тренировки</summary><WorkoutDetails record={record} /></details>
      <div className='record-footer'><span>{durationLabel(record.duration)} · цель {record.goal.sets} × {goalLabel(record.goal)}</span><div className='history-actions'><button className='button button-ghost' onClick={() => downloadJson({ schemaVersion: 1, records: [record] }, 'playfit-workout.json')}>Экспорт</button><button className='button button-ghost danger-text' onClick={() => setConfirm(record.id)}>Удалить…</button></div></div>
      {confirm === record.id && <div role='alert' className='delete-confirm'><p>Удалить эту тренировку без возможности восстановления?</p><button className='button button-danger' onClick={() => remove(record.id)}>Удалить запись</button><button className='button' onClick={() => setConfirm(null)}>Отмена</button></div>}
    </article>)}
    <GuestProgramHistory exerciseFilter={exerciseFilter} dateRange={dateRange} onChange={refresh} />
    {groups.length > 0 && <details className='comparison-section'><summary>Сравнить тренировки <span>В одинаковых условиях</span></summary>
      <p>Сравниваются одинаковые упражнения, цели, условия и параметры анализа. Камера и видео разделены. Демо не входит в личный прогресс.</p>
      {groups.map(selected => {
        const records = comparableHistory(history.records, selected);
        return <details key={selected.id}><summary>{labels[selected.exercise]} · {modeLabels[selected.mode]} · {selected.conditions || 'условия неизвестны'} · {records.length} записей</summary>
          <p>Правила: {selected.metadata.rulesVersion}{isLegacy(selected.exercise)?` · амплитуда ${selected.metadata.variant.lowerAngle}–${selected.metadata.variant.upperAngle}°`: ' · параметры зафиксированы в снимке упражнения'}.</p>
          {records.length < 2 && <p>Для сравнения нужна ещё одна запись с теми же условиями и параметрами.</p>}
          <p>Разница показателей сама по себе не доказывает физический прогресс.</p>
          {records.map(r => <article key={r.id}><h3>{new Date(r.date).toLocaleString('ru-RU')}</h3><WorkoutMetrics record={r} /></article>)}
        </details>;
      })}
    </details>}
  </main>;
}
