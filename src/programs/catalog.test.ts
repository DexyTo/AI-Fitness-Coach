import { describe, expect, it } from 'vitest';
import type { ProgramPlan } from '../../shared/program';
import { matchesProgram, programExercises } from './catalog';

const plan: ProgramPlan = {
  schemaVersion: 1, id: 'mixed', version: 1, origin: 'catalog', ownerId: null,
  title: 'На коврике', description: 'Два движения в трёх шагах.',
  steps: [
    { id: 'bridge-1', exercise: 'glute_bridge', goal: { sets: 1, reps: 8, restSeconds: 30 }, transitionSeconds: 30 },
    { id: 'plank', exercise: 'forearm_plank', goal: { sets: 1, unit: 'seconds', seconds: 20, restSeconds: 30 }, transitionSeconds: 30 },
    { id: 'bridge-2', exercise: 'glute_bridge', goal: { sets: 1, reps: 8, restSeconds: 30 }, transitionSeconds: 0 },
  ],
};

describe('program discovery', () => {
  it('finds exercises inside mixed plans by label and exercise filter', () => {
    expect(matchesProgram(plan, '  ПЛАНКА ', 'all', 'all')).toBe(true);
    expect(matchesProgram(plan, '', 'forearm_plank', 'all')).toBe(true);
    expect(matchesProgram(plan, 'мостик', 'mixed', '3+')).toBe(true);
    expect(matchesProgram(plan, '', 'pushup', 'all')).toBe(false);
    expect(matchesProgram(plan, 'планка', 'mixed', '2')).toBe(false);
    expect(matchesProgram(plan, 'гантели', 'all', 'all')).toBe(false);
  });
  it('lists distinct movements while counting repeated steps separately', () => {
    expect(programExercises(plan)).toEqual(['glute_bridge', 'forearm_plank']);
    expect(matchesProgram(plan, '', 'mixed', '3+')).toBe(true);
    const single = { ...plan, steps: [plan.steps[0], plan.steps[2]] };
    expect(matchesProgram(single, '', 'mixed', 'all')).toBe(false);
    expect(matchesProgram(single, '', 'glute_bridge', '2')).toBe(true);
  });
});
