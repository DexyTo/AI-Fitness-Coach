import type { AttemptOutcome, CriterionStatus, LegacyExercise as ExerciseType, FeedbackCode, MovementAttempt, ObservationQuality, ExerciseAnalysisResult } from '../exercises/types';

export { RULES_VERSION } from '../exercises/config';
import { RULES_VERSION } from '../exercises/config';
export const PROTOCOL_VERSION = 'playfit-validation-v1';
export const criteriaFor = (exercise: ExerciseType): FeedbackCode[] => ['depth', 'extension', exercise === 'squat' ? 'lean' : 'line'];
export interface Interval { startMs: number; endMs: number }
export interface ReferenceAttempt extends Interval {
  id: string;
  outcome: AttemptOutcome;
  criteria: Partial<Record<FeedbackCode, { status: CriterionStatus; onsetMs?: number; note?: string }>>;
}
export interface Annotation {
  schemaVersion: 1;
  material: 'real' | 'synthetic';
  clipId: string;
  participantGroupId: string;
  split: 'calibration' | 'control';
  permission: { allowed: true; reference: string };
  video: { sha256: string; durationMs: number };
  exercise: ExerciseType;
  variant: 'bodyweight-side' | 'pushup-side';
  view: 'side' | 'unsuitable' | 'unknown';
  conditions: string[];
  annotation: {
    revision: string;
    source: 'human' | 'synthetic';
    reviewer: 'coach' | 'unreviewed';
    protocolVersion: typeof PROTOCOL_VERSION;
    rulesVersion: typeof RULES_VERSION;
  };
  sideConfirmationsMs: number[];
  unassessable: (Interval & { reason: string })[];
  attempts: ReferenceAttempt[];
}
export interface ValidationFrame {
  atMs: number;
  observation: ObservationQuality;
  preparation: ExerciseAnalysisResult['preparation'];
  sufficient: boolean;
  observableCriteria: FeedbackCode[];
  feedback: FeedbackCode[];
  detectorMs: number;
  analyzerMs: number;
}
export interface DetectedAttempt extends MovementAttempt {
  detectedAtMs: number;
  remarkDetectedAtMs: Partial<Record<FeedbackCode, number>>;
}
export interface ValidationRun {
  schemaVersion: 1;
  protocolVersion: typeof PROTOCOL_VERSION;
  clipId: string;
  exercise: ExerciseType;
  variant: Annotation['variant'];
  rulesVersion: typeof RULES_VERSION;
  video: Annotation['video'] & { width: number; height: number };
  sampleIntervalMs: number;
  sideConfirmationsMs: number[];
  metadata: Record<string, unknown>;
  performance: { wallMs: number; initializationMs: number; decodingAndAnalysisMs: number; duplicateFrames: number };
  frames: ValidationFrame[];
  attempts: DetectedAttempt[];
}
