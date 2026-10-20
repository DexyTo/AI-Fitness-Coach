import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ExerciseAnalysisResult,
  ExerciseType,
  InputMode,
  PoseLandmarks,
  TrainingSession,
  UnavailableSourceReason,
} from '../exercises/types';
import { createAnalyzer } from '../exercises/analyzer';
import { tracking } from '../exercises/config';
import { demoPose } from '../pose/demo';
import { clearPose, drawPose } from '../pose/drawing';
import { closeDetector, getDetector } from '../pose/poseDetector';
import { VideoTimeline } from '../pose/videoTimeline';


interface Options {
  exercise: ExerciseType;
  mode: InputMode;
  videoUrl?: string;
}

export function useTraining({ exercise, mode, videoUrl }: Options) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyzerRef = useRef(createAnalyzer(exercise));
  const [analysis, setAnalysis] = useState<ExerciseAnalysisResult>(() =>
    analyzerRef.current.snapshot(),
  );
  const [status, setStatus] = useState('Ожидание запуска');
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [session, setSession] = useState<TrainingSession | null>(null);
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
  }, []);
  useEffect(
    () => () => {
      stop();
      closeDetector();
    },
    [stop],
  );
  const finish = () => {
    const duration = Math.max(
      1,
      Math.round((mode === 'video' ? timelineRef.current.time : performance.now() - startAt.current) / 1000),
    );
    const finalAnalysis = analyzerRef.current.finish(mode === 'video' ? analysisTime.current : performance.now());
    setAnalysis(finalAnalysis);
    const result = finalAnalysis.result;
    const mainError = (Object.entries(result.errors).sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0] ?? null) as TrainingSession['mainError'];
    setSession({
      exercise,
      mode,
      duration,
      result,
      mainError,
    });
    stop();
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
      const detector = mode === 'demo' ? null : await getDetector();
      if (cancelled()) return;
      // A short local recording must not play through while the model is loading.
      if (mode === 'video' && video) await video.play();
      if (cancelled()) return;
      startAt.current = performance.now();
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
        () =>
          setSeconds(Math.floor((mode === 'video' ? timelineRef.current.time : performance.now() - startAt.current) / 1000)),
        1000,
      );
      const tick = () => {
        if (cancelled()) return;
        rafRef.current = requestAnimationFrame(tick);
        const now = performance.now();
        const sourceEnded = mode === 'video' && video?.ended;
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
            if (sample.reset) analyzerRef.current.interrupt(timestamp - 0.5, 'timeline_reset');
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
        if (points.length) drawPose(canvas, points, width, height, mode === 'demo' ? 1600 : video!.videoWidth, mode === 'demo' ? 1000 : video!.videoHeight);
        else clearPose(canvas);
        const before = analyzerRef.current.snapshot();
        analysisTime.current = timestamp;
        const current = analyzerRef.current.analyze(points, timestamp, aspect, sourceReason);
        if (now - lastUi.current > 130 || current.observation.status !== 'ready' ||
            current.observation.status !== before.observation.status ||
            current.preparation.stage !== before.preparation.stage ||
            current.result.attempts.length !== before.result.attempts.length) {
          setAnalysis(current);
          lastUi.current = now;
        }
        setStatus(`${mode === 'demo' ? 'Симуляция. ' : ''}${current.preparation.message}`);
        if (sourceEnded) finish();
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
    status,
    started,
    starting,
    seconds,
    session,
    start,
    finish,
    stop,
    restart: () => {
      stop();
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
      const interrupted = analyzerRef.current.interrupt(analysisTime.current, 'timeline_reset');
      setAnalysis(interrupted);
      setStatus('Перемотка: текущая попытка прервана. Снова удерживайте исходную позицию.');
      if (canvasRef.current) clearPose(canvasRef.current);
    },
  };
}
