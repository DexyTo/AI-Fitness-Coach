import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';


let pending: Promise<PoseLandmarker> | null = null;

export function getDetector(): Promise<PoseLandmarker> {
  if (!pending)
    pending = (async () => {
      const wasm = await FilesetResolver.forVisionTasks(
        `${import.meta.env.BASE_URL}wasm`,
      );
      return PoseLandmarker.createFromOptions(wasm, {
        baseOptions: {
          modelAssetPath: `${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.55,
        minPosePresenceConfidence: 0.55,
        minTrackingConfidence: 0.5,
      }).catch(async () =>
        PoseLandmarker.createFromOptions(wasm, {
          baseOptions: {
            modelAssetPath: `${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        }),
      );
    })().catch((error) => {
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
