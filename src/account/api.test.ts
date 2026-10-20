import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountPersistence, ProgramPersistence, accountHistoryExport, api, type AccountResult } from './api';
import { TrainingController } from '../training/session';
import { ProgramController } from '../programs/controller';
import { parseHistory } from '../training/history';
import { validProgramRecord, type ProgramSnapshot } from '../../shared/program';
afterEach(() => vi.unstubAllGlobals());
describe('account persistence and failure handling',() => {
  it('retries program start/completion with stable IDs and exports mixed history readable by v1',async()=>{
    const snapshot:ProgramSnapshot={kind:'program',mode:'demo',conditions:'',program:{schemaVersion:1,id:'one',origin:'catalog',ownerId:null,version:1,title:'Приседания',description:'',steps:[{id:'s',exercise:'squat',goal:{sets:1,reps:1,restSeconds:0},transitionSeconds:0}]}};
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const persistence=new ProgramPersistence('alice');
    fetch.mockRejectedValueOnce(Error('lost response'));await expect(persistence.begin(snapshot)).rejects.toMatchObject({code:'NETWORK'});
    const date='2026-10-20T10:00:00Z';fetch.mockResolvedValueOnce(new Response(JSON.stringify({id:'run',createdAt:date,snapshot})));await persistence.begin(snapshot);
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
    const program=new ProgramController(snapshot,'run',date,0).finish(1000,true);
    fetch.mockRejectedValueOnce(Error('lost completion'));await expect(persistence.save(program)).rejects.toMatchObject({code:'NETWORK'});fetch.mockResolvedValueOnce(new Response('{}'));await persistence.save(program);
    expect(fetch.mock.calls[2][1].body).toBe(fetch.mock.calls[3][1].body);expect(fetch.mock.calls[3][1].headers['x-playfit-user']).toBe('alice');
    const workout=new TrainingController('squat','demo',snapshot.program.steps[0].goal,'',0,date,'single').finish(1000,1000);
    const result=(record:AccountResult['record'],id:string):AccountResult=>({id,runId:record.id,source:'training',sourceVersion:record.schemaVersion,originalId:null,createdAt:date,archivedAt:null,record});
    const envelope=accountHistoryExport([result(workout,'result-single'),result(program,'result-program')]);
    expect(parseHistory(JSON.stringify(envelope))).toEqual([{...workout,id:'result-single'}]);expect(envelope.programs).toEqual([program]);expect(validProgramRecord(envelope.programs[0] as typeof program)).toBe(true);expect(envelope.accountResults[1]).toMatchObject({id:'result-program',recordId:'run'});
    const first=JSON.parse(fetch.mock.calls[1][1].body).requestId;fetch.mockResolvedValueOnce(new Response('{}'));await persistence.begin({...snapshot,conditions:'new conditions'});expect(JSON.parse(fetch.mock.calls[4][1].body).requestId).not.toBe(first);
  });
  it('reuses a lost begin request ID and completes with the same run, payload and expected owner after a lost response',async () => {
    const fetch=vi.fn(); vi.stubGlobal('fetch',fetch);
    const persistence=new AccountPersistence('alice'); const snapshot={exercise:'squat' as const,mode:'demo' as const,goal:{sets:1,reps:1,restSeconds:0},conditions:''};
    fetch.mockRejectedValueOnce(new TypeError('offline'));
    await expect(persistence.begin(snapshot)).rejects.toMatchObject({code:'NETWORK'});
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({id:'server-run',createdAt:'2026-10-20T10:00:00Z'})));
    const run=await persistence.begin(snapshot);
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
    const record=new TrainingController('squat','demo',snapshot.goal,'',0,run.createdAt,run.id).finish(1000,1000);
    fetch.mockRejectedValueOnce(new TypeError('response lost'));
    await expect(persistence.save(record)).rejects.toMatchObject({code:'NETWORK'});
    const receipt={reason:'demo',xp:0,earnedAt:'2026-10-20T10:00:03Z',achievements:[]};
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({result:{reward:receipt}}))); expect(await persistence.save(record)).toEqual(receipt);
    expect(fetch.mock.calls[2][0]).toEqual(fetch.mock.calls[3][0]);
    expect(fetch.mock.calls[2][1].body).toEqual(fetch.mock.calls[3][1].body);
    expect(fetch.mock.calls[3][0]).toBe('/api/runs/server-run/complete');
    expect(fetch.mock.calls[3][1].headers['x-playfit-user']).toBe('alice');
    expect(fetch.mock.calls[3][1].credentials).toBe('same-origin');
  });
  it('surfaces unauthorized, conflict and malformed responses without silently treating them as saved',async () => {
    const fetch=vi.fn(); vi.stubGlobal('fetch',fetch);
    for (const [status,code] of [[401,'AUTH_REQUIRED'],[409,'RESULT_CONFLICT'],[500,'INTERNAL_ERROR']] as const) {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({error:{code,message:'Повтори действие'}}),{status}));
      await expect(api('/history')).rejects.toMatchObject({status,code,message:'Повтори действие'});
    }
    fetch.mockResolvedValueOnce(new Response('<html>offline</html>'));
    await expect(api('/history')).rejects.toMatchObject({code:'NETWORK'});
  });
});
