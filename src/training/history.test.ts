import { describe, expect, it, vi } from 'vitest';
import { demoPose } from '../pose/demo';
import { comparableHistory, comparisonKey, downloadJson, HISTORY_KEY, HistoryStore, metrics, parseHistory } from './history';
import { TrainingController, type WorkoutRecord } from './session';

function fixture(id = 'one'): WorkoutRecord {
  const controller = new TrainingController('squat', 'camera', { sets: 1, reps: 20, restSeconds: 0 }, 'side-room-A', 0, '2026-10-20T10:00:00Z', id);
  for (let t = 90; t < 3700; t += 90) controller.sample(demoPose('squat', t - 90), t, 1.6, t);
  // Include both insufficient and incomplete attempts alongside a full cycle.
  for (let t = 3690; t < 5400; t += 90) controller.sample(demoPose('squat', t - 3690), t + 100, 1.6, t + 100);
  controller.pause(5600); controller.resume(5700);
  for (let t = 0; t < 2000; t += 90) controller.sample(demoPose('squat', 0), 5800 + t, 1.6, 5800 + t);
  // Finish mid-motion with sufficient coverage: incomplete, not insufficient.
  for (let t = 0; t < 1500; t += 90) controller.sample(demoPose('squat', t), 8000 + t, 1.6, 8000 + t);
  return controller.finish(9500, 9500);
}
function memory() {
  const entries = new Map<string, string>();
  return { entries, getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
}
describe('local workout storage', () => {
  it('downloads a valid JSON snapshot and preserves the exact raw recovery string', async () => {
    vi.useFakeTimers();
    const link = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('document', { createElement: () => link });
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      const records = [fixture()];
      downloadJson({ schemaVersion: 1, records }, 'workout.json');
      const blob = create.mock.calls[0][0] as Blob;
      expect(blob.type).toBe('application/json');
      expect(parseHistory(await blob.text())).toEqual(records);
      expect(link.download).toBe('workout.json'); expect(link.href).toBe('blob:test'); expect(link.click).toHaveBeenCalledOnce();
      const raw = '{corrupt original'; downloadJson(raw, 'original.json', true);
      expect(await (create.mock.calls[1][0] as Blob).text()).toBe(raw);
      expect(revoke).not.toHaveBeenCalled(); vi.runAllTimers(); expect(revoke).toHaveBeenCalledTimes(2);
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); }
  });
  it('survives a new store instance and retains outcomes, criteria and provenance', () => {
    const storage = memory(); const first = new HistoryStore(() => storage); const r = fixture();
    expect(r.sets[0].result.reps).toBe(1);
    expect(r.sets[0].result.unassessed).toBe(1);
    expect(r.sets[0].result.incomplete).toBe(1);
    expect(first.save(r)).toBeNull();
    const afterReload = new HistoryStore(() => storage).load();
    expect(afterReload.error).toBeNull(); expect(afterReload.records).toEqual([r]);
    expect(parseHistory(JSON.stringify({ schemaVersion: 1, records: afterReload.records }))).toEqual([r]);
  });
  it('deduplicates repeated save/finish, merges current records and deletes just the selected one', () => {
    const storage = memory(); const a = new HistoryStore(() => storage); const b = new HistoryStore(() => storage);
    const r = fixture(); a.save(r); b.save(fixture('two')); a.save(r);
    expect(a.load().records.map(r => r.id)).toEqual(['one', 'two']);
    expect(a.remove('one')).toBeNull(); expect(b.load().records.map(r => r.id)).toEqual(['two']);
    expect(a.clear()).toBeNull(); expect(b.load().records).toEqual([]);
  });
  for (const raw of ['{invalid', '{"schemaVersion":99,"records":[]}', '{"schemaVersion":1,"records":[{}]}', 'null']) {
    it(`preserves unreadable history and blocks replacement: ${raw}`, () => {
      const storage = memory(); storage.setItem(HISTORY_KEY, raw); const store = new HistoryStore(() => storage);
      expect(store.load().error).toBeTruthy(); expect(store.load().raw).toBe(raw);
      expect(store.save(fixture())).toBeTruthy(); expect(store.remove('one')).toBeTruthy();
      expect(storage.getItem(HISTORY_KEY)).toBe(raw);
      expect(store.clear()).toBeNull(); // Only explicit UI confirmation calls this.
      expect(store.save(fixture())).toBeNull();
    });
  }
  it('handles denied access, write/quota errors and failed deletion without throwing or pruning', () => {
    const denied = new HistoryStore(() => { throw new DOMException('denied', 'SecurityError'); });
    expect(denied.load().error).toBeTruthy(); expect(denied.save(fixture())).toBeTruthy(); expect(denied.clear()).toBeTruthy();
    const storage = memory(); const good = new HistoryStore(() => storage); good.save(fixture());
    const before = storage.getItem(HISTORY_KEY);
    const full = new HistoryStore(() => ({ ...storage, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); }, removeItem: () => { throw Error('denied'); } }));
    expect(full.save(fixture('two'))).toContain('заполнено'); expect(full.remove('one')).toBeTruthy(); expect(full.clear()).toBeTruthy();
    expect(storage.getItem(HISTORY_KEY)).toBe(before);
  });
  it('rejects malformed nested data and inconsistent counters without overwriting original data', () => {
    const mutations: ((r: WorkoutRecord) => void)[] = [
      r => { r.sets[0].result.attempts[0].criteria.depth!.status = 'bad' as never; },
      r => { r.sets[0].result.reps = 500; },
      r => { r.sets[0].result.attempts[0].reasons = [{ code: 'bad' as never }]; },
      r => { r.sets[0].result.attempts[0].remarks = ['bad' as never]; },
      r => { r.sets[0].observation.sampledMs = -1; },
      r => { r.metadata.tracking = null as never; },
      r => { r.sets[0].result.attempts[0].endedAt = -1; },
      r => { r.schemaVersion = 2 as never; },
    ];
    for (const mutate of mutations) {
      const r = fixture(); mutate(r);
      const raw = JSON.stringify({ schemaVersion: 1, records: [r] });
      expect(() => parseHistory(raw)).toThrow();
      const storage = memory(); storage.setItem(HISTORY_KEY, raw); const store = new HistoryStore(() => storage);
      expect(store.save(fixture('new'))).toBeTruthy(); expect(storage.getItem(HISTORY_KEY)).toBe(raw);
    }
  });
});
describe('comparable observations and honest denominators', () => {
  it('computes unassessed over all attempts and findings only over assessed criteria', () => {
    const r = fixture(); const m = metrics(r);
    expect(m.result.attempts).toHaveLength(3); expect(m.result.unassessed).toBe(1);
    for (const code of ['depth', 'extension', 'lean', 'line'] as const) {
      const assessed = m.result.attempts.filter(a => a.criteria[code] && a.criteria[code]!.status !== 'unassessed');
      expect(m.criteria[code].denominator).toBe(assessed.length);
      expect(m.criteria[code].deviations).toBe(assessed.filter(a => a.criteria[code]!.status === 'deviation').length);
    }
    expect(m.criteria.line.denominator).toBe(0);
    expect(m.completedSets).toBe(0); expect(m.targetSets).toBe(0);
  });
  it('excludes demo, separates video/live and each significant parameter change', () => {
    const selected = fixture(); const same = fixture('same');
    const mutations: ((r: WorkoutRecord) => void)[] = [
      r => { r.mode = 'demo'; }, r => { r.mode = 'video'; }, r => { r.exercise = 'pushup'; },
      r => { r.metadata.rulesVersion = 'next'; }, r => { r.metadata.analysisVersion = 'next'; },
      r => { r.metadata.variant.lowerAngle = 110; }, r => { r.metadata.variant.id = 'other'; },
      r => { r.metadata.tracking.smoothingMs = 999; }, r => { r.conditions = 'other-room'; },
      r => { r.goal.restSeconds = 90; }, r => { r.sets[0].observation.sideViewConfirmed = true; },
      r => { r.metadata.detector = 'next-model'; },
      r => { r.metadata.source = { width: 640, height: 480, delegate: 'CPU', settings: { numPoses: 1 } }; },
    ];
    const changed = mutations.map((mutate, i) => { const r = fixture(String(i)); mutate(r); return r; });
    expect(comparableHistory([selected, same, ...changed], selected).map(r => r.id)).toEqual(['one', 'same']);
    const demo = fixture(); demo.mode = 'demo'; expect(comparableHistory([demo], demo)).toEqual([]);
  });
  it('does not assume missing conditions are equivalent, and compares parameter values regardless of key order', () => {
    const a = fixture(); const b = fixture('two');
    b.metadata.tracking = Object.fromEntries(Object.entries(b.metadata.tracking).reverse());
    expect(comparisonKey(a)).toBe(comparisonKey(b));
    a.conditions = ''; b.conditions = '';
    expect(comparableHistory([a, b], a)).toEqual([a]);
  });
  it('separates actual CPU/GPU settings and capture resolution in saved provenance', () => {
    const a = fixture(); const b = fixture('two');
    a.metadata.source = { width: 1280, height: 720, delegate: 'GPU', settings: { minPoseDetectionConfidence: 0.55 } };
    b.metadata.source = structuredClone(a.metadata.source);
    expect(comparableHistory([a, b], a)).toHaveLength(2);
    b.metadata.source.delegate = 'CPU'; expect(comparableHistory([a, b], a)).toHaveLength(1);
    b.metadata.source = { ...a.metadata.source, width: 640 }; expect(comparableHistory([a, b], a)).toHaveLength(1);
  });
});
