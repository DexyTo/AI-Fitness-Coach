import { Link } from 'react-router-dom';
import type { ChallengeView } from '../../shared/challenges';
import { Icon } from '../components/Icon';

export const dates = (date: string) => new Date(date).toLocaleString('ru-RU', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const states = { upcoming: 'Скоро старт', active: 'Идёт сейчас', completed: 'Цель выполнена', expired: 'Срок истёк' };
export function ChallengeProgress({ item }: { item: ChallengeView }) {
  return <div className='challenge-progress'><div><span>{item.participation ? 'Твой прогресс' : 'Цель'}</span><strong>{item.participation?.progress ?? 0} / {item.definition.target}</strong></div><progress aria-label={`Прогресс: ${item.definition.title}`} value={item.participation?.progress ?? 0} max={item.definition.target}/><small>{item.definition.type === 'program' ? 'Полностью выполненная программа' : 'Полностью выполненные тренировки по принятому плану'}</small></div>;
}
export function ChallengeCard({ item }: { item: ChallengeView }) {
  const d = item.definition;
  return <article className={`program-card challenge-card challenge-${item.state}`}><div className='program-card-top'><span className='exercise-glyph'><Icon name={item.state === 'completed' ? 'check' : 'flag'}/></span><span className='mode-badge'>{states[item.state]}</span></div><span className='eyebrow'>УЧЕБНОЕ ИСПЫТАНИЕ · {d.type === 'program' ? 'ПРОГРАММА' : `${d.target} ТРЕНИРОВКИ`}</span><h2>{d.title}</h2><p>{d.description}</p><p className='challenge-period'><time dateTime={d.startsAt}>{dates(d.startsAt)}</time> — <time dateTime={d.endsAt}>{dates(d.endsAt)}</time></p><ChallengeProgress item={item}/><div className='challenge-prize'><Icon name='star'/><strong>{d.reward.xp} XP</strong><span>+ {d.reward.points} соревновательных очков</span></div><p className='muted'>Участников: {item.participantCount}</p><Link className='button button-primary' to={`/competitions/challenges/${encodeURIComponent(d.id)}`}>{item.state === 'completed' || item.state === 'expired' ? 'Посмотреть итог' : item.participation ? 'Продолжить испытание' : 'Задача и условия'} <Icon name='arrow'/></Link></article>;
}
export function ActiveChallenges({ items }: { items: ChallengeView[] }) {
  return <section className='active-challenges'><div className='builder-heading'><div><span className='eyebrow'>ТВОИ ЗАДАНИЯ</span><h2>Активные испытания</h2></div><Link className='button button-ghost' to='/competitions'>Все испытания <Icon name='arrow'/></Link></div>{items.length ? <div className='program-grid'>{items.map(item => <ChallengeCard key={item.definition.id} item={item}/>)}</div> : <p className='muted'>Пока нет активных заданий. Выбери испытание и вступи явно — прежние тренировки не засчитываются.</p>}</section>;
}
