import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { WorkoutDetails, WorkoutMetrics } from '../components/HistoryView';
import { Icon } from '../components/Icon';
import { labels } from '../exercises/types';
import { comparableHistory, downloadJson, HistoryStore } from '../training/history';
import { modeLabels, type WorkoutRecord } from '../training/session';
import { useAccount } from './context';
import { api, messageOf, type AccountResult, type User } from './api';

function exportResults(results: AccountResult[]) {
  // Server result IDs are unique even when imported records retain original IDs.
  downloadJson({ schemaVersion:1, records:results.map(r => ({ ...r.record,id:r.id })), accountResults:results.map(({ record,...provenance }) => ({ ...provenance, recordId:record.id })) },'playfit-account-history.json');
}
function SourceLabel({ result }: { result:AccountResult }) {
  return <p className='record-source'>{result.source === 'historical_import' ? `Исторический импорт · v${result.sourceVersion} · без игровых наград` : 'Новый запуск аккаунта'} · {modeLabels[result.record.mode]}{result.record.mode !== 'camera' && result.source !== 'historical_import' ? ' · без игровых наград' : ''}</p>;
}
type ImportPreview = { records:WorkoutRecord[]; added:number; existing:number };
export function AccountHistoryView({ user,onHome }: { user:User; onHome:() => void }) {
  const [results,setResults] = useState<AccountResult[]>([]), [loading,setLoading] = useState(true), [error,setError] = useState('');
  const [busy,setBusy] = useState(false), [confirm,setConfirm] = useState<string | null>(null);
  const [preview,setPreview] = useState<ImportPreview | null>(null), [notice,setNotice] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try { const data = await api<{ results:AccountResult[] }>('/history',{ userId:user.id }); setResults(data.results); }
    catch(e) { setError(messageOf(e)); setResults([]); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); },[user.id]);
  const archive = async (id:string) => {
    setBusy(true); setError('');
    try { await api(`/history/${encodeURIComponent(id)}`,{ method:'DELETE',userId:user.id }); setResults(v => v.filter(r => r.id !== id)); setConfirm(null); }
    catch(e) { setError(messageOf(e)); } finally { setBusy(false); }
  };
  const prepareImport = async () => {
    setBusy(true); setPreview(null); setError(''); setNotice('Проверяем гостевую историю…');
    try {
      const local = new HistoryStore().load();
      if (local.error) throw new Error(local.error);
      if (!local.records.length) { setNotice('В этом браузере нет гостевых записей для импорта.'); return; }
      let added=0,existing=0;
      for (const record of local.records) {
        const data = await api<{ added:number; existing:number }>('/history/import/preview',{ method:'POST', userId:user.id, body:{ schemaVersion:1,source:'playfit.workouts.v1',records:[record] } });
        added+=data.added; existing+=data.existing;
      }
      setPreview({ records:local.records,added,existing }); setNotice('');
    } catch(e) { setError(messageOf(e)); setNotice(''); } finally { setBusy(false); }
  };
  const doImport = async () => {
    if (!preview) return;
    setBusy(true); setError(''); let processed=0, added=0;
    try {
      for (const record of preview.records) {
        setNotice(`Переносим записи: ${processed}/${preview.records.length}…`);
        const data = await api<{ added:number }>('/history/import',{ method:'POST',userId:user.id,body:{ schemaVersion:1,source:'playfit.workouts.v1',records:[record] } });
        processed++; added+=data.added;
      }
      setPreview(null); setNotice(`Импорт завершён. Добавлено: ${added}. Исходная гостевая история сохранена.`);
      await load();
    } catch(e) { setError(`${messageOf(e)} Подтверждено записей: ${processed}. Повтори импорт: уже перенесённые записи не дублируются.`); setNotice(''); }
    finally { setBusy(false); }
  };
  const records = results.map(r => r.record);
  const groups = records.filter(r => r.mode !== 'demo').reduce<WorkoutRecord[]>((all,r) => { if (!all.some(p => comparableHistory([p],r).length)) all.push(r); return all; },[]);
  return <main className='history-page page-enter'><div className='page-heading'><div><span className='eyebrow'>ИСТОРИЯ АККАУНТА · @{user.login}</span><h1>История движений<span className='accent'>.</span></h1><p className='muted'>Твои сохранённые тренировки и наблюдения.</p></div><button className='button button-primary' onClick={onHome}>К тренировке <Icon name='arrow' /></button></div>
    <div className='local-note'><Icon name='shield' /><p>Результаты хранятся в локальной серверной базе этого аккаунта. Видео и поток точек остаются в браузере. Гостевые записи показываются отдельно после выхода.</p></div>
    <details className='import-panel'><summary>Перенести гостевую историю <span>Только по твоему выбору</span></summary><p>Предварительно проверим записи этого браузера. Импорт сохраняет источник и версию, не создаёт игровых запусков и не начисляет награды. Исходные записи останутся на месте.</p><button className='button' disabled={busy} onClick={() => void prepareImport()}>{busy ? 'Подождите…' : 'Посмотреть итог импорта'}</button>
      {preview && <section className='import-preview'><h3>В аккаунт @{user.login}</h3><div className='profile-stats'><div><strong>{preview.added}</strong><span>Новых записей</span></div><div><strong>{preview.existing}</strong><span>Уже импортированы</span></div></div><p>Камера: {preview.records.filter(r => r.mode === 'camera').length} · Видео: {preview.records.filter(r => r.mode === 'video').length} · Демо: {preview.records.filter(r => r.mode === 'demo').length}</p><div className='account-actions'><button className='button button-primary' disabled={busy || !preview.added} onClick={() => void doImport()}>Импортировать в этот аккаунт</button><button className='button' disabled={busy} onClick={() => setPreview(null)}>Отмена</button></div></section>}
    </details>
    {notice && <p role='status'>{notice}</p>}{error && <div className='storage-error' role='alert'>{error} <button className='button' disabled={busy || loading} onClick={() => void load()}>Повторить загрузку</button></div>}
    <div className='history-toolbar'><h2>Тренировки <span className='count-badge'>{results.length}</span></h2><div className='history-actions'><button className='button button-ghost' disabled={loading || busy} onClick={() => void load()}>Обновить</button><button className='button button-ghost' disabled={loading || !results.length} onClick={() => exportResults(results)}>Экспорт JSON</button></div></div>
    {loading ? <p role='status'>Загружаем историю аккаунта…</p> : !error && !results.length && <section className='empty-state'><span className='empty-icon'><Icon name='history' /></span><h2>Первый подход ещё впереди</h2><p>Заверши тренировку или явно перенеси прежние записи.</p><button className='button button-primary' onClick={onHome}>Выбрать тренировку <Icon name='arrow' /></button></section>}
    {!loading && [...results].reverse().map(result => <article className='history-record' key={result.id}><div className='record-heading'><span className='exercise-glyph'><Icon name={result.record.exercise} /></span><div><span className='record-date'>{new Date(result.record.date).toLocaleString('ru-RU')}</span><h3>{labels[result.record.exercise]}</h3></div><span className={`mode-badge ${result.record.mode === 'demo' ? 'demo' : ''}`}>{modeLabels[result.record.mode]}</span></div><SourceLabel result={result} /><WorkoutMetrics record={result.record} /><div className='record-footer'><Link className='button button-ghost' to={`/history/${result.id}`}>Подробности <Icon name='arrow' /></Link><div className='history-actions'><button className='button button-ghost' onClick={() => exportResults([result])}>Экспорт</button><button className='button button-ghost' disabled={busy} onClick={() => setConfirm(result.id)}>Скрыть…</button></div></div>{confirm === result.id && <div role='alert' className='delete-confirm'><p>Скрыть из истории и показателей профиля? Результат останется в базе для связанных событий. Повторный импорт не вернёт скрытую запись.</p><button className='button' disabled={busy} onClick={() => void archive(result.id)}>Скрыть запись</button><button className='button' disabled={busy} onClick={() => setConfirm(null)}>Отмена</button></div>}</article>)}
    {groups.length > 0 && <details className='comparison-section'><summary>Сравнить тренировки <span>В одинаковых условиях</span></summary><p>Камера и видео разделены, демо не участвует. Разница наблюдений сама по себе не доказывает физический прогресс.</p>{groups.map((selected,index) => <details key={index}><summary>{labels[selected.exercise]} · {modeLabels[selected.mode]} · {selected.conditions || 'условия неизвестны'}</summary>{comparableHistory(records,selected).map((record,index) => <article key={index}><h3>{new Date(record.date).toLocaleString('ru-RU')}</h3><WorkoutMetrics record={record} /></article>)}</details>)}</details>}
  </main>;
}
export function AccountHistoryDetail() {
  const { user } = useAccount(); const { id } = useParams();
  const [result,setResult] = useState<AccountResult | null>(null), [error,setError] = useState(''), [retry,setRetry] = useState(0);
  useEffect(() => {
    if (!user || !id) return;
    const controller = new AbortController(); setResult(null); setError('');
    void api<{ result:AccountResult }>(`/history/${encodeURIComponent(id)}`,{ userId:user.id, signal:controller.signal }).then(data => { if (!controller.signal.aborted) setResult(data.result); }).catch(e => { if (!controller.signal.aborted) setError(messageOf(e)); });
    return () => controller.abort();
  },[user?.id,id,retry]);
  if (!user) return <Navigate to='/login' replace />;
  return <main className='history-page page-enter'><Link className='button button-ghost' to='/history'>К истории</Link><h1>Детали тренировки<span className='accent'>.</span></h1>{error ? <div role='alert' className='storage-error'>{error} <button className='button' onClick={() => setRetry(v => v+1)}>Повторить</button></div> : result && result.id === id ? <><SourceLabel result={result} />{result.archivedAt && <p className='muted'>Запись скрыта из истории и показателей.</p>}<WorkoutDetails record={result.record} /><button className='button' onClick={() => exportResults([result])}>Экспорт JSON</button></> : <p role='status'>Загружаем результат…</p>}</main>;
}
