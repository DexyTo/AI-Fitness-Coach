import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { Leaderboard, PublicParticipant, RankedParticipant } from '../../shared/leaderboard';
import { api, messageOf } from '../account/api';
import { useAccount } from '../account/context';
import { Avatar } from '../account/AccountViews';
import { Icon } from '../components/Icon';

const date = (value: string) => new Date(value).toLocaleDateString('ru-RU', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'long', year: 'numeric' });
function ParticipantRow({ row, own = false }: { row: RankedParticipant; own?: boolean }) {
  return <div className={`ranking-row ${own ? 'ranking-own' : ''}`}>
    <strong className='ranking-place' aria-label={`Место ${row.rank}`}>{row.rank}</strong>
    <Link className='ranking-person' to={`/participants/${encodeURIComponent(row.id)}`}><Avatar name={row.avatar}/><span><strong>{row.nickname}{own && <small> · ты</small>}</strong><small>Уровень {row.level}{row.isDemo && ' · Учебный участник'}</small></span></Link>
    <strong className='ranking-points'>{row.points}<small>очков</small></strong>
  </div>;
}
export function LeaderboardPage() {
  const { user } = useAccount();
  const [params, setParams] = useSearchParams();
  const period = params.get('period') === 'all' ? 'all' : 'week', mode = params.get('mode') === 'demo' ? 'demo' : 'regular';
  const offset = /^(0|[1-9][0-9]{0,6})$/.test(params.get('offset') ?? '') ? Number(params.get('offset')) : 0;
  const [data, setData] = useState<Leaderboard | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setData(null); setError('');
    void api<Leaderboard>(`/leaderboard?period=${period}&mode=${mode}&offset=${offset}`, { userId: user?.id, signal: abort.signal }).then(value => { if (!abort.signal.aborted) setData(value); }).catch(e => { if (!abort.signal.aborted) setError(messageOf(e)); });
    return () => abort.abort();
  }, [period, mode, offset, user?.id, retry]);
  const change = (next: { period?: string; mode?: string; offset?: number }) => setParams({ period: next.period ?? period, mode: next.mode ?? mode, offset: String(next.offset ?? 0) });
  return <main className='program-page ranking-page page-enter'>
    <div className='page-heading'><div><span className='eyebrow'>ОБЩИЙ ЗАЧЁТ</span><h1>Рейтинг участников<span className='accent'>.</span></h1><p className='muted'>Место по очкам испытаний и дуэлей. Опыт XP растит уровень отдельно.</p></div><Link className='button button-primary' to='/competitions'>К соревнованиям <Icon name='arrow'/></Link></div>
    <div className='ranking-filters'><fieldset><legend>Участники</legend><button className='button' aria-pressed={mode === 'regular'} onClick={() => change({ mode: 'regular' })}>Обычный рейтинг</button><button className='button' aria-pressed={mode === 'demo'} onClick={() => change({ mode: 'demo' })}>Учебные участники</button></fieldset><fieldset><legend>Период</legend><button className='button' aria-pressed={period === 'week'} onClick={() => change({ period: 'week' })}>Эта неделя</button><button className='button' aria-pressed={period === 'all'} onClick={() => change({ period: 'all' })}>Всё время</button></fieldset></div>
    {mode === 'demo' && <aside className='local-note demo-note'><Icon name='shield'/><p><strong>Вымышленные данные для показа платформы.</strong> Эти участники и результаты созданы учебным наполнением, без упражнений. Обычные аккаунты считают очки отдельно. Синтетическое демо тренировки показывает движения и не начисляет наград.</p></aside>}
    {error ? <div className='storage-error' role='alert'>{error} <button className='button' onClick={() => setRetry(n => n + 1)}>Повторить</button></div> : !data ? <p role='status'>Загружаем рейтинг…</p> : <>
      <p className='challenge-period'>{data.startsAt && data.endsAt ? `${date(data.startsAt)} — ${date(new Date(Date.parse(data.endsAt) - 1).toISOString())}` : 'За всё время'}<small>Europe/Kyiv · {data.total} участников с очками</small></p>
      <section aria-label='Твоё место' className='ranking-personal'>{data.me ? <><h2>Твоё место</h2><ParticipantRow row={data.me} own/></> : <p className='muted'>{!user ? <><Link to='/login'>Войди</Link>, чтобы видеть своё место.</> : Boolean(user.isDemo) !== (mode === 'demo') ? 'Твой аккаунт участвует в другом режиме рейтинга. Переключи участников выше.' : 'У тебя пока нет соревновательных очков за этот период. Выполни испытание или дуэль.'}</p>}</section>
      {data.total === 0 ? <section className='empty-state'><h2>Здесь начинается движение</h2><p>{mode === 'demo' ? 'Учебное наполнение пока не добавлено.' : 'За этот период очков пока нет. Первые результаты появятся после испытаний и дуэлей.'}</p><Link className='button' to='/competitions'>Открыть соревнования</Link></section> : <section aria-label='Таблица рейтинга'><div className='ranking-head'><span>Место</span><span>Участник</span><span>Очки</span></div><ol className='ranking-list'>{data.rows.map(row => <li key={row.id}><ParticipantRow row={row} own={row.id === user?.id}/></li>)}</ol>{data.rows.length === 0 && <p>На этой странице участников нет. Вернись к началу рейтинга.</p>}<nav className='account-actions ranking-pagination' aria-label='Страницы рейтинга'><button className='button' disabled={offset === 0} onClick={() => change({ offset: Math.max(0, offset - 10) })}>Назад</button><span>{data.rows.length ? `${offset + 1}–${offset + data.rows.length}` : '0'} из {data.total}</span><button className='button' disabled={offset + data.limit >= data.total} onClick={() => change({ offset: offset + 10 })}>Далее</button>{offset > 0 && <button className='button button-ghost' onClick={() => change({ offset: 0 })}>В начало</button>}</nav></section>}
    </>}
    <details className='duel-rules'><summary>Как считаются места</summary><p>Только соревновательные очки из журнала наград испытаний и дуэлей. При равенстве место общее; следующее пропускается: 1, 2, 2, 4. Внутри равного места порядок стабилен по ID участника. В недельный зачёт входят начисления с понедельника 00:00 до следующего понедельника 00:00 по Europe/Kyiv. Учитывается зафиксированное время события.</p></details>
  </main>;
}
const outcomes: Record<string, string> = { completed: 'Выполнено', win: 'Победа', loss: 'Поражение', draw: 'Ничья', expired: 'Срок истёк' };
export function PublicParticipantPage() {
  const { id } = useParams();
  const [data, setData] = useState<PublicParticipant | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setData(null); setError('');
    void api<{ participant: PublicParticipant }>(`/participants/${encodeURIComponent(id ?? '')}`, { signal: abort.signal }).then(value => { if (!abort.signal.aborted) setData(value.participant); }).catch(e => { if (!abort.signal.aborted) setError(messageOf(e)); });
    return () => abort.abort();
  }, [id, retry]);
  return <main className='program-page page-enter'><Link className='button button-ghost' to={data?.isDemo ? '/leaderboard?mode=demo' : '/leaderboard'}>К рейтингу</Link>{error ? <div role='alert' className='storage-error'>{error} <button className='button' onClick={() => setRetry(n => n + 1)}>Повторить</button></div> : !data ? <p role='status'>Загружаем участника…</p> : <>
    <div className='public-identity'><Avatar name={data.avatar}/><div><span className='eyebrow'>ПУБЛИЧНЫЙ ПРОФИЛЬ</span><h1>{data.nickname}<span className='accent'>.</span></h1><p className='muted'>Уровень {data.level} · {data.points} соревновательных очков</p></div></div>
    {data.isDemo && <p className='local-note'>Учебный участник. Аккаунт и события вымышлены; очки входят только в учебный рейтинг.</p>}
    <section className='achievement-section'><h2>Открытые достижения</h2>{!data.achievements.length ? <p className='muted'>Открытых достижений пока нет.</p> : <ul className='public-achievements'>{data.achievements.map(a => <li key={a.id}><Icon name='star'/><span>{a.title}<small>{date(a.earnedAt)}</small></span></li>)}</ul>}</section>
    <section className='achievement-section'><h2>Последние соревновательные награды</h2><p className='muted'>До 10 событий с начисленными очками.</p>{!data.results.length ? <p className='muted'>Соревновательных наград пока нет.</p> : <ul className='public-results'>{data.results.map((r, i) => <li key={i}><div><strong>{r.title}</strong><p className='muted'>{outcomes[r.outcome] ?? r.outcome} · {date(r.eventAt)}</p></div><strong className='accent'>+{r.points} очков</strong></li>)}</ul>}</section>
  </>}</main>;
}
