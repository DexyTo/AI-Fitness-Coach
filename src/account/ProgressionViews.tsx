import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import type { Progression, RewardReceipt } from '../../shared/progression';
import { rewardMessages } from '../../shared/progression';
import { isProgram } from '../../shared/program';
import { api, messageOf, type AccountResult } from './api';
import { useAccount } from './context';
import { Icon } from '../components/Icon';
import { labels } from '../exercises/types';
import { ProfileFavorites } from '../programs/ProgramLibrary';
import type { ChallengeView } from '../../shared/challenges';
import { challengeMessages } from '../../shared/challenges';
import { ActiveChallenges } from '../challenges/ChallengeCards';

export function RewardNotice({ reward, guest = false }: { reward?: RewardReceipt | null; guest?: boolean }) {
  if (!reward && !guest) return null;
  return <section className={`reward-notice ${reward?.xp ? 'reward-earned' : ''}`} aria-label='Награда за тренировку' role='status'><Icon name={reward?.xp ? 'star' : 'activity'} /><div><strong>{guest ? 'Гостевая тренировка' : reward?.xp ? `+${reward.xp} XP` : 'Без XP за эту тренировку'}</strong><p>{guest ? 'Гостевые результаты не дают XP и достижения. Войди до начала новой камерной тренировки.' : reward && rewardMessages[reward.reason]}</p>{!!reward?.achievements.length && <p className='accent'>Новые достижения: {reward.achievements.join(', ')}.</p>}{reward?.challenge && <div className='challenge-result'><strong>{reward.challenge.title}</strong><p>{challengeMessages[reward.challenge.reason]}</p><p>Прогресс испытания: {reward.challenge.progress}/{reward.challenge.target}</p>{reward.challenge.reason === 'completed' && <p className='accent'>Награда испытания: +{reward.challenge.xp} XP · +{reward.challenge.points} соревновательных очков</p>}<Link to='/competitions'>К испытаниям <Icon name='arrow'/></Link></div>}{!guest && <Link to='/overview'>Мой прогресс <Icon name='arrow'/></Link>}</div></section>;
}
export function LevelCard({ data }: { data: Progression }) {
  return <section className='level-card'><div className='level-top'><span className='eyebrow'>ТВОЙ УРОВЕНЬ</span><Icon name='star'/></div><div className='level-value'><strong>{data.level}</strong><div><b>{data.xp} XP</b><span>накоплено за всё время</span><span>Из испытаний: {data.challengeXp} XP</span><span>{data.competitionPoints} соревновательных очков</span></div></div><label className='xp-label'>До уровня {data.level + 1}<span>{data.levelXp} / {data.nextLevelXp} XP</span><progress aria-label='Прогресс до следующего уровня' value={data.levelXp} max={data.nextLevelXp}/></label><p>Ещё {data.nextLevelXp-data.levelXp} XP до следующего уровня.</p><details><summary>Как получить XP</summary><p>+{data.workoutXp} XP за полностью выполненную камерную тренировку аккаунта. Все подходы и шаги должны достичь цели полных повторов. За тренировки максимум {data.dailyLimit} XP в день по {data.timeZone}; сегодня {data.todayXp}/{data.dailyLimit} XP. Бонус испытания — отдельная фиксированная награда сверх этого предела, один раз за участие. Каждые {data.nextLevelXp} XP — новый уровень.</p><p>Демо, видео, импорт и прерванные задания не дают XP и достижения. Повторы сверх цели и скорость не увеличивают награду. После дневного предела выполненные задания продолжают прогресс достижений. Это правила учёта результатов, а не подтверждение точности распознавания.</p></details></section>;
}
export function AchievementCollection({ data }: { data: Progression }) {
  const earned = data.achievements.filter(a => a.earnedAt).length;
  return <section className='achievement-section'><div className='builder-heading'><div><span className='eyebrow'>КОЛЛЕКЦИЯ ДВИЖЕНИЯ</span><h2>Достижения <span className='count-badge'>{earned}/{data.achievements.length}</span></h2></div></div><p className='muted'>Только новые выполненные камерные задания аккаунта. Каждый значок выдаётся один раз, без бонусных XP.</p><div className='achievement-grid'>{data.achievements.map(a => <article className={`achievement-card ${a.earnedAt ? 'is-earned' : ''}`} key={a.id}><span className='achievement-icon'><Icon name={a.earnedAt ? 'star' : 'activity'}/></span><span className='eyebrow'>{a.earnedAt ? 'ПОЛУЧЕНО' : 'ВПЕРЕДИ'}</span><h3>{a.title}</h3><p>{a.description}</p><progress aria-label={a.title} value={a.progress} max={a.target}/><small>{a.progress} / {a.target}{a.earnedAt ? ` · ${new Date(a.earnedAt).toLocaleDateString('ru-RU',{timeZone:data.timeZone})}` : ''}</small><details><summary>Награда</summary><p>{a.reward}</p></details></article>)}</div></section>;
}
export function ProfileProgression() {
  const { user } = useAccount();
  const [data,setData] = useState<Progression|null>(null), [error,setError] = useState(''), [retry,setRetry] = useState(0);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController(); setData(null); setError('');
    void api<{progression:Progression}>('/me/progression',{userId:user.id,signal:controller.signal}).then(r => {if(!controller.signal.aborted)setData(r.progression);}).catch(e => {if(!controller.signal.aborted)setError(messageOf(e));});
    return () => controller.abort();
  },[user?.id,retry]);
  return error ? <p className='storage-error' role='alert'>{error} <button className='button' onClick={()=>setRetry(v=>v+1)}>Повторить загрузку прогресса</button></p> : data ? <><LevelCard data={data}/><AchievementCollection data={data}/></> : <p role='status'>Загружаем прогресс…</p>;
}
export function ProfileChallenges() {
  const {user} = useAccount();
  const [items,setItems] = useState<ChallengeView[]|null>(null),[error,setError] = useState(''),[retry,setRetry] = useState(0);
  useEffect(()=>{
    if(!user)return;
    const abort = new AbortController();setItems(null);setError('');
    void api<{challenges:ChallengeView[]}>('/challenges?filter=mine',{userId:user.id,signal:abort.signal}).then(r=>{if(!abort.signal.aborted)setItems(r.challenges.filter(c=>c.state==='active'));}).catch(e=>{if(!abort.signal.aborted)setError(messageOf(e));});
    return ()=>abort.abort();
  },[user?.id,retry]);
  return error ? <p className='storage-error' role='alert'>{error}<button className='button' onClick={()=>setRetry(v=>v+1)}>Повторить загрузку испытаний</button></p> : items ? <ActiveChallenges items={items}/> : <p role='status'>Загружаем испытания…</p>;
}
export function OverviewView() {
  const { user } = useAccount();
  const [data,setData] = useState<{progression:Progression;recent:AccountResult[];challenges:ChallengeView[]}|null>(null), [error,setError] = useState(''), [retry,setRetry] = useState(0);
  useEffect(() => {
    if(!user)return;
    const controller = new AbortController(); setData(null); setError('');
    void api<{progression:Progression;recent:AccountResult[];challenges:ChallengeView[]}>('/me/overview',{userId:user.id,signal:controller.signal}).then(r=>{if(!controller.signal.aborted)setData(r);}).catch(e=>{if(!controller.signal.aborted)setError(messageOf(e));});
    return ()=>controller.abort();
  },[user?.id,retry]);
  if(!user)return <Navigate to='/login' replace/>;
  return <main className='profile-page overview-page page-enter'><div className='page-heading'><div><span className='eyebrow'>ПЕРСОНАЛЬНЫЙ ОБЗОР</span><h1>Твой следующий шаг<span className='accent'>.</span></h1><p className='muted'>{user.nickname}, здесь складывается твоя история движения.</p></div><Link className='button button-primary' to='/'>Новая тренировка <Icon name='arrow'/></Link></div>{error?<p className='storage-error' role='alert'>{error} <button className='button' onClick={()=>setRetry(v=>v+1)}>Повторить</button></p>:!data?<p role='status'>Загружаем твой обзор…</p>:<><div className='overview-grid'><LevelCard data={data.progression}/><section className='activity-card'><span className='eyebrow'>ПОСЛЕДНИЕ 7 ДНЕЙ · EUROPE/KYIV</span><h2>Каждый день — новый шаг</h2><div className='activity-days'>{data.progression.activity.map(day=><div key={day.day} className={day.workouts?'has-activity':''}><strong>{day.workouts}</strong><time dateTime={day.day}>{new Date(`${day.day}T12:00:00Z`).toLocaleDateString('ru-RU',{day:'numeric',month:'short',timeZone:'UTC'})}</time></div>)}</div><p className='muted'>Выполненные камерные задания. Ноль означает, что в этот день нет зачтённых тренировок.</p><div className='profile-stats'><div><strong>{data.progression.stats.workouts}</strong><span>Тренировок всего</span></div><div><strong>{data.progression.stats.days}</strong><span>Разных дней</span></div><div><strong>{data.progression.stats.reps}</strong><span>Повторов в пределах целей</span></div></div></section></div><section className='recent-workouts'><div className='builder-heading'><h2>Последние тренировки</h2><Link className='button button-ghost' to='/history'>История <Icon name='arrow'/></Link></div>{data.recent.length?<ul>{data.recent.map(r=><li key={r.id}><div><Link to={`/history/${r.id}`}>{isProgram(r.record)?r.record.program.title:labels[r.record.exercise]} <Icon name='arrow'/></Link><p className='muted'>{new Date(r.createdAt).toLocaleString('ru-RU',{timeZone:data.progression.timeZone})} · {r.source==='historical_import'?'Импорт':r.record.mode==='demo'?'Синтетическое демо':r.record.mode==='video'?'Видеофайл':'Камера'}</p></div><span className={r.reward?.xp?'accent':'muted'}>{r.reward?.xp?`+${r.reward.xp} XP`:'Без XP'}</span></li>)}</ul>:<p className='muted'>Здесь появятся сохранённые результаты. Выбери упражнение или <Link to='/programs'>готовую программу</Link>.</p>}</section><ActiveChallenges items={data.challenges}/><ProfileFavorites/><AchievementCollection data={data.progression}/><p className='fine-print'>Архивирование скрывает запись из истории, но сохраняет XP, достижения и факты активности. Незавершённые запуски после обновления не восстанавливаются.</p></>}</main>;
}
