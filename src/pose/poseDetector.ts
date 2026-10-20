import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';


let pending: Promise<PoseLandmarker> | null = null;

export const detectorSettings = {
  runningMode: 'VIDEO' as const,
  numPoses: 1,
  minPoseDetectionConfidence: 0.55,
  minPosePresenceConfidence: 0.55,
  minTrackingConfidence: 0.5,
};

// Shared by the app and offline validation. Preserve the existing CPU fallback
// (library confidence defaults) and record that distinction in validation exports.
export async function createDetectorWithMetadata() {
  const wasm = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`);
  const modelAssetPath = `${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`;
  try {
    const detector = await PoseLandmarker.createFromOptions(wasm, {
      ...detectorSettings, baseOptions: { modelAssetPath, delegate: 'GPU' },
    });
    return { detector, delegate: 'GPU' as const, settings: { ...detectorSettings } };
  } catch {
    const settings = { runningMode: 'VIDEO' as const, numPoses: 1 };
    const detector = await PoseLandmarker.createFromOptions(wasm, {
      ...settings, baseOptions: { modelAssetPath, delegate: 'CPU' },
    });
    return { detector, delegate: 'CPU' as const, settings: { ...settings } };
  }
}

export function getDetector(): Promise<PoseLandmarker> {
  if (!pending)
    pending = createDetectorWithMetadata().then(({ detector }) => detector).catch((error) => {
      pending = null;
      throw error;
    });
  return pending;
}
export function closeDetector() {
  if (pending) {
    void pending.then((detector) => detector.close()).catch(() => {});
    pending = null;
  }
}
