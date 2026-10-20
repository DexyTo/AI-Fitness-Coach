import { useEffect, useState } from 'react';
import './HeroCarousel.css';

const slides = [
  {
    label: 'ДВИЖЕНИЕ ПОД КОНТРОЛЕМ',
    tag: 'ADVANTAGE / 01',
    headline: 'Видит движения',
    detail: '33 точки тела в каждом кадре',
    kind: 'track',
  },
  {
    label: 'НИ ОДНОГО ЛИШНЕГО ПОВТОРА',
    tag: 'ADVANTAGE / 02',
    headline: 'Считает повторы',
    detail: 'Только полные циклы упражнения',
    kind: 'count',
  },
  {
    label: 'ПОДСКАЗКА В НУЖНЫЙ МОМЕНТ',
    tag: 'ADVANTAGE / 03',
    headline: 'Помогает с техникой',
    detail: 'Обратная связь во время тренировки',
    kind: 'coach',
  },
] as const;

export function HeroCarousel() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(
      () => setActive((index) => (index + 1) % slides.length),
      8000,
    );
    return () => window.clearInterval(timer);
  }, [active]);
  const slide = slides[active];
  const go = (direction: number) =>
    setActive((index) => (index + direction + slides.length) % slides.length);

  return (
    <section className='hero'>
      <div className='hero-copy'>
        <div className='pill'>
          <span className='pill-dot' /> ТВОЙ ТРЕНЕР. ТВОЙ ТЕМП.
        </div>
        <h1>
          ДВИГАЙСЯ
          <br />
          <em>осознанно</em>
          <span className='accent'>.</span>
        </h1>
        <p className='hero-text'>
          Умный тренер видит твою технику через камеру, считает повторения и
          подсказывает, как стать лучше. Всё — прямо в браузере.
        </p>
        <a
          className='hero-link'
          href='#setup'
          onClick={(event) => {
            event.preventDefault();
            document.getElementById('setup')?.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            });
          }}
        >
          Начать тренировку <span aria-hidden='true'>↗</span>
        </a>
        <div className='hero-foot' aria-live='polite'>
          <span>{String(active + 1).padStart(2, '0')} / 03</span>
          <div className='hero-line' />
          <span>{slide.label}</span>
        </div>
      </div>
      <div
        className={`hero-art hero-art-${slide.kind}`}
        aria-label={`${slide.headline}. ${slide.detail}`}
      >
        <div className='art-grid' aria-hidden='true' />
        <div className='art-ring ring-a' aria-hidden='true' />
        <div className='art-ring ring-b' aria-hidden='true' />
        <div key={active} className='art-scene' id='hero-current-slide'>
          {slide.kind === 'track' && (
            <div className='art-core' aria-hidden='true'>
              ✳
            </div>
          )}
          {slide.kind === 'count' && (
            <div className='art-big-number' aria-hidden='true'>
              08<span>REP</span>
            </div>
          )}
          {slide.kind === 'coach' && (
            <div className='art-score' aria-hidden='true'>
              ↗
              <small>ПОДСКАЗКИ</small>
            </div>
          )}
          <span className='art-tag tag-a'>
            {slide.kind === 'track'
              ? 'TRACKING ACTIVE'
              : slide.kind === 'count'
                ? 'REP COUNT ACTIVE'
                : 'FEEDBACK ACTIVE'}{' '}
            <i />
          </span>
          <span className='art-tag tag-b'>{slide.tag}</span>
          <div className='art-caption'>
            <strong>{slide.headline}</strong>
            <span>{slide.detail}</span>
          </div>
        </div>
        <div className='art-controls' aria-label='Управление слайдами'>
          <button
            type='button'
            className='art-arrow'
            onClick={() => go(-1)}
            aria-label='Предыдущий слайд'
          >
            ←
          </button>
          <div className='art-dots'>
            {slides.map((item, index) => (
              <button
                key={item.tag}
                type='button'
                className={index === active ? 'art-dot active' : 'art-dot'}
                onClick={() => setActive(index)}
                aria-label={`Слайд ${index + 1}: ${item.headline}`}
                aria-pressed={index === active}
              />
            ))}
          </div>
          <button
            type='button'
            className='art-arrow'
            onClick={() => go(1)}
            aria-label='Следующий слайд'
          >
            →
          </button>
        </div>
      </div>
    </section>
  );
}
