import { appendEvent, validateCase, type TwinCase, type TwinEvent } from '../../../shared/cognitive-twin';
const DB = 'sijia-cognitive-twin-v1';
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('cases', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(Error('本机存储不可用，未保存任何新记录'));
    r.onblocked = () => reject(Error('请关闭旧窗口后重试'));
  });
}
async function transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, finish: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cases', mode); let value: T; let reason: Error | undefined;
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onerror = tx.onabort = () => { db.close(); reject(reason ?? Error('存储失败，记录未保存')); };
    try { work(tx.objectStore('cases'), result => { value = result; }, error => { reason = error; tx.abort(); }); }
    catch (error) { reason = error as Error; tx.abort(); }
  });
}
export async function listTwinCases(): Promise<TwinCase[]> {
  return transaction('readonly', (s, done, fail) => {
    const r = s.getAll(); r.onsuccess = () => { try { r.result.forEach(validateCase); done(r.result.sort((a: TwinCase,b: TwinCase) => b.createdAt.localeCompare(a.createdAt))); } catch (e) { fail(e as Error); } };
  });
}
export async function createTwinCase(value: TwinCase): Promise<TwinCase> {
  validateCase(value);
  if (value.revision !== 0) throw Error('新案例不可携带历史记录');
  return transaction('readwrite', (s, done, fail) => {
    const count = s.count(); count.onsuccess = () => {
      if (count.result >= 100) return fail(Error('最多保存 100 个案例，请先导出并删除旧案例'));
      s.add(value); done(value);
    };
  });
}
export async function saveTwinEvent(id: string, event: TwinEvent, revision: number): Promise<TwinCase> {
  return transaction('readwrite', (s, done, fail) => {
    const r = s.get(id); r.onsuccess = () => {
      try { if (!r.result) throw Error('案例已删除，请重新载入'); const next = appendEvent(r.result, event, revision); s.put(next); done(next); } catch (e) { fail(e as Error); }
    };
  });
}
export async function deleteTwinCase(id: string, revision: number): Promise<void> {
  return transaction('readwrite', (s, done, fail) => {
    const r = s.get(id); r.onsuccess = () => {
      if (r.result && r.result.revision !== revision) return fail(Error('案例已更新，请重新载入后再删除'));
      s.delete(id); done();
    };
  });
}
