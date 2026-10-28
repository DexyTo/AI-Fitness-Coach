import { useEffect, useState, type FormEvent } from 'react';
import { useAccount } from '../account/context';
import { useVoiceFeedback } from '../hooks/useVoiceFeedback';
import { Icon } from './Icon';
import { Link } from 'react-router-dom';

export interface Preferences { sets: string; reps: string; restSeconds: string; goal: string }
const defaults: Preferences = { sets: '1', reps: '10', restSeconds: '30', goal: 'consistency' };
export function readPreferences(userId?: string): Preferences {
  try {
    const data = JSON.parse(localStorage.getItem(`playfit.preferences.${userId ?? 'guest'}`) ?? 'null');
    if (data && /^\d+$/.test(data.sets) && +data.sets >= 1 && +data.sets <= 100 && /^\d+$/.test(data.reps) && +data.reps >= 1 && +data.reps <= 1000 && /^\d+$/.test(data.restSeconds) && +data.restSeconds <= 3600 && ['consistency', 'technique', 'strength'].includes(data.goal)) return data as Preferences;
  } catch { /* Storage may be unavailable; the training form remains usable. */ }
  return { ...defaults };
}
export function PreferencesPanel() {
  const { user } = useAccount();
  const [prefs, setPrefs] = useState(() => readPreferences(user?.id)), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const { enabled, setEnabled, supported, error: voiceError, testSound } = useVoiceFeedback(false, null);
  const [camera, setCamera] = useState('Доступ запрашивается перед тренировкой'), [busy, setBusy] = useState(false);
  useEffect(() => { setPrefs(readPreferences(user?.id)); }, [user?.id]);
  const save = (e: FormEvent) => {
    e.preventDefault(); setError('');
    try { localStorage.setItem(`playfit.preferences.${user?.id ?? 'guest'}`, JSON.stringify(prefs)); setNotice('Настройки сохранены на этом устройстве.'); }
    catch { setNotice(''); setError('Не удалось сохранить настройки. Разреши локальное хранилище и повтори.'); }
  };
  const checkCamera = async () => {
    setBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('В этом браузере камера недоступна.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => track.stop()); setCamera('Камера доступна. Можно начинать тренировку.');
    } catch (e) { setCamera(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Доступ запрещён. Разреши камеру в настройках браузера и повтори.' : e instanceof Error ? `Камера недоступна: ${e.message}` : 'Не удалось подключить камеру.'); }
    finally { setBusy(false); }
  };
  return <section className='preferences-panel' aria-label='Настройки тренировок'><form onSubmit={save}><div className='preferences-grid'>
    <section className='surface preference-card' id='goals'><h2>Твои цели</h2><p className='muted'>Личный ориентир для следующих тренировок.</p><div className='goal-choices'>{([{ id: 'strength', name: 'Стать сильнее', icon: 'squat' }, { id: 'technique', name: 'Следить за техникой', icon: 'activity' }, { id: 'consistency', name: 'Тренироваться регулярно', icon: 'history' }] as const).map(item => <button type='button' key={item.id} aria-pressed={prefs.goal === item.id} onClick={() => { setPrefs(v => ({ ...v, goal: item.id })); setNotice(''); }}><Icon name={item.icon} /><b>{item.name}</b><span className='choice-dot'>{prefs.goal === item.id && <Icon name='check' />}</span></button>)}</div></section>
    <section className='surface preference-card'><h2>План по умолчанию</h2><p className='muted'>Подставим в новую тренировку. Цель можно изменить.</p><div className='preference-fields'>{([{ key: 'sets', text: 'Подходы', min: 1, max: 100 }, { key: 'reps', text: 'Повторы / секунды удержания', min: 1, max: 1000 }, { key: 'restSeconds', text: 'Отдых между подходами, с', min: 0, max: 3600 }] as const).map(field => <label key={field.key}>{field.text}<input required type='number' min={field.min} max={field.max} step='1' value={prefs[field.key]} onChange={e => { setPrefs(v => ({ ...v, [field.key]: e.target.value })); setNotice(''); }} /></label>)}</div></section>
    </div><div className='account-actions'><button className='button button-primary' type='submit'>Сохранить настройки <Icon name='check' /></button></div>{notice && <p role='status' className='success-text'>{notice}</p>}{error && <p role='alert' className='storage-error'>{error}</p>}</form>
    <div className='preferences-grid'><section className='surface preference-card'><h2>Настройки приложения</h2><div className='setting-row'><Icon name='volume' /><span><b>Голосовые подсказки</b><small>{supported ? 'Подсказки во время тренировки · на этом устройстве' : 'Озвучивание не поддерживается браузером'}</small></span><button className='switch' role='switch' aria-label='Голосовые подсказки' aria-checked={enabled} disabled={!supported} onClick={() => setEnabled(v => !v)}><i /></button></div><div className='voice-check'><button type='button' className='button button-ghost' disabled={!supported} onClick={testSound}>Проверить звук</button>{voiceError && <p role='alert' className='storage-error'>{voiceError}</p>}</div><div className='setting-row' id='camera'><Icon name='camera' /><span><b>Доступ к камере</b><small role='status'>{camera}</small></span><button className='button button-ghost' disabled={busy} onClick={() => void checkCamera()}>{busy ? 'Проверяем…' : 'Проверить'}</button></div></section>
    <section className='surface preference-card' id='help'><h2>О приложении</h2><div className='setting-row'><Icon name='user' /><span><b>Язык</b><small>Русский</small></span></div><div className='setting-row'><Icon name='activity' /><span><b>Единицы измерения</b><small>Секунды, повторы, килограммы</small></span></div><details><summary>Помощь и конфиденциальность</summary><p>Размести камеру так, чтобы всё тело помещалось в кадре. Используй равномерный свет. При потере точек оценка приостанавливается; точную причину смотри на экране тренировки.</p><p>Видео и точки не отправляются на сервер. {user ? 'Структурированные результаты сохраняются в серверной базе аккаунта.' : 'Гостевая история сохраняется в браузере.'}</p><p>PlayFit Vision — учебное приложение. Проверки по 2D-точкам предварительные.</p><Link className='text-link' to='/training?exercise=squat&mode=demo'>Попробовать синтетическое демо <Icon name='arrow' /></Link></details></section></div>
  </section>;
}
export function SettingsView() { return <main className='profile-page page-enter'><div className='page-heading'><div><h1>Настройки</h1><p className='muted'>Тренируйся так, как удобно тебе.</p></div></div><PreferencesPanel /></main>; }
