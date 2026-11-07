import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { KnowledgeCatalog } from '../../../shared/knowledge-catalog';
import { requestKnowledgeCatalog, clearCachedKnowledgeCatalog } from '../knowledge/catalog-api';
import { WORKBENCH_KEY, downloadFile, type Activity, type Dataset, type WorkbenchData } from './data';
import {
  applyWorkbenchOperation,
  detectLegacyWrite,
  emptyWorkbenchData,
  migrateLegacyWorkbench,
  notifyWorkbenchChanged,
  openWorkbenchDb,
  readWorkbenchRecord,
  runWorkbenchOperation,
  subscribeWorkbenchChanged,
  type WorkbenchOperation,
} from './store';
function useWorkbenchState() {
  const [catalog, setCatalog] = useState<KnowledgeCatalog | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [revision, setRevision] = useState(0);
  const [brandId, setBrandId] = useState(''), [modelId, setModelId] = useState('');
  const [data, setData] = useState<WorkbenchData>(emptyWorkbenchData());
  const current = useRef(data);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const dbRef = useRef<IDBDatabase | null>(null);
  const legacyRawRef = useRef<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [migrationCorruptRaw, setMigrationCorruptRaw] = useState<string | null>(null);
  const [legacyWriteDetected, setLegacyWriteDetected] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let disposed = false;
    const timer = setTimeout(() => controller.abort(), 20000); setCatalogStatus('loading');
    requestKnowledgeCatalog('', controller.signal).then(result => { if (!disposed) { setCatalog(result); setCatalogStatus('ready'); } })
      .catch(() => { if (!disposed) setCatalogStatus('error'); }).finally(() => clearTimeout(timer));
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [revision]);
  const reload = useCallback(async () => {
    const db = dbRef.current;
    if (!db || busyRef.current) return;
    try {
      const record = await readWorkbenchRecord(db);
      if (record) { current.current = record.data; setData(record.data); }
    } catch { setStorageError(true); }
  }, []);
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const db = await openWorkbenchDb();
        if (disposed) { db.close(); return; }
        dbRef.current = db;
        legacyRawRef.current = localStorage.getItem(WORKBENCH_KEY);
        const migration = await migrateLegacyWorkbench(db);
        if (disposed) return;
        if (migration.status === 'corrupt') setMigrationCorruptRaw(migration.raw);
        const record = await readWorkbenchRecord(db);
        if (disposed) return;
        if (record) { current.current = record.data; setData(record.data); }
        setReady(true);
      } catch {
        // IndexedDB unavailable: keep data in memory only and say so.
        // Never fall back to localStorage writes: they are not concurrency-safe.
        if (!disposed) { setStorageError(true); setReady(true); }
      }
    })();
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    const unsubscribe = subscribeWorkbenchChanged(() => { void reload(); });
    const check = () => {
      if (detectLegacyWrite(legacyRawRef.current)) setLegacyWriteDetected(true);
      void reload();
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      unsubscribe?.();
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [reload]);
  const runOperation = useCallback(async (operation: WorkbenchOperation): Promise<WorkbenchData> => {
    const db = dbRef.current;
    if (!db) {
      // No database: apply in memory only, keep the error visible, never
      // report the change as saved.
      const next = applyWorkbenchOperation(current.current, operation);
      current.current = next; setData(next); setStorageError(true);
      return next;
    }
    setBusy(true); busyRef.current = true;
    try {
      const next = await runWorkbenchOperation(db, operation);
      current.current = next; setData(next); setStorageError(false);
      notifyWorkbenchChanged();
      return next;
    } catch (error) {
      setStorageError(true);
      throw error;
    } finally {
      setBusy(false); busyRef.current = false;
    }
  }, []);
  const log = useCallback((kind: Activity['kind'], text: string, object = '') =>
    runOperation({ type: 'log', kind, text, object }).then(() => undefined), [runOperation]);
  const addDataset = useCallback(async (dataset: Dataset) => {
    // Throws WorkbenchCapacityError when the store is full (checked inside
    // the transaction) so the caller keeps the import draft; throws on
    // storage failure so the caller never reports a success that did not commit.
    await runOperation({ type: 'import', dataset });
  }, [runOperation]);
  const deleteDataset = useCallback((id: string) =>
    runOperation({ type: 'delete', id }).then(() => undefined), [runOperation]);
  const clearActivities = useCallback(() =>
    runOperation({ type: 'clearActivities' }).then(() => undefined), [runOperation]);
  const retryMigration = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    try {
      const result = await migrateLegacyWorkbench(db);
      if (result.status === 'already-migrated') setMigrationCorruptRaw(null);
      else if (result.status === 'migrated' || result.status === 'migrated-empty') {
        setMigrationCorruptRaw(null);
        const record = await readWorkbenchRecord(db);
        if (record) { current.current = record.data; setData(record.data); }
      }
    } catch { setStorageError(true); }
  }, []);
  const exportLegacyRecovery = useCallback(() => {
    const raw = migrationCorruptRaw ?? localStorage.getItem(WORKBENCH_KEY);
    if (raw !== null) downloadFile(raw, 'sijia-workbench-legacy-recovery.json', 'application/json');
  }, [migrationCorruptRaw]);
  const brand = catalog?.brands.find(b => b.id === brandId), model = brand?.models.find(m => m.id === modelId);
  return { catalog, catalogStatus, refresh: () => { clearCachedKnowledgeCatalog(''); setRevision(n => n + 1); }, brandId, modelId, brand, model, chooseBrand: (id: string) => { setBrandId(id); setModelId(''); }, chooseModel: setModelId, data, ready, busy, storageError, migrationCorruptRaw, legacyWriteDetected, retryMigration, exportLegacyRecovery, log, addDataset, deleteDataset, clearActivities };
}
const Context = createContext<ReturnType<typeof useWorkbenchState> | null>(null);
export function WorkbenchProvider({ children }: { children: ReactNode }) { const value = useWorkbenchState(); return <Context.Provider value={value}>{children}</Context.Provider>; }
export function useWorkbench() { const value = useContext(Context); if (!value) throw new Error('Workbench provider missing'); return value; }
