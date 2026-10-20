import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ExerciseAnalysisResult,
  ExerciseType,
  InputMode,
  PoseLandmarks,
  UnavailableSourceReason,
} from '../exercises/types';
import { createAnalyzer } from '../exercises/analyzer';
import { tracking } from '../exercises/config';
import { CoachingController, type CoachingCue } from '../exercises/coaching';
import { demoPose } from '../pose/demo';
import { clearPose, drawPose } from '../pose/drawing';
import { closeDetector, getDetectorWithMetadata } from '../pose/poseDetector';
import { VideoTimeline } from '../pose/videoTimeline';
import { TrainingController, phaseLabels, type SessionPhase, type TrainingGoal, type WorkoutRecord } from '../training/session';
import { HistoryStore } from '../training/history';


interface Options {
  exercise: ExerciseType;
  mode: InputMode;
  videoUrl?: string;
  goal: TrainingGoal;
  conditions: string;
}

export function useTraining({ exercise, mode, videoUrl, goal, conditions }: Options) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyzerRef = useRef(createAnalyzer(exercise));
  const coachingRef = useRef(new CoachingController(exercise));
  const [cue, setCue] = useState<CoachingCue | null>(null);
  const [analysis, setAnalysis] = useState<ExerciseAnalysisResult>(() =>
    analyzerRef.current.snapshot(),
  );
  const [status, setStatus] = useState('Ожидание запуска');
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [session, setSession] = useState<WorkoutRecord | null>(null);
  const controllerRef = useRef<TrainingController | null>(null);
  const [phase, setPhase] = useState<SessionPhase>('preparing');
  const [setNumber, setSetNumber] = useState(1);
  const [restSeconds, setRestSeconds] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const startAt = useRef(0),
    clockRef = useRef(0),
    rafRef = useRef(0),
    streamRef = useRef<MediaStream | null>(null);
  const cancelRef = useRef(false),
    runRef = useRef(0),
    timelineRef = useRef(new VideoTimeline()),
    analysisTime = useRef(0),
    stalledInterrupted = useRef(false),
    lastFrame = useRef(0),
    lastVideoTime = useRef(-1),
    lastVideoFrameAt = useRef(0),
    lastUi = useRef(0);
  const stop = useCallback(() => {
    runRef.current++;
    cancelRef.current = true;
    cancelAnimationFrame(rafRef.current);
    window.clearInterval(clockRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
    if (canvasRef.current) clearPose(canvasRef.current);
    setStarted(false);
    setStarting(false);
    setCue(null);
    coachingRef.current.reset();
  }, []);
  useEffect(
    () => () => {
      stop();
      closeDetector();
    },
    [stop],
  );
  const finish = () => {
    const controller = controllerRef.current;
    if (!controller) return;
    const record = controller.finish(mode === 'video' ? analysisTime.current : performance.now(), performance.now());
    setSession(record);
    setSaveError(new HistoryStore().save(record));
    setPhase('completed');
    stop();
  };
  const syncController = () => {
    const controller = controllerRef.current;
    if (!controller) return;
    const remaining = controller.remainingRest(performance.now());
    setPhase(controller.phase);
    setSetNumber(Math.min(controller.currentSet, controller.goal.sets));
    setRestSeconds(remaining);
    if (!controller.acceptsFrames) setStatus(`${phaseLabels[controller.phase]}. Движения не учитываются; технические подсказки выключены.`);
  };
  const suspendFeedback = () => {
    coachingRef.current.reset();
    setCue(null);
    if (canvasRef.current) clearPose(canvasRef.current);
    setAnalysis(analyzerRef.current.snapshot());
    syncController();
  };
  const pause = () => {
    controllerRef.current?.pause(mode === 'video' ? analysisTime.current : performance.now());
    if (mode === 'video') videoRef.current?.pause();
    suspendFeedback();
  };
  const resume = async () => {
    const controller = controllerRef.current;
    if (!controller || !['paused', 'next'].includes(controller.phase)) return;
    if (mode === 'video' && videoRef.current?.ended) { finish(); return; }
    controller.resume(performance.now());
    analyzerRef.current = controller.analyzer;
    lastVideoFrameAt.current = performance.now();
    lastVideoTime.current = -1;
    suspendFeedback();
    if (mode === 'video') {
      try { await videoRef.current?.play(); }
      catch { pause(); setStatus('Не удалось продолжить видео. Повторите продолжение.'); }
    }
  };
  const endSet = () => {
    controllerRef.current?.endSet(mode === 'video' ? analysisTime.current : performance.now(), performance.now());
    if (mode === 'video') videoRef.current?.pause();
    suspendFeedback();
    if (controllerRef.current?.phase === 'completed') finish();
  };
  const start = async () => {
    stop();
    const run = runRef.current;
    const cancelled = () => cancelRef.current || runRef.current !== run;
    cancelRef.current = false;
    setStarting(true);
    setStatus(mode === 'demo' ? 'Запуск демо' : 'Подготовка модели...');
    analyzerRef.current = createAnalyzer(exercise);
    setAnalysis(analyzerRef.current.snapshot());
    setSeconds(0);
    setSession(null);
    setSaveError(null);
    controllerRef.current = null;
    coachingRef.current.reset();
    const video = videoRef.current;
    try {
      if (mode === 'camera') {
        if (!navigator.mediaDevices?.getUserMedia)
          throw Error(
            'Камера доступна только в защищённом соединении (HTTPS) или на localhost.',
          );
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
          },
          audio: false,
        });
        if (cancelled()) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
      } else if (mode === 'video') {
        if (!videoUrl) throw Error('Сначала выберите видеофайл.');
        if (!video) return;
        video.src = videoUrl;
        video.loop = false;
      }
      const detection = mode === 'demo' ? null : await getDetectorWithMetadata();
      const detector = detection?.detector;
      if (cancelled()) return;
      // A short local recording must not play through while the model is loading.
      if (mode === 'video' && video) await video.play();
      if (cancelled()) return;
      startAt.current = performance.now();
      controllerRef.current = new TrainingController(exercise, mode, goal, conditions, startAt.current, undefined, undefined, {
        width: mode === 'demo' ? 1600 : video?.videoWidth ?? 0,
        height: mode === 'demo' ? 1000 : video?.videoHeight ?? 0,
        delegate: detection?.delegate ?? 'synthetic', settings: detection ? { ...detection.settings } : {},
      });
      analyzerRef.current = controllerRef.current.analyzer;
      syncController();
      lastFrame.current = 0;
      lastVideoTime.current = -1;
      lastVideoFrameAt.current = startAt.current;
      lastUi.current = 0;
      analysisTime.current = mode === 'video' ? 0 : startAt.current;
      timelineRef.current = new VideoTimeline();
      stalledInterrupted.current = false;
      setStarting(false);
      setStarted(true);
      setStatus(
        mode === 'demo'
          ? 'Демо: смоделированные точки тела'
          : 'Наведите камеру так, чтобы тело было видно целиком',
      );
      clockRef.current = window.setInterval(
        () => {
          setSeconds(Math.floor((performance.now() - startAt.current) / 1000));
          controllerRef.current?.advance(performance.now());
          syncController();
        },
        1000,
      );
      let displayedCue: CoachingCue | null = null;
      const tick = () => {
        if (cancelled()) return;
        rafRef.current = requestAnimationFrame(tick);
        const now = performance.now();
        const controller = controllerRef.current!;
        controller.advance(now);
        const sourceEnded = mode === 'video' && video?.ended;
        if (!controller.acceptsFrames) {
          if (sourceEnded) finish();
          else syncController();
          return;
        }
        if (now - lastFrame.current < 85 && !sourceEnded) return;
        lastFrame.current = now;
        const canvas = canvasRef.current;
        if (!canvas) return;
        let points: PoseLandmarks = [];
        let sourceReason: UnavailableSourceReason | undefined;
        let timestamp = mode === 'video' ? analysisTime.current : now;
        const width = canvas.clientWidth,
          height = canvas.clientHeight;
        // Demo has a fixed source aspect, independent of responsive viewport dimensions.
        if (mode === 'demo') points = demoPose(exercise, now - startAt.current);
        else if (
          video &&
          video.readyState >= 2 &&
          !video.seeking &&
          video.videoWidth &&
          video.currentTime !== lastVideoTime.current
        ) {
          if (mode === 'video') {
            const sample = timelineRef.current.sample(video.currentTime);
            timestamp = sample.time;
            if (sample.reset) controller.interrupt(timestamp - 0.5);
          }
          lastVideoTime.current = video.currentTime;
          lastVideoFrameAt.current = now;
          stalledInterrupted.current = false;
          try {
            points = detector?.detectForVideo(video, now).landmarks[0] ?? [];
          } catch {
            // Send an unavailable observation through the same analyzer path.
            points = [];
            sourceReason = 'detector_error';
          }
        } else {
          if (sourceEnded) {
            finish();
            return;
          }
          if (now - lastVideoFrameAt.current < 250) return;
          sourceReason = 'source_unavailable';
          if (mode === 'video' && now - lastVideoFrameAt.current > tracking.maxGapMs && !stalledInterrupted.current) {
            analyzerRef.current.interrupt(timestamp, 'tracking_gap');
            stalledInterrupted.current = true;
          }
        }
        if (width < 1 || height < 1) return;
        const aspect =
          mode === 'demo'
            ? 1.6
            : (video?.videoWidth ?? width) / (video?.videoHeight ?? height);
        const before = analyzerRef.current.snapshot();
        analysisTime.current = timestamp;
        const current = controller.sample(points, timestamp, aspect, now, sourceReason);
        syncController();
        if (sourceEnded) { finish(); return; }
        if (!controller.acceptsFrames) {
          if (mode === 'video') video?.pause();
          suspendFeedback();
          displayedCue = null;
          if (controller.phase === 'completed') finish();
          return;
        }
        const currentCue = coachingRef.current.update(current, points, aspect, now);
        if (points.length) drawPose(canvas, points, width, height, mode === 'demo' ? 1600 : video!.videoWidth, mode === 'demo' ? 1000 : video!.videoHeight, currentCue.target);
        else clearPose(canvas);
        if (now - lastUi.current > 130 || currentCue.key !== displayedCue?.key || currentCue.message !== displayedCue?.message || current.observation.status !== 'ready' ||
            current.state !== before.state ||
            current.observation.status !== before.observation.status ||
            current.preparation.stage !== before.preparation.stage ||
            current.result.attempts.length !== before.result.attempts.length) {
          setAnalysis(current);
          setCue(currentCue);
          displayedCue = currentCue;
          lastUi.current = now;
        }
        setStatus(`${mode === 'demo' ? 'Симуляция. ' : ''}${current.preparation.message}`);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (error) {
      if (cancelled()) return;
      stop();
      const message = error instanceof Error ? error.message : String(error);
      if (mode === 'camera' && /denied|permission|notallowed/i.test(message))
        setStatus(
          'Доступ к камере запрещён. Разрешите камеру в настройках сайта и повторите попытку.',
        );
      else setStatus(message || 'Не удалось начать тренировку.');
    }
  };
  return {
    videoRef,
    canvasRef,
    analysis,
    cue,
    status,
    started,
    starting,
    seconds,
    session,
    phase,
    setNumber,
    restSeconds,
    saveError,
    pause,
    resume,
    endSet,
    retrySave: () => {
      if (!session) return;
      setSaveError(new HistoryStore().save(session));
    },
    start,
    finish,
    stop,
    restart: () => {
      stop();
      controllerRef.current = null;
      setPhase('preparing');
      analyzerRef.current = createAnalyzer(exercise);
      setAnalysis(analyzerRef.current.snapshot());
      setSession(null);
      setSeconds(0);
      setStatus('Новый анализ начнётся с начала записи; счётчики сброшены.');
    },
    confirmSideView: () => analyzerRef.current.confirmSideView(),
    seek: () => {
      if (mode !== 'video' || !started) return;
      timelineRef.current.seek();
      lastVideoTime.current = -1;
      const interrupted = controllerRef.current?.interrupt(analysisTime.current) ?? analyzerRef.current.snapshot();
      setAnalysis(interrupted);
      coachingRef.current.reset();
      setCue(coachingRef.current.update(interrupted, [], 1, performance.now()));
      setStatus('Перемотка: текущая попытка прервана. Снова удерживайте исходную позицию.');
      if (canvasRef.current) clearPose(canvasRef.current);
    },
  };
}
