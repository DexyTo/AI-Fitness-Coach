import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ProgramPlan } from '../../shared/program';
import { api, messageOf } from '../account/api';
import { useAccount } from '../account/context';
import { Icon } from '../components/Icon';

export function useFavorites() {
  const {user}=useAccount();
  const [ids,setIds]=useState<Set<string>|null>(null),[error,setError]=useState('');
  const load=async()=>{
    if(!user){setIds(new Set());return;}
    setError('');
    try {const data=await api<{programs:ProgramPlan[]}>('/me/favorites',{userId:user.id});setIds(new Set(data.programs.map(p=>p.id)));}
    catch(e){setError(messageOf(e));}
  };
  useEffect(()=>{void load();},[user?.id]);
  return {ids,error,load,change:(id:string,saved:boolean)=>setIds(previous=>{const next=new Set(previous);if(saved)next.add(id);else next.delete(id);return next;})};
}
export function FavoriteButton({programId,favorites}:{programId:string;favorites:ReturnType<typeof useFavorites>}) {
  const {user}=useAccount();const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const saved=favorites.ids?.has(programId)??false;
  if(!user)return <Link className='button button-ghost' to='/login'><Icon name='star'/> Войти для избранного</Link>;
  const toggle=async()=>{
    setBusy(true);setError('');
    try {await api(`/programs/${encodeURIComponent(programId)}/favorite`,{method:saved?'DELETE':'PUT',userId:user.id});favorites.change(programId,!saved);}
    catch(e){setError(messageOf(e));}finally{setBusy(false);}
  };
  return <><button className='button button-ghost' disabled={busy||!favorites.ids} aria-pressed={saved} onClick={()=>void toggle()}><Icon name='star'/>{busy?'Сохраняем…':saved?'В избранном':'В избранное'}</button>{error&&<p className='storage-error' role='alert'>{error} Нажми ещё раз, чтобы повторить.</p>}</>;
}
export function ProgramActions({plan,favorites}:{plan:ProgramPlan;favorites:ReturnType<typeof useFavorites>}) {
  const {user}=useAccount(),navigate=useNavigate();
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false);
  const own=plan.origin==='personal'&&plan.ownerId===user?.id;
  const act=async(copy:boolean)=>{
    if(!user||busy)return;setBusy(true);setError('');
    try {
      if(copy){const data=await api<{program:ProgramPlan}>(`/programs/${plan.id}/copy`,{method:'POST',body:{version:plan.version},userId:user.id});void navigate(`/programs/${data.program.id}/edit`);}
      else {await api(`/programs/${plan.id}`,{method:'DELETE',userId:user.id});void navigate('/my-programs');}
    }catch(e){setError(messageOf(e));}finally{setBusy(false);}
  };
  return <section className='program-management' aria-label='Действия с программой'><div className='account-actions'><FavoriteButton programId={plan.id} favorites={favorites}/>{user?<button className='button' disabled={busy} onClick={()=>void act(true)}><Icon name='copy'/>Создать копию</button>:<Link className='button' to='/login'>Войти для копирования</Link>}{own&&<><Link className='button' to={`/programs/${plan.id}/edit`}>Редактировать</Link><button className='button button-ghost' disabled={busy} onClick={()=>setConfirm(true)}>Удалить…</button></>}</div>{error&&<p className='storage-error' role='alert'>{error} Повтори действие после проверки.</p>}{confirm&&<div className='delete-confirm' role='group' aria-label='Подтверждение удаления'><p>Удалить «{plan.title}» из личного списка и избранного? Старые результаты и начатые запуски сохранятся. Новые запуски будут недоступны.</p><div className='account-actions'><button className='button' disabled={busy} onClick={()=>void act(false)}>Удалить программу</button><button className='button' disabled={busy} onClick={()=>setConfirm(false)}>Отмена</button></div></div>}</section>;
}
export function FavoriteLoadError({favorites}:{favorites:ReturnType<typeof useFavorites>}) {
  return favorites.error?<p className='storage-error' role='alert'>{favorites.error}<button className='button' onClick={()=>void favorites.load()}>Повторить загрузку избранного</button></p>:null;
}

export function ProfileFavorites() {
  const {user}=useAccount();const [programs,setPrograms]=useState<ProgramPlan[]|null>(null),[error,setError]=useState('');
  const load=async()=>{
    if(!user)return;setError('');
    try{setPrograms((await api<{programs:ProgramPlan[]}>('/me/favorites',{userId:user.id})).programs);}catch(e){setError(messageOf(e));}
  };
  useEffect(()=>{void load();},[user?.id]);
  return <section className='profile-favorites'><div className='builder-heading'><h2>Избранные программы</h2><Link className='button button-ghost' to='/favorites'>Все избранные <Icon name='arrow'/></Link></div>{error?<p className='storage-error' role='alert'>{error}<button className='button' onClick={()=>void load()}>Повторить</button></p>:programs===null?<p role='status'>Загружаем избранное…</p>:programs.length?<ul>{programs.slice(0,3).map(p=><li key={p.id}><Link to={`/programs/${p.id}`}>{p.title} <Icon name='arrow'/></Link><span className='muted'>{p.origin==='personal'?'Моя программа':'Каталог'} · {p.steps.length} шаг(а)</span></li>)}</ul>:<p className='muted'>Здесь появятся сохранённые программы. <Link to='/programs'>Выбрать в каталоге</Link></p>}</section>;
}
