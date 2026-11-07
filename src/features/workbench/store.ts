/**
 * Workbench storage: IndexedDB is the authoritative store.
 *
 * Every mutation (import, delete, log, clear) runs inside one readwrite
 * transaction that reads the latest record, validates, mutates and writes
 * it back. The transaction only reports success after it commits, so two
 * tabs can never clobber each other with a stale whole-snapshot write the
 * way the previous localStorage code did. Capacity is checked inside the
 * same transaction: a full store rejects the import instead of silently
 * evicting the oldest dataset with .slice(0, 5).
 *
 * Cross-tab notification (BroadcastChannel) only tells other tabs to
 * re-read; write correctness comes from the transactions, never from the
 * notification. No Web Locks are used, so disabling them changes nothing.
 */
import {
  MAX_DATASETS,
  WORKBENCH_KEY,
  parseWorkbench,
  type Activity,
  type Dataset,
  type WorkbenchData,
} from './data';

export const WORKBENCH_DB_NAME = 'agridx-workbench';
export const WORKBENCH_DB_VERSION = 1;
export const WORKBENCH_STORE_NAME = 'workbench-state';
export const WORKBENCH_RECORD_KEY = 'workbench';
export const WORKBENCH_CHANNEL_NAME = 'agridx-workbench';
export const WORKBENCH_CHANNEL_MESSAGE = 'agridx-workbench-changed';

export interface WorkbenchRecord {
  data: WorkbenchData;
  migrated: boolean;
}

export class WorkbenchCapacityError extends Error {
  constructor() {
    super('最多保留 5 个数据集，请先删除不需要的数据集。');
    this.name = 'WorkbenchCapacityError';
  }
}

export class WorkbenchUnavailableError extends Error {
  constructor() {
    super('浏览器数据库不可用，数据仅保留在当前页面，请先导出。');
    this.name = 'WorkbenchUnavailableError';
  }
}

export type WorkbenchOperation =
  | { type: 'import'; dataset: Dataset }
  | { type: 'delete'; id: string }
  | { type: 'log'; kind: Activity['kind']; text: string; object: string }
  | { type: 'clearActivities' };

export function emptyWorkbenchData(): WorkbenchData {
  return { datasets: [], activities: [] };
}

function addActivity(previous: WorkbenchData, kind: Activity['kind'], text: string, object: string): WorkbenchData {
  const activity: Activity = {
    id: crypto.randomUUID(),
    at: Date.now(),
    kind,
    text: text.slice(0, 1000),
    object: object.slice(0, 150),
  };
  return { ...previous, activities: [activity, ...previous.activities].slice(0, 100) };
}

/**
 * Pure state transition for one explicit operation. Throws
 * WorkbenchCapacityError when an import would exceed MAX_DATASETS; the
 * caller must abort the enclosing transaction so nothing is written and
 * the rejected draft is preserved by the caller.
 */
export function applyWorkbenchOperation(previous: WorkbenchData, operation: WorkbenchOperation): WorkbenchData {
  switch (operation.type) {
    case 'import': {
      if (previous.datasets.some(d => d.id === operation.dataset.id)) return previous;
      if (previous.datasets.length >= MAX_DATASETS) throw new WorkbenchCapacityError();
      return addActivity(
        { ...previous, datasets: [operation.dataset, ...previous.datasets] },
        'import',
        operation.dataset.name,
        operation.dataset.object,
      );
    }
    case 'delete':
      return { ...previous, datasets: previous.datasets.filter(d => d.id !== operation.id) };
    case 'log':
      return addActivity(previous, operation.kind, operation.text, operation.object);
    case 'clearActivities':
      return { ...previous, activities: [] };
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function openWorkbenchDb(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<IDBDatabase> {
  if (!factory) return Promise.reject(new WorkbenchUnavailableError());
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(WORKBENCH_DB_NAME, WORKBENCH_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WORKBENCH_STORE_NAME)) db.createObjectStore(WORKBENCH_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

export async function readWorkbenchRecord(db: IDBDatabase): Promise<WorkbenchRecord | null> {
  const transaction = db.transaction(WORKBENCH_STORE_NAME, 'readonly');
  const store = transaction.objectStore(WORKBENCH_STORE_NAME);
  const record = await requestToPromise(store.get(WORKBENCH_RECORD_KEY));
  await transactionComplete(transaction);
  if (!record || typeof record !== 'object') return null;
  const stored = record as Partial<WorkbenchRecord>;
  return { data: parseWorkbench(stored.data), migrated: stored.migrated === true };
}

/** Run one explicit operation in a single readwrite transaction and return the committed data. */
export async function runWorkbenchOperation(db: IDBDatabase, operation: WorkbenchOperation): Promise<WorkbenchData> {
  const transaction = db.transaction(WORKBENCH_STORE_NAME, 'readwrite');
  const store = transaction.objectStore(WORKBENCH_STORE_NAME);
  const record = await requestToPromise(store.get(WORKBENCH_RECORD_KEY));
  const previous = record && typeof record === 'object' ? parseWorkbench((record as Partial<WorkbenchRecord>).data) : emptyWorkbenchData();
  let next: WorkbenchData;
  try {
    next = applyWorkbenchOperation(previous, operation);
  } catch (error) {
    transaction.abort();
    throw error;
  }
  await requestToPromise(store.put(
    { data: next, migrated: (record as Partial<WorkbenchRecord> | undefined)?.migrated ?? true } satisfies WorkbenchRecord,
    WORKBENCH_RECORD_KEY,
  ));
  await transactionComplete(transaction);
  return next;
}

export type MigrationResult =
  | { status: 'migrated'; data: WorkbenchData }
  | { status: 'migrated-empty'; data: WorkbenchData }
  | { status: 'already-migrated' }
  | { status: 'corrupt'; raw: string };

/**
 * Move the legacy localStorage value into IndexedDB exactly once. The
 * migration marker is written in the same transaction as the data, so two
 * tabs cannot migrate twice. Corrupt or partially invalid legacy data is
 * reported with its raw text and nothing is written: the store is never
 * silently replaced by an empty one, and the legacy key stays available
 * as recovery material.
 */
export async function migrateLegacyWorkbench(
  db: IDBDatabase,
  storage: Pick<Storage, 'getItem'> = globalThis.localStorage,
): Promise<MigrationResult> {
  const transaction = db.transaction(WORKBENCH_STORE_NAME, 'readwrite');
  const store = transaction.objectStore(WORKBENCH_STORE_NAME);
  const existing = await requestToPromise(store.get(WORKBENCH_RECORD_KEY));
  if (existing && typeof existing === 'object') {
    await transactionComplete(transaction);
    return { status: 'already-migrated' };
  }
  const raw = storage.getItem(WORKBENCH_KEY);
  if (raw === null) {
    const data = emptyWorkbenchData();
    await requestToPromise(store.put({ data, migrated: true } satisfies WorkbenchRecord, WORKBENCH_RECORD_KEY));
    await transactionComplete(transaction);
    return { status: 'migrated-empty', data };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'corrupt', raw };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'corrupt', raw };
  const legacy = parsed as { datasets?: unknown; activities?: unknown };
  if ((legacy.datasets !== undefined && !Array.isArray(legacy.datasets)) ||
      (legacy.activities !== undefined && !Array.isArray(legacy.activities))) {
    return { status: 'corrupt', raw };
  }
  const data = parseWorkbench(parsed);
  const rawDatasets = Array.isArray(legacy.datasets) ? legacy.datasets.length : 0;
  const rawActivities = Array.isArray(legacy.activities) ? legacy.activities.length : 0;
  if (data.datasets.length < Math.min(rawDatasets, MAX_DATASETS) ||
      data.activities.length < Math.min(rawActivities, 100)) {
    return { status: 'corrupt', raw };
  }
  await requestToPromise(store.put({ data, migrated: true } satisfies WorkbenchRecord, WORKBENCH_RECORD_KEY));
  await transactionComplete(transaction);
  return { status: 'migrated', data };
}

/** True when an old-version tab has written the legacy key since it was last seen. */
export function detectLegacyWrite(previousRaw: string | null, storage: Pick<Storage, 'getItem'> = globalThis.localStorage): boolean {
  return storage.getItem(WORKBENCH_KEY) !== previousRaw;
}

/** Notify other tabs to re-read. A no-op when BroadcastChannel is unavailable; correctness never depends on it. */
export function notifyWorkbenchChanged(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(WORKBENCH_CHANNEL_NAME);
  channel.postMessage(WORKBENCH_CHANNEL_MESSAGE);
  channel.close();
}

/** Subscribe to other tabs' change notifications. Returns null when BroadcastChannel is unavailable. */
export function subscribeWorkbenchChanged(onChange: () => void): (() => void) | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const channel = new BroadcastChannel(WORKBENCH_CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent) => {
    if (event.data === WORKBENCH_CHANNEL_MESSAGE) onChange();
  };
  return () => channel.close();
}
