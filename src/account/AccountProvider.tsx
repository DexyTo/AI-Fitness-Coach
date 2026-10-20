import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, messageOf, type User } from './api';
import { AccountContext as Context } from './context';
export function AccountProvider({ children }: { children: ReactNode }) {
  const [state,setState] = useState<{ user: User | null; loading: boolean; error: string }>({ user:null, loading:true, error:'' });
  const sequence = useRef(0);
  const ready = useRef(false);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const data = await api<{ user:User | null }>('/auth/me');
      if (seq === sequence.current) { ready.current = true; setState({ user:data.user, loading:false, error:'' }); }
    } catch (e) { if (seq === sequence.current) setState(previous => ({ ...previous, loading:false, error:messageOf(e) })); }
  },[]);
  useEffect(() => {
    void refresh();
    const onStorage = (event: StorageEvent) => { if (event.key === 'playfit.auth.changed') void refresh(); };
    const onFocus = () => { void refresh(); };
    window.addEventListener('storage',onStorage);
    window.addEventListener('focus',onFocus);
    return () => { sequence.current++; window.removeEventListener('storage',onStorage); window.removeEventListener('focus',onFocus); };
  },[refresh]);
  const setUser = (user:User | null) => {
    sequence.current++;
    ready.current = true;
    setState({ user, loading:false, error:'' });
    try { localStorage.setItem('playfit.auth.changed', crypto.randomUUID()); } catch { /* No credentials stored here. */ }
  };
  if (state.loading || (state.error && !ready.current)) return <main className='account-page'><section className='account-card'><h1>PlayFit Vision</h1>{state.loading ? <p role='status'>Проверяем вход…</p> : <><p className='storage-error' role='alert'>{state.error}</p><div className='account-actions'><button className='button button-primary' onClick={() => void refresh()}>Повторить подключение</button><button className='button' onClick={() => setUser(null)}>Продолжить гостем</button></div><p className='muted'>Гость сохраняет тренировки только в этом браузере.</p></>}</section></main>;
  return <Context.Provider value={{ user:state.user, setUser, refresh }}><div key={state.user?.id ?? 'guest'}>{state.error && <div className='connection-banner' role='alert'>{state.error} <button className='button' onClick={() => void refresh()}>Повторить подключение</button></div>}{children}</div></Context.Provider>;
}
