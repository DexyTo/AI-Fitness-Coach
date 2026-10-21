import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';

const slides = [
  { title: 'Твоё движение.\nТвой новый ритм.', text: 'Тренируйся через камеру. Следи за повторами и получай подсказки прямо во время движения.' },
  { title: 'Каждый повтор\nна виду.', text: 'Полные, неполные и неоценённые попытки сохраняются отдельно. Ты видишь, что удалось проверить.' },
  { title: 'Начни с одного\nдвижения.', text: 'Выбери упражнение, настрой камеру и свою цель. Видео остаётся на твоём устройстве.' },
];
export function WelcomeView() {
  const [active, setActive] = useState(0);
  return <main className='welcome-page page-enter'><section className='welcome-card'><img src='/images/squat.webp' alt='Девушка выполняет приседание' /><div className='welcome-content'><span className='eyebrow'>PLAYFIT VISION</span><h1>{slides[active].title}</h1><p>{slides[active].text}</p><div className='welcome-dots' role='group' aria-label='Знакомство с приложением'>{slides.map((_, i) => <button key={i} aria-label={`Слайд ${i + 1}`} aria-pressed={active === i} onClick={() => setActive(i)} />)}</div>{active < slides.length - 1 ? <button className='button button-primary' onClick={() => setActive(v => v + 1)}>Дальше <Icon name='arrow' /></button> : <Link className='button button-primary' to='/exercises'>Начать <Icon name='arrow' /></Link>}<Link className='welcome-skip' to='/'>Пропустить</Link></div></section></main>;
}
