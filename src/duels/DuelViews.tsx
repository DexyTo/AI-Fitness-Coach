import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { duelOutcomes, duelScore, duelStates, type DuelInvitation, type DuelView } from '../../shared/duels';
import { stepCompleted, validPlan, type ProgramPlan, type ProgramRecord } from '../../shared/program';
import { api, messageOf, ProgramPersistence } from '../account/api';
import { useAccount } from '../account/context';
import { Avatar } from '../account/AccountViews';
import { Icon } from '../components/Icon';
import { labels } from '../exercises/types';
import { dates } from '../challenges/ChallengeCards';
import { ProgramResultDetails, ProgramRun } from '../programs/ProgramViews';
import { ProgramController } from '../programs/controller';
import { CompetitionTabs, DuelCard } from './DuelCards';

function useData<T>(path:string) {
  const {user}=useAccount();const [data,setData]=useState<T|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!user)return;const abort=new AbortController();setData(null);setError('');
    void api<T>(path,{userId:user.id,signal:abort.signal}).then(r=>{if(!abort.signal.aborted)setData(r);}).catch(e=>{if(!abort.signal.aborted)setError(messageOf(e));});
    return ()=>abort.abort();
  },[path,user?.id,retry]);
  return {data,error,reload:()=>setRetry(v=>v+1)};
}
function LoadError({error,reload}:{error:string;reload:()=>void}) {return <p className='storage-error' role='alert'>{error}<button className='button' onClick={reload}>Повторить</button></p>;}
function DuelRulesText() {
  return <details className='duel-rules'><summary>Баллы, сроки и награды</summary><p>Балл — средняя доля цели всех шагов, от 0 до 100%. Каждый шаг имеет одинаковый вес. Вклад подхода ограничен его целью полных оценённых повторов. Неполные и неоценённые попытки дают 0; замечания сохраняются отдельно. Округление один раз до 0,01%. При равных баллах — ничья, в том числе у двух полных целей.</p><p>Победа: 30 XP и 15 очков; ничья: 20 XP и 10 очков; поражение: 10 XP и 5 очков. Только за положительный отправленный балл в завершённой дуэли. За первый такой итог — значок «Первая дуэль». Бонус сверх дневного предела обычных тренировок. Черновик, нулевой или отсутствующий результат не даёт бонуса.</p><p>На каждого — одна связанная камерная сессия. Демо, видеофайлы, импорт и чужая история не участвуют. После принятия план фиксирован. Скорость и дополнительные повторы не дают преимущества.</p><p>Окончательная отправка — строго до серверного срока; черновик сам не отправляется. Если отправил только один участник с положительным баллом, после срока он побеждает. Без обеих отправок или при единственной нулевой — истечение без наград. Два нуля дают ничью без наград.</p><p>Записанные шаги сохраняются на сервере. После обновления доступны они и статус запуска; незаписанные кадры и текущий подход не восстанавливаются. Учебные правила учёта не подтверждают подлинность движения.</p></details>;
}
function Task({plan}:{plan:ProgramPlan}) {return <ol className='challenge-steps'>{plan.steps.map(s=><li key={s.id}><Icon name={s.exercise}/><div><strong>{labels[s.exercise]}</strong><p>{s.goal.sets} × {s.goal.reps} · отдых {s.goal.restSeconds} с · переход {s.transitionSeconds} с</p></div></li>)}</ol>;}

export function DuelsPage() {
  const {user}=useAccount(), navigate=useNavigate();
  const {data,error,reload}=useData<{duels:DuelView[]}>('/duels');const [code,setCode]=useState(''),[codeError,setCodeError]=useState('');
  const [filter,setFilter]=useState('active');
  const items=data?.duels.filter(d=>filter==='all'||['invited','accepted','waiting'].includes(d.state));
  return <main className='program-page page-enter'><div className='page-heading'><div><span className='eyebrow'>СОРЕВНОВАНИЯ · ДВА УЧАСТНИКА</span><h1>Движение на двоих<span className='accent'>.</span></h1><p className='muted'>Один план. Свой ритм. Общий итог.</p></div><Icon name='flag'/></div><CompetitionTabs duels/>{!user?<section className='empty-state'><h2>Пригласи соперника</h2><p>Для создания и принятия дуэли нужен аккаунт.</p><Link className='button button-primary' to='/login'>Войти</Link></section>:<><div className='duel-entry-grid'><section className='account-card'><h2>Создать дуэль</h2><p>Выбери программу из каталога, настрой цель и срок. Соперник увидит условия до принятия.</p><Link className='button button-primary' to='/competitions/duels/new'>Выбрать план <Icon name='arrow'/></Link></section><form className='account-card' onSubmit={e=>{e.preventDefault();if(!/^[A-F0-9]{16}$/.test(code)){setCodeError('Введи 16 символов кода приглашения.');return;}void navigate(`/competitions/duels/invite/${code}`);}}><h2>Есть приглашение?</h2><label>Код дуэли<input value={code} onChange={e=>{setCode(e.target.value.trim().toUpperCase());setCodeError('');}} autoComplete='off' maxLength={16} placeholder='16 символов' required/></label><button className='button' type='submit'>Посмотреть условия</button>{codeError&&<p role='alert'>{codeError}</p>}</form></div><div className='builder-heading'><h2>Мои дуэли</h2><div className='account-actions'><button className='button' aria-pressed={filter==='active'} onClick={()=>setFilter('active')}>В ожидании</button><button className='button' aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>Все</button><button className='button' onClick={reload}>Обновить</button></div></div>{error?<LoadError error={error} reload={reload}/>:!data?<p role='status'>Загружаем дуэли…</p>:items?.length?<div className='program-grid'>{items.map(item=><DuelCard item={item} key={item.id}/>)}</div>:<section className='empty-state'><h3>Здесь появятся твои дуэли</h3><p>Создай приглашение или введи код соперника выше.</p></section>}</>}<DuelRulesText/></main>;
}

export function NewDuel() {
  const {user}=useAccount(),navigate=useNavigate();const {data,error,reload}=useData<{programs:ProgramPlan[]}>('/programs');
  const [plan,setPlan]=useState<ProgramPlan|null>(null),[hours,setHours]=useState(24),[actionError,setActionError]=useState(''),[busy,setBusy]=useState(false);
  const request=useRef<{key:string;id:string}|null>(null),lock=useRef(false);
  if(!user)return <Navigate to='/login' replace/>;
  const create=async()=>{
    if(!plan||lock.current)return;lock.current=true;setBusy(true);setActionError('');
    const key=JSON.stringify({plan,hours});if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};
    try {const r=await api<{duel:DuelView}>('/duels',{method:'POST',userId:user.id,body:{program:plan,hours,requestId:request.current.id}});void navigate(`/competitions/duels/${r.duel.id}`);}catch(e){setActionError(messageOf(e));}finally{lock.current=false;setBusy(false);}
  };
  const update=(index:number,key:'sets'|'reps'|'restSeconds'|'transitionSeconds',value:number)=>setPlan(p=>p&&({...p,steps:p.steps.map((s,i)=>i!==index?s:key==='transitionSeconds'?{...s,transitionSeconds:value}:{...s,goal:{...s.goal,[key]:value}})}));
  return <main className='program-page page-enter'><Link className='button button-ghost' to='/competitions/duels'>← Мои дуэли</Link><span className='eyebrow'>НОВОЕ ПРИГЛАШЕНИЕ</span><h1>Одна цель для двоих<span className='accent'>.</span></h1><p className='muted'>Учебные шаблоны. Выбирай нагрузку под свои возможности и договорённость с соперником.</p>{error?<LoadError error={error} reload={reload}/>:!data?<p role='status'>Загружаем каталог…</p>:<><label>Программа<select disabled={busy} value={plan?.id??''} onChange={e=>setPlan(structuredClone(data.programs.find(p=>p.id===e.target.value)??null))}><option value=''>Выбери программу</option>{data.programs.filter(p=>p.origin==='catalog').map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>{plan&&<fieldset className='program-plan' disabled={busy}><legend>Фиксированная цель</legend>{plan.steps.map((s,i)=><section className='program-step' key={s.id}><h2>{i+1}. {labels[s.exercise]}</h2><div className='program-fields'>{([{key:'sets',label:'Подходы',min:1,max:100},{key:'reps',label:'Полные повторы',min:1,max:1000},{key:'restSeconds',label:'Отдых, с',min:0,max:3600},{key:'transitionSeconds',label:'Переход, с',min:0,max:3600}] as const).map(f=><label key={f.key}>{f.label}<input type='number' min={f.min} max={f.max} step={1} required value={Number.isNaN(f.key==='transitionSeconds'?s.transitionSeconds:s.goal[f.key])?'':f.key==='transitionSeconds'?s.transitionSeconds:s.goal[f.key]} onChange={e=>update(i,f.key,e.target.value===''?NaN:Number(e.target.value))}/></label>)}</div></section>)}</fieldset>}<label>Срок с момента создания<select disabled={busy} value={hours} onChange={e=>setHours(Number(e.target.value))}><option value={1}>1 час</option><option value={24}>24 часа</option><option value={72}>3 дня</option><option value={168}>7 дней</option></select></label><DuelRulesText/>{actionError&&<p className='storage-error' role='alert'>{actionError}</p>}<button className='button button-primary' disabled={busy||!plan||!validPlan(plan)} onClick={()=>void create()}>{busy?'Создаём…':'Создать приглашение'}</button></>}</main>;
}

export function DuelInvite() {
  const {code}=useParams(),{user}=useAccount(),navigate=useNavigate();const {data,error,reload}=useData<{invitation:DuelInvitation}>(`/duel-invitations/${encodeURIComponent(code??'')}`);
  const [busy,setBusy]=useState(false),[actionError,setActionError]=useState('');
  if(!user)return <main className='program-page'><h1>Приглашение в дуэль</h1><p>Войди, затем снова открой приглашение по коду {code}.</p><Link className='button button-primary' to='/login'>Войти</Link></main>;
  const accept=async()=>{if(busy)return;setBusy(true);setActionError('');try{const r=await api<{duel:DuelView}>(`/duel-invitations/${code}/accept`,{method:'POST',body:{},userId:user.id});void navigate(`/competitions/duels/${r.duel.id}`);}catch(e){setActionError(messageOf(e));}finally{setBusy(false);}};
  const item=data?.invitation;
  return <main className='program-page page-enter'><Link className='button button-ghost' to='/competitions/duels'>← К дуэлям</Link><span className='eyebrow'>ПРИГЛАШЕНИЕ</span><h1>Принимаешь вызов<span className='accent'>?</span></h1>{error?<LoadError error={error} reload={reload}/>:!item?<p role='status'>Загружаем условия…</p>:<><section className='account-card'><Avatar name={item.creator.avatar}/><h2>{item.creator.nickname} приглашает</h2><h3>{item.task.program.title}</h3><p>{duelStates[item.state]} · до {dates(item.endsAt)}</p><Task plan={item.task.program}/><DuelRulesText/><p>После принятия цель и срок фиксированы. Выполняйте задание отдельно, каждый через свою камеру.</p><button className='button button-primary' disabled={busy} onClick={()=>void accept()}>{busy?'Сохраняем…':item.state==='invited'?'Принять условия':'Проверить моё участие'}</button>{actionError&&<p className='storage-error' role='alert'>{actionError}</p>}</section></>}</main>;
}

class DuelPersistence extends ProgramPersistence {
  private revision:number;
  private pending:{revision:number;record:ProgramRecord}|null=null;
  constructor(userId:string,private duelId:string,revision:number){super(userId);this.revision=revision;}
  async checkpoint(record:ProgramRecord) {
    // Keep the exact payload/revision after a lost response before starting another save.
    if(this.pending) {await this.write(this.pending);this.pending=null;}
    this.pending={revision:this.revision+1,record:structuredClone(record)};
    await this.write(this.pending);this.pending=null;
  }
  private async write(payload:{revision:number;record:ProgramRecord}) {await api(`/duels/${this.duelId}/draft`,{method:'PUT',userId:this.userId,body:payload});this.revision=payload.revision;}
  override async save(record:ProgramRecord) {await this.checkpoint(record);return undefined;}
}
export function DuelDetails() {
  const {id}=useParams(),{user}=useAccount();const {data,error,reload}=useData<{duel:DuelView}>(`/duels/${encodeURIComponent(id??'')}`);
  const [busy,setBusy]=useState(false),[actionError,setActionError]=useState(''),[copy,setCopy]=useState('');const lock=useRef(false);
  const [run,setRun]=useState<{controller:ProgramController;persistence:DuelPersistence;owner:string}|null>(null);
  const item=data?.duel,mine=item?.participants.find(p=>p.userId===user?.id),draft=item?.myAttempt.draft;
  const act=async(action:'run'|'cancel'|'submit')=>{
    if(!item||!user||lock.current)return;lock.current=true;setBusy(true);setActionError('');
    try {
      if(action==='run') {
        const r=await api<NonNullable<DuelView['myAttempt']['run']>>(`/duels/${item.id}/run`,{method:'POST',body:{},userId:user.id});
        const controller=new ProgramController(r.snapshot,r.id,r.createdAt,performance.now()-Math.max(0,Date.now()-Date.parse(r.createdAt)));
        if(draft)controller.restore(draft);
        setRun({controller,persistence:new DuelPersistence(user.id,item.id,item.myAttempt.revision),owner:`дуэль · аккаунт @${user.login}`});
      } else if(action==='submit'&&draft) {await new ProgramPersistence(user.id).save(draft);reload();}
      else {await api(`/duels/${item.id}/cancel`,{method:'POST',body:{},userId:user.id});reload();}
    }catch(e){setActionError(messageOf(e));}finally{lock.current=false;setBusy(false);}
  };
  if(!user)return <Navigate to='/login' replace/>;
  if(run)return <><section className='challenge-run-context'><Icon name='flag'/><div><strong>Зачётная сессия дуэли</strong><p>Записанные шаги сохраняются. Окончательная отправка отдельно, до {dates(item!.endsAt)}.</p></div></section><ProgramRun {...run} draftOnly restartLabel='К отправке итога дуэли' onRestart={()=>{setRun(null);reload();}}/></>;
  const active=item&&['accepted','waiting'].includes(item.state)&&!mine?.submittedAt;
  const resumable=!draft||(draft.steps.length<draft.program.steps.length&&draft.steps.every(stepCompleted));
  return <main className='program-page challenge-detail page-enter'><div className='builder-heading'><Link className='button button-ghost' to='/competitions/duels'>← Мои дуэли</Link><button className='button' onClick={reload} disabled={busy}>Обновить</button></div>{error?<LoadError error={error} reload={reload}/>:!item?<p role='status'>Загружаем дуэль…</p>:<><span className='eyebrow'>ДУЭЛЬ · {duelStates[item.state]}</span><h1>{item.task.program.title}<span className='accent'>.</span></h1><p className='muted'>Окончательно отправь результат до {dates(item.endsAt)}</p><div className='challenge-detail-grid'><section className='account-card'><h2>План для обоих</h2><Task plan={item.task.program}/><DuelRulesText/></section><aside className='account-card duel-status'><h2>{duelStates[item.state]}</h2>{item.state==='invited'?<><p>Передай код сопернику любым удобным способом.</p><label>Код приглашения<input className='duel-code' readOnly value={item.code} onFocus={e=>e.target.select()}/></label><button className='button' onClick={()=>void navigator.clipboard?.writeText(item.code).then(()=>setCopy('Код скопирован.')).catch(()=>setCopy('Выдели код в поле и скопируй вручную.'))}>Копировать код</button><p role='status'>{copy||'Если копирование недоступно, выдели код в поле и скопируй вручную.'}</p><button className='button button-ghost' disabled={busy} onClick={()=>void act('cancel')}>Отменить приглашение</button></>:<><div className='duel-players'>{item.participants.map(p=><div key={p.userId} className='duel-player'><Avatar name={p.avatar}/><strong>{p.nickname}{p.userId===user.id?' · ты':''}</strong><span>{p.event?<><b className='duel-score'>{p.event.score===null?'Нет отправки':`${(p.event.score/100).toFixed(2)}%`}</b>{duelOutcomes[p.event.outcome]}{p.event.xp>0&&<small>+{p.event.xp} XP · +{p.event.points} очков</small>}</>:p.submittedAt?'Итог отправлен':'Итог ещё не отправлен'}</span></div>)}</div>{mine?.event&&<p role='status'>{mine.event.reason==='opponent_absent'?'Срок истёк. Только один участник отправил положительный результат — ему засчитана победа.':mine.event.reason==='no_positive_submission'?'К сроку нет положительной отправки. Дуэль истекла без наград.':'Сравнили среднюю долю цели. Равные округлённые баллы дают ничью.'} {mine.event.xp===0?'Бонус за этот итог не начислен.':'Награда сохранена в аккаунте.'}</p>}{active&&<>{draft?<><p className='accent'>Сохранён черновик · {(duelScore(draft)/100).toFixed(2)}% цели</p><p>Записано шагов: {draft.steps.length}/{draft.program.steps.length}. Отправка окончательная: изменить итог после неё нельзя.</p><button className='button button-primary' disabled={busy} onClick={()=>void act('submit')}>Отправить итог окончательно</button></>:<p>У тебя одна зачётная сессия. Начни, сохрани работу и отправь итог отдельно.</p>}{resumable&&<button className={`button ${draft?'':'button-primary'}`} disabled={busy} onClick={()=>void act('run')}>{item.myAttempt.run?'Продолжить записанную сессию':'Начать с камерой'}</button>}</>}{mine?.submittedAt&&!mine.event&&<p role='status'>Твой итог сохранён. Ждём отправку соперника или окончание срока. Нажми «Обновить», чтобы проверить.</p>}{item.finalizedAt&&<p className='fine-print'>Событие: {dates(item.finalizedAt)}</p>}</>}{actionError&&<p role='alert' className='storage-error'>{actionError}</p>}</aside></div>{draft&&<details className='duel-draft-details'><summary>Моя записанная работа · ревизия {item.myAttempt.revision}</summary><ProgramResultDetails record={draft}/></details>}</>}</main>;
}
