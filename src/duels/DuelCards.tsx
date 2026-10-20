import { Link } from 'react-router-dom';
import { duelStates, type DuelView } from '../../shared/duels';
import { Icon } from '../components/Icon';
import { dates } from '../challenges/ChallengeCards';

export function CompetitionTabs({duels=false}:{duels?:boolean}) {
  return <nav className='competition-tabs' aria-label='Разделы соревнований'><Link to='/competitions' aria-current={!duels?'page':undefined}>Испытания</Link><Link to='/competitions/duels' aria-current={duels?'page':undefined}>Дуэли</Link></nav>;
}
export function DuelCard({item}:{item:DuelView}) {
  return <article className='program-card'><div className='program-card-top'><span className='exercise-glyph'><Icon name='flag'/></span><span className='mode-badge'>{duelStates[item.state]}</span></div><h3>{item.task.program.title}</h3><p>{item.participants.map(p=>p.nickname).join(' · ')}{item.participants.length===1?' · ждём соперника':''}</p><p className='muted'>До {dates(item.endsAt)} · Europe/Kyiv</p><Link className='button' to={`/competitions/duels/${item.id}`}>Открыть дуэль <Icon name='arrow'/></Link></article>;
}
export function ActiveDuels({items}:{items:DuelView[]}) {
  return <section className='recent-workouts'><div className='builder-heading'><h2>Дуэли и приглашения <span className='count-badge'>{items.length}</span></h2><Link className='button button-ghost' to='/competitions/duels'>Мои дуэли <Icon name='arrow'/></Link></div>{items.length?<div className='program-grid'>{items.map(item=><DuelCard key={item.id} item={item}/>)}</div>:<p className='muted'>Пригласи соперника или введи его код в разделе дуэлей.</p>}</section>;
}
