import { useState, type FormEvent } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAccount } from '../account/context';
import { Avatar } from '../account/AccountViews';
import { Icon } from './Icon';

export function AppNavigation({ search }: { search: string }) {
  const { user } = useAccount();
  return <><aside className='app-sidebar'><Link className='brand' to={{ pathname: '/', search }}><span className='brand-icon'>✳</span><span>PlayFit<span className='brand-accent'> Vision</span></span></Link><span className='sidebar-caption'>ТВОЁ ДВИЖЕНИЕ</span>
    <nav aria-label='Основная навигация'>
      <NavLink end to={{ pathname: '/', search }}><Icon name='home' />Главная</NavLink><NavLink to='/exercises'><Icon name='squat' />Упражнения</NavLink><NavLink to='/programs'><Icon name='video' />Программы</NavLink><NavLink to={{ pathname: '/history', search }}><Icon name='history' />История</NavLink><NavLink to='/progress'><Icon name='activity' />Мой прогресс</NavLink><NavLink to={user ? '/profile' : '/login'}><Icon name='user' />{user ? 'Профиль' : 'Войти в аккаунт'}</NavLink>
      <span className='sidebar-caption'>БОЛЬШЕ МОТИВАЦИИ</span><NavLink to='/competitions'><Icon name='flag' />Соревнования</NavLink><NavLink to='/leaderboard'><Icon name='star' />Рейтинг</NavLink>{user && <NavLink to='/overview'><Icon name='shield' />XP и достижения</NavLink>}
    </nav><div className='sidebar-bottom'><NavLink to='/settings'><Icon name='settings' />Настройки</NavLink><p>Небольшой шаг сегодня.<br />Больше возможностей завтра.</p><span>PLAYFIT VISION · УЧЕБНЫЙ ПРОЕКТ</span></div></aside>
    <nav className='mobile-navigation' aria-label='Нижняя навигация'><NavLink end to={{ pathname: '/', search }}><Icon name='home' /><span>Главная</span></NavLink><NavLink to='/exercises'><Icon name='squat' /><span>Упражнения</span></NavLink><NavLink to='/programs'><Icon name='video' /><span>Программы</span></NavLink><NavLink to={{ pathname: '/history', search }}><Icon name='history' /><span>История</span></NavLink><NavLink to={user ? '/profile' : '/login'}><Icon name='user' /><span>Профиль</span></NavLink></nav></>;
}
export function TopBar() {
  const { user } = useAccount(), navigate = useNavigate();
  const [query, setQuery] = useState(''), [open, setOpen] = useState(false);
  const submit = (e: FormEvent) => { e.preventDefault(); void navigate(`/exercises${query ? `?q=${encodeURIComponent(query)}` : ''}`); };
  return <header className='app-topbar'><Link className='mobile-brand brand' to='/'><span className='brand-icon'>✳</span><span>PlayFit<span className='brand-accent'> Vision</span></span></Link><form className='top-search' onSubmit={submit}><Icon name='search' /><input aria-label='Поиск упражнений' placeholder='Найти упражнение…' value={query} onChange={e => setQuery(e.target.value)} /><button type='submit' aria-label='Найти'><Icon name='arrow' /></button></form><div className='topbar-actions'><div className='notification-control'><button className='icon-button' aria-label='Информация о тренировках' aria-expanded={open} onClick={() => setOpen(v => !v)}><Icon name='bell' /></button>{open && <div className='notification-popover surface'><b>Твоё пространство движения</b><p>Начни с упражнения или выбери готовую программу.</p><Link to='/settings#help' onClick={() => setOpen(false)}>Помощь и настройки <Icon name='arrow' /></Link></div>}</div><Link className='topbar-account' aria-label={user ? `Профиль ${user.nickname}` : 'Войти в аккаунт'} to={user ? '/profile' : '/login'}>{user ? <><Avatar name={user.avatar} /><span>{user.nickname}</span></> : <><Icon name='user' /><span>Войти</span></>}</Link></div></header>;
}
