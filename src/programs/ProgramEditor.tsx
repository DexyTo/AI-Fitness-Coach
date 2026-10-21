import { exerciseIds } from '../exercises/types';
import { isHold, isLegacy, optionsFor } from '../exercises/registry';
import { ExerciseOptionsFields } from '../components/ExerciseSetup';
import { goalValue, withGoalValue, type TrainingGoal } from '../../shared/workout';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ProgramPlan, ProgramStep } from '../../shared/program';
import { draftOf, validDraft, type ProgramDraft } from '../../shared/programDraft';
import { api, messageOf } from '../account/api';
import { useAccount } from '../account/context';
import { Icon } from '../components/Icon';
import { labels } from '../exercises/types';

interface EditorState { draft:ProgramDraft; version:number }
const empty=():EditorState=>({draft:{title:'',description:'',steps:[]},version:0});
const numericFields=[{key:'sets',label:'Подходы',min:1,max:100},{key:'reps',label:'Полные повторы',min:1,max:1000},{key:'restSeconds',label:'Отдых между подходами, с',min:0,max:3600},{key:'transitionSeconds',label:'Переход к следующему шагу, с',min:0,max:3600}] as const;
function newGoal(exercise:ProgramStep['exercise'],previous:TrainingGoal):TrainingGoal {
  const base={sets:previous.sets,restSeconds:previous.restSeconds};
  return isHold(exercise)?{...base,schemaVersion:2,unit:'seconds',seconds:NaN,options:optionsFor(exercise)}:{...base,reps:NaN,...(!isLegacy(exercise)?{schemaVersion:2,unit:'reps',options:optionsFor(exercise)} as const:{})};
}
export function ProgramEditor() {
  const {id}=useParams(),{user}=useAccount(),navigate=useNavigate();
  const [state,setState]=useState<EditorState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
  const [dirty,setDirty]=useState(false),[draftNotice,setDraftNotice]=useState('');
  const baseline=useRef<EditorState|null>(null), skipDraft=useRef(false);
  const storageKey=`playfit.builder.v1:${user?.id}:${id??'new'}`;
  useEffect(()=>{
    if(!user)return;
    const abort=new AbortController();setState(null);setError('');setDirty(false);
    const load=async()=>{
      try {
        let initial=empty();
        if(id){const {program}=await api<{program:ProgramPlan}>(`/programs/${id}`,{userId:user.id,signal:abort.signal});if(program.ownerId!==user.id||program.origin!=='personal')throw Error('Редактировать можно только свою личную программу.');initial={draft:draftOf(program),version:program.version};}
        if(abort.signal.aborted)return;
        baseline.current=initial;setState(initial);setDraftNotice('');
        try {
          const raw=sessionStorage.getItem(storageKey);
          if(raw){const stored=JSON.parse(raw) as EditorState;
            // Incomplete numeric fields use null in JSON; restore them as empty fields.
            if(!stored.draft||typeof stored.draft.title!=='string'||typeof stored.draft.description!=='string'||!Array.isArray(stored.draft.steps)||stored.draft.steps.length>12||!Number.isInteger(stored.version)||!stored.draft.steps.every(s=>s&&typeof s.id==='string'&&exerciseIds.includes(s.exercise)&&s.goal))throw Error();
            setState(stored);setDirty(true);setDraftNotice(stored.version!==initial.version?'Восстановлен черновик прежней версии. Скопируй нужные значения и сбрось черновик перед сохранением.':'Черновик восстановлен. Он ещё не сохранён как программа.');
          }
        }catch{setDraftNotice('Не удалось прочитать черновик. Открыта сохранённая версия.');}
      }catch(e){if(!abort.signal.aborted)setError(messageOf(e));}
    };void load();return()=>abort.abort();
  },[id,user?.id,retry,storageKey]);
  useEffect(()=>{
    if(!state||!dirty||skipDraft.current)return;
    try{sessionStorage.setItem(storageKey,JSON.stringify(state));}
    catch{setDraftNotice('Хранилище черновика недоступно. Сохрани программу перед уходом.');}
  },[state,dirty,storageKey]);
  useEffect(()=>{
    if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
  if(!user)return <main className='program-page'><h1>Твои программы<span className='accent'>.</span></h1><p>Войди, чтобы создавать программы и сохранять избранное в аккаунте.</p><Link className='button button-primary' to='/login'>Войти</Link></main>;
  const change=(draft:ProgramDraft)=>{if(!state)return;setState({...state,draft});setDirty(true);setError('');};
  const updateStep=(index:number,step:ProgramStep)=>{if(state)change({...state.draft,steps:state.draft.steps.map((s,i)=>i===index?step:s)});};
  const move=(index:number,offset:number)=>{if(!state)return;const steps=[...state.draft.steps];[steps[index],steps[index+offset]]=[steps[index+offset],steps[index]];change({...state.draft,steps});};
  const add=(exercise:ProgramStep['exercise'])=>{
    if(!state||state.draft.steps.length>=12)return;
    // Empty fields require an explicit choice of load; no personal target is assigned.
    change({...state.draft,steps:[...state.draft.steps,{id:crypto.randomUUID(),exercise,goal: isHold(exercise)?{schemaVersion:2,unit:'seconds',sets:NaN,seconds:NaN,restSeconds:NaN,options:optionsFor(exercise)}:{sets:NaN,reps:NaN,restSeconds:NaN,...(!isLegacy(exercise)?{schemaVersion:2,unit:'reps',options:optionsFor(exercise)} as const:{})},transitionSeconds:NaN}]});
  };
  const reset=()=>{
    try{sessionStorage.removeItem(storageKey);}catch{/* Keep the form usable when storage is denied. */}
    setState(baseline.current);setDirty(false);setDraftNotice('Черновик сброшен.');setError('');
  };
  const save=async(e:FormEvent)=>{
    e.preventDefault();if(!state||!validDraft(state.draft))return;setBusy(true);setError('');
    try {
      const result=await api<{program:ProgramPlan}>(id?`/programs/${id}`:'/programs',{method:id?'PUT':'POST',body:{...state.draft,...(id?{version:state.version}:{})},userId:user.id});
      skipDraft.current=true;setDirty(false);try{sessionStorage.removeItem(storageKey);}catch{/* Saved on the server. */}void navigate(`/programs/${result.program.id}`,{replace:true});
    }catch(e){setError(messageOf(e));}finally{setBusy(false);}
  };
  return <main className='program-page program-editor page-enter'><Link className='button button-ghost' to='/my-programs'>← Мои программы</Link><span className='eyebrow'>ЛИЧНЫЙ КОНСТРУКТОР {state&&id?`· ВЕРСИЯ ${state.version}`:''}</span><h1>{id?'Настрой свой план':'Собери свой план'}<span className='accent'>.</span></h1><p className='muted'>От 1 до 12 шагов из десяти упражнений. Нагрузку и отдых выбираешь ты.</p>{error&&<p className='storage-error' role='alert'>{error}{!state&&<button className='button' onClick={()=>setRetry(v=>v+1)}>Повторить</button>}</p>}{!state?!error&&<p role='status'>Загружаем программу…</p>:<form onSubmit={e=>void save(e)}><fieldset disabled={busy} className='account-fields builder-fields'><label>Название<input required maxLength={100} value={state.draft.title} onChange={e=>change({...state.draft,title:e.target.value})}/></label><label>Короткое описание<textarea maxLength={1000} rows={3} value={state.draft.description} onChange={e=>change({...state.draft,description:e.target.value})}/></label><div className='builder-heading'><h2>Шаги <span className='count-badge'>{state.draft.steps.length}/12</span></h2><span className='muted'>Порядок можно менять</span></div>{!state.draft.steps.length&&<div className='empty-state'><h3>С какого движения начнёшь?</h3><p>Добавь упражнение и задай параметры.</p></div>}{state.draft.steps.map((s,i)=><section className='program-step' key={s.id}><div className='builder-heading'><h3><span className='accent'>{String(i+1).padStart(2,'0')}</span> {labels[s.exercise]}</h3><div className='account-actions'><button className='button button-ghost' type='button' disabled={i===0} aria-label={`Шаг ${i+1}: вверх`} onClick={()=>move(i,-1)}><Icon name='up'/></button><button className='button button-ghost' type='button' disabled={i===state.draft.steps.length-1} aria-label={`Шаг ${i+1}: вниз`} onClick={()=>move(i,1)}><Icon name='down'/></button><button className='button button-ghost' type='button' aria-label={`Удалить шаг ${i+1}`} onClick={()=>change({...state.draft,steps:state.draft.steps.filter((_,j)=>i!==j)})}><Icon name='trash'/></button></div></div><label>Упражнение<select value={s.exercise} onChange={e=>updateStep(i,{...s,exercise:e.target.value as ProgramStep['exercise'],goal:newGoal(e.target.value as ProgramStep['exercise'],s.goal)})}>{exerciseIds.map(id=><option key={id} value={id}>{labels[id]}</option>)}</select></label>{!isLegacy(s.exercise)&&<ExerciseOptionsFields exercise={s.exercise} value={optionsFor(s.exercise,s.goal.options)} onChange={options=>updateStep(i,{...s,goal:{...s.goal,options}})}/>}<div className='program-fields'>{numericFields.map(f=><label key={f.key}>{f.key==='reps'?(isHold(s.exercise)?'Удержание, с':'Полные повторы · всего'):f.label}<input type='number' required min={f.min} max={f.key==='reps'&&isHold(s.exercise)?3600:f.max} step={1} value={Number.isFinite(f.key==='transitionSeconds'?s.transitionSeconds:(f.key==='reps'?goalValue(s.goal):s.goal[f.key]))?(f.key==='transitionSeconds'?s.transitionSeconds:(f.key==='reps'?goalValue(s.goal):s.goal[f.key])):''} onChange={e=>{const value=e.target.value===''?NaN:Number(e.target.value);updateStep(i,f.key==='transitionSeconds'?{...s,transitionSeconds:value}:{...s,goal:f.key==='reps'?withGoalValue(s.goal,value):{...s.goal,[f.key]:value}});}}/></label>)}</div><p className='fine-print'>{i===state.draft.steps.length-1?'Переход последнего шага не используется при запуске.':'Переход — отдых перед следующим упражнением.'}</p></section>)}<div className='account-actions'>{exerciseIds.map(exercise=><button className='button' type='button' key={exercise} disabled={state.draft.steps.length>=12} onClick={()=>add(exercise)}><Icon name={exercise}/>Добавить {labels[exercise].toLocaleLowerCase('ru')}</button>)}</div><details><summary>Пределы параметров</summary><p>Подходы: 1–100. Полные повторы: 1–1000; удержание: 1–3600 с. Цель выпадов — всего для выбранной опорной ноги, не для пары. Отдых и переход: 0–3600 секунд. Все значения целые. Это пределы формы, а не рекомендации по нагрузке.</p></details><p className='muted' role='status'>{draftNotice||'Изменения остаются черновиком в этой вкладке до сохранения. Вернись сюда после случайного перехода.'}</p><div className='account-actions'><button type='submit' className='button button-primary' disabled={!validDraft(state.draft)||!dirty}>{busy?'Сохраняем…':'Сохранить программу'}<Icon name='check'/></button>{dirty&&<button type='button' className='button button-ghost' onClick={reset}>Сбросить черновик</button>}</div>{!validDraft(state.draft)&&<p className='fine-print'>Заполни название и все числовые поля хотя бы одного шага в указанных пределах.</p>}</fieldset></form>}</main>;
}
