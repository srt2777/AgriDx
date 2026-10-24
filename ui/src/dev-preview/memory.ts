import type { DeviceProfile, MemoryDevice, MemoryMessage, MemoryOverview, MemorySession, SessionDetail, PriorDeviceReport } from '../../../shared/memory';
import { MemoryError, profileFrom, summarizeReports, validId } from '../../../shared/memory-validation';

const KEY = '__agridx_preview_memory_v1';
interface Snapshot { devices: MemoryDevice[]; sessions: (MemorySession & { messages: MemoryMessage[] })[] }

/** Static preview stores private data in this browser only; it never contacts production. */
export class PreviewMemoryStore {
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage) {}
  private read(): Snapshot {
    const saved = this.storage.getItem(KEY);
    if (!saved) return { devices: [], sessions: [] };
    const value = JSON.parse(saved) as Snapshot;
    if (!Array.isArray(value.devices) || !Array.isArray(value.sessions)) throw new Error('Preview memory unavailable');
    return value;
  }
  private write(value: Snapshot) { this.storage.setItem(KEY, JSON.stringify(value)); }
  private find<T extends { id: string }>(items: T[], id: string): T {
    if (!validId(id)) throw new MemoryError(400, 'bad_request', '记录编号格式错误');
    const result = items.find(item => item.id === id);
    if (!result) throw new MemoryError(404, 'memory_not_found', '设备或诊断记录不存在');
    return result;
  }
  private check(actual: number, expected: unknown) {
    if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0) throw new MemoryError(400, 'bad_request', '请提供有效的诊断记录版本');
    if (actual !== expected) throw new MemoryError(409, 'memory_conflict', '诊断记录已更新，请重新载入后继续');
  }
  overview(): MemoryOverview {
    const { devices, sessions } = this.read();
    return { devices, sessions: sessions.map(({ messages: _messages, ...session }) => session) };
  }
  saveDevice(profile: DeviceProfile, id?: string): MemoryDevice {
    const state = this.read();
    const previous = id ? this.find(state.devices, id) : undefined;
    if (!id && state.devices.length >= 100) throw new MemoryError(409, 'memory_limit', '设备档案已达上限');
    const device = { ...profile, id: id || crypto.randomUUID(), updatedAt: new Date().toISOString() };
    if (previous && ['machineType', 'brand', 'model'].some(field => previous[field as keyof DeviceProfile] !== profile[field as keyof DeviceProfile])) {
      state.sessions.filter(session => session.deviceId === device.id).forEach(session => { session.revision++; });
    }
    state.devices = [device, ...state.devices.filter(item => item.id !== device.id)];
    this.write(state); return device;
  }
  createSession(deviceId: string): MemorySession {
    const state = this.read(); this.find(state.devices, deviceId);
    if (state.sessions.length >= 100) throw new MemoryError(409, 'memory_limit', '诊断记录已达上限');
    const session = { id: crypto.randomUUID(), deviceId, title: '新诊断', progress: '', summary: '', revision: 0, updatedAt: new Date().toISOString() };
    state.sessions.unshift({ ...session, messages: [] }); this.write(state); return session;
  }
  session(id: string): SessionDetail {
    const state = this.read(); const session = this.find(state.sessions, id);
    return { ...session, device: this.find(state.devices, session.deviceId) };
  }
  priorReports(deviceId: string, excluded: string, query: string): PriorDeviceReport[] {
    const state = this.read(); this.find(state.devices, deviceId);
    const terms = new Set<string>();
    const stop = new Set(['检查', '正常', '请问', '如何', '什么', '下一', '一步', '继续', '故障', '问题', '已检', '查正', '结果']);
    for (const token of query.toLowerCase().match(/[a-z][a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) || []) {
      if (/^[a-z]/.test(token)) terms.add(token);
      else for (let i = 0; i < token.length - 1; i++) if (!stop.has(token.slice(i, i + 2))) terms.add(token.slice(i, i + 2));
    }
    return state.sessions.filter(s => s.deviceId === deviceId && s.id !== excluded && s.progress).slice(0, 20)
      .map(s => ({ report: { sessionId: s.id, updatedAt: s.updatedAt, question: s.messages.find(m => m.role === 'user')?.content.slice(0, 400) || '', progress: s.progress.slice(0, 800) },
        score: [...terms].filter(term => `${s.messages.find(m => m.role === 'user')?.content || ''} ${s.progress}`.toLowerCase().includes(term)).length }))
      .filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(item => item.report);
  }
  appendTurn(id: string, expected: number, user: string, assistant: Omit<MemoryMessage, 'id' | 'role' | 'createdAt'>,
    imported: { role: 'user' | 'assistant'; content: string }[]): MemorySession {
    const state = this.read(); const session = this.find(state.sessions, id); this.check(session.revision, expected);
    const now = new Date().toISOString();
    if (!session.messages.length) session.messages = imported.map(message => ({ ...message, id: crypto.randomUUID(), createdAt: now }));
    session.messages.push({ role: 'user', content: user, id: crypto.randomUUID(), createdAt: now },
      { ...assistant, content: assistant.content.slice(0, 16000), role: 'assistant', id: crypto.randomUUID(), createdAt: now });
    if (session.messages.length > 2000) throw new MemoryError(409, 'memory_limit', '本次诊断记录已达上限，请新建诊断');
    session.title = session.messages.find(message => message.role === 'user')!.content.slice(0, 60);
    session.summary = summarizeReports(session.messages); session.revision++; session.updatedAt = now;
    this.write(state); const { messages: _messages, ...result } = session; return result;
  }
  update(id: string, expected: unknown, progress: unknown, clear = false): MemorySession {
    const state = this.read(); const session = this.find(state.sessions, id); this.check(session.revision, expected);
    if (typeof progress !== 'string' || progress.length > 2000) throw new MemoryError(400, 'bad_request', '检查进度须为文本（上限2000字符）');
    session.progress = progress.trim();
    if (clear) { session.messages = []; session.title = '新诊断'; session.summary = ''; }
    session.revision++; session.updatedAt = new Date().toISOString(); this.write(state);
    const { messages: _messages, ...result } = session; return result;
  }
  deleteSession(id: string) {
    const state = this.read(); this.find(state.sessions, id); state.sessions = state.sessions.filter(item => item.id !== id); this.write(state);
  }
  deleteDevice(id: string) {
    const state = this.read(); this.find(state.devices, id); state.devices = state.devices.filter(item => item.id !== id);
    state.sessions = state.sessions.filter(item => item.deviceId !== id); this.write(state);
  }
}

export function previewMemoryRoute(store: PreviewMemoryStore, path: string, method: string, body: Record<string, unknown>) {
  if (path === '/api/memory' && method === 'GET') return store.overview();
  if (path === '/api/memory/devices' && method === 'POST') return store.saveDevice(profileFrom(body));
  if (path === '/api/memory/sessions' && method === 'POST') return store.createSession(String(body.deviceId));
  const match = /^\/api\/memory\/(devices|sessions)\/([^/]+)(\/clear)?$/.exec(path);
  if (!match) throw new MemoryError(404, 'not_found', '接口不存在');
  const [, type, id, clear] = match;
  if (type === 'devices' && method === 'PATCH') return store.saveDevice(profileFrom(body), id);
  if (method === 'DELETE') { if (type === 'devices') store.deleteDevice(id); else store.deleteSession(id); return { ok: true }; }
  if (type === 'sessions' && method === 'GET' && !clear) return store.session(id);
  if (type === 'sessions' && method === 'PATCH' && !clear) return store.update(id, body.revision, body.progress);
  if (type === 'sessions' && method === 'POST' && clear) { store.update(id, body.revision, '', true); return store.session(id); }
  throw new MemoryError(404, 'not_found', '接口不存在');
}
