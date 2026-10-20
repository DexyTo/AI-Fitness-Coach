import { useEffect, useState } from 'react';
import { AttemptReport } from './AttemptReport';
import { Icon } from './Icon';
import { criterionLabels, labels } from '../exercises/types';
import { comparableHistory, downloadJson, HistoryStore, metrics } from '../training/history';
import { modeLabels, type WorkoutRecord } from '../training/session';

const ratio = (n: number, d: number) => d ? `${n}/${d} (${Math.round(n / d * 100)}%)` : '0/0 · нет оценённых данных';
const durationLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export function WorkoutMetrics({ record }: { record: WorkoutRecord }) {
  const { result, completedSets, targetSets, criteria } = metrics(record);
  return <div className='history-metrics'>
    <div className='record-stats'><div><strong>{result.reps}</strong><span>Полных повторов</span></div><div><strong>{completedSets}<small> / {record.goal.sets}</small></strong><span>Подходов завершено</span></div><div><strong>{result.incomplete}</strong><span>Неполных попыток</span></div></div>
    <details className='metrics-details'><summary>Замечания и качество наблюдения</summary>
      <p>Достигли цели: {targetSets}/{record.goal.sets} подходов. Неоценённые: {ratio(result.unassessed, result.attempts.length)} от всех попыток.</p>
      <ul>{Object.entries(criteria).filter(([code]) => code !== (record.exercise === 'squat' ? 'line' : 'lean')).map(([code, c]) => <li key={code}>{criterionLabels[code as keyof typeof criterionLabels]}: замечания в {ratio(c.deviations, c.denominator)} попыток, где критерий оценивался.</li>)}</ul>
    </details>
  </div>;
}
export function WorkoutDetails({ record }: { record: WorkoutRecord }) {
  return <section className='workout-details'>
    <h2>Подходы и условия</h2>
    <p>{modeLabels[record.mode]} · {labels[record.exercise]} · {new Date(record.date).toLocaleString('ru-RU')}</p>
    <p>Цель: {record.goal.sets} подходов × {record.goal.reps} повторов. Отдых {record.goal.restSeconds} с. Длительность с подготовкой, паузами и отдыхом: {Math.round(record.duration)} с.</p>
    <p>Условия съёмки: {record.conditions || 'не указаны — сравнение между записями отключено'}.</p>
    <WorkoutMetrics record={record} />
    {record.sets.map(set => <details key={set.number} className='set-details'>
      <summary>Подход {set.number}<span>{set.result.reps}/{record.goal.reps} полных · {set.ended === 'completed' ? 'завершён' : 'прерван'} · {Math.round(set.durationMs / 1000)} с</span></summary>
      <p>Наблюдение без пауз и отдыха: нужные точки видны {Math.round(set.observation.readyMs / 1000)} / {Math.round(set.observation.sampledMs / 1000)} с; частично {Math.round(set.observation.partialMs / 1000)} с; недоступно {Math.round(set.observation.unavailableMs / 1000)} с. Ракурс проверяется отдельно.</p>
      <p>Ручное подтверждение профиля: {set.observation.sideViewConfirmed ? 'использовалось' : 'не использовалось'}. Подготовка и пауза включены в длительность подхода.</p>
      {set.result.attempts.length ? set.result.attempts.map(a => <AttemptReport key={a.id} attempt={a} exercise={record.exercise} compact />) : <p>Наблюдаемых попыток нет.</p>}
    </details>)}
    <details><summary>Версии и параметры анализа</summary><pre>{JSON.stringify(record.metadata, null, 2)}</pre></details>
    <p className='fine-print'>Правила предварительные. Эти данные описывают наблюдаемые движения, а не рост силы, мышц или изменение риска травмы.</p>
  </section>;
}

export function HistoryView({ onHome }: { onHome: () => void }) {
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
  return <main className='history-page page-enter'>
    <div className='page-heading'><div><span className='eyebrow'>ТВОЙ РИТМ</span><h1>История движений<span className='accent'>.</span></h1><p className='muted'>Каждый подход — часть твоего пути.</p></div><button className='button button-primary' onClick={onHome}>К тренировке <Icon name='arrow' /></button></div>
    <div className='local-note'><Icon name='shield' /><p>Сохранено только в этом браузере. Видео не сохраняется.<span> При очистке данных браузера история удалится. Экспортируй результаты, чтобы оставить копию.</span></p></div>
    {(history.error || error) && <p role='alert' className='storage-error'>{error || history.error}</p>}
    <div className='history-toolbar'><h2>Тренировки <span className='count-badge'>{history.records.length}</span></h2><div className='history-actions'>
      <button className='button button-ghost' onClick={refresh}>Обновить</button>
      <button className='button button-ghost' disabled={!history.records.length} onClick={() => downloadJson({ schemaVersion: 1, records: history.records }, 'playfit-history.json')}>Экспорт JSON</button>
      {history.error && history.raw !== null && <button className='button' onClick={() => downloadJson(history.raw, 'playfit-history-original.json', true)}>Сохранить исходные данные</button>}
      {(history.records.length > 0 || history.raw !== null) && <button className='button button-ghost danger-text' onClick={() => setConfirm('all')}>Очистить…</button>}
    </div></div>
    {confirm === 'all' && <div role='alert' className='delete-confirm'><p>Удалить всю историю? Восстановить её не получится. Сначала можно сохранить JSON.</p><button className='button button-danger' onClick={clear}>Удалить всю историю</button><button className='button' onClick={() => setConfirm(null)}>Отмена</button></div>}
    {!history.records.length && !history.error && <section className='empty-state'><span className='empty-icon'><Icon name='history' /></span><span className='eyebrow'>НОВАЯ ТОЧКА ОТСЧЁТА</span><h2>Первый подход ещё впереди</h2><p>Заверши тренировку — здесь появятся<br />твои повторы, подходы и подсказки.</p><button className='button button-primary' onClick={onHome}>Выбрать тренировку <Icon name='arrow' /></button></section>}
    {[...history.records].reverse().map(record => <article className='history-record' key={record.id}>
      <div className='record-heading'><span className='exercise-glyph'><Icon name={record.exercise} /></span><div><span className='record-date'>{new Date(record.date).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><h3>{labels[record.exercise]}</h3></div><span className={`mode-badge ${record.mode === 'demo' ? 'demo' : ''}`}>{modeLabels[record.mode]}</span></div>
      <WorkoutMetrics record={record} />
      <details><summary>Подробности тренировки</summary><WorkoutDetails record={record} /></details>
      <div className='record-footer'><span>{durationLabel(record.duration)} · цель {record.goal.sets} × {record.goal.reps}</span><div className='history-actions'><button className='button button-ghost' onClick={() => downloadJson({ schemaVersion: 1, records: [record] }, 'playfit-workout.json')}>Экспорт</button><button className='button button-ghost danger-text' onClick={() => setConfirm(record.id)}>Удалить…</button></div></div>
      {confirm === record.id && <div role='alert' className='delete-confirm'><p>Удалить эту тренировку без возможности восстановления?</p><button className='button button-danger' onClick={() => remove(record.id)}>Удалить запись</button><button className='button' onClick={() => setConfirm(null)}>Отмена</button></div>}
    </article>)}
    {groups.length > 0 && <details className='comparison-section'><summary>Сравнить тренировки <span>В одинаковых условиях</span></summary>
      <p>Сравниваются одинаковые упражнения, цели, условия и параметры анализа. Камера и видео разделены. Демо не входит в личный прогресс.</p>
      {groups.map(selected => {
        const records = comparableHistory(history.records, selected);
        return <details key={selected.id}><summary>{labels[selected.exercise]} · {modeLabels[selected.mode]} · {selected.conditions || 'условия неизвестны'} · {records.length} записей</summary>
          <p>Правила: {selected.metadata.rulesVersion} · амплитуда {selected.metadata.variant.lowerAngle}–{selected.metadata.variant.upperAngle}°.</p>
          {records.length < 2 && <p>Для сравнения нужна ещё одна запись с теми же условиями и параметрами.</p>}
          <p>Разница показателей сама по себе не доказывает физический прогресс.</p>
          {records.map(r => <article key={r.id}><h3>{new Date(r.date).toLocaleString('ru-RU')}</h3><WorkoutMetrics record={r} /></article>)}
        </details>;
      })}
    </details>}
  </main>;
}
