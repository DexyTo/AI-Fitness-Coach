import { describe, expect, it } from 'vitest';
import { validDraft } from './programDraft';

describe('builder shares the executable plan contract',()=>{
  it('requires explicit numeric goals and at least one known unique step',()=>{
    const draft={title:'План',description:'',steps:[{id:'one',exercise:'squat' as const,goal:{sets:1,reps:2,restSeconds:0},transitionSeconds:0}]};
    expect(validDraft(draft)).toBe(true);
    expect(validDraft({...draft,title:'  '})).toBe(false);
    expect(validDraft({...draft,steps:[]})).toBe(false);
    expect(validDraft({...draft,steps:[draft.steps[0],draft.steps[0]]})).toBe(false);
    expect(validDraft({...draft,steps:[{...draft.steps[0],goal:{sets:NaN,reps:NaN,restSeconds:NaN}}]})).toBe(false);
  });
});
