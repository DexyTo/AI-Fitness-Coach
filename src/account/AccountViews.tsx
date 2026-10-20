import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAccount } from './context';
import { api, messageOf, type User } from './api';
import { ProfileFavorites } from '../programs/ProgramLibrary';
import { ProfileProgression } from './ProgressionViews';

export const avatars = { sprout:'Росток', bolt:'Молния', sun:'Солнце', mountain:'Горы' };
export function Avatar({ name }: { name: string }) {
  return <span className={`avatar avatar-${name}`}><svg viewBox='0 0 48 48' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
    {name === 'bolt' ? <path d='M27 6 12 27h12l-3 15 15-23H24Z' /> : name === 'sun' ? <><circle cx='24' cy='24' r='8' /><path d='M24 4v5m0 30v5M4 24h5m30 0h5M10 10l4 4m20 20 4 4m0-28-4 4M14 34l-4 4' /></> : name === 'mountain' ? <><path d='m5 37 14-24 8 14 5-8 11 18ZM14 22l5 3 5-4' /></> : <><path d='M24 40V24C8 27 7 12 7 12s16-2 17 12c0-14 17-16 17-16s2 17-17 16M17 40h14' /></>}
  </svg></span>;
}
export function AuthView({ register = false }: { register?: boolean }) {
  const { user,setUser } = useAccount();
  const navigate = useNavigate();
  const [login,setLogin] = useState(''), [password,setPassword] = useState(''), [repeat,setRepeat] = useState('');
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  if (user) return <Navigate to='/overview' replace />;
  const submit = async (event:FormEvent) => {
    event.preventDefault(); setError('');
    if (register && repeat !== password) { setError('Пароли не совпадают.'); return; }
    setBusy(true);
    try {
      const data = await api<{ user:User }>(register ? '/auth/register' : '/auth/login', { method:'POST', body:{ login,password } });
      setUser(data.user); void navigate('/overview',{ replace:true });
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };
  return <main className='account-page page-enter'><div className='account-intro'><span className='eyebrow'>ТВОЁ ПРОСТРАНСТВО</span><h1>{register ? 'Начни свою' : 'Продолжай'}<br />историю<span className='accent'>.</span></h1><p>Тренировки, повторы и личные наблюдения — в одном профиле.</p><div className='local-note'><Icon name='shield' /><p>Видео и точки тела остаются в браузере. В аккаунте хранятся только результаты в локальной базе приложения.</p></div><Link className='button button-ghost' to='/'>Продолжить без аккаунта <Icon name='arrow' /></Link></div>
    <section className='account-card' aria-labelledby='auth-title'><h2 id='auth-title'>{register ? 'Создать аккаунт' : 'Войти в аккаунт'}</h2><p className='muted'>{register ? 'Придумай логин и сохрани пароль.' : 'Используй свой логин и пароль.'}</p><form onSubmit={e => void submit(e)}>
      <fieldset disabled={busy} className='account-fields'><label>Логин<input required autoComplete='username' autoCapitalize='none' spellCheck={false} minLength={3} maxLength={32} pattern='[a-zA-Z0-9_]{3,32}' value={login} onChange={e => setLogin(e.target.value)} aria-describedby='login-help' /></label><small id='login-help'>3–32 символа: латинские буквы, цифры, _</small><label>Пароль<input required type='password' autoComplete={register ? 'new-password' : 'current-password'} minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></label><small>От 8 до 128 символов.</small>{register && <label>Повтори пароль<input required type='password' autoComplete='new-password' minLength={8} maxLength={128} value={repeat} onChange={e => setRepeat(e.target.value)} /></label>}
      {error && <p role='alert' className='storage-error'>{error}</p>}<button className='button button-primary' type='submit'>{busy ? 'Подождите…' : register ? 'Зарегистрироваться' : 'Войти'}<Icon name='arrow' /></button></fieldset>
    </form><p className='account-switch'>{register ? 'Уже есть аккаунт?' : 'Впервые здесь?'} <Link to={register ? '/login' : '/register'}>{register ? 'Войти' : 'Создать аккаунт'}</Link></p>{register && <p className='fine-print'>Восстановление пароля пока недоступно. Гостевая история не переносится автоматически.</p>}</section></main>;
}
interface ProfileData { user:User; stats:{ workouts:number; reps:number; seconds:number; demos:number } }
export function ProfileView() {
  const { user,setUser } = useAccount();
  const [data,setData] = useState<ProfileData | null>(null), [error,setError] = useState(''), [loading,setLoading] = useState(true);
  const [nickname,setNickname] = useState(user?.nickname ?? ''), [avatar,setAvatar] = useState(user?.avatar ?? 'sprout');
  const [busy,setBusy] = useState(false), [notice,setNotice] = useState('');
  const load = async () => {
    if (!user) return;
    setLoading(true); setError('');
    try { setData(await api<ProfileData>('/profile',{ userId:user.id })); } catch(e) { setError(messageOf(e)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); },[user?.id]);
  if (!user) return <Navigate to='/login' replace />;
  const save = async (event:FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { const result = await api<{ user:User }>('/profile',{ method:'PATCH', userId:user.id, body:{ nickname,avatar } }); setUser(result.user); setNickname(result.user.nickname); setNotice('Профиль сохранён.'); }
    catch(e) { setError(messageOf(e)); } finally { setBusy(false); }
  };
  const logout = async () => {
    setBusy(true); setError('');
    try { await api('/auth/logout',{ method:'POST',body:{},userId:user.id }); setUser(null); }
    catch(e) { setError(messageOf(e)); } finally { setBusy(false); }
  };
  return <main className='profile-page page-enter'><div className='page-heading'><div><span className='eyebrow'>ЛИЧНЫЙ ПРОФИЛЬ</span><h1>Твой ритм<span className='accent'>.</span></h1><p className='muted'>@{user.login} · С нами с {new Date(user.createdAt).toLocaleDateString('ru-RU')}</p></div><Link className='button' to='/history'><Icon name='history' />Открыть историю</Link></div>
    {error && <div role='alert' className='storage-error'>{error} <button className='button' disabled={loading} onClick={() => void load()}>Повторить загрузку</button></div>}
    <div className='account-actions program-tabs'><Link className='button' to='/my-programs'>Мои программы</Link><Link className='button' to='/favorites'><Icon name='star'/>Избранное</Link><Link className='button' to='/programs/new'>Создать программу <Icon name='arrow'/></Link></div>
    <div className='profile-grid'><section className='account-card'><div className='profile-identity'><Avatar name={avatar} /><div><h2>{user.nickname}</h2><p className='muted'>Твой знак движения</p></div></div><form onSubmit={e => void save(e)}><fieldset disabled={busy} className='account-fields'><label>Никнейм<input required maxLength={32} value={nickname} onChange={e => { setNickname(e.target.value); setNotice(''); }} /></label><fieldset className='avatar-picker'><legend>Выбери аватар</legend>{Object.entries(avatars).map(([id,label]) => <button className='avatar-option' key={id} type='button' aria-label={label} aria-pressed={avatar === id} onClick={() => { setAvatar(id); setNotice(''); }}><Avatar name={id} /><span>{label}</span></button>)}</fieldset><button className='button button-primary' disabled={!nickname.trim()} type='submit'>{busy ? 'Сохранение…' : 'Сохранить профиль'}<Icon name='check' /></button></fieldset></form>{notice && <p role='status' className='accent'>{notice}</p>}</section>
    <section className='profile-summary'><span className='eyebrow'>ПО ДАННЫМ ИСТОРИИ</span><h2>Движение в цифрах</h2>{loading ? <p role='status'>Загружаем показатели…</p> : data && <><div className='profile-stats'><div><strong>{data.stats.workouts}</strong><span>Тренировок</span></div><div><strong>{data.stats.reps}</strong><span>Полных повторов</span></div><div><strong>{Math.floor(data.stats.seconds/60)}</strong><span>Минут с подготовкой</span></div></div><p className='muted'>Камера, видео и явно импортированные записи. Демо отдельно: {data.stats.demos}. Скрытые записи не входят в показатели.</p>{data.stats.workouts === 0 && <Link className='button button-primary' to='/'>Выбрать тренировку <Icon name='arrow' /></Link>}</>}<details><summary>Как хранятся данные</summary><p>Распознавание, видео и поток точек остаются на устройстве. Результаты этого аккаунта хранятся в локальной серверной базе SQLite. Гостевая история хранится отдельно в браузере. В истории можно явно импортировать её без игровых наград и сохранить JSON-копию.</p></details><button className='button button-ghost' disabled={busy} onClick={() => void logout()}>Выйти из аккаунта</button></section></div>
  <ProfileProgression key={user.id}/><ProfileFavorites/></main>;
}
