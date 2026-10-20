import { useState } from 'react';
import { Icon } from './Icon';

const slides = [
  { title: 'Движение в фокусе', text: 'Ключевые точки помогают разобрать движение.', label: 'Распознавание' },
  { title: 'Каждый повтор на виду', text: 'Отдельно — полные циклы и неполные попытки.', label: 'Повторения' },
  { title: 'Подсказка рядом', text: 'Одно замечание за раз, чтобы сохранить фокус.', label: 'Техника' },
];

export function HeroCarousel({ onDemo }: { onDemo: () => void }) {
  const [active, setActive] = useState(0);
  return <section className='hero' aria-label='Тренировки с PlayFit Vision'>
    <div className='hero-copy'>
      <span className='eyebrow'><span className='small-dot' /> ТРЕНИРОВКА В КАДРЕ</span>
      <h1>Твой темп.<br /><em>Твоя техника.</em></h1>
      <p className='hero-text'>Включи камеру. Двигайся. Получай подсказки и следи за повторениями — прямо в браузере.</p>
      <div className='hero-actions'>
        <a className='button button-primary' href='#setup'>Выбрать тренировку <Icon name='arrow' /></a>
        <button className='button button-ghost' onClick={onDemo}><Icon name='play' /> Попробовать демо</button>
      </div>
      <p className='hero-privacy'><Icon name='shield' /> Видео остаётся на твоём устройстве</p>
      <div className='hero-bottom'><span>МЕНЬШЕ ОТВЛЕЧЕНИЙ.</span><span>БОЛЬШЕ ДВИЖЕНИЯ.</span></div>
    </div>
    <div className='movement-card'>
      <div className='movement-top'><span className='movement-label'><span className='small-dot' /> PLAYFIT / VISION</span><span className='illustration-label'>Схема движения</span></div>
      <svg className='movement-illustration' viewBox='0 0 520 410' role='img' aria-label='Схематичная фигура человека в приседе с отмеченными суставами'>
        <path d='M64 47v-19h27M429 28h27v19M64 328v19h27M429 347h27v-19' fill='none' stroke='#737968' strokeWidth='1.3' />
        <path d='M77 347h365M260 48v300' stroke='#464b40' strokeWidth='1' strokeDasharray='3 8' />
        <path d='M77 274h365M77 201h365M77 128h365' stroke='#343930' strokeWidth='1' />
        <path d='M174 306 240 276 309 312 340 341M204 169 180 240 240 276M204 169 263 200 327 195' fill='none' stroke='#61684f' strokeWidth='22' strokeLinecap='round' strokeLinejoin='round' />
        <path d='M228 306 303 263 250 222 275 142' fill='none' stroke='#d8ecc1' strokeWidth='38' strokeLinecap='round' strokeLinejoin='round' />
        <path d='m275 142 54 43 67-5' fill='none' stroke='#d8ecc1' strokeWidth='25' strokeLinecap='round' strokeLinejoin='round' />
        <path d='m228 306-17 34h47' fill='none' stroke='#d8ecc1' strokeWidth='19' strokeLinecap='round' strokeLinejoin='round' />
        <circle cx='284' cy='91' r='29' fill='#d8ecc1' />
        <path d='m284 66 18 7 11 15-15 1-5-13' fill='#b9d09e' />
        <path d='m275 142-25 80 53 41-75 43M275 142l54 43 67-5' fill='none' stroke='#d1f277' strokeWidth='2.5' />
        {[ [275,142], [250,222], [303,263], [228,306], [329,185], [396,180] ].map(([x,y]) => <g key={x}><circle cx={x} cy={y} r='9' fill='#252c20' /><circle cx={x} cy={y} r='4' fill='#d1f277' /></g>)}
        <path d='M283 251a25 25 0 0 0 1 27' fill='none' stroke='#d1f277' strokeWidth='1.5' />
        <path d='M321 263h55' stroke='#d1f277' strokeWidth='1' /><circle cx='376' cy='263' r='2.5' fill='#d1f277' />
        <text x='385' y='267' fill='#d7e4c4' fontSize='11' fontFamily='inherit'>Колено</text>
        <text x='84' y='75' fill='#9da78f' fontSize='10' fontFamily='inherit' letterSpacing='2'>ВИД СБОКУ</text>
      </svg>
      <div className='movement-caption' id='movement-description' aria-live='polite'><span className='slide-index'>0{active + 1}<span> / 03</span></span><div><h2>{slides[active].title}</h2><p>{slides[active].text}</p></div></div>
      <div className='feature-tabs' aria-label='Возможности приложения'>{slides.map((slide, i) => <button key={slide.label} aria-pressed={active === i} aria-controls='movement-description' onClick={() => setActive(i)}><span>0{i + 1}</span>{slide.label}</button>)}</div>
    </div>
  </section>;
}
