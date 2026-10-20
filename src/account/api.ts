import type { WorkoutRecord, TrainingGoal } from '../training/session';
import type { ExerciseType, InputMode } from '../exercises/types';
import { isProgram, type HistoryRecord, type ProgramRecord, type ProgramSnapshot } from '../../shared/program';
export interface User { id: string; login: string; nickname: string; avatar: string; createdAt: string }
export interface AccountResult {
  id: string; runId: string | null; source: 'training' | 'historical_import'; sourceVersion: number;
  originalId: string | null; createdAt: string; archivedAt: string | null; record: HistoryRecord;
}
export function accountHistoryExport(results:AccountResult[]) {
  return {schemaVersion:1,records:results.filter(r=>!isProgram(r.record)).map(r=>({...r.record,id:r.id})),programs:results.filter(r=>isProgram(r.record)).map(r=>r.record),accountResults:results.map(({record,...provenance})=>({...provenance,recordId:record.id}))};
}
export class RequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}
export async function api<T>(path: string, options: { method?: string; body?: unknown; userId?: string; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { method: options.method ?? 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([AbortSignal.timeout(15000), ...(options.signal ? [options.signal] : [])]),
      headers: { 'x-playfit-request': '1', ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...(options.userId ? { 'x-playfit-user': options.userId } : {}) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  } catch { throw new RequestError('Нет связи с локальным сервером. Проверь запуск приложения и повтори действие.', 'NETWORK', 0); }
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) throw new RequestError(data?.error?.message ?? 'Не удалось получить ответ сервера. Повтори действие.', data?.error?.code ?? 'NETWORK', response.status);
  return data as T;
}
export const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие.';
export type RunSnapshot = { exercise: ExerciseType; mode: InputMode; goal: TrainingGoal; conditions: string };
export interface TrainingPersistence {
  begin(snapshot: RunSnapshot): Promise<{id:string;createdAt:string}>;
  save(record:WorkoutRecord): Promise<void>;
}
export class ProgramPersistence {
  private requestId = crypto.randomUUID();
  private snapshot: ProgramSnapshot | null = null;
  constructor(readonly userId: string) {}
  begin(snapshot:ProgramSnapshot) {
    if (JSON.stringify(snapshot) !== JSON.stringify(this.snapshot)) {this.requestId=crypto.randomUUID();this.snapshot=structuredClone(snapshot);}
    return api<{id:string;createdAt:string; snapshot:ProgramSnapshot}>('/runs',{method:'POST',body:{...snapshot,requestId:this.requestId},userId:this.userId});
  }
  async save(record:ProgramRecord) { await api(`/runs/${encodeURIComponent(record.id)}/complete`,{method:'POST',body:{record},userId:this.userId}); }
}
// A failed begin retains its request ID. A failed completion retains its run ID and payload.
export class AccountPersistence {
  private pending: { key: string; requestId: string } | null = null;
  constructor(readonly userId: string) {}
  async begin(snapshot: RunSnapshot) {
    const key = JSON.stringify(snapshot);
    if (this.pending?.key !== key) this.pending = { key, requestId: crypto.randomUUID() };
    const run = await api<{ id: string; createdAt: string }>('/runs', { method:'POST', userId:this.userId, body:{ ...snapshot, requestId:this.pending.requestId } });
    this.pending = null;
    return run;
  }
  async save(record: WorkoutRecord) {
    await api(`/runs/${encodeURIComponent(record.id)}/complete`, { method:'POST', body:{ record }, userId:this.userId });
  }
}
