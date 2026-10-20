import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountPersistence, api } from './api';
import { TrainingController } from '../training/session';
afterEach(() => vi.unstubAllGlobals());
describe('account persistence and failure handling',() => {
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
    fetch.mockResolvedValueOnce(new Response('{}')); await persistence.save(record);
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
