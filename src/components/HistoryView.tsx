import { useEffect, useState } from 'react';
import { AttemptReport } from './AttemptReport';
import { criterionLabels, labels } from '../exercises/types';
import { comparableHistory, downloadJson, HistoryStore, metrics } from '../training/history';
import { modeLabels, type WorkoutRecord } from '../training/session';

const ratio = (n: number, d: number) => d ? `${n}/${d} (${Math.round(n / d * 100)}%)` : '0/0 · нет оценённых данных';
export function WorkoutMetrics({ record }: { record: WorkoutRecord }) {
  const { result, completedSets, targetSets, criteria } = metrics(record);
  return <div className='history-metrics'>
    <p>Завершённые подходы: {completedSets}/{record.goal.sets}; достигли цели: {targetSets}/{record.goal.sets}. Полные повторы: {result.reps}.</p>
    <p>Неполные попытки: {result.incomplete}. Неоценённые: {ratio(result.unassessed, result.attempts.length)} от всех попыток.</p>
    <ul>{Object.entries(criteria).filter(([code]) => code !== (record.exercise === 'squat' ? 'line' : 'lean')).map(([code, c]) => <li key={code}>{criterionLabels[code as keyof typeof criterionLabels]}: замечания в {ratio(c.deviations, c.denominator)} попыток, где критерий оценивался.</li>)}</ul>
  </div>;
}
export function WorkoutDetails({ record }: { record: WorkoutRecord }) {
  return <section className='workout-details'>
    <h2>Подходы и условия</h2>
    <p>{modeLabels[record.mode]} · {labels[record.exercise]} · {record.metadata.variant.id} · {new Date(record.date).toLocaleString('ru-RU')}</p>
    <p>Цель пользователя: {record.goal.sets} подходов × {record.goal.reps} полных повторов, отдых {record.goal.restSeconds} с. Длительность всей сессии: {Math.round(record.duration)} с, включая подготовку, паузы и отдых.</p>
    <p>Условия со слов пользователя: {record.conditions || 'не указаны — сравнение между записями отключено'}.</p>
    <WorkoutMetrics record={record} />
    {record.sets.map(set => <details key={set.number} className='set-details'>
      <summary>Подход {set.number}: {set.result.reps}/{record.goal.reps} полных · {set.ended === 'completed' ? 'завершён' : 'прерван завершением сессии'} · {Math.round(set.durationMs / 1000)} с</summary>
      <p>Наблюдение (время поддержанных кадрами интервалов подхода; без паузы и отдыха): нужные точки видны {Math.round(set.observation.readyMs / 1000)} с / {Math.round(set.observation.sampledMs / 1000)} с; частично {Math.round(set.observation.partialMs / 1000)} с; недоступно {Math.round(set.observation.unavailableMs / 1000)} с. Это видимость точек, ракурс проверяется отдельно.</p>
      <p>Ручное подтверждение профиля: {set.observation.sideViewConfirmed ? 'использовалось' : 'не использовалось'}. Подготовка и пауза включены в длительность подхода.</p>
      {set.result.attempts.length ? set.result.attempts.map(a => <AttemptReport key={a.id} attempt={a} exercise={record.exercise} compact />) : <p>Наблюдаемых попыток нет.</p>}
    </details>)}
    <details><summary>Версии и параметры сравнения</summary><pre>{JSON.stringify(record.metadata, null, 2)}</pre></details>
    <p>Правила предварительные. Эти данные описывают наблюдаемые движения, а не рост силы, мышц или изменение риска травмы.</p>
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
    <h1>Локальная история</h1>
    <p>Результаты хранятся в этом браузере на этом устройстве. Синхронизации между устройствами нет. Видео и поток координат не сохраняются. Очистка данных браузера удалит историю; JSON позволяет сохранить копию результатов.</p>
    {(history.error || error) && <p role='alert' className='storage-error'>{error || history.error}</p>}
    <div className='history-actions'>
      <button className='button' onClick={onHome}>На главную</button>
      <button className='button' onClick={refresh}>Обновить</button>
      <button className='button' disabled={!history.records.length} onClick={() => downloadJson({ schemaVersion: 1, records: history.records }, 'playfit-history.json')}>Экспорт истории JSON</button>
      {history.error && history.raw !== null && <button className='button' onClick={() => downloadJson(history.raw, 'playfit-history-original.json', true)}>Экспорт исходных данных</button>}
      <button className='button' disabled={!history.records.length && history.raw === null} onClick={() => setConfirm('all')}>Очистить историю…</button>
    </div>
    {confirm === 'all' && <div role='alert' className='delete-confirm'><p>Удалить всю локальную историю без возможности отмены? Перед удалением можно экспортировать JSON.</p><button className='button' onClick={clear}>Да, удалить всю историю</button><button className='button' onClick={() => setConfirm(null)}>Отмена</button></div>}
    <section aria-label='Прогресс по сопоставимым наблюдениям'>
      <h2>Сопоставимые наблюдения</h2>
      <p>Отдельные группы для упражнения, варианта, условий со слов пользователя, цели, ракурса, правил, амплитуды и параметров анализа. Изменение любого из них начинает новую группу. Камера и анализ записи сравниваются отдельно. Синтетическое демо исключено из прогресса.</p>
      {groups.map(selected => {
        const records = comparableHistory(history.records, selected);
        return <details key={selected.id}><summary>{labels[selected.exercise]} · {modeLabels[selected.mode]} · {selected.conditions || 'условия неизвестны'} · {selected.metadata.rulesVersion} · амплитуда {selected.metadata.variant.lowerAngle}–{selected.metadata.variant.upperAngle}° · {records.length} записей</summary>
          {records.length < 2 && <p>Для сравнения нужна ещё одна запись с теми же условиями и параметрами.</p>}
          <p>Хронология наблюдений; разница показателей сама по себе не доказывает физический прогресс.</p>
          {records.map(r => <article key={r.id}><h3>{new Date(r.date).toLocaleString('ru-RU')}</h3><WorkoutMetrics record={r} /></article>)}
        </details>;
      })}
      {!groups.length && <p>Личных наблюдений для сравнения пока нет.</p>}
    </section>
    <h2>Все записи ({history.records.length})</h2>
    {!history.records.length && !history.error && <p>Завершённые тренировки появятся здесь.</p>}
    {[...history.records].reverse().map(record => <article className='history-record' key={record.id}>
      <h3>{new Date(record.date).toLocaleString('ru-RU')} · {labels[record.exercise]} · {modeLabels[record.mode]}</h3>
      <WorkoutMetrics record={record} />
      <details><summary>Подробности тренировки</summary><WorkoutDetails record={record} /></details>
      <div className='history-actions'>
        <button className='button' onClick={() => downloadJson({ schemaVersion: 1, records: [record] }, 'playfit-workout.json')}>Экспорт JSON</button>
        <button className='button' onClick={() => setConfirm(record.id)}>Удалить запись…</button>
      </div>
      {confirm === record.id && <div role='alert' className='delete-confirm'><p>Удалить эту тренировку без возможности отмены?</p><button className='button' onClick={() => remove(record.id)}>Да, удалить запись</button><button className='button' onClick={() => setConfirm(null)}>Отмена</button></div>}
    </article>)}
  </main>;
}
