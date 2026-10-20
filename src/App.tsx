import { useState } from 'react';
import { TrainingView } from './components/TrainingView';
import { HeroCarousel } from './components/HeroCarousel';
import { labels } from './exercises/types';
import type { ExerciseType, InputMode } from './exercises/types';
import './style.css';
import { HistoryView } from './components/HistoryView';


export default function App() {
  const [exercise, setExercise] = useState<ExerciseType>('squat');
  const [mode, setMode] = useState<InputMode>('camera');
  const [page, setPage] = useState<'home' | 'training' | 'history'>('home');
  
  return (
    <div className='app-shell'>
      <header className='site-header'>
        <button
          className='brand'
          onClick={() => setPage('home')}
          aria-label='PlayFit Vision — главная'
        >
          <span className='brand-icon'>✳</span>
          <span>
            Play<span className='brand-light'>Fit</span>
            <span className='brand-accent'> Vision</span>
          </span>
        </button>
        <nav>
          <span className='nav-indicator'>● &nbsp; ВСЁ РАБОТАЕТ ЛОКАЛЬНО</span>
          <button className='nav-link' onClick={() => setPage('home')}>
            Главная ↗
          </button>
          <button className='nav-link' onClick={() => setPage('history')}>История ↗</button>
        </nav>
      </header>
      {page === 'history' ? <HistoryView onHome={() => setPage('home')} /> : page === 'training' ? (
        <TrainingView
          key={`${exercise}-${mode}`}
          exercise={exercise}
          mode={mode}
          onHome={() => setPage('home')}
        />
      ) : (
        <main className='home page-enter'>
          <HeroCarousel />
          <section className='feature-strip' aria-label='Возможности'>
            <div>
              <span className='feature-number'>01</span>
              <strong>Видит движение</strong>
              <p>AI распознаёт ключевые точки тела в реальном времени.</p>
            </div>
            <div>
              <span className='feature-number'>02</span>
              <strong>Считает за тебя</strong>
              <p>Каждое полное повторение автоматически попадает в счётчик.</p>
            </div>
            <div>
              <span className='feature-number'>03</span>
              <strong>Помогает расти</strong>
              <p>Советы по технике и сводка после тренировки.</p>
            </div>
          </section>
          <section id='setup' className='setup'>
            <div className='setup-heading'>
              <span className='eyebrow'>НАСТРОЙ ТРЕНИРОВКУ</span>
              <h2>
                С чего начнём<span className='accent'>?</span>
              </h2>
              <p>
                Выбери упражнение и способ тренировки. Остальное мы настроим.
              </p>
            </div>
            <div className='setup-form'>
              <div className='field-head'>
                <span>01 / УПРАЖНЕНИЕ</span>
                <small>Выбери одно</small>
              </div>
              <div className='choice-grid'>
                <button
                  className={`exercise-choice ${exercise === 'squat' ? 'selected' : ''}`}
                  onClick={() => setExercise('squat')}
                >
                  <span
                    className='exercise-glyph glyph-squat'
                    aria-hidden='true'
                  >
                    <svg viewBox='0 0 40 40' fill='none'>
                      <path
                        d='M13 7v11l7 6 7-6V7M10 33l10-9 10 9'
                        stroke='currentColor'
                        strokeWidth='3.2'
                        strokeLinecap='round'
                        strokeLinejoin='round'
                      />
                    </svg>
                  </span>
                  <span>
                    <strong>Приседания</strong>
                    <small>Ноги · корпус · баланс</small>
                  </span>
                  <span className='choice-arrow'>↗</span>
                </button>
                <button
                  className={`exercise-choice ${exercise === 'pushup' ? 'selected' : ''}`}
                  onClick={() => setExercise('pushup')}
                >
                  <span className='exercise-glyph glyph-push'>↔</span>
                  <span>
                    <strong>Отжимания</strong>
                    <small>Руки · плечи · корпус</small>
                  </span>
                  <span className='choice-arrow'>↗</span>
                </button>
              </div>
              <div className='field-head mode-head'>
                <span>02 / ФОРМАТ</span>
                <small>Как будем заниматься?</small>
              </div>
              <div className='mode-grid'>
                <button
                  className={`mode-choice ${mode === 'camera' ? 'mode-selected' : ''}`}
                  onClick={() => setMode('camera')}
                >
                  <span>◉</span>
                  <strong>Камера</strong>
                  <small>Тренировка в реальном времени</small>
                </button>
                <button
                  className={`mode-choice ${mode === 'demo' ? 'mode-selected' : ''}`}
                  onClick={() => setMode('demo')}
                >
                  <span>✳</span>
                  <strong>Демо</strong>
                  <small>Посмотреть без камеры</small>
                </button>
                <button
                  className={`mode-choice ${mode === 'video' ? 'mode-selected' : ''}`}
                  onClick={() => setMode('video')}
                >
                  <span>▷</span>
                  <strong>Видеофайл</strong>
                  <small>Анализ готовой записи</small>
                </button>
              </div>
              <button
                className='button button-primary setup-go'
                onClick={() => {
                  setPage('training');
                  window.scrollTo(0, 0);
                }}
              >
                Начать · {labels[exercise]} <span>↗</span>
              </button>
            </div>
          </section>
          <footer>
            <span>✳ &nbsp; PlayFit Vision</span>
            <span>УЧЕБНЫЙ ПРОЕКТ · АНАЛИЗ НА УСТРОЙСТВЕ</span>
          </footer>
        </main>
      )}
    </div>
  );
}
