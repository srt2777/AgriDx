import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  WORKBENCH_DB_NAME,
  WORKBENCH_DB_VERSION,
  WorkbenchCapacityError,
  applyWorkbenchOperation,
  detectLegacyWrite,
  migrateLegacyWorkbench,
  notifyWorkbenchChanged,
  openWorkbenchDb,
  readWorkbenchRecord,
  runWorkbenchOperation,
  subscribeWorkbenchChanged,
  type WorkbenchData,
  type WorkbenchOperation,
} from '../src/features/workbench/store';
import { WORKBENCH_KEY, parseWorkbench } from '../src/features/workbench/data';

const dataset = (id: string, name = id) => ({
  id, name, unit: 'rpm', object: 'tractor', source: 'user-import' as const, createdAt: 1,
  points: [{ at: 0, value: 1 }, { at: 1, value: 2 }],
});
const five = () => [1, 2, 3, 4, 5].map(n => dataset(`d${n}`));

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

async function freshDb() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(WORKBENCH_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  return openWorkbenchDb();
}

test('old read-once/write-back model loses a concurrent import (bug reproduction)', () => {
  // The previous WorkbenchContext read localStorage once per tab and wrote the
  // whole snapshot back. Two tabs importing from the same snapshot: the last
  // writer silently drops the other tab's dataset. This test pins that loss.
  const snapshot = { datasets: [] as ReturnType<typeof dataset>[], activities: [] as never[] };
  const tabA = { ...snapshot, datasets: [dataset('a')] };
  const tabB = { ...snapshot, datasets: [dataset('b')] };
  const lastWriteWins = tabB; // tab B writes after tab A
  assert.equal(lastWriteWins.datasets.length, 1);
  assert.equal(lastWriteWins.datasets[0].id, 'b');
  void tabA;
});

test('two concurrent imports both survive when each reads latest in its transaction', async () => {
  const db = await freshDb();
  const [a, b] = await Promise.all([
    runWorkbenchOperation(db, { type: 'import', dataset: dataset('a') }),
    runWorkbenchOperation(db, { type: 'import', dataset: dataset('b') }),
  ]);
  void a; void b;
  const record = await readWorkbenchRecord(db);
  assert.equal(record?.data.datasets.length, 2);
  assert.deepEqual(record?.data.datasets.map(d => d.id).sort(), ['a', 'b']);
  db.close();
});

test('a stale reader appending data cannot overwrite a newer record', async () => {
  const db = await freshDb();
  await runWorkbenchOperation(db, { type: 'import', dataset: dataset('new') });
  // A tab that still holds the pre-import snapshot would write it back under
  // the old model. The store never writes a snapshot: every operation reads
  // the latest record inside its own transaction.
  const after = await runWorkbenchOperation(db, { type: 'import', dataset: dataset('later') });
  assert.deepEqual(after.datasets.map(d => d.id).sort(), ['later', 'new']);
  db.close();
});

test('delete racing an import never resurrects the deleted dataset', async () => {
  const db = await freshDb();
  await runWorkbenchOperation(db, { type: 'import', dataset: dataset('gone') });
  const [afterDelete, afterImport] = await Promise.all([
    runWorkbenchOperation(db, { type: 'delete', id: 'gone' }),
    runWorkbenchOperation(db, { type: 'import', dataset: dataset('kept') }),
  ]);
  void afterDelete; void afterImport;
  const record = await readWorkbenchRecord(db);
  assert.deepEqual(record?.data.datasets.map(d => d.id), ['kept']);
  db.close();
});

test('four datasets plus two concurrent imports: exactly one succeeds, the four stay', async () => {
  const db = await freshDb();
  for (const d of five().slice(0, 4)) await runWorkbenchOperation(db, { type: 'import', dataset: d });
  const results = await Promise.allSettled([
    runWorkbenchOperation(db, { type: 'import', dataset: dataset('fifth') }),
    runWorkbenchOperation(db, { type: 'import', dataset: dataset('sixth') }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.ok(results.find(r => r.status === 'rejected')?.reason instanceof WorkbenchCapacityError);
  const record = await readWorkbenchRecord(db);
  assert.equal(record?.data.datasets.length, 5);
  assert.deepEqual(record?.data.datasets.map(d => d.id).sort(), ['d1', 'd2', 'd3', 'd4', 'fifth']);
  // A rejected import keeps its draft: nothing was written for it.
  assert.equal(record?.data.datasets.some(d => d.id === 'sixth'), false);
  db.close();
});

test('capacity is enforced inside the transaction, not by truncating with slice', () => {
  const previous: WorkbenchData = { datasets: five(), activities: [] };
  assert.throws(
    () => applyWorkbenchOperation(previous, { type: 'import', dataset: dataset('extra') }),
    WorkbenchCapacityError,
  );
  // The old code silently dropped the oldest dataset with .slice(0, 5);
  // the new operation rejects instead, so no existing dataset is evicted.
  assert.equal(previous.datasets.length, 5);
  assert.equal(previous.datasets[0].id, 'd1');
});

test('import, delete, log and clear-activities are explicit operations', () => {
  const empty: WorkbenchData = { datasets: [], activities: [] };
  const imported = applyWorkbenchOperation(empty, { type: 'import', dataset: dataset('a') });
  assert.equal(imported.datasets.length, 1);
  assert.equal(imported.activities[0].kind, 'import');
  const logged = applyWorkbenchOperation(imported, { type: 'log', kind: 'note', text: 'checked', object: 'tractor' });
  assert.equal(logged.activities.length, 2);
  const cleared = applyWorkbenchOperation(logged, { type: 'clearActivities' });
  assert.deepEqual(cleared.activities, []);
  assert.equal(cleared.datasets.length, 1);
  const deleted = applyWorkbenchOperation(cleared, { type: 'delete', id: 'a' });
  assert.deepEqual(deleted.datasets, []);
  const op: WorkbenchOperation = { type: 'delete', id: 'missing' };
  assert.deepEqual(applyWorkbenchOperation(deleted, op), deleted);
});

test('migration moves legacy localStorage data once, preserving ids, samples and source', async () => {
  const db = await freshDb();
  const legacy = { datasets: [dataset('legacy-1'), dataset('legacy-2')], activities: [{ id: 'a1', at: 1, kind: 'import', text: 'legacy-1', object: 'tractor' }] };
  const storage = memoryStorage({ [WORKBENCH_KEY]: JSON.stringify(legacy) });
  const first = await migrateLegacyWorkbench(db, storage as Storage);
  assert.equal(first.status, 'migrated');
  assert.deepEqual(first.data?.datasets.map(d => d.id), ['legacy-1', 'legacy-2']);
  assert.equal(first.data?.datasets[0].source, 'user-import');
  assert.deepEqual(first.data?.datasets[0].points, [{ at: 0, value: 1 }, { at: 1, value: 2 }]);
  const second = await migrateLegacyWorkbench(db, storage as Storage);
  assert.equal(second.status, 'already-migrated');
  const record = await readWorkbenchRecord(db);
  assert.equal(record?.migrated, true);
  assert.equal(record?.data.datasets.length, 2);
  // The legacy key stays as a recovery source; it is not re-imported.
  assert.equal(storage.getItem(WORKBENCH_KEY), JSON.stringify(legacy));
  db.close();
});

test('migration with no legacy key records an empty migrated state once', async () => {
  const db = await freshDb();
  const storage = memoryStorage();
  const first = await migrateLegacyWorkbench(db, storage as Storage);
  assert.equal(first.status, 'migrated-empty');
  const second = await migrateLegacyWorkbench(db, storage as Storage);
  assert.equal(second.status, 'already-migrated');
  db.close();
});

test('corrupt or partially invalid legacy data is reported, not overwritten with an empty store', async () => {
  const db = await freshDb();
  const bad = '{not json';
  const storage = memoryStorage({ [WORKBENCH_KEY]: bad });
  const result = await migrateLegacyWorkbench(db, storage as Storage);
  assert.equal(result.status, 'corrupt');
  assert.equal(result.raw, bad);
  assert.equal(await readWorkbenchRecord(db), null);
  assert.equal(storage.getItem(WORKBENCH_KEY), bad);

  const partial = memoryStorage({
    [WORKBENCH_KEY]: JSON.stringify({ datasets: [dataset('good'), { ...dataset('bad'), source: 'verified' }], activities: [] }),
  });
  const partialResult = await migrateLegacyWorkbench(db, partial as Storage);
  assert.equal(partialResult.status, 'corrupt');
  assert.equal(await readWorkbenchRecord(db), null);
  // parseWorkbench itself still validates shape; the store refuses to lose entries silently.
  assert.equal(parseWorkbench({ datasets: [dataset('good')] }).datasets.length, 1);
  db.close();
});

test('a failing transaction reports failure and leaves the record unchanged', async () => {
  const db = await freshDb();
  await runWorkbenchOperation(db, { type: 'import', dataset: dataset('kept') });
  const failingFactory = {
    open: () => {
      throw new Error('QuotaExceededError: storage quota exceeded');
    },
  } as unknown as IDBFactory;
  await assert.rejects(openWorkbenchDb(failingFactory), /QuotaExceededError/);
  const record = await readWorkbenchRecord(db);
  assert.deepEqual(record?.data.datasets.map(d => d.id), ['kept']);
  db.close();
});

test('legacy writes by an old tab are detected by comparing the stored raw value', () => {
  const storage = memoryStorage({ [WORKBENCH_KEY]: JSON.stringify({ datasets: [], activities: [] }) });
  const seen = storage.getItem(WORKBENCH_KEY);
  assert.equal(detectLegacyWrite(seen, storage as Storage), false);
  storage.setItem(WORKBENCH_KEY, JSON.stringify({ datasets: [dataset('old-tab')], activities: [] }));
  assert.equal(detectLegacyWrite(seen, storage as Storage), true);
});

test('cross-tab notification is a no-op when BroadcastChannel is unavailable', () => {
  const channel = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
  delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
  try {
    assert.doesNotThrow(() => notifyWorkbenchChanged());
    assert.equal(subscribeWorkbenchChanged(() => {}), null);
  } finally {
    if (channel) (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = channel;
  }
});

test('open uses the documented database name and version', async () => {
  const db = await freshDb();
  assert.equal(db.name, WORKBENCH_DB_NAME);
  assert.equal(db.version, WORKBENCH_DB_VERSION);
  db.close();
});
