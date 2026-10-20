import { useEffect } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { TrainingView } from './components/TrainingView';
import { HeroCarousel } from './components/HeroCarousel';
import { HistoryView } from './components/HistoryView';
import { Icon } from './components/Icon';
import { useAccount } from './account/context';
import { AuthView, ProfileView, Avatar } from './account/AccountViews';
import { AccountHistoryView, AccountHistoryDetail } from './account/AccountHistory';
import { labels } from './exercises/types';
import type { ExerciseType, InputMode } from './exercises/types';
import { readSelection, selectionSearch } from './routing/selection';
import './style.css';
import { ProgramCatalog, ProgramDetails } from './programs/ProgramViews';
import { ProgramEditor } from './programs/ProgramEditor';
import { OverviewView } from './account/ProgressionViews';

export default function App() {
  const { user } = useAccount();
  const location = useLocation();
  const routerNavigate = useNavigate();
  const { exercise, mode } = readSelection(location.search);
  const search = selectionSearch({ exercise, mode });
  const navigate = (next: 'home' | 'training' | 'history', nextMode = mode) => {
    void routerNavigate({ pathname: next === 'home' ? '/' : `/${next}`, search: selectionSearch({ exercise, mode: nextMode }) });
  };
  const setExercise = (value: ExerciseType) => { void routerNavigate({ search: selectionSearch({ exercise: value, mode }) }, { replace: true }); };
  const setMode = (value: InputMode) => { void routerNavigate({ search: selectionSearch({ exercise, mode: value }) }, { replace: true }); };
  useEffect(() => {
    // Invalid, duplicate and unknown parameters never reach the training runtime.
    if (['/', '/training', '/history'].includes(location.pathname) && location.search !== search) {
      void routerNavigate({ pathname: location.pathname, search, hash: location.hash }, { replace: true });
    }
  }, [location.pathname, location.search, location.hash, search, routerNavigate]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [location.pathname]);
  return <div className='app-shell'>
    <a className='skip-link' href='#main-content'>Перейти к содержимому</a>
    <header className='site-header'>
      <Link className='brand' to={{ pathname: '/', search }} aria-label='PlayFit Vision — главная'><span className='brand-icon' aria-hidden='true'>✳</span><span>PlayFit<span className='brand-accent'> Vision</span></span></Link>
      <nav aria-label='Основная навигация'>
        {user && <NavLink className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to='/overview'>Обзор</NavLink>}
        <NavLink end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to={{ pathname: '/', search }}>Тренировки</NavLink>
        <NavLink className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to='/programs'>Программы</NavLink>
        <NavLink className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} to={{ pathname: '/history', search }}><Icon name='history' />История</NavLink>
      </nav>
      <Link className='account-nav' to={user ? '/profile' : '/login'}>{user ? <><Avatar name={user.avatar} /><span>{user.nickname}</span></> : <><Icon name='shield' /><span>Войти</span></>}</Link>
    </header>
    <div id='main-content' tabIndex={-1}>
    <Routes>
    <Route path='/login' element={<AuthView key='login' />} />
    <Route path='/register' element={<AuthView key='register' register />} />
    <Route path='/profile' element={<ProfileView key={user?.id} />} />
    <Route path='/overview' element={<OverviewView key={user?.id} />} />
    <Route path='/programs' element={<ProgramCatalog />} />
    <Route path='/my-programs' element={<ProgramCatalog key='mine' scope='mine' />} />
    <Route path='/favorites' element={<ProgramCatalog key='favorites' scope='favorites' />} />
    <Route path='/programs/new' element={<ProgramEditor key='new' />} />
    <Route path='/programs/:id/edit' element={<ProgramEditor key={location.pathname} />} />
    <Route path='/programs/:id' element={<ProgramDetails key={location.pathname} />} />
    <Route path='/history' element={user ? <AccountHistoryView user={user} onHome={() => navigate('home')} /> : <HistoryView onHome={() => navigate('home')} />} />
    <Route path='/history/:id' element={<AccountHistoryDetail />} />
    <Route path='/training' element={<TrainingView key={`${exercise}-${mode}`} exercise={exercise} mode={mode} onHome={() => navigate('home')} />} />
    <Route path='/' element={<main className='home page-enter'>
      <HeroCarousel onDemo={() => navigate('training', 'demo')} />
      <div className='home-benefits'><span><Icon name='camera' /> Камера вместо датчиков</span><span><Icon name='activity' /> Повторы и подсказки</span><span><Icon name='shield' /> Без загрузки видео на сервер</span></div>
      <section id='setup' className='setup' aria-labelledby='setup-title'>
        <div className='setup-heading'><span className='eyebrow'>СЛЕДУЮЩИЙ ПОДХОД</span><h2 id='setup-title'>Начни с <br />одного движения<span className='accent'>.</span></h2><p>Два упражнения. Три способа начать.<br />Выбери то, что подходит тебе сейчас.</p><div className='setup-note'><Icon name='camera' /><p>Для камеры понадобится немного места и всё тело в кадре. С ракурсом поможем перед стартом.</p></div></div>
        <div className='setup-form'>
          <div className='field-head'><span><b>01</b> Выбери упражнение</span><small>Без дополнительного веса</small></div>
          <div className='choice-grid'>{(['squat', 'pushup'] as const).map(type => <button key={type} className={`exercise-choice ${exercise === type ? 'selected' : ''}`} aria-pressed={exercise === type} onClick={() => setExercise(type)}><span className='exercise-glyph'><Icon name={type} /></span><span><strong>{labels[type]}</strong><small>{type === 'squat' ? 'Ноги и корпус' : 'Руки и корпус'}</small></span><span className='selection-mark'>{exercise === type && <Icon name='check' />}</span></button>)}</div>
          <div className='field-head mode-head'><span><b>02</b> Выбери формат</span></div>
          <div className='mode-grid'>{([{ id: 'camera', icon: 'camera', title: 'Камера', text: 'В реальном времени' }, { id: 'demo', icon: 'play', title: 'Демо', text: 'Без доступа к камере' }, { id: 'video', icon: 'video', title: 'Видеофайл', text: 'Своя запись' }] as const).map(item => <button key={item.id} className={`mode-choice ${mode === item.id ? 'mode-selected' : ''}`} aria-pressed={mode === item.id} onClick={() => setMode(item.id)}><Icon name={item.icon} /><strong>{item.title}</strong><small>{item.text}</small></button>)}</div>
          <button className='button button-primary setup-go' onClick={() => navigate('training')}>К настройке тренировки <Icon name='arrow' /></button>
          <p className='setup-footnote'>Дальше — твоя цель и подготовка к первому подходу.</p>
        </div>
      </section>
      <footer><span className='footer-brand'>PlayFit Vision<span>Движение начинается с тебя.</span></span><span>Учебный проект · Анализ на устройстве</span></footer>
    </main>} />
    <Route path='*' element={<main className='history-page page-enter'><section className='empty-state'><span className='eyebrow'>404</span><h1>Страница не найдена<span className='accent'>.</span></h1><p>Проверь адрес или выбери тренировку на главной.</p><Link className='button button-primary' to={{ pathname: '/', search }}>На главную <Icon name='arrow' /></Link></section></main>} />
    </Routes>
    </div>
  </div>;
}
