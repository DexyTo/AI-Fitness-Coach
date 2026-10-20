import { useState } from 'react';
import { TrainingView } from './components/TrainingView';
import { HeroCarousel } from './components/HeroCarousel';
import { HistoryView } from './components/HistoryView';
import { Icon } from './components/Icon';
import { labels } from './exercises/types';
import type { ExerciseType, InputMode } from './exercises/types';
import './style.css';

export default function App() {
  const [exercise, setExercise] = useState<ExerciseType>('squat');
  const [mode, setMode] = useState<InputMode>('camera');
  const [page, setPage] = useState<'home' | 'training' | 'history'>('home');
  const navigate = (next: typeof page) => { setPage(next); window.scrollTo({ top: 0 }); };
  return <div className='app-shell'>
    <a className='skip-link' href='#main-content'>Перейти к содержимому</a>
    <header className='site-header'>
      <button className='brand' onClick={() => navigate('home')} aria-label='PlayFit Vision — главная'><span className='brand-icon' aria-hidden='true'>✳</span><span>PlayFit<span className='brand-accent'> Vision</span></span></button>
      <nav aria-label='Основная навигация'>
        <button className={`nav-link ${page === 'home' ? 'active' : ''}`} aria-current={page === 'home' ? 'page' : undefined} onClick={() => navigate('home')}>Тренировки</button>
        <button className={`nav-link ${page === 'history' ? 'active' : ''}`} aria-current={page === 'history' ? 'page' : undefined} onClick={() => navigate('history')}><Icon name='history' />История</button>
      </nav>
      <span className='nav-indicator'><span className='small-dot' /> Локально и приватно</span>
    </header>
    <div id='main-content' tabIndex={-1}>
    {page === 'history' ? <HistoryView onHome={() => navigate('home')} /> : page === 'training' ? <TrainingView key={`${exercise}-${mode}`} exercise={exercise} mode={mode} onHome={() => navigate('home')} /> : <main className='home page-enter'>
      <HeroCarousel onDemo={() => { setMode('demo'); navigate('training'); }} />
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
    </main>}
    </div>
  </div>;
}
