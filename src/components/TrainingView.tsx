import { useEffect, useMemo, useState } from 'react';
import { useAccount } from '../account/context';
import { AccountPersistence, type TrainingPersistence } from '../account/api';
import type { TrainingGoal } from '../training/session';
import type { ExerciseType, InputMode, FeedbackCode } from '../exercises/types';
import { criterionLabels, labels } from '../exercises/types';
import { criterionTotals, nextTask } from '../exercises/coaching';
import { AttemptReport } from './AttemptReport';
import { useTraining } from '../hooks/useTraining';
import { useVoiceFeedback } from '../hooks/useVoiceFeedback';
import { combineResults, phaseLabels, validGoal } from '../training/session';
import { downloadJson } from '../training/history';
import { WorkoutDetails } from './HistoryView';
import { Icon } from './Icon';


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
  const [goalFields, setGoalFields] = useState(programStep ? {sets:String(programStep.goal.sets),reps:String(programStep.goal.reps),restSeconds:String(programStep.goal.restSeconds)} : { sets: '', reps: '', restSeconds: '' });
  const [conditions, setConditions] = useState(programStep?.conditions ?? '');
  const goal = { sets: Number(goalFields.sets || NaN), reps: Number(goalFields.reps || NaN), restSeconds: Number(goalFields.restSeconds || NaN) };
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
    phase, setNumber, restSeconds, pause, resume, endSet, saveError, saving, retrySave,
  } = useTraining({ exercise, mode, videoUrl, goal, conditions, persistence });
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
        <div className='result-grid'>
          <div className='result-tile'>
            <span>Полные повторы</span>
            <strong>{result.reps}</strong>
          </div>
          <div className='result-tile'>
            <span>Неполные попытки</span>
            <strong>{result.incomplete}</strong>
          </div>
          <div className='result-tile'>
            <span>С замечаниями</span>
            <strong>{result.withErrors}</strong>
          </div>
          <div className='result-tile'>
            <span>Не удалось оценить</span>
            <strong>{result.unassessed}</strong>
          </div>
        </div>
        <div className='recommend'>
          <span className='recommend-symbol'>✦</span>
          <div>
            <b>Одна задача на следующий подход</b>
            <p>{nextTask(result, exercise)}</p>
            <p>Без замечаний по проверенным критериям: {result.withoutFindings} полных повторов.</p>
          </div>
        </div>
        <details className='criterion-summary' aria-label='Результаты по критериям'>
          <summary>Что удалось проверить</summary>
          <p>Предварительные критерии. Это результаты наблюдений, а не процент техники.</p>
          {result.attempts.length ? <ul className='criterion-list'>{Object.entries(criterionTotals(result)).map(([code, total]) => <li key={code}>
            <b>{criterionLabels[code as FeedbackCode]}</b>: выполнен в {total.passed}, отклонение в {total.deviation}, не оценён в {total.unassessed} попытках.
          </li>)}</ul> : <p>Попыток для проверки пока нет.</p>}
        </details>
        {result.attempts.length > 0 && (
          <section className='attempt-report' aria-label='Разбор попыток'>
            <h2>Разбор попыток</h2>
            {result.attempts.map(attempt => (
              <AttemptReport key={attempt.id} attempt={attempt} exercise={exercise} compact />
            ))}
          </section>
        )}
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
    <main className='workout page-enter'>
      <div className='workout-heading'>
        <div>
          <span className='eyebrow'>
            ТРЕНИРОВОЧНАЯ СЕССИЯ /{' '}
            {mode === 'demo' ? 'ДЕМО' : mode === 'video' ? 'ВИДЕО' : 'КАМЕРА'}
          </span>
          <h1>
            {labels[exercise]}
            <span className='accent'>.</span>
          </h1>
          <p className='muted'>
            {started ? 'Сосредоточься на движении. Подсказки — рядом.' : 'Задай цель и подготовься к первому подходу.'}
          </p>
        </div>
        <div className='clock'>
          ◷ <span>{readable(seconds)}</span>
        </div>
      </div>
      {programStep && !started && <button className='button' disabled={starting} onClick={onHome}>Прервать программу до запуска шага</button>}
      {started && <section className='session-controls' aria-label='Управление сессией'>
        <p role='status'><b>{phaseLabels[phase]}</b> · Подход {setNumber}/{goal.sets} · {phase === 'next' ? `Цель следующего: ${goal.reps} полных` : `В текущем: ${analysis.result.reps}/${goal.reps} полных`}{phase === 'rest' ? ` · осталось ${restSeconds} с` : ''}</p>
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
            {!started && (
              <div className='start-overlay'>
                <div className='start-icon'>
                  <Icon name={mode === 'camera' ? 'camera' : mode === 'video' ? 'video' : 'play'} />
                </div>
                <h2>
                  {mode === 'camera'
                    ? 'Твоё место для движения'
                    : mode === 'video'
                      ? 'Проверьте своё видео'
                      : 'Познакомься с тренировкой'}
                </h2>
                <p>
                  {mode === 'camera'
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
                  onClick={() => void start()}
                  disabled={starting || !validGoal(goal) || (mode === 'video' && !videoUrl)}
                >
                  {starting ? 'Подготовка…' : mode === 'camera'
                    ? 'Разрешить доступ к камере'
                    : mode === 'video'
                      ? 'Запустить анализ'
                      : 'Запустить демо'}{' '}
                  <Icon name='arrow' />
                </button>
                {!validGoal(goal) && <small>Сначала заполни три поля в блоке «Твой план».</small>}
              </div>
            )}
          </div>
          <div className='camera-bottom'>
            <span className='status-dot' aria-hidden='true' />
            <span role='status'>{status}</span>
            <span className='fps'>POSE TRACKING</span>
          </div>
        </section>
        <aside className='dashboard'>
      {!started && <fieldset className='session-goal' disabled={starting || !!programStep}>
        <legend>Твой план</legend>
        <p className='goal-intro'>Цель выбираешь ты. Мы поможем следить за счётом.</p>
        <div className='goal-fields'>
          <label>Подходы<input type='number' inputMode='numeric' placeholder='1–100' min='1' max='100' step='1' value={goalFields.sets} onChange={e => setGoalFields(v => ({ ...v, sets: e.target.value }))} /></label>
          <label>Повторы в подходе<input type='number' inputMode='numeric' placeholder='1–1000' min='1' max='1000' step='1' value={goalFields.reps} onChange={e => setGoalFields(v => ({ ...v, reps: e.target.value }))} /></label>
          <label>Отдых, секунды<input type='number' inputMode='numeric' placeholder='0–3600' min='0' max='3600' step='1' value={goalFields.restSeconds} onChange={e => setGoalFields(v => ({ ...v, restSeconds: e.target.value }))} /></label>
        </div>
        <details className='plan-details'><summary>Условия съёмки и правила подсчёта <span>Необязательно</span></summary>
          <label>Условия съёмки для сравнения<input type='text' maxLength={200} value={conditions} placeholder='Например: комната, камера сбоку, дневной свет' onChange={e => setConditions(e.target.value)} /></label>
          <p>В цель входят только полные оценённые циклы. Неполные и неоценённые попытки сохраняются отдельно. При достижении цели подход завершится автоматически.</p>
          <p>Для сравнения тренировок укажи одинаковые условия съёмки. {user ? 'Результаты сохраняются в локальной серверной базе аккаунта.' : 'Гостевые результаты хранятся в этом браузере.'} Видео и поток точек не отправляются на сервер. Цель — твой выбор, а не рекомендация нагрузки.</p>
        </details>
        {Object.values(goalFields).some(Boolean) && !validGoal(goal) && <p className='field-hint'>Заполни три поля целыми числами в указанных диапазонах.</p>}
      </fieldset>}
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
          <p className='variant-note'>{exercise === 'squat' ? 'Без веса · Вид сбоку' : 'Отжимания · Вид сбоку'} · Предварительные правила</p>
          <div className='rep-block'>
            <span className='metric-label'>{phase === 'rest' || phase === 'next' ? 'ПОЛНЫЕ В ПРЕДЫДУЩЕМ ПОДХОДЕ' : 'ПОВТОРЕНИЯ'}</span>
            <div className='rep-value'>
              {pad(analysis.result.reps)}
              <span className='rep-suffix'> / {validGoal(goal) ? goal.reps : '—'}</span>
            </div>
            <div className='progress-track'>
              <div
                style={{
                  width: `${Math.min(100, analysis.result.reps / goal.reps * 100) || 0}%`,
                }}
              />
            </div>
            <small>Полные циклы {phase === 'rest' || phase === 'next' ? 'предыдущего' : 'текущего'} подхода · цель {validGoal(goal) ? goal.reps : 'не задана'}</small>
          </div>
          <div className='mini-metrics'>
            <div>
              <span className='metric-label'>ФАЗА ДВИЖЕНИЯ</span>
              <strong>{!started ? 'Ожидание' : accepting ? analysis.state : phaseLabels[phase]}</strong>
            </div>
            <div>
              <span className='metric-label'>УГОЛ СУСТАВА</span>
              <strong>
                {started && accepting && analysis.angle !== null
                  ? `${analysis.angle}°`
                  : '—'}
              </strong>
            </div>
          </div>
          <div className='score-row'>
            <div>
              <span className='metric-label'>НАБЛЮДЕНИЕ</span>
              <strong>{!started ? 'Ожидание' : !accepting ? 'Наблюдение приостановлено' : analysis.observation.status === 'ready' ? 'Нужные точки видны' : 'Недостаточно данных'}</strong>
              <small>Неполных: {analysis.result.incomplete} · Не оценено: {analysis.result.unassessed} · С замечаниями: {analysis.result.withErrors}</small>
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
