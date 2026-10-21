import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ChallengeDetail, ChallengeView } from '../../shared/challenges';
import type { ProgramSnapshot } from '../../shared/program';
import { api, messageOf, ProgramPersistence } from '../account/api';
import { useAccount } from '../account/context';
import { Avatar } from '../account/AccountViews';
import { Icon } from '../components/Icon';
import { labels } from '../exercises/types';
import { ChallengeCard, ChallengeProgress, dates, states } from './ChallengeCards';
import { ProgramRun } from '../programs/ProgramViews';
import { ProgramController } from '../programs/controller';
import { CompetitionTabs } from '../duels/DuelCards';

interface ChallengeResponse { serverNow: string; challenges?: ChallengeView[]; challenge?: ChallengeDetail }
function useChallenges(path: string, enabled = true) {
  const { user } = useAccount();
  const [data, setData] = useState<ChallengeResponse | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController(); let timer: number | undefined;
    setData(null); setError('');
    void api<ChallengeResponse>(path, { userId: user?.id, signal: abort.signal }).then(r => {
      if (abort.signal.aborted) return;
      setData(r);
      const now = Date.parse(r.serverNow);
      const boundaries = (r.challenge ? [r.challenge] : r.challenges ?? []).flatMap(c => [Date.parse(c.definition.startsAt), Date.parse(c.definition.endsAt)]).filter(t => t > now);
      if (boundaries.length) timer = window.setTimeout(() => setRetry(v => v + 1), Math.min(2147483647, Math.min(...boundaries) - now + 100));
    }).catch(e => { if (!abort.signal.aborted) setError(messageOf(e)); });
    return () => { abort.abort(); clearTimeout(timer); };
  }, [path, user?.id, retry, enabled]);
  return { data, error, reload: () => setRetry(v => v + 1) };
}
export function ChallengesPage() {
  const { user } = useAccount();
  const [filter, setFilter] = useState<'available' | 'mine' | 'completed'>('available');
  const { data, error, reload } = useChallenges(`/challenges?filter=${filter}`, filter === 'available' || !!user);
  return <main className='program-page page-enter'><div className='page-heading'><div><span className='eyebrow'>СОРЕВНОВАНИЯ · АСИНХРОННО</span><h1>Брось себе вызов<span className='accent'>.</span></h1><p className='muted'>Выбери цель. Двигайся в своём ритме. Заверши до срока.</p></div><span className='challenge-mark' aria-hidden='true'><Icon name='flag'/></span></div><CompetitionTabs/><div className='account-actions program-tabs' role='group' aria-label='Фильтр испытаний'>{([['available', 'Доступные'], ['mine', 'Мои'], ['completed', 'Завершённые']] as const).map(([id, title]) => <button key={id} className={`button ${filter === id ? 'button-primary' : ''}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{title}</button>)}</div><p className='program-disclaimer'>Учебные задания из двух знакомых движений. Для зачёта — новая тренировка с камерой, запущенная из испытания. Нагрузка — твой выбор.</p>{!user && filter !== 'available' ? <section className='empty-state'><h2>Твои задания — в аккаунте</h2><p>Войди, чтобы участвовать и сохранять прогресс.</p><Link className='button button-primary' to='/login'>Войти</Link></section> : error ? <div className='storage-error' role='alert'>{error}<button className='button' onClick={reload}>Повторить</button></div> : !data ? <p role='status'>Загружаем испытания…</p> : data.challenges?.length ? <div className='program-grid'>{data.challenges.map(c => <ChallengeCard key={c.definition.id} item={c}/>)}</div> : <section className='empty-state'><Icon name='flag'/><h2>{filter === 'completed' ? 'Первая победа ещё впереди' : filter === 'mine' ? 'Выбери свой вызов' : 'Новых испытаний пока нет'}</h2><p>{filter === 'available' ? 'Все доступные задания уже в твоём списке или пока не опубликованы.' : 'Здесь появятся твои задания и их сохранённый прогресс.'}</p><button className='button' onClick={() => filter === 'available' ? setFilter('mine') : setFilter('available')}>{filter === 'available' ? 'Мои испытания' : 'Найти испытание'}</button></section>}</main>;
}
export function ChallengeDetails() {
  const { id } = useParams(), { user } = useAccount();
  const { data, error, reload } = useChallenges(`/challenges/${encodeURIComponent(id ?? '')}`);
  const [actionError, setActionError] = useState(''), [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID()), actionBusy = useRef(false);
  const [run, setRun] = useState<{ controller: ProgramController; persistence: ProgramPersistence; owner: string; title: string; endsAt: string } | null>(null);
  const item = data?.challenge;
  const act = async () => {
    if (!item || !user || actionBusy.current) return;
    actionBusy.current = true; setBusy(true); setActionError('');
    try {
      if (!item.participation) {
        await api(`/challenges/${encodeURIComponent(item.definition.id)}/join`, { method: 'POST', body: { version: item.definition.version }, userId: user.id }); reload();
      } else {
        const r = await api<{ id: string; createdAt: string; snapshot: ProgramSnapshot }>(`/challenge-participations/${item.participation.id}/runs`, { method: 'POST', body: { requestId: requestId.current }, userId: user.id });
        setRun({ controller: new ProgramController(r.snapshot, r.id, r.createdAt, performance.now() - Math.max(0, Date.now() - Date.parse(r.createdAt))), persistence: new ProgramPersistence(user.id), owner: `испытание · аккаунт @${user.login}`, title: item.definition.title, endsAt: item.definition.endsAt });
      }
    } catch (e) { setActionError(messageOf(e)); } finally { actionBusy.current = false; setBusy(false); }
  };
  if (run) return <><section className='challenge-run-context' aria-label='Контекст испытания'><Icon name='flag'/><div><strong>{run.title}</strong><p>Принятый план фиксирован. Зачёт результата строго до {dates(run.endsAt)}.</p></div></section><ProgramRun {...run} restartLabel='Вернуться к испытанию' onRestart={() => { setRun(null); requestId.current = crypto.randomUUID(); reload(); }}/></>;
  return <main className='program-page challenge-detail page-enter'><Link className='button button-ghost' to='/competitions'>← Все испытания</Link>{error ? <div className='storage-error' role='alert'>{error}<button className='button' onClick={reload}>Повторить</button></div> : !item ? <p role='status'>Загружаем задание…</p> : <><span className='eyebrow'>УЧЕБНОЕ ИСПЫТАНИЕ · V{item.definition.version} · {states[item.state]}</span><h1>{item.definition.title}<span className='accent'>.</span></h1><p className='muted'>{item.definition.description}</p><div className='challenge-detail-grid'><section className='account-card challenge-task'><span className='eyebrow'>ТВОЯ ЗАДАЧА</span><h2>{item.definition.type === 'program' ? 'Пройди программу один раз' : `Выполни ${item.definition.target} тренировки по плану`}</h2><p>{item.definition.task.program.title}</p><ol className='challenge-steps'>{item.definition.task.program.steps.map(s => <li key={s.id}><Icon name={s.exercise}/><div><strong>{labels[s.exercise]}</strong><p>{s.goal.sets} × {s.goal.reps} полных повторов · отдых {s.goal.restSeconds} с</p>{s.transitionSeconds > 0 && <small>Переход: {s.transitionSeconds} с</small>}</div></li>)}</ol><details><summary>Правила зачёта</summary><p>Только новый связанный запуск с камерой после вступления. Все шаги и цели каждого подхода должны быть выполнены. Демо, импорт, видеофайлы и прежняя история не подходят.</p><p>Один результат учитывается только в испытании, из которого он запущен. За повторы отправки прогресс и награда не увеличиваются.</p><p>Зачёт — по первому успешному сохранению результата на сервере строго до окончания срока. Начать вовремя недостаточно: отправь результат до дедлайна. Повтор уже сохранённого итога сохраняет прежний зачёт.</p><p>При вступлении план, сроки и награды фиксируются. Изменение исходной программы не меняет твоё задание. Считаются полные повторы; неполные, неоценённые попытки и замечания остаются отдельными показателями.</p><p>Незавершённый запуск после обновления страницы не восстанавливается. Можно создать новый запуск из этого участия.</p></details></section><aside className='account-card challenge-summary'><span className={`mode-badge challenge-${item.state}`}>{states[item.state]}</span><p className='challenge-period'>С {dates(item.definition.startsAt)}<br/>до {dates(item.definition.endsAt)}<small>срок проверяет сервер</small></p><ChallengeProgress item={item}/><div className='challenge-prize'><Icon name='star'/><strong>+{item.definition.reward.xp} XP</strong><span>+{item.definition.reward.points} соревновательных очков</span></div><p className='muted'>Отдельная награда за всё испытание. За саму тренировку — до 20 XP с дневным пределом 60 XP. Бонус испытания начисляется сверх него один раз.</p>{item.state === 'completed' ? <p className='accent' role='status'>Испытание пройдено. Награда получена {dates(item.participation!.completedAt!)}.</p> : item.state === 'expired' ? <p role='status'>Срок истёк. Цель не выполнена, награды за испытание нет.</p> : item.state === 'upcoming' ? <p role='status'>Анонс. Вступить можно после старта.</p> : !user ? <Link className='button button-primary' to='/login'>Войти для участия</Link> : <button className='button button-primary' disabled={busy} onClick={() => void act()}>{busy ? 'Сохраняем…' : item.participation ? 'Начать связанную тренировку' : 'Вступить в испытание'} <Icon name='arrow'/></button>}{actionError && <p role='alert' className='storage-error'>{actionError}<button className='button' onClick={reload}>Обновить условия</button></p>}{item.participation && <p className='fine-print'>Участие с {dates(item.participation.joinedAt)}. До завершения цели награда не выдаётся.</p>}</aside></div><section className='challenge-participants'><h2>Участники <span className='count-badge'>{item.participantCount}</span></h2><p className='muted'>Публичны никнейм, аватар и прогресс этого испытания. Показываем до 50 участников.</p>{item.participants.length ? <ul>{item.participants.map((p, index) => <li key={index}><Avatar name={p.avatar}/><strong>{p.nickname}</strong><span>{p.progress} / {item.definition.target}</span></li>)}</ul> : <p className='muted'>Пока никто не вступил. Здесь появятся только сохранённые участия.</p>}</section></>}</main>;
}
