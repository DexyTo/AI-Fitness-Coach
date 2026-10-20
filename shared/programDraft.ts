import type { ProgramPlan, ProgramStep } from './program.js';
import { validPlan } from './program.js';

// The builder and catalog share the same step and parameter contract.
export interface ProgramDraft { title: string; description: string; steps: ProgramStep[] }
export function validDraft(draft: ProgramDraft): boolean {
  try {
    return validPlan({ ...draft, schemaVersion: 1, id: 'draft', version: 1, origin: 'personal', ownerId: 'draft' });
  } catch { return false; }
}
export const draftOf = (plan: ProgramPlan): ProgramDraft => ({title: plan.title, description: plan.description, steps: structuredClone(plan.steps)});
