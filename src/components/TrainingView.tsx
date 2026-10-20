import { useEffect, useState } from 'react';
import type { ExerciseType, InputMode, FeedbackCode } from '../exercises/types';
import { criterionLabels, labels } from '../exercises/types';
import { criterionTotals, nextTask } from '../exercises/coaching';
import { variant } from '../exercises/config';
import { AttemptReport } from './AttemptReport';
import { useTraining } from '../hooks/useTraining';
import { useVoiceFeedback } from '../hooks/useVoiceFeedback';
import { combineResults, phaseLabels, validGoal } from '../training/session';
import { downloadJson } from '../training/history';
import { WorkoutDetails } from './HistoryView';


interface Props {
  exercise: ExerciseType;
  mode: InputMode;
  onHome: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

function readable(seconds: number) {
  const whole = Math.floor(seconds);
  return `${pad(Math.floor(whole / 60))}:${pad(whole % 60)}`;
}

export function TrainingView({ exercise, mode, onHome }: Props) {
  const [videoUrl, setVideoUrl] = useState('');
  const [goalFields, setGoalFields] = useState({ sets: '', reps: '', restSeconds: '' });
  const [conditions, setConditions] = useState('');
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
    phase, setNumber, restSeconds, pause, resume, endSet, saveError, retrySave,
  } = useTraining({ exercise, mode, videoUrl, goal, conditions });
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
            <span>Попытки с замечаниями</span>
            <strong>{result.withErrors}</strong>
          </div>
          <div className='result-tile'>
            <span>Не оценены из-за данных</span>
            <strong>{result.unassessed}</strong>
          </div>
        </div>
        <div className='recommend'>
          <span className='recommend-symbol'>✦</span>
          <div>
            <b>Одна задача на следующий подход</b>
            <p>{nextTask(result, exercise)}</p>
            <p>Полных повторов без обнаруженных замечаний: {result.withoutFindings}. Замечания учитываются независимо от исхода попытки.</p>
          </div>
        </div>
        <section className='criterion-summary' aria-label='Результаты по критериям'>
          <h2>Что удалось проверить</h2>
          <p>Предварительные критерии · {variant(exercise).id}. Это результаты наблюдений, а не процент техники.</p>
          {result.attempts.length ? <ul className='criterion-list'>{Object.entries(criterionTotals(result)).map(([code, total]) => <li key={code}>
            <b>{criterionLabels[code as FeedbackCode]}</b>: выполнен в {total.passed}, отклонение в {total.deviation}, не оценён в {total.unassessed} попытках.
          </li>)}</ul> : <p>Попыток для проверки пока нет.</p>}
        </section>
        {result.attempts.length > 0 && (
          <section className='attempt-report' aria-label='Разбор попыток'>
            <h2>Разбор попыток</h2>
            {result.attempts.map(attempt => (
              <AttemptReport key={attempt.id} attempt={attempt} exercise={exercise} />
            ))}
          </section>
        )}
        <div className='result-actions'>
          <button className='button' onClick={() => downloadJson({ schemaVersion: 1, records: [session] }, 'playfit-workout.json')}>Экспорт результата JSON</button>
          {saveError && <button className='button' onClick={retrySave}>Повторить сохранение</button>}
          {mode === 'video' && <button className='button' onClick={restart}>Повторить запись с нуля</button>}
          <button className='button button-primary' onClick={onHome}>
            Новая тренировка <span>↗</span>
          </button>
        </div>
        <p role={saveError ? 'alert' : 'status'} className={saveError ? 'storage-error' : 'muted'}>{saveError || 'Результат сохранён локально в истории этого браузера. Синхронизации между устройствами нет.'}</p>
        <WorkoutDetails record={session} />
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
            Наблюдение движения и подсказки по доступным точкам.
          </p>
        </div>
        <div className='clock'>
          ◷ <span>{readable(seconds)}</span>
        </div>
      </div>
      {!started && <fieldset className='session-goal' disabled={starting}>
        <legend>Ваша цель · {labels[exercise]}</legend>
        <p>Задайте собственные значения. Это счётная цель, а не персональная рекомендация нагрузки.</p>
        <div className='goal-fields'>
          <label>Подходы<input type='number' min='1' max='100' step='1' value={goalFields.sets} onChange={e => setGoalFields(v => ({ ...v, sets: e.target.value }))} /></label>
          <label>Полные повторы в подходе<input type='number' min='1' max='1000' step='1' value={goalFields.reps} onChange={e => setGoalFields(v => ({ ...v, reps: e.target.value }))} /></label>
          <label>Отдых, секунды<input type='number' min='0' max='3600' step='1' value={goalFields.restSeconds} onChange={e => setGoalFields(v => ({ ...v, restSeconds: e.target.value }))} /></label>
        </div>
        <label>Условия съёмки для сравнения<input type='text' maxLength={200} value={conditions} placeholder='Например: комната, камера сбоку, дневной свет' onChange={e => setConditions(e.target.value)} /></label>
        <p>В цель входят только полные оценённые циклы. Замечания учитываются отдельно; неполные и неоценённые попытки цель не увеличивают. Достигнутый счёт завершает подход. Если условия не указаны, сравнение между записями отключено. Видео и координаты не сохраняются; результаты сохраняются только в этом браузере без синхронизации.</p>
        {!validGoal(goal) && <p>Введите целые значения: подходы 1–100, повторы 1–1000, отдых 0–3600 секунд.</p>}
      </fieldset>}
      {started && <section className='session-controls' aria-label='Управление сессией'>
        <p role='status'><b>{phaseLabels[phase]}</b> · Подход {setNumber}/{goal.sets} · {phase === 'next' ? `Цель следующего: ${goal.reps} полных` : `В текущем: ${analysis.result.reps}/${goal.reps} полных`}{phase === 'rest' ? ` · осталось ${restSeconds} с` : ''}</p>
        {!accepting && <p>Движения не учитываются, технические подсказки выключены. Перед продолжением снова удерживайте исходную позицию.</p>}
        {accepting && <button className='button' onClick={pause}>Пауза</button>}
        {(phase === 'paused' || phase === 'next') && <button className='button button-primary' onClick={() => void resume()}>{phase === 'next' ? 'Начать следующий подход' : 'Продолжить с подготовки'}</button>}
        {(accepting || phase === 'paused') && <button className='button' onClick={endSet}>Завершить подход</button>}
      </section>}
      <div className='workout-grid'>
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
                  {mode === 'camera' ? '◉' : mode === 'video' ? '▷' : '✳'}
                </div>
                <h2>
                  {mode === 'camera'
                    ? 'Камера готова к запуску'
                    : mode === 'video'
                      ? 'Проверьте своё видео'
                      : 'Посмотрите, как это работает'}
                </h2>
                <p>
                  {mode === 'camera'
                    ? 'Для работы AI-тренеру необходим доступ к камере. Видео анализируется прямо в браузере.'
                    : mode === 'video'
                      ? 'Загрузите запись упражнения: анализ пройдёт через ту же модель, что и камера.'
                      : 'Демо показывает работу подсчёта на смоделированных точках тела.'}
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
                  <span>↗</span>
                </button>
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
          {exercise === 'squat' && <section className='camera-guide' aria-label='Подготовка камеры для приседаний сбоку'>
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
            <p>Поставьте камеру примерно на уровне таза, без наклона. Отойдите, чтобы плечо, таз, колено и лодыжка ближней стороны оставались в кадре весь подход. Удерживайте верхнюю позицию около половины секунды.</p>
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
          <p className='variant-note'>Вариант: {exercise === 'squat' ? 'без веса, сбоку' : 'отжимания сбоку'} · {variant(exercise).id}. Правила предварительные.</p>
          <div className='rep-block'>
            <span className='metric-label'>{phase === 'rest' || phase === 'next' ? 'ПОЛНЫЕ В ПРЕДЫДУЩЕМ ПОДХОДЕ' : 'ПОВТОРЕНИЯ'}</span>
            <div className='rep-value'>
              {pad(analysis.result.reps)}
              <span className='rep-suffix'> REP</span>
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
              <strong>{accepting ? analysis.state : phaseLabels[phase]}</strong>
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
            <span className='metric-label'>ПРЕДЫДУЩАЯ ПОПЫТКА · НЕ ТЕКУЩИЙ СОВЕТ</span>
            <AttemptReport attempt={previousAttempt} exercise={exercise} compact />
          </section>}
          <button
            className='button button-end'
            disabled={!started}
            onClick={finish}
          >
            Завершить тренировку <span>↗</span>
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
