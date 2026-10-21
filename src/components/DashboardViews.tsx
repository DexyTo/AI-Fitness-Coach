import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAccount } from '../account/context';
import { api, messageOf, type AccountResult } from '../account/api';
import { HistoryStore } from '../training/history';
import { loadPrograms } from '../programs/history';
import type { HistoryRecord } from '../../shared/program';
import { exerciseIds, labels, type ExerciseType, type InputMode } from '../exercises/types';
import { exerciseRegistry, isHold } from '../exercises/registry';
import { selectionSearch } from '../routing/selection';
import { ExerciseVisual, muscleGroups } from './ExerciseVisual';
import { ProgramVisual } from '../programs/ProgramVisual';
import { HistoryAnalytics, Ring } from './HistoryAnalytics';
import { summarizeHistory } from './workoutAnalytics';
import { Icon } from './Icon';

function useDashboardHistory() {
  const { user } = useAccount();
  const [state, setState] = useState<{ records: HistoryRecord[]; loading: boolean; error: string }>({ records: [], loading: true, error: '' });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setState({ records: [], loading: true, error: '' });
    if (!user) {
      const local = new HistoryStore().load(), programs = loadPrograms();
      setState({ records: [...local.records, ...programs.records], loading: false, error: local.error || programs.error });
    } else {
      void api<{ results: AccountResult[] }>('/history', { userId: user.id, signal: abort.signal }).then(data => {
        if (!abort.signal.aborted) setState({ records: data.results.map(r => r.record), loading: false, error: '' });
      }).catch(e => { if (!abort.signal.aborted) setState({ records: [], loading: false, error: messageOf(e) }); });
    }
    return () => abort.abort();
  }, [user?.id, retry]);
  return { ...state, retry: () => setRetry(v => v + 1) };
}

export function HomeView({ exercise, mode }: { exercise: ExerciseType; mode: InputMode }) {
  const { user } = useAccount(), history = useDashboardHistory();
  const summary = summarizeHistory(history.records, 'week');
  return <main className='dashboard-home page-enter'>
    <div className='page-heading'><div><h1>Привет{user ? `, ${user.nickname}` : ''}!</h1><p className='muted'>Готов{user ? '' : '(а)'} к тренировке сегодня?</p></div><span className='today-label'>{new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' })}</span></div>
    <div className='home-top-grid'><section className='current-workout'><div><span>Твоя следующая тренировка</span><h2>{labels[exercise]}</h2><p>{muscleGroups[exercise]} · {exerciseRegistry[exercise].equipment}</p><Link to={`/exercises/${exercise}`} className='button'>Начать тренировку <Icon name='arrow' /></Link></div><ExerciseVisual exercise={exercise} /></section>
      <section className='home-week surface'><div className='section-title'><h2>Твой прогресс</h2><Link to='/progress'>Подробнее <Icon name='chevron' /></Link></div>{history.loading ? <p role='status'>Загружаем показатели…</p> : history.error ? <p role='alert'>{history.error}<button className='button' onClick={history.retry}>Повторить</button></p> : <div className='home-rings'><Ring value={summary.completion} label={summary.completion === null ? '—' : `${summary.completion}%`} caption='Цели подходов за неделю' /><div><strong>{summary.workouts}</strong><span>тренировок за неделю</span><strong>{summary.reps}</strong><span>полных повторов</span></div></div>}<Link className='text-link' to='/history'>Открыть историю <Icon name='arrow' /></Link></section></div>
    <section className='home-exercises'><div className='section-title'><h2>Выбери своё движение</h2><Link to='/exercises'>Все упражнения <Icon name='chevron' /></Link></div><div className='exercise-strip'>{exerciseIds.slice(0, 4).map(id => <Link to={`/exercises/${id}`} key={id}><ExerciseVisual exercise={id} /><strong>{labels[id]}</strong><small>{muscleGroups[id]}</small></Link>)}</div></section>
    <section><div className='section-title'><h2>Тренируйся в своём ритме</h2><Link to='/programs'>Все программы <Icon name='chevron' /></Link></div><div className='recommendation-grid'><Link className='program-feature' to='/programs'><ProgramVisual /><span><small>ГОТОВЫЕ ПРОГРАММЫ</small><h3>Больше движения.<br />Меньше планирования.</h3><p>Выбери программу под свою цель</p><b>Смотреть программы <Icon name='arrow' /></b></span></Link><div className='try-card surface'><span className='stat-icon'><Icon name='camera' /></span><h3>Твой тренер — рядом</h3><p>Камера считает повторы и помогает следить за движением. Видео остаётся на устройстве.</p><Link className='button button-primary' to={{ pathname: '/training', search: selectionSearch({ exercise, mode }) }}>Настроить тренировку <Icon name='arrow' /></Link><Link className='text-link' to='/welcome'>Как это работает <Icon name='chevron' /></Link><Link className='text-link' to={{ pathname: '/training', search: selectionSearch({ exercise, mode: 'demo' }) }}>Сначала попробовать демо <Icon name='play' /></Link></div></div></section>
    <div className='home-shortcuts'><Link to='/competitions'><Icon name='flag' />Соревнования<Icon name='chevron' /></Link><Link to='/leaderboard'><Icon name='star' />Рейтинг участников<Icon name='chevron' /></Link>{user && <Link to='/overview'><Icon name='activity' />XP и достижения<Icon name='chevron' /></Link>}</div>
  </main>;
}

export function ExerciseCatalog() {
  const [params, setParams] = useSearchParams(), query = params.get('q') ?? '';
  const [category, setCategory] = useState('Все');
  const shown = exerciseIds.filter(id => `${labels[id]} ${muscleGroups[id]}`.toLowerCase().includes(query.toLowerCase()) && (category === 'Все' || muscleGroups[id].includes(category)));
  return <main className='exercise-page page-enter'><div className='page-heading'><div><h1>Упражнения</h1><p className='muted'>Знакомые движения. Новый взгляд на технику.</p></div><span className='count-badge'>{exerciseIds.length} упражнений</span></div>
    <label className='catalog-search'><Icon name='search' /><input type='search' placeholder='Поиск упражнений' aria-label='Поиск упражнений' value={query} onChange={e => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })} /></label>
    <div className='filter-pills' role='group' aria-label='Мышечные группы'>{['Все', 'Ноги', 'Руки', 'Корпус', 'Ягодицы', 'Плечи'].map(c => <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div>
    <div className='exercise-catalog'>{shown.map(id => <Link className='exercise-card surface' to={`/exercises/${id}`} key={id}><ExerciseVisual exercise={id} /><span><h2>{labels[id]}</h2><p>{muscleGroups[id]}</p><span className='difficulty-badge'>{isHold(id) ? 'Удержание' : 'Повторения'}</span><small>{exerciseRegistry[id].equipment}</small></span><Icon name='chevron' /></Link>)}</div>
    {!shown.length && <section className='empty-state'><Icon name='search' /><h2>Ничего не нашлось</h2><p>Попробуй другое название или мышечную группу.</p><button className='button' onClick={() => { setParams({}); setCategory('Все'); }}>Сбросить поиск</button></section>}
  </main>;
}

export function ExerciseDetails() {
  const { id } = useParams(), [mode, setMode] = useState<InputMode>('camera');
  if (!exerciseIds.includes(id as ExerciseType)) return <main className='exercise-page'><h1>Упражнение не найдено</h1><Link className='button' to='/exercises'>К упражнениям</Link></main>;
  const exercise = id as ExerciseType, def = exerciseRegistry[exercise];
  return <main className='exercise-detail page-enter'><Link className='back-link' to='/exercises'>← Все упражнения</Link><div className='exercise-detail-grid'><ExerciseVisual className='detail-photo' exercise={exercise} /><section className='detail-copy surface'><h1>{labels[exercise]}</h1><div className='detail-meta'><span className='difficulty-badge'>{isHold(exercise) ? 'Удержание' : 'Повторения'}</span><span>{muscleGroups[exercise]}</span></div><h2>О упражнении</h2><p>{def.description}</p><h2>Как подготовиться</h2><p>{def.initial}</p><ul className='exercise-facts'><li><Icon name='activity' /><span>Работают мышцы<b>{muscleGroups[exercise]}</b></span></li><li><Icon name='squat' /><span>Оборудование<b>{def.equipment}</b></span></li><li><Icon name='camera' /><span>Ракурс камеры<b>{def.view === 'side' ? 'Сбоку' : 'Спереди'}</b></span></li></ul>
      <h2>Выбери формат</h2><div className='mode-grid'>{([{ id: 'camera', icon: 'camera', title: 'Камера' }, { id: 'video', icon: 'video', title: 'Видеофайл' }, { id: 'demo', icon: 'play', title: 'Демо' }] as const).map(m => <button className={`mode-choice ${m.id === mode ? 'mode-selected' : ''}`} aria-pressed={m.id === mode} onClick={() => setMode(m.id)} key={m.id}><Icon name={m.icon} /><strong>{m.title}</strong></button>)}</div><Link className='button button-primary detail-start' to={{ pathname: '/training', search: selectionSearch({ exercise, mode }) }}>Начать <Icon name='arrow' /></Link><details><summary>Подробнее об анализе</summary><p>{def.camera}</p><p>{def.limitation}</p><p>Правила предварительные; персональная сложность не оценивалась.</p></details></section></div></main>;
}

export function ProgressView() {
  const history = useDashboardHistory();
  return <main className='history-page page-enter'><div className='page-heading'><div><h1>Мой прогресс</h1><p className='muted'>Каждая тренировка складывается в историю.</p></div><Link className='button' to='/history'>История <Icon name='arrow' /></Link></div>{history.loading ? <p role='status'>Загружаем статистику…</p> : history.error ? <div role='alert' className='storage-error'>{history.error}<button className='button' onClick={history.retry}>Повторить</button></div> : <><HistoryAnalytics records={history.records} /><p className='fine-print'>Программа считается одной тренировкой. Повторы и распределение включают её записанные шаги. Демо не участвует в статистике.</p></>}</main>;
}
