import { ResultOverview, ResultLinks } from './ResultOverview';
import { readPreferences } from './PreferencesView';
import { ExerciseGuide, ExerciseOptionsFields, SideSummary } from './ExerciseSetup';
import { exerciseRegistry, isHold, isLegacy, optionsFor, criterionName } from '../exercises/registry';
import { goalValue, resultValue, validExerciseGoal, type TrainingGoal as Goal } from '../../shared/workout';
import { useEffect, useMemo, useState } from 'react';
import { useAccount } from '../account/context';
import { AccountPersistence, type TrainingPersistence } from '../account/api';
import type { TrainingGoal } from '../training/session';
import type { ExerciseType, InputMode, FeedbackCode } from '../exercises/types';
import { criterionLabels, labels } from '../exercises/types';
import { criterionTotals } from '../exercises/coaching';
import { AttemptReport } from './AttemptReport';
import { useTraining } from '../hooks/useTraining';
import { useVoiceFeedback } from '../hooks/useVoiceFeedback';
import { combineResults, phaseLabels, validGoal } from '../training/session';
import { downloadJson } from '../training/history';
import { WorkoutDetails } from './HistoryView';
import { Icon } from './Icon';
import { RewardNotice } from '../account/ProgressionViews';
import type { DemoScenario } from '../pose/demo';


interface Props {
  exercise: ExerciseType;
  mode: InputMode;
  onHome: () => void;
  programStep?: {goal:TrainingGoal; conditions:string; persistence:TrainingPersistence};
}

const pad = (n: number) => String(n).padStart(2, '0');

function readable(seconds: number) {
  const whole = Math.floor(seconds);
  return `${pad(Math.floor(whole / 60))}:${pad(whole % 60)}`;
}

export function TrainingView({ exercise, mode, onHome, programStep }: Props) {
  const { user } = useAccount();
  const accountPersistence = useMemo(() => user ? new AccountPersistence(user.id) : undefined, [user?.id]);
  const persistence = programStep?.persistence ?? accountPersistence;
  const [videoUrl, setVideoUrl] = useState('');
  const [attemptedStart, setAttemptedStart] = useState(false);
  const [demoScenario,setDemoScenario]=useState<DemoScenario>('normal');
  const [goalFields, setGoalFields] = useState(programStep ? {sets:String(programStep.goal.sets),reps:String(goalValue(programStep.goal)),restSeconds:String(programStep.goal.restSeconds)} : readPreferences(user?.id));
  const [conditions, setConditions] = useState(programStep?.conditions ?? '');
  const [options,setOptions]=useState(()=>optionsFor(exercise,programStep?.goal.options));
  const hold=isHold(exercise), def=exerciseRegistry[exercise];
  const base={sets:Number(goalFields.sets||NaN),restSeconds:Number(goalFields.restSeconds||NaN)};
  const goal:Goal=programStep?.goal ?? (hold?{...base,schemaVersion:2,unit:'seconds',seconds:Number(goalFields.reps||NaN),options}:{...base,reps:Number(goalFields.reps||NaN),...(!isLegacy(exercise)?{schemaVersion:2,unit:'reps',options} as const:{})});
  const goalIsValid=validGoal(goal)&&validExerciseGoal(exercise,goal);
  useEffect(
    () => () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    },
    [videoUrl],
  );
  const {
    videoRef,
    canvasRef,
    analysis,
    cue,
    status,
    started,
    starting,
    seconds,
    session,
    start,
    finish,
    confirmSideView,
    seek,
    restart,
    phase, setNumber, restSeconds, pause, resume, endSet, saveError, saving, retrySave, reward,
  } = useTraining({ exercise, mode, videoUrl, goal, conditions, persistence, demoScenario });
  useEffect(() => { if (started || session) window.scrollTo({ top: 0, behavior: 'smooth' }); }, [started, session]);
  useEffect(() => { if (started) setAttemptedStart(false); }, [started]);
  const startupFailed = attemptedStart && !started && !starting;
  const {
    enabled: voiceEnabled,
    setEnabled: setVoiceEnabled,
    supported: voiceSupported,
  } = useVoiceFeedback(started && phase === 'active' && !session && analysis.state !== 'Оценка приостановлена', cue);
  const accepting = phase === 'active' || phase === 'preparing';
  const previousAttempt = analysis.result.attempts.at(-1);
  const onFile = (file?: File) => {
    if (!file) return;
    setVideoUrl(URL.createObjectURL(file));
  };
  if (session && programStep) return <p role='status'>Собираем результат шага…</p>;
  if (session) {
    const result = combineResults(session.sets.map(s => s.result));
    return (
      <main className='results page-enter'>
        <div className='results-icon'>✓</div>
        <span className='eyebrow'>ТРЕНИРОВКА ЗАВЕРШЕНА</span>
        <h1>
          Хорошая работа<span className='accent'>.</span>
        </h1>
        <p className='muted'>
          {labels[exercise]} · {readable(session.duration)} ·{' '}
          {mode === 'demo' ? 'Демо' : mode === 'video' ? 'Видеофайл' : 'Камера'}
        </p>
        <ResultOverview record={session} />
        <ResultLinks repeat={restart} disabled={saving || !!saveError} />
        <SideSummary result={result}/>
        {!saving && !saveError && <RewardNotice reward={reward} guest={!persistence}/>}
        {!hold&&<details className='criterion-summary' aria-label='Результаты по критериям'>
          <summary>Что удалось проверить</summary>
          <p>Предварительные критерии. Это результаты наблюдений, а не процент техники.</p>
          {result.attempts.length ? <ul className='criterion-list'>{Object.entries(criterionTotals(result)).map(([code, total]) => <li key={code}>
            <b>{isLegacy(exercise)?criterionLabels[code as FeedbackCode]:criterionName(exercise,code as FeedbackCode)}</b>: выполнен в {total.passed}, отклонение в {total.deviation}, не оценён в {total.unassessed} попытках.
          </li>)}</ul> : <p>Попыток для проверки пока нет.</p>}
        </details>}
        {result.attempts.length > 0 && (
          <section className='attempt-report' aria-label='Разбор попыток'>
            <h2>Разбор попыток</h2>
            {result.attempts.map(attempt => (
              <AttemptReport key={attempt.id} attempt={attempt} exercise={exercise} compact />
            ))}
          </section>
        )}
        {hold&&<p>Удержания пока не входят в механику XP и соревнований.</p>}
        <div className='result-actions'>
          <button className='button' onClick={() => downloadJson({ schemaVersion: 1, records: [session] }, 'playfit-workout.json')}>Экспорт результата JSON</button>
          {saveError && <button className='button' disabled={saving} onClick={retrySave}>Повторить сохранение</button>}
          {mode === 'video' && <button className='button' onClick={restart}>Повторить запись с нуля</button>}
          <button className='button button-primary' onClick={onHome}>
            Новая тренировка <span>↗</span>
          </button>
        </div>
        <p role={saveError ? 'alert' : 'status'} className={saveError ? 'storage-error' : 'muted'}>{saving ? 'Сохраняем результат… Не закрывай страницу до подтверждения.' : saveError || (user ? `Результат сохранён в локальной серверной базе аккаунта @${user.login}.` : 'Гостевой результат сохранён в истории этого браузера.')}</p>
        {mode !== 'camera' && <p className='fine-print'>Демо и анализ видеофайлов не начисляют игровые награды.</p>}
        <details className='result-details'><summary>Подходы, условия и параметры</summary><WorkoutDetails record={session} /></details>
        <p className='disclaimer'>
          Проверки основаны на 2D-точках и приблизительных правилах. Отсутствие замечаний не подтверждает безопасность движения.
        </p>
      </main>
    );
  }
  return (
    <main className={`workout page-enter ${started ? 'workout-live' : 'workout-setup'}`}>
      {!started && <div className='preparation-steps' aria-label='Этапы подготовки'><span className='done'>1 · Упражнение</span><i /><span className='current'>2 · Камера и план</span><i /><span>3 · Движение</span></div>}
      <div className='workout-heading'>
        <div>
          <span className='eyebrow'>
            ТРЕНИРОВОЧНАЯ СЕССИЯ /{' '}
            {mode === 'demo' ? 'ДЕМО' : mode === 'video' ? 'ВИДЕО' : 'КАМЕРА'}
            {started && user?.isDemo ? ' · УЧЕБНЫЙ АККАУНТ' : ''}
          </span>
          <h1>
            {labels[exercise]}
            <span className='accent'>.</span>
          </h1>
          {started && <span className='live-plan'>Подход {setNumber} / {goal.sets} · цель {goalValue(goal)} {hold ? 'с' : 'повт.'}</span>}
          <p className='muted'>
            {started ? 'Сосредоточься на движении. Подсказки — рядом.' : 'Настрой камеру и выбери цель подхода.'}
          </p>
        </div>
        <div className='clock'>
          ◷ <span>{readable(seconds)}</span>
        </div>
      </div>
      {programStep && !started && <button className='button' disabled={starting} onClick={onHome}>Прервать программу до запуска шага</button>}
      {started && <section className='session-controls' aria-label='Управление сессией'>
        <p role='status'><b>{phaseLabels[phase]}</b> · Подход {setNumber}/{goal.sets} · {phase === 'next' ? `Цель следующего: ${goalValue(goal)} ${hold?'с':'повт.'}` : `В текущем: ${resultValue(analysis.result).toFixed(hold?1:0)}/${goalValue(goal)} ${hold?'с':'повт.'}`}{phase === 'rest' ? ` · осталось ${restSeconds} с` : ''}</p>
        {!accepting && <p>Движения не учитываются, технические подсказки выключены. Перед продолжением снова удерживайте исходную позицию.</p>}
        {accepting && <button className='button' onClick={pause}>Пауза</button>}
        {(phase === 'paused' || phase === 'next') && <button className='button button-primary' onClick={() => void resume()}>{phase === 'next' ? 'Начать следующий подход' : 'Продолжить с подготовки'}</button>}
        {(accepting || phase === 'paused') && <button className='button' onClick={endSet}>Завершить подход</button>}
      </section>}
      <div className={`workout-grid ${!started ? 'preparing-layout' : ''}`}>
        <section className='camera-card' aria-label='Область анализа движения'>
          <div className='camera-top'>
            <span className='live-label'>
              <i />
              {started ? phaseLabels[phase] : 'ОЖИДАНИЕ'}
            </span>
            <span className='top-right'>
              {mode === 'demo'
                ? 'СИМУЛЯЦИЯ'
                : mode === 'video'
                  ? 'ЛОКАЛЬНОЕ ВИДЕО'
                  : 'LIVE FEED'}
            </span>
          </div>
          <div className={`stage ${mode === 'demo' ? 'stage-demo' : ''}`}>
            {started && <div className='video-hud'><div><strong>{hold ? resultValue(analysis.result).toFixed(1) : analysis.result.reps}</strong><span>{hold ? 'Секунды' : 'Повторения'}</span></div><div><strong>{readable(seconds)}</strong><span>Время</span></div><span className={`tracking-pill ${analysis.observation.status === 'ready' && accepting ? 'is-ready' : ''}`}>{!accepting ? phaseLabels[phase] : analysis.observation.status === 'ready' ? 'Точки видны' : 'Проверь кадр'}</span></div>}
            {started && !accepting && <div className='pause-overlay' role='status'><Icon name={phase === 'rest' ? 'clock' : 'play'} /><h2>{phaseLabels[phase]}</h2><p>{phase === 'rest' ? `Следующий подход через ${restSeconds} с` : 'Нажми продолжить, когда будешь готов(а).'}</p></div>}
            <video
              ref={videoRef}
              muted
              playsInline
              controls={mode === 'video' && started && accepting}
              onPause={() => { if (mode === 'video' && started && accepting && !videoRef.current?.ended) pause(); }}
              onSeeking={seek}
              className='feed'
              style={{ display: mode === 'demo' ? 'none' : 'block' }}
            />
            {mode === 'demo' && (
              <div className='demo-backdrop'>
                <div className='demo-orbit orbit-one' />
                <div className='demo-orbit orbit-two' />
                <span className='demo-badge'>POSE / SIMULATION</span>
              </div>
            )}
            <canvas
              className='pose-overlay'
              ref={canvasRef}
              aria-hidden='true'
            />
            {started && accepting && <div className='live-cue' role='status'><Icon name='volume' /><span>{cue?.message ?? 'Удерживай исходную позицию. Проверяем наблюдение…'}</span></div>}
            {!started && (
              <div className='start-overlay'>
                <div className='start-icon'>
                  <Icon name={mode === 'camera' ? 'camera' : mode === 'video' ? 'video' : 'play'} />
                </div>
                <h2>
                  {startupFailed ? 'Не удалось начать' : mode === 'camera'
                    ? 'Твоё место для движения'
                    : mode === 'video'
                      ? 'Проверьте своё видео'
                      : 'Познакомься с тренировкой'}
                </h2>
                <p role={startupFailed ? 'alert' : undefined}>
                  {startupFailed ? status : mode === 'camera'
                    ? 'Разреши доступ к камере. Видео обрабатывается только на твоём устройстве.'
                    : mode === 'video'
                      ? 'Загрузите запись упражнения: анализ пройдёт через ту же модель, что и камера.'
                      : 'Посмотри на счётчик и подсказки без камеры. Движение в демо смоделировано.'}
                </p>
                {mode === 'video' && (
                  <label className='file-picker'>
                    Выбрать видео
                    <input
                      type='file'
                      accept='video/*'
                      onChange={(e) => onFile(e.target.files?.[0])}
                    />
                  </label>
                )}
                {mode === 'video' && videoUrl && <small>Видео выбрано ✓</small>}
                <button
                  className='button button-primary'
                  onClick={() => { setAttemptedStart(true); void start(); }}
                  disabled={starting || !goalIsValid || (mode === 'video' && !videoUrl)}
                >
                  {starting ? 'Подготовка…' : startupFailed ? 'Попробовать снова' : mode === 'camera'
                    ? 'Разрешить доступ к камере'
                    : mode === 'video'
                      ? 'Запустить анализ'
                      : 'Запустить демо'}{' '}
                  <Icon name='arrow' />
                </button>
                {!goalIsValid && <small>Сначала заполни три поля в блоке «Твой план».</small>}
              </div>
            )}
          </div>
          {started && <div className='camera-actions' aria-label='Управление у видео'><button className='camera-sound' aria-label={voiceEnabled ? 'Выключить голос' : 'Включить голос'} aria-pressed={voiceEnabled} disabled={!voiceSupported} onClick={() => setVoiceEnabled(v => !v)}><Icon name='volume' /></button>{accepting ? <button className='camera-pause' onClick={pause} aria-label='Поставить на паузу'>Ⅱ</button> : (phase === 'paused' || phase === 'next') ? <button className='camera-pause' onClick={() => void resume()} aria-label='Продолжить тренировку'><Icon name='play' /></button> : <span className='camera-rest'>{restSeconds} с</span>}<button className='camera-finish' onClick={finish} aria-label={programStep ? 'Прервать программу у видео' : 'Завершить тренировку у видео'}><span>■</span><small>{programStep ? 'Прервать' : 'Завершить'}</small></button></div>}
          <div className='camera-bottom'>
            <span className='status-dot' aria-hidden='true' />
            <span role='status'>{status}</span>
            <span className='fps'>POSE TRACKING</span>
          </div>
        </section>
        <aside className='dashboard'>
      {!started&&mode==='demo'&&<fieldset className='exercise-options' disabled={starting}><legend>Синтетическое демо</legend><label>Сценарий симуляции<select value={demoScenario} onChange={e=>setDemoScenario(e.target.value as DemoScenario)}><option value='normal'>Полный цикл / удержание</option><option value='occlusion'>Перекрытие обязательных точек</option><option value='no_pose'>Человек пропал из кадра</option><option value='source_gap'>Остановка источника</option></select></label><p className='fine-print'>Пропуск искусственно задан на 2,4–4,3 с каждого 9-секундного отрезка. Это проверка интерфейса, без камеры.</p></fieldset>}
      {!started&&!isLegacy(exercise)&&<ExerciseOptionsFields exercise={exercise} value={options} onChange={setOptions} disabled={starting||!!programStep}/>}
      {!started && <fieldset className='session-goal' disabled={starting || !!programStep}>
        <legend>Твой план</legend>
        <p className='goal-intro'>Цель выбираешь ты. Мы поможем следить за счётом.</p>
        <div className='goal-fields'>
          <label>Подходы<input type='number' inputMode='numeric' placeholder='1–100' min='1' max='100' step='1' value={goalFields.sets} onChange={e => setGoalFields(v => ({ ...v, sets: e.target.value }))} /></label>
          <label>{hold?'Удержание в подходе, с':'Повторы в подходе'}<input type='number' inputMode='numeric' placeholder={hold?'1–3600':'1–1000'} min='1' max={hold?'3600':'1000'} step='1' value={goalFields.reps} onChange={e => setGoalFields(v => ({ ...v, reps: e.target.value }))} /></label>
          <label>Отдых, секунды<input type='number' inputMode='numeric' placeholder='0–3600' min='0' max='3600' step='1' value={goalFields.restSeconds} onChange={e => setGoalFields(v => ({ ...v, restSeconds: e.target.value }))} /></label>
        </div>
        <details className='plan-details'><summary>Условия съёмки и правила подсчёта <span>Необязательно</span></summary>
          <label>Условия съёмки для сравнения<input type='text' maxLength={200} value={conditions} placeholder='Например: комната, камера сбоку, дневной свет' onChange={e => setConditions(e.target.value)} /></label>
          <p>{hold?'В цель входят только наблюдаемые интервалы удержания с выполненными критериями.':'В цель входят только полные оценённые циклы.'} Неполные и неоценённые попытки сохраняются отдельно. При достижении цели подход завершится автоматически.</p>
          <p>Для сравнения тренировок укажи одинаковые условия съёмки. {user ? 'Результаты сохраняются в локальной серверной базе аккаунта.' : 'Гостевые результаты хранятся в этом браузере.'} Видео и поток точек не отправляются на сервер. Цель — твой выбор, а не рекомендация нагрузки.</p>
        </details>
        {Object.values(goalFields).some(Boolean) && !goalIsValid && <p className='field-hint'>Заполни три поля целыми числами в указанных диапазонах.</p>}
      </fieldset>}
          {exercise !== 'squat'&&(!started?<ExerciseGuide exercise={exercise}/>:<details className='exercise-instructions'><summary>Инструкция и расположение камеры</summary><ExerciseGuide exercise={exercise}/></details>)}
          {exercise === 'squat' && mode !== 'demo' && (!started || analysis.preparation.stage !== 'active') && <section className='camera-guide' aria-label='Подготовка камеры для приседаний сбоку'>
            <strong>Приседания без веса · съёмка сбоку</strong>
            <svg viewBox='0 0 320 125' role='img' aria-label='Камера на уровне таза направлена на человека в профиль; плечо, таз, колено и лодыжка остаются в кадре'>
              <g fill='none' stroke='currentColor' strokeWidth='4' strokeLinecap='round' strokeLinejoin='round'>
                <rect x='20' y='49' width='28' height='22' rx='4' /><path d='m48 55 14-7v25l-14-8M34 72v37m0-22-13 22m13-22 13 22' />
                <path d='M80 61h62' strokeDasharray='5 7' strokeWidth='2' />
                <circle cx='190' cy='18' r='10' /><path d='m190 29 0 37 5 23v22h18M190 37l20 14h20' />
                <circle cx='190' cy='37' r='3' /><circle cx='190' cy='66' r='3' /><circle cx='195' cy='89' r='3' />
                <path d='M165 4h77v112h-77z' strokeDasharray='4 6' strokeWidth='1' />
              </g>
              <text x='17' y='123' fill='currentColor' fontSize='10'>КАМЕРА</text><text x='250' y='63' fill='currentColor' fontSize='11'>ПРОФИЛЬ</text>
            </svg>
            <p>Камера на уровне таза. Встань боком и оставь плечо, таз, колено и лодыжку в кадре. Перед стартом ненадолго замри стоя.</p>
            {started && accepting && <>
              <p><b>Ракурс:</b> {({ side: 'похож на боковой (эвристика)', unsuitable: 'повернитесь боком', unknown: 'не удалось определить', not_required: 'не проверяется' }[analysis.preparation.view])}</p>
              {analysis.preparation.view === 'unknown' && !analysis.preparation.viewConfirmed && analysis.observation.status === 'ready' && <button className='button' onClick={confirmSideView}>Подтверждаю съёмку сбоку по примеру</button>}
            </>}
          </section>}
          {started&&accepting&&!isLegacy(exercise)&&def.view==='side'&&analysis.observation.status==='ready'&&analysis.preparation.view==='unknown'&&!analysis.preparation.viewConfirmed&&<button className='button' onClick={confirmSideView}>Подтверждаю съёмку сбоку по схеме</button>}
          <div className='dashboard-title'>
            <span>ПАНЕЛЬ ТРЕНИРОВКИ</span>
            <button
              type='button'
              className='voice-toggle'
              onClick={() => setVoiceEnabled((value) => !value)}
              disabled={!voiceSupported}
              aria-pressed={voiceEnabled}
              title={
                voiceSupported
                  ? 'Включить или выключить голосовые подсказки'
                  : 'Озвучивание не поддерживается этим браузером'
              }
            >
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='1.8'
                strokeLinecap='round'
                strokeLinejoin='round'
                aria-hidden='true'
              >
                <path d='M4 9v6h4l5 4V5L8 9H4Z' />
                {voiceEnabled ? (
                  <path d='M17 9a5 5 0 0 1 0 6M19 6a9 9 0 0 1 0 12' />
                ) : (
                  <path d='m17 9 5 6m0-6-5 6' />
                )}
              </svg>
              {voiceSupported
                ? voiceEnabled
                  ? 'Звук включён'
                  : 'Звук выключен'
                : 'Звук недоступен'}
            </button>
          </div>
          <p className='variant-note'>{def.equipment} · {def.view==='side'?'Вид сбоку':'Вид спереди'} · {options.variant==='seated'?'Сидя':options.variant==='standing'?'Стоя':'Основной вариант'} · Предварительные правила</p>
          <div className='rep-block'>
            <span className='metric-label'>{hold?'ЗАСЧИТАННЫЕ СЕКУНДЫ':phase === 'rest' || phase === 'next' ? 'ПОЛНЫЕ В ПРЕДЫДУЩЕМ ПОДХОДЕ' : 'ПОВТОРЕНИЯ'}</span>
            <div className='rep-value'>
              {hold?resultValue(analysis.result).toFixed(1):pad(analysis.result.reps)}
              <span className='rep-suffix'> / {goalIsValid ? goalValue(goal) : '—'}</span>
            </div>
            <div className='progress-track'>
              <div
                style={{
                  width: `${Math.min(100, resultValue(analysis.result) / goalValue(goal) * 100) || 0}%`,
                }}
              />
            </div>
            <small>{hold?'Засчитанные секунды':'Полные циклы'} {phase === 'rest' || phase === 'next' ? 'предыдущего' : 'текущего'} подхода · цель {goalIsValid ? goalValue(goal) : 'не задана'}</small>
          </div>
          <SideSummary result={analysis.result}/>
          {hold&&analysis.result.hold&&<p>Непрерывно до {(analysis.result.hold.longestMs/1000).toFixed(1)} с · Отклонения {(analysis.result.hold.deviationMs/1000).toFixed(1)} с · Не оценено {(analysis.result.hold.unassessedMs/1000).toFixed(1)} с</p>}
          <div className='mini-metrics'>
            <div>
              <span className='metric-label'>ФАЗА ДВИЖЕНИЯ</span>
              <strong>{!started ? 'Ожидание' : accepting ? analysis.state : phaseLabels[phase]}</strong>
            </div>
            <div>
              <span className='metric-label'>{exercise==='side_bend'?'НАКЛОН КОРПУСА':exercise==='glute_bridge'?'УГОЛ ПЛЕЧО–ТАЗ–КОЛЕНО':exercise==='forearm_plank'?'ЛИНИЯ ТЕЛА':!isLegacy(exercise)&&['front_hold','overhead_press','lateral_raise'].includes(exercise)?'МЕНЬШИЙ УГОЛ ПОДЪЁМА РУК':'УГОЛ КОЛЕНА / ЛОКТЯ'}</span>
              <strong>
                {started && accepting && analysis.angle !== null
                  ? `${analysis.angle}°`
                  : '—'}
              </strong>
            </div>
          </div>
          {accepting&&analysis.metrics?.leftArm!==undefined&&<details className='exercise-instructions'><summary>Измерения обеих рук</summary><p>Левая: угол подъёма {Math.round(analysis.metrics.leftArm)}°, локоть {Math.round(analysis.metrics.leftElbow)}°.</p><p>Правая: угол подъёма {Math.round(analysis.metrics.rightArm)}°, локоть {Math.round(analysis.metrics.rightElbow)}°.</p></details>}
          <div className='score-row'>
            <div>
              <span className='metric-label'>НАБЛЮДЕНИЕ</span>
              <strong>{!started ? 'Ожидание' : !accepting ? 'Наблюдение приостановлено' : analysis.observation.status === 'ready' ? 'Нужные точки видны' : 'Недостаточно данных'}</strong>
              {!hold&&<small>Неполных: {analysis.result.incomplete} · Не оценено: {analysis.result.unassessed} · С замечаниями: {analysis.result.withErrors}</small>}
            </div>
          </div>
          <div className='feedback'>
            <span className='metric-label'>СЕЙЧАС · {started ? phaseLabels[phase] : 'Ожидание'}</span>
            <div
              role='status' aria-live='polite' aria-atomic='true'
              className={`feedback-message ${cue?.kind === 'technique' || cue?.kind === 'observation' ? 'warning' : ''}`}
            >
              <span aria-hidden='true'>{cue?.kind === 'technique' || cue?.kind === 'observation' ? '!' : '·'}</span>
              <p>
                {started ? !accepting ? 'Движения не учитываются. Технические подсказки приостановлены.' : cue?.message ?? 'Проверяем наблюдение…' : 'После запуска здесь появится текущая подсказка.'}
                {cue?.target && <span className='target-note'>Метка «! {cue.target.label}» на видео относится к этому замечанию.</span>}
              </p>
            </div>
          </div>
          {previousAttempt && <section className='previous-attempt' aria-label='Предыдущая попытка'>
            <span className='metric-label'>ПРЕДЫДУЩАЯ ПОПЫТКА</span>
            <AttemptReport attempt={previousAttempt} exercise={exercise} compact />
          </section>}
          <button
            className='button button-end'
            disabled={!started}
            onClick={finish}
          >
            {programStep ? 'Прервать программу' : 'Завершить тренировку'} <span>↗</span>
          </button>
        </aside>
      </div>
      <p className='workout-note'>
        {mode === 'video' && 'Запись анализируется один раз. Перемотка прерывает попытку и требует новой исходной позиции; повторный запуск сбрасывает счётчики. '}
        {mode === 'demo'
          ? 'В демо используется заранее заданная последовательность точек; распознавание камерой здесь не выполняется.'
          : 'Видеокадры обрабатываются на этом устройстве. Результат зависит от освещения и ракурса.'}
      </p>
    </main>
  );
}
