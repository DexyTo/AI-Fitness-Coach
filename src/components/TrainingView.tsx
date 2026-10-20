import { useEffect, useState } from 'react';
import type { ExerciseType, InputMode, FeedbackCode } from '../exercises/types';
import { criterionLabels, labels } from '../exercises/types';
import { criterionTotals, nextTask } from '../exercises/coaching';
import { variant } from '../exercises/config';
import { AttemptReport } from './AttemptReport';
import { useTraining } from '../hooks/useTraining';
import { useVoiceFeedback } from '../hooks/useVoiceFeedback';


interface Props {
  exercise: ExerciseType;
  mode: InputMode;
  onHome: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

function readable(seconds: number) {
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

export function TrainingView({ exercise, mode, onHome }: Props) {
  const [videoUrl, setVideoUrl] = useState('');
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
  } = useTraining({ exercise, mode, videoUrl });
  const {
    enabled: voiceEnabled,
    setEnabled: setVoiceEnabled,
    supported: voiceSupported,
  } = useVoiceFeedback(started && !session && analysis.state !== 'Оценка приостановлена', cue);
  const previousAttempt = analysis.result.attempts.at(-1);
  const onFile = (file?: File) => {
    if (!file) return;
    setVideoUrl(URL.createObjectURL(file));
  };
  if (session) {
    const { result } = session;
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
          {mode === 'video' && <button className='button' onClick={restart}>Повторить запись с нуля</button>}
          <button className='button button-primary' onClick={onHome}>
            Новая тренировка <span>↗</span>
          </button>
        </div>
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
      <div className='workout-grid'>
        <section className='camera-card' aria-label='Область анализа движения'>
          <div className='camera-top'>
            <span className='live-label'>
              <i />
              {started ? ({ preparing: 'ПОДГОТОВКА', ready: 'ГОТОВНОСТЬ', active: 'ПОДХОД', recovering: 'ВОССТАНОВЛЕНИЕ' }[analysis.preparation.stage]) : 'ОЖИДАНИЕ'}
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
              controls={mode === 'video' && started}
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
                  disabled={starting || (mode === 'video' && !videoUrl)}
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
            {started && <>
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
            <span className='metric-label'>ПОВТОРЕНИЯ</span>
            <div className='rep-value'>
              {pad(analysis.result.reps)}
              <span className='rep-suffix'> REP</span>
            </div>
            <div className='progress-track'>
              <div
                style={{
                  width: `${Math.min(100, analysis.result.reps * 10)}%`,
                }}
              />
            </div>
            <small>Каждый полный цикл движения</small>
          </div>
          <div className='mini-metrics'>
            <div>
              <span className='metric-label'>ФАЗА ДВИЖЕНИЯ</span>
              <strong>{analysis.state}</strong>
            </div>
            <div>
              <span className='metric-label'>УГОЛ СУСТАВА</span>
              <strong>
                {started && analysis.angle !== null
                  ? `${analysis.angle}°`
                  : '—'}
              </strong>
            </div>
          </div>
          <div className='score-row'>
            <div>
              <span className='metric-label'>НАБЛЮДЕНИЕ</span>
              <strong>{!started ? 'Ожидание' : analysis.observation.status === 'ready' ? 'Нужные точки видны' : 'Недостаточно данных'}</strong>
              <small>Неполных: {analysis.result.incomplete} · Не оценено: {analysis.result.unassessed} · С замечаниями: {analysis.result.withErrors}</small>
            </div>
          </div>
          <div className='feedback'>
            <span className='metric-label'>СЕЙЧАС · {started ? analysis.state : 'Ожидание'}</span>
            <div
              role='status' aria-live='polite' aria-atomic='true'
              className={`feedback-message ${cue?.kind === 'technique' || cue?.kind === 'observation' ? 'warning' : ''}`}
            >
              <span aria-hidden='true'>{cue?.kind === 'technique' || cue?.kind === 'observation' ? '!' : '·'}</span>
              <p>
                {started ? cue?.message ?? 'Проверяем наблюдение…' : 'После запуска здесь появится текущая подсказка.'}
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
