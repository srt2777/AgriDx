import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { KnowledgeCatalog } from '../../../shared/knowledge-catalog';
import { requestKnowledgeCatalog, clearCachedKnowledgeCatalog } from '../knowledge/catalog-api';
import { parseWorkbench, WORKBENCH_KEY, type Activity, type Dataset, type WorkbenchData } from './data';
function useWorkbenchState() {
  const [catalog, setCatalog] = useState<KnowledgeCatalog | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [revision, setRevision] = useState(0);
  const [brandId, setBrandId] = useState(''), [modelId, setModelId] = useState('');
  const [data, setData] = useState<WorkbenchData>(() => { try { return parseWorkbench(JSON.parse(localStorage.getItem(WORKBENCH_KEY) || 'null')); } catch { return { datasets: [], activities: [] }; } });
  const current = useRef(data); const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let disposed = false;
    const timer = setTimeout(() => controller.abort(), 20000); setCatalogStatus('loading');
    requestKnowledgeCatalog('', controller.signal).then(result => { if (!disposed) { setCatalog(result); setCatalogStatus('ready'); } })
      .catch(() => { if (!disposed) setCatalogStatus('error'); }).finally(() => clearTimeout(timer));
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [revision]);
  const commit = useCallback((update: (previous: WorkbenchData) => WorkbenchData) => {
    const next = update(current.current); current.current = next; setData(next);
    try { localStorage.setItem(WORKBENCH_KEY, JSON.stringify(next)); setStorageError(false); } catch { setStorageError(true); }
  }, []);
  const log = useCallback((kind: Activity['kind'], text: string, object = '') => {
    const activity: Activity = { id: crypto.randomUUID(), at: Date.now(), kind, text: text.slice(0, 1000), object: object.slice(0, 150) };
    commit(previous => ({ ...previous, activities: [activity, ...previous.activities].slice(0, 100) }));
  }, [commit]);
  const addDataset = (dataset: Dataset) => commit(previous => ({ datasets: [dataset, ...previous.datasets].slice(0, 5), activities: [{ id: crypto.randomUUID(), at: Date.now(), kind: 'import' as const, text: dataset.name, object: dataset.object }, ...previous.activities].slice(0, 100) }));
  const deleteDataset = (id: string) => commit(previous => ({ ...previous, datasets: previous.datasets.filter(d => d.id !== id) }));
  const brand = catalog?.brands.find(b => b.id === brandId), model = brand?.models.find(m => m.id === modelId);
  return { catalog, catalogStatus, refresh: () => { clearCachedKnowledgeCatalog(''); setRevision(n => n + 1); }, brandId, modelId, brand, model, chooseBrand: (id: string) => { setBrandId(id); setModelId(''); }, chooseModel: setModelId, data, storageError, log, addDataset, deleteDataset, clearActivities: () => commit(previous => ({ ...previous, activities: [] })) };
}
const Context = createContext<ReturnType<typeof useWorkbenchState> | null>(null);
export function WorkbenchProvider({ children }: { children: ReactNode }) { const value = useWorkbenchState(); return <Context.Provider value={value}>{children}</Context.Provider>; }
export function useWorkbench() { const value = useContext(Context); if (!value) throw new Error('Workbench provider missing'); return value; }
