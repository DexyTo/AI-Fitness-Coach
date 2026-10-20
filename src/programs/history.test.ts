import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPrograms, saveProgram, PROGRAM_HISTORY_KEY } from './history';
import { ProgramController } from './controller';
import type { ProgramSnapshot } from '../../shared/program';
const snapshot:ProgramSnapshot={kind:'program',mode:'demo',conditions:'',program:{schemaVersion:1,id:'one',origin:'catalog',ownerId:null,version:1,title:'Один шаг',description:'',steps:[{id:'s',exercise:'squat',goal:{sets:1,reps:1,restSeconds:0},transitionSeconds:0}]}};
afterEach(()=>vi.unstubAllGlobals());
describe('separate guest program history',()=>{
  it('preserves v1, deduplicates retries and refuses conflicts, damaged data and failed writes',()=>{
    const values=new Map([['playfit.workouts.v1','keep v1']]);
    const storage={getItem:(k:string)=>values.get(k)??null,setItem:vi.fn((k:string,v:string)=>{values.set(k,v);})};vi.stubGlobal('localStorage',storage);
    const record=new ProgramController(snapshot,'run','2026-10-20T10:00:00Z',0).finish(1000,true);
    saveProgram(record);saveProgram(record);expect(loadPrograms().records).toEqual([record]);expect(values.get('playfit.workouts.v1')).toBe('keep v1');
    const raw=values.get(PROGRAM_HISTORY_KEY);expect(()=>saveProgram({...record,duration:2})).toThrow(/другой результат/);expect(values.get(PROGRAM_HISTORY_KEY)).toBe(raw);
    storage.setItem.mockImplementationOnce(()=>{throw Error('quota');});expect(()=>saveProgram({...record,id:'another'})).toThrow(/хранилище/);expect(values.get(PROGRAM_HISTORY_KEY)).toBe(raw);
    values.set(PROGRAM_HISTORY_KEY,'damaged');expect(loadPrograms().error).toBeTruthy();expect(()=>saveProgram(record)).toThrow();expect(values.get(PROGRAM_HISTORY_KEY)).toBe('damaged');
  });
});
