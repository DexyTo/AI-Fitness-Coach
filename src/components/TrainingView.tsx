import { useEffect, useState } from 'react';
import type { ExerciseType, InputMode, FeedbackCode } from '../exercises/types';
import { criterionLabels, criterionStatusLabels, endReasonLabels, feedbackMessage, labels, outcomeLabels, reasonText } from '../exercises/types';
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
    status,
    started,
    seconds,
    session,
    start,
    finish,
  } = useTraining({ exercise, mode, videoUrl });
  const {
    enabled: voiceEnabled,
    setEnabled: setVoiceEnabled,
    supported: voiceSupported,
  } = useVoiceFeedback(started && analysis.observation.status === 'ready', analysis.feedback[0]);
  const onFile = (file?: File) => {
    if (!file) return;
    setVideoUrl(URL.createObjectURL(file));
  };
  if (session) {
    const { result, mainError } = session;
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
            <b>Результаты наблюдения</b>
            <p>
              {mainError ? feedbackMessage(exercise, mainError)
                : result.unassessed ? 'Часть движений не удалось оценить. Ниже указаны недостающие данные.'
                : result.reps ? 'В проверенных признаках полных повторов замечаний не обнаружено.'
                : 'Завершённых движений не зафиксировано. Начните с верхней точки.'}
            </p>
            <p>Полных повторов без обнаруженных замечаний: {result.withoutFindings}. Замечания учитываются независимо от исхода попытки.</p>
          </div>
        </div>
        {result.attempts.length > 0 && (
          <section className='attempt-report' aria-label='Разбор попыток'>
            <h2>Разбор попыток</h2>
            {result.attempts.map(attempt => (
              <article className='attempt-item' key={attempt.id}>
                <h3>#{attempt.id} · {outcomeLabels[attempt.outcome]}</h3>
                <p>{endReasonLabels[attempt.endReason]} · Минимальный наблюдаемый угол: {attempt.minAngle}°</p>
                {attempt.outcome === 'incomplete' && <p>Не засчитано: {attempt.remarks.includes('depth') ? 'нижняя точка не достигнута. ' : ''}{attempt.remarks.includes('extension') ? 'возврат к выпрямлению не завершён.' : ''}</p>}
                {attempt.outcome === 'insufficient_data' && <p>Не засчитано: обязательные проверки имеют пропуски данных.{attempt.motionComplete ? ' По доступным точкам цикл движения виден, но полностью оценить его нельзя.' : ''}</p>}
                {attempt.reasons.length > 0 && <ul>{[...new Set(attempt.reasons.map(reasonText))].map(text => <li key={text}>{text}</li>)}</ul>}
                <ul className='criterion-list'>
                  {Object.entries(attempt.criteria).map(([code, check]) => (
                    <li key={code}>
                      <b>{criterionLabels[code as FeedbackCode]}</b>: {criterionStatusLabels[check.status]}
                      {check.reasons.length > 0 && <span> · {[...new Set(check.reasons.map(reasonText))].join(' ')}</span>}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>
        )}
        <div className='result-actions'>
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
            Следите за движением. Остальное берём на себя.
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
              {started ? analysis.observation.status === 'ready' ? 'АНАЛИЗ ИДЁТ' : 'ОЦЕНКА НА ПАУЗЕ' : 'ОЖИДАНИЕ'}
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
                  disabled={mode === 'video' && !videoUrl}
                >
                  {mode === 'camera'
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
              <strong>{!started ? 'Ожидание' : analysis.observation.status === 'ready' ? 'Данных достаточно' : 'Недостаточно данных'}</strong>
              <small>Неполных: {analysis.result.incomplete} · Не оценено: {analysis.result.unassessed} · С замечаниями: {analysis.result.withErrors}</small>
            </div>
          </div>
          {started && <ul className='criterion-list live-criteria'>
            {Object.entries(analysis.criteria).map(([code, check]) => <li key={code}>
              {criterionLabels[code as FeedbackCode]}: {criterionStatusLabels[check.status]}
            </li>)}
          </ul>}
          <div className='feedback'>
            <span className='metric-label'>ПОДСКАЗКИ В РЕАЛЬНОМ ВРЕМЕНИ</span>
            <div
              className={`feedback-message ${analysis.feedback.length || (started && analysis.observation.status !== 'ready') ? 'warning' : ''}`}
            >
              <span>{analysis.feedback.length || analysis.observation.status !== 'ready' ? '!' : '·'}</span>
              <p>
                {started && analysis.observation.status !== 'ready'
                  ? `Оценка приостановлена. ${analysis.observation.reasons[0] ? reasonText(analysis.observation.reasons[0]) : 'Проверьте видимость нужных точек.'}`
                  : analysis.feedback[0]?.message ??
                  (started
                    ? 'Наблюдаем движение. Итог проверок появится в разборе попыток.'
                    : 'После запуска здесь появятся подсказки.')}
              </p>
            </div>
          </div>
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
        {mode === 'demo'
          ? 'В демо используется заранее заданная последовательность точек; распознавание камерой здесь не выполняется.'
          : 'Видеокадры обрабатываются на этом устройстве. Результат зависит от освещения и ракурса.'}
      </p>
    </main>
  );
}
