import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ExerciseAnalysisResult,
  ExerciseType,
  InputMode,
  PoseLandmarks,
  TrainingSession,
} from '../exercises/types';
import { createAnalyzer } from '../exercises/analyzer';
import { demoPose } from '../pose/demo';
import { clearPose, drawPose } from '../pose/drawing';
import { closeDetector, getDetector } from '../pose/poseDetector';
import { fullBodyInFrame } from '../pose/landmarks';


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
  const [seconds, setSeconds] = useState(0);
  const [session, setSession] = useState<TrainingSession | null>(null);
  const startAt = useRef(0),
    clockRef = useRef(0),
    rafRef = useRef(0),
    streamRef = useRef<MediaStream | null>(null);
  const cancelRef = useRef(false),
    lastFrame = useRef(0),
    lastVideoTime = useRef(-1),
    lastUi = useRef(0);
  const stop = useCallback(() => {
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
      Math.round((performance.now() - startAt.current) / 1000),
    );
    const result = analyzerRef.current.snapshot().result;
    const mainError = (Object.entries(result.errors).sort(
      (a, b) => b[1] - a[1],
    )[0]?.[0] ?? null) as TrainingSession['mainError'];
    setSession({
      exercise,
      mode,
      duration,
      result,
      averageScore: result.reps ? Math.round(result.scoreSum / result.reps) : 0,
      mainError,
    });
    stop();
  };
  const start = async () => {
    stop();
    cancelRef.current = false;
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
        if (cancelRef.current) {
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
        video.loop = true;
        await video.play();
      }
      const detector = mode === 'demo' ? null : await getDetector();
      if (cancelRef.current) return;
      startAt.current = performance.now();
      lastFrame.current = 0;
      lastVideoTime.current = -1;
      lastUi.current = 0;
      setStarted(true);
      setStatus(
        mode === 'demo'
          ? 'Демо: смоделированные точки тела'
          : 'Наведите камеру так, чтобы тело было видно целиком',
      );
      clockRef.current = window.setInterval(
        () =>
          setSeconds(Math.floor((performance.now() - startAt.current) / 1000)),
        1000,
      );
      const tick = () => {
        if (cancelRef.current) return;
        rafRef.current = requestAnimationFrame(tick);
        const now = performance.now();
        if (now - lastFrame.current < 85) return;
        lastFrame.current = now;
        const canvas = canvasRef.current;
        if (!canvas) return;
        let points: PoseLandmarks = [];
        let width = canvas.clientWidth,
          height = canvas.clientHeight;
        if (mode === 'demo') points = demoPose(exercise, now - startAt.current);
        else if (
          video &&
          video.readyState >= 2 &&
          video.videoWidth &&
          video.currentTime !== lastVideoTime.current
        ) {
          lastVideoTime.current = video.currentTime;
          try {
            points = detector?.detectForVideo(video, now).landmarks[0] ?? [];
          } catch {
            setStatus(
              'Не удалось обработать видеокадр. Попробуйте перезапустить тренировку.',
            );
            return;
          }
        } else return;
        if (width < 1 || height < 1) return;
        const aspect =
          mode === 'demo'
            ? width / height
            : (video?.videoWidth ?? width) / (video?.videoHeight ?? height);
        if (points.length) {
          drawPose(canvas, points, width, height);
          if (mode === 'demo' || fullBodyInFrame(points)) {
            const before = analyzerRef.current.snapshot().result.reps;
            const current = analyzerRef.current.analyze(points, now, aspect);
            if (now - lastUi.current > 130 || current.result.reps !== before) {
              setAnalysis(current);
              lastUi.current = now;
            }
            setStatus(
              mode === 'demo'
                ? 'Демо: смоделированные точки тела'
                : 'Поза определена · анализ идёт на устройстве',
            );
          } else {
            setStatus('Отойдите дальше — необходимо видеть тело полностью.');
          }
        } else {
          clearPose(canvas);
          setStatus(
            'Человек не обнаружен. Проверьте освещение и положение камеры.',
          );
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (error) {
      if (cancelRef.current) return;
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
    seconds,
    session,
    start,
    finish,
    stop,
  };
}
