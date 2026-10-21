import { inHistoryRange, type HistoryRange } from '../components/workoutAnalytics';
import { matchesProgram, programExercises } from './catalog';
import { ProgramVisual } from './ProgramVisual';
import { exerciseIds } from '../exercises/types';
import { ExerciseOptionsFields } from '../components/ExerciseSetup';
import { isLegacy, optionsFor } from '../exercises/registry';
import { goalValue, goalLabel, goalReached, withGoalValue } from '../../shared/workout';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, messageOf, ProgramPersistence, type TrainingPersistence } from '../account/api';
import { useAccount } from '../account/context';
import { labels } from '../exercises/types';
import { TrainingView } from '../components/TrainingView';
import { WorkoutDetails, WorkoutMetrics } from '../components/HistoryView';
import { Icon } from '../components/Icon';
import { downloadJson } from '../training/history';
import { stepCompleted, validPlan, type ProgramPlan, type ProgramRecord, type ProgramSnapshot } from '../../shared/program';
import { ProgramController } from './controller';
import { loadPrograms, saveProgram, PROGRAM_HISTORY_KEY } from './history';
import { FavoriteButton, FavoriteLoadError, ProgramActions, useFavorites } from './ProgramLibrary';
import { RewardNotice } from '../account/ProgressionViews';
import type { RewardReceipt } from '../../shared/progression';

const estimate = (p:ProgramPlan) => Math.max(1,Math.round(p.steps.reduce((n,s,i) => n+s.goal.sets*goalValue(s.goal)*(s.goal.unit==='seconds'?1:4)+(s.goal.sets-1)*s.goal.restSeconds+(i<p.steps.length-1?s.transitionSeconds:0),0)/60));


export function ProgramCatalog({scope='catalog'}:{scope?:'catalog'|'mine'|'favorites'}) {
  const {user}=useAccount();const favorites=useFavorites();
  const [programs,setPrograms] = useState<ProgramPlan[]>([]), [loading,setLoading] = useState(true), [error,setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query,setQuery] = useState(''), [filter,setFilter] = useState('all'), [steps,setSteps] = useState('all');
  const load = async () => {
    setLoading(true);setError('');
    try { setPrograms((await api<{programs:ProgramPlan[]}>(scope==='mine'?'/me/programs':'/programs',{userId:user?.id})).programs); }
    catch(e) { setError(messageOf(e)); } finally { setLoading(false); }
  };
  useEffect(() => { if(scope!=='catalog'&&!user){setLoading(false);return;}void load(); },[scope,user?.id]);
  const shown = programs.filter(p => (scope!=='favorites'||favorites.ids?.has(p.id)) && matchesProgram(p,query,filter,steps));
  if(scope!=='catalog'&&!user)return <main className='program-page'><h1>{scope==='mine'?'Мои программы':'Избранное'}<span className='accent'>.</span></h1><p>Войди в аккаунт, чтобы создавать программы и сохранять избранное. Гостевая тренировка доступна без входа.</p><Link className='button button-primary' to='/login'>Войти</Link></main>;
  return <main className='program-page page-enter'><div className='page-heading'><div><span className='eyebrow'>{scope==='catalog'?'ПРОГРАММЫ':scope==='mine'?'ЛИЧНАЯ КОЛЛЕКЦИЯ':'СОХРАНЕНО В АККАУНТЕ'}</span><h1>{scope==='mine'?'Мои программы':scope==='favorites'?'Избранное':'Программы'}<span className='accent'>.</span></h1><p className='muted'>{scope==='mine'?'Собери последовательность под свой ритм.':'Выбери последовательность. Настрой её под эту сессию.'}</p></div><Link className='button button-primary' to={user?'/programs/new':'/login'}>Создать программу <Icon name='arrow'/></Link></div>
    <nav className='account-actions program-tabs' aria-label='Разделы программ'><Link className={`button ${scope==='catalog'?'button-primary':''}`} to='/programs'>Все доступные</Link><Link className={`button ${scope==='mine'?'button-primary':''}`} to='/my-programs'>Мои программы</Link><Link className={`button ${scope==='favorites'?'button-primary':''}`} to='/favorites'><Icon name='star'/>Избранное</Link></nav><FavoriteLoadError favorites={favorites}/>
    <p className='program-disclaimer'>Каталожные и личные программы. Числа — пример плана, а не персональное назначение нагрузки.</p>
    <button className='button program-filter-toggle' aria-expanded={filtersOpen} aria-controls='program-search-filters' onClick={() => setFiltersOpen(v => !v)}><Icon name='search'/>Поиск и фильтры <Icon name='settings'/></button>
    <div className='program-filters' id='program-search-filters' data-open={filtersOpen}><label>Поиск<input type='search' value={query} onChange={e => setQuery(e.target.value)} placeholder='Название или упражнение' /></label><label>Состав<select value={filter} onChange={e => setFilter(e.target.value)}><option value='all'>Все упражнения</option><option value='mixed'>Несколько упражнений</option>{exerciseIds.map(id=><option key={id} value={id}>{labels[id]}</option>)}</select></label><label>Шаги<select value={steps} onChange={e => setSteps(e.target.value)}><option value='all'>Любое число</option><option value='1'>Один</option><option value='2'>Два</option><option value='3+'>Три и больше</option></select></label></div>
    {loading||(scope==='favorites'&&!favorites.ids&&!favorites.error) ? <p role='status'>Загружаем программы…</p> : error ? <div className='storage-error' role='alert'>{error} <button className='button' onClick={() => void load()}>Повторить</button></div> : scope==='favorites'&&favorites.error?null:<><p className='muted' role='status'>Найдено: {shown.length}</p><div className='program-grid'>{shown.map(p => <article className='program-card' key={p.id}><div className='program-card-top'><ProgramVisual plan={p} /><span className='mode-badge'>{p.steps.length} шаг(а)</span></div><span className='eyebrow'>{p.origin==='personal'?'МОЯ ПРОГРАММА':'КАТАЛОГ'} · V{p.version}</span><h2>{p.title}</h2><p>{p.description}</p><ul className='program-composition' aria-label='Упражнения программы'>{programExercises(p).map(exercise => <li key={exercise}>{labels[exercise]}</li>)}</ul><p className='muted'>{p.steps.reduce((n,s) => n+s.goal.sets,0)} подход(а) · ≈ {estimate(p)} мин</p><Link className='button button-primary' to={`/programs/${p.id}`}>Посмотреть план <Icon name='arrow' /></Link><FavoriteButton programId={p.id} favorites={favorites}/></article>)}</div>{!shown.length && <section className='empty-state'><h2>{scope==='favorites'?'Пока нет избранных программ':scope==='mine'?'Твой первый план — впереди':'Такой программы пока нет'}</h2><p>{scope==='favorites'?'Нажми «В избранное» у нужной программы.':scope==='mine'?'Создай программу или скопируй шаблон из каталога.':'Попробуй другой запрос или убери фильтры.'}</p>{scope==='mine'?<Link className='button button-primary' to='/programs/new'>Создать программу</Link>:scope==='favorites'?<Link className='button' to='/programs'>Открыть программы</Link>:<button className='button' onClick={() => {setQuery('');setFilter('all');setSteps('all');}}>Сбросить поиск</button>}</section>}</>}
  </main>;
}

export function ProgramDetails() {
  const { id } = useParams(); const { user } = useAccount();
  const favorites=useFavorites();
  const [plan,setPlan] = useState<ProgramPlan|null>(null), [error,setError] = useState(''), [retry,setRetry] = useState(0);
  const [mode,setMode] = useState<'camera'|'demo'>('camera'), [conditions,setConditions] = useState(''), [busy,setBusy] = useState(false), [generation,setGeneration] = useState(0);
  const [run,setRun] = useState<{controller:ProgramController;persistence?:ProgramPersistence;owner:string}|null>(null);
  const persistence = useMemo(() => user ? new ProgramPersistence(user.id) : undefined,[user?.id,generation]);
  useEffect(() => {
    const abort = new AbortController();setPlan(null);setError('');
    void api<{program:ProgramPlan}>(`/programs/${encodeURIComponent(id ?? '')}`,{signal:abort.signal,userId:user?.id}).then(d => {if(!abort.signal.aborted)setPlan(d.program);}).catch(e => {if(!abort.signal.aborted)setError(messageOf(e));});
    return () => abort.abort();
  },[id,retry,user?.id]);
  const launch = async () => {
    if (!plan || !validPlan(plan) || busy) return;
    setBusy(true);setError('');
    const snapshot:ProgramSnapshot = {kind:'program',program:structuredClone(plan),mode,conditions:conditions.trim()};
    try {
      const result = persistence ? await persistence.begin(snapshot) : {id:crypto.randomUUID(),createdAt:new Date().toISOString()};
      setRun({controller:new ProgramController(snapshot,result.id,result.createdAt,performance.now()-Math.max(0,Date.now()-Date.parse(result.createdAt))),persistence,owner:user ? `аккаунт @${user.login}` : 'гость · этот браузер'});
    } catch(e) {setError(messageOf(e));} finally {setBusy(false);}
  };
  if (run) return <ProgramRun key={run.controller.id} {...run} onRestart={() => {setRun(null);setGeneration(v => v+1);}} />;
  const update = (index:number,field:'sets'|'reps'|'restSeconds'|'transitionSeconds',value:number) => setPlan(p => p && ({...p,steps:p.steps.map((s,i) => i!==index ? s : field==='transitionSeconds'? {...s,transitionSeconds:value}:{...s,goal:field==='reps'?withGoalValue(s.goal,value):{...s.goal,[field]:value}})}));
  return <main className='program-page page-enter'><Link className='button button-ghost' to='/programs'>← Каталог программ</Link>{!plan ? error ? <div className='storage-error' role='alert'>{error}<button className='button' onClick={() => setRetry(v => v+1)}>Повторить</button></div>:<p role='status'>Загружаем план…</p> : <><span className='eyebrow'>{plan.origin==='personal'?'МОЯ ПРОГРАММА':'УЧЕБНЫЙ ШАБЛОН'} · ВЕРСИЯ {plan.version}</span><h1>{plan.title}<span className='accent'>.</span></h1><p className='muted'>{plan.description}</p><ProgramActions plan={plan} favorites={favorites}/><FavoriteLoadError favorites={favorites}/><div className='local-note'><Icon name='activity'/><p>План можно изменить для этого запуска. Сохранённая программа останется прежней. Копирование и редактор используют её исходные настройки. Это твой выбор нагрузки. Примерная длительность: ≈ {validPlan(plan)?estimate(plan):'—'} мин. Повторы оценены по 4 с, удержания — по заданной длительности; подготовка и паузы не учтены.</p></div>
    <fieldset className='program-plan' disabled={busy}><legend>План этой сессии</legend>{plan.steps.map((s,i) => <section className='program-step' key={s.id}><h2><span className='accent'>{String(i+1).padStart(2,'0')}</span> {labels[s.exercise]}</h2>{!isLegacy(s.exercise)&&<ExerciseOptionsFields exercise={s.exercise} value={optionsFor(s.exercise,s.goal.options)} onChange={options=>setPlan(p=>p&&({...p,steps:p.steps.map((step,index)=>index===i?{...step,goal:{...step.goal,options}}:step)}))}/>}<div className='program-fields'>{([{key:'sets',label:'Подходы',min:1,max:100},{key:'reps',label:'Полные повторы',min:1,max:1000},{key:'restSeconds',label:'Отдых между подходами, с',min:0,max:3600},...(i<plan.steps.length-1?[{key:'transitionSeconds',label:'Переход к следующему шагу, с',min:0,max:3600}]:[])] as const).map(f => <label key={f.key}>{f.key==='reps'?(s.goal.unit==='seconds'?'Удержание, с':'Полные повторы · всего'):f.label}<input type='number' min={f.min} max={f.key==='reps'&&s.goal.unit==='seconds'?3600:f.max} step='1' required value={Number.isNaN(f.key==='transitionSeconds'?s.transitionSeconds:(f.key==='reps'?goalValue(s.goal):s.goal[f.key as 'sets'|'restSeconds']))?'':f.key==='transitionSeconds'?s.transitionSeconds:(f.key==='reps'?goalValue(s.goal):s.goal[f.key as 'sets'|'restSeconds'])} onChange={e => update(i,f.key as 'sets'|'reps'|'restSeconds'|'transitionSeconds',e.target.value===''?NaN:Number(e.target.value))}/></label>)}</div></section>)}</fieldset>
    <section className='program-source'><h2>Источник движения</h2><div className='account-actions'><button className={`button ${mode==='camera'?'button-primary':''}`} disabled={busy} aria-pressed={mode==='camera'} onClick={() => setMode('camera')}><Icon name='camera'/> Камера</button><button className={`button ${mode==='demo'?'button-primary':''}`} disabled={busy} aria-pressed={mode==='demo'} onClick={() => setMode('demo')}><Icon name='play'/> Синтетическое демо</button></div><p>{mode==='demo'?'Все шаги выполняются на синтетических точках. Это проверка интерфейса, без игровых наград.':'Перед каждым шагом — отдельный запуск камеры и новая проверка готовности. На переходах камера освобождается.'}</p><details><summary>Почему здесь нет видеофайла</summary><p>Программа не определяет тип упражнения в смешанной записи. Для локального файла выбери одно упражнение в одиночной тренировке.</p></details><label>Условия съёмки (необязательно)<input maxLength={200} disabled={busy} value={conditions} onChange={e => setConditions(e.target.value)} placeholder='Например: камера сбоку, дневной свет' /></label></section>
    {error && <p className='storage-error' role='alert'>{error}</p>}{!validPlan(plan) && <p className='storage-error'>Введи целые числа: подходы 1–100, повторы 1–1000 или удержание 1–3600 с, отдых и переход 0–3600 с.</p>}<button className='button button-primary' disabled={busy||!validPlan(plan)} onClick={() => void launch()}>{busy?'Сохраняем запуск…':'Начать программу'} <Icon name='arrow'/></button><p className='fine-print'>{user?`Результат сохранится в аккаунте @${user.login}.`:'Гостевой результат сохранится в этом браузере.'} Незавершённый запуск после обновления страницы не восстанавливается.</p></>}
  </main>;
}

export interface ProgramRunPersistence { save(record:ProgramRecord):Promise<RewardReceipt|void>; checkpoint?(record:ProgramRecord):Promise<void> }
export function ProgramRun({controller,persistence,owner,onRestart,restartLabel='Повторить программу',draftOnly=false}:{controller:ProgramController;persistence?:ProgramRunPersistence;owner:string;onRestart:()=>void;restartLabel?:string;draftOnly?:boolean}) {
  const [reward,setReward] = useState<RewardReceipt|null>(null);
  const [,render] = useState(0); const [result,setResult] = useState<ProgramRecord|null>(null), [saved,setSaved] = useState(false), [error,setError] = useState(''), [saving,setSaving] = useState(false);
  const saveBusy = useRef(false); const index = controller.index;
  useEffect(() => { window.scrollTo({top:0}); },[index,!!result]);
  const save = async (record:ProgramRecord) => {
    if(saveBusy.current)return;saveBusy.current=true;setSaving(true);setError('');
    try {if(persistence)setReward(await persistence.save(record)??null);else saveProgram(record);setSaved(true);}catch(e){setError(messageOf(e));}finally{saveBusy.current=false;setSaving(false);}
  };
  const finish = () => { const record=controller.finish(performance.now(),true);setResult(record);void save(record); };
  const stepPersistence = useMemo<TrainingPersistence>(() => ({
    begin:async () => ({id:`${controller.id}:${index}`,createdAt:new Date().toISOString()}),
    save:async record => {
      if(persistence?.checkpoint) {
        const steps=[...controller.children,record];
        await persistence.checkpoint({...controller.checkpoint(performance.now()),steps,ended:steps.length===controller.snapshot.program.steps.length&&steps.every(stepCompleted)?'completed':'interrupted'});
      }
      controller.accept(record,performance.now());
      if(controller.phase==='finished') {const final=controller.finish(performance.now());setResult(final);void save(final);}
      render(v => v+1);
    },
  }),[controller,index]);
  useEffect(() => { const timer=window.setInterval(() => {if(controller.phase==='transition'){controller.remaining(performance.now());render(v => v+1);}},250);return () => clearInterval(timer); },[controller]);
  useEffect(() => { if(saved)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn); },[saved]);
  if(result)return <main className='program-page page-enter'><span className='eyebrow'>ОБЩИЙ ИТОГ · {owner}</span><h1>{result.ended==='completed'?'Программа завершена':'Программа прервана'}<span className='accent'>.</span></h1>{saved&&!saving&&!error&&!draftOnly&&<RewardNotice reward={reward} guest={!persistence}/>}<ProgramResultDetails record={result}/><p role={error?'alert':'status'} className={error?'storage-error':'muted'}>{saving?'Сохраняем общий результат…':error?`${error} Сохранение не подтверждено. Повтори или экспортируй JSON перед уходом.`:saved?draftOnly?'Черновик сохранён на сервере. Вернись к дуэли и отправь итог окончательно. До отправки зачёта и наград нет.':'Общий результат сохранён.':''}</p><div className='account-actions'>{error&&<button className='button' disabled={saving} onClick={()=>void save(result)}>Повторить сохранение</button>}<button className='button' onClick={()=>downloadJson({schemaVersion:2,programs:[result]},'playfit-program.json')}>Экспорт JSON</button>{!draftOnly&&<Link className='button' to='/history'>История</Link>}<button className='button button-primary' disabled={!saved} onClick={onRestart}>{restartLabel}</button></div></main>;
  const step=controller.snapshot.program.steps[index];
  return <><section className='program-run-banner'><div><span className='eyebrow'>ПРОГРАММА · {controller.snapshot.mode==='demo'?'СИНТЕТИЧЕСКОЕ ДЕМО': 'КАМЕРА'}</span><h2>{controller.snapshot.program.title}</h2><p>Шаг {index+1}/{controller.snapshot.program.steps.length} · {owner}</p></div><progress aria-label='Завершённые шаги' value={index} max={controller.snapshot.program.steps.length}/></section>
    {controller.phase==='exercise'?<TrainingView key={`${controller.id}:${index}`} exercise={step.exercise} mode={controller.snapshot.mode} onHome={finish} programStep={{goal:step.goal,conditions:controller.snapshot.conditions,persistence:stepPersistence}}/>:<main className='program-page program-transition page-enter'><span className='eyebrow'>СМЕНА УПРАЖНЕНИЯ</span><h1>{controller.phase==='paused'?'Пауза перехода':controller.phase==='next'?'Можно продолжать':'Отдохни перед следующим шагом'}<span className='accent'>.</span></h1><p className='transition-clock' role='status'>{controller.phase==='next'?'Готово':`${controller.remaining(performance.now())} с`}</p><h2>Далее: {labels[step.exercise]}</h2><p>{step.goal.sets} × {goalLabel(step.goal)} · отдых между подходами {step.goal.restSeconds} с</p><p className='muted'>Камера освобождена. Движения не учитываются. Следующий шаг начнётся с новой подготовки.</p><div className='account-actions'>{controller.phase==='transition'&&<button className='button' onClick={()=>{controller.pause(performance.now());render(v=>v+1);}}>Пауза перехода</button>}{controller.phase==='paused'&&<button className='button' onClick={()=>{controller.resume(performance.now());render(v=>v+1);}}>Продолжить отдых</button>}{controller.phase==='next'&&<button className='button button-primary' onClick={()=>{controller.next(performance.now());render(v=>v+1);}}>К следующему упражнению <Icon name='arrow'/></button>}<button className='button' onClick={finish}>Прервать программу</button></div></main>}</>;
}

export function ProgramResultDetails({record}:{record:ProgramRecord}) {
  const reps=record.steps.reduce((n,r)=>n+r.sets.reduce((m,s)=>m+s.result.reps,0),0);
  const targets=record.steps.reduce((n,r)=>n+r.sets.filter(s=>goalReached(s.result,r.goal)).length,0);
  return <section className='program-result'><h2>{record.program.title}</h2><p className='muted'>{new Date(record.date).toLocaleString('ru-RU')} · {record.mode==='demo'?'Синтетическое демо · без игровых наград':record.steps.some(r=>r.metadata.analysisVersion==='fabricated'&&r.metadata.detector==='none')?'Вымышленный учебный результат · без камеры':'Камера'} · {Math.round(record.duration)} с · {record.ended==='completed'?'Все шаги завершены':'Досрочное завершение'}</p><div className='profile-stats'><div><strong>{record.steps.length}/{record.program.steps.length}</strong><span>Шагов с результатом</span></div><div><strong>{reps}</strong><span>Полных повторов</span></div><div><strong>{targets}</strong><span>Подходов с достигнутой целью</span></div></div><p>Ручное завершение подхода сохраняет фактические результаты. Незавершённые и будущие шаги не засчитываются.</p><details><summary>Снимок плана · версия {record.program.version}</summary><p>{record.program.description}</p><ol>{record.program.steps.map(s=><li key={s.id}>{labels[s.exercise]} · {s.goal.sets} × {goalLabel(s.goal)} · отдых {s.goal.restSeconds} с · переход {s.transitionSeconds} с</li>)}</ol><p>Условия: {record.conditions||'не указаны'}</p></details>{record.steps.map((r,i)=><article className='history-record' key={r.id}><h3>Шаг {i+1}. {labels[r.exercise]}</h3><WorkoutMetrics record={r}/><details><summary>Подходы и разбор попыток</summary><WorkoutDetails record={r}/></details></article>)}{!record.steps.length&&<p>Ни один шаг не был записан. Программа прервана до первого результата.</p>}</section>;
}

export function GuestProgramHistory({ exerciseFilter = 'all', dateRange = 'all', onChange }: { exerciseFilter?: string; dateRange?: HistoryRange; onChange?: () => void }) {
  const [state,setState]=useState(loadPrograms), [confirm,setConfirm]=useState<string|null>(null), [error,setError]=useState('');
  const filteredRecords = [...state.records].reverse().filter(record => inHistoryRange(record.date, dateRange) && (exerciseFilter === 'all' || record.steps.some(step => step.exercise === exerciseFilter)));
  const remove=(id:string)=>{try {const current=loadPrograms();if(current.error)throw Error(current.error);localStorage.setItem(PROGRAM_HISTORY_KEY,JSON.stringify({schemaVersion:2,programs:current.records.filter(r=>r.id!==id)}));setState(loadPrograms());setConfirm(null);onChange?.();}catch(e){setError(messageOf(e));}};
  return <section className='guest-programs'><h2>Программы гостя <span className='count-badge'>{filteredRecords.length}</span></h2>{(state.error||error)&&<p className='storage-error' role='alert'>{state.error||error}<button className='button' onClick={()=>{setState(loadPrograms());setError('');}}>Повторить</button>{state.raw&&<button className='button' onClick={()=>downloadJson(state.raw,'playfit-programs-raw.json',true)}>Экспорт исходных данных</button>}</p>}{!state.error&&!state.records.length&&<p className='muted'>Здесь появятся результаты программ. <Link to='/programs'>Выбрать программу</Link></p>}{state.records.length > 0 && filteredRecords.length === 0 && <p className='filter-empty'>Для выбранных фильтров программ пока нет.</p>}{filteredRecords.map(record=><article className='history-record' key={record.id}><ProgramResultDetails record={record}/><div className='account-actions'><button className='button' onClick={()=>downloadJson({schemaVersion:2,programs:[record]},'playfit-program.json')}>Экспорт программы</button><button className='button' onClick={()=>setConfirm(record.id)}>Удалить…</button></div>{confirm===record.id&&<div className='delete-confirm'><p>Удалить гостевую программу без возможности восстановления?</p><button className='button' onClick={()=>remove(record.id)}>Удалить программу</button><button className='button' onClick={()=>setConfirm(null)}>Отмена</button></div>}</article>)}</section>;
}
