import { requestJson, ApiError, isRecord } from '@/lib/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeviceProfile, MemoryDevice, MemoryOverview, MemorySession, SessionDetail } from '../../../shared/memory';

const ACTIVE_SESSION = '__agridx_memory_session';
export async function memoryRequest<T>(url: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  try {
    return await requestJson(`/api/memory${url}`, { method, credentials: 'same-origin', signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) }) as T;
  } catch (error) {
    if (error instanceof ApiError && isRecord(error.payload) && typeof error.payload.error === 'string') throw new Error(error.payload.error);
    throw error;
  }
}
const persistSession = (id?: string) => {
  try { if (id) localStorage.setItem(ACTIVE_SESSION, id); else localStorage.removeItem(ACTIVE_SESSION); } catch { /* private mode */ }
};
export function useDiagnosticMemory(onRestore: (detail: SessionDetail | null) => void, onDevice: (device: MemoryDevice | null) => void, resumeOnBoot: boolean) {
  const [overview, setOverview] = useState<MemoryOverview>({ devices: [], sessions: [] });
  const [session, setSession] = useState<MemorySession | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [boot, setBoot] = useState(0);
  const callbacks = useRef({ onRestore, onDevice });
  useEffect(() => { callbacks.current = { onRestore, onDevice }; }, [onRestore, onDevice]);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    let active = true;
    const initialize = async () => {
      try {
        const data = await memoryRequest<MemoryOverview>('', 'GET', undefined, controller.signal);
        if (!active) return;
        setOverview(data);
        let id: string | null = null;
        try { id = localStorage.getItem(ACTIVE_SESSION); } catch { /* private mode */ }
        if (resumeOnBoot && id) {
          if (data.sessions.some((s) => s.id === id)) {
            const detail = await memoryRequest<SessionDetail>(`/sessions/${id}`, 'GET', undefined, controller.signal);
            if (!active) return;
            setSession(detail); setDeviceId(detail.deviceId);
            callbacks.current.onDevice(detail.device); callbacks.current.onRestore(detail);
          } else {
            persistSession(); callbacks.current.onRestore(null);
          }
        } else if (!resumeOnBoot) { persistSession(); callbacks.current.onRestore(null); }
        setReady(true); setError('');
      } catch {
        if (active) { setReady(false); setError('诊断记忆暂不可用，请重试 / Memory unavailable. Please retry.'); }
      } finally { window.clearTimeout(timeout); }
    };
    void initialize();
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [boot, resumeOnBoot]);
  const refresh = useCallback(async () => setOverview(await memoryRequest<MemoryOverview>('')), []);
  const activate = useCallback((detail: SessionDetail) => {
    setSession(detail); setDeviceId(detail.deviceId); persistSession(detail.id);
    callbacks.current.onDevice(detail.device); callbacks.current.onRestore(detail);
  }, []);
  const saveProfile = useCallback(async (profile: DeviceProfile) => {
    const previous = overview.devices.find((d) => d.id === deviceId);
    const device = await memoryRequest<MemoryDevice>(deviceId ? `/devices/${deviceId}` : '/devices', deviceId ? 'PATCH' : 'POST', profile);
    setDeviceId(device.id);
    if (previous && ['machineType', 'brand', 'model'].some((key) => previous[key as keyof DeviceProfile] !== profile[key as keyof DeviceProfile])) {
      setSession(null); persistSession(); callbacks.current.onRestore(null);
    }
    callbacks.current.onDevice(device);
    setOverview((prev) => ({ ...prev, devices: [device, ...prev.devices.filter((d) => d.id !== device.id)] }));
    return device;
  }, [deviceId, overview.devices]);
  const prepare = useCallback(async (profile: DeviceProfile) => {
    if (!ready) throw new Error('请等待记忆服务就绪，或点击重试 / Please retry memory service');
    const device = overview.devices.find((d) => d.id === deviceId);
    if (session) {
      if (!device || Object.keys(profile).some((k) => profile[k as keyof DeviceProfile] !== device[k as keyof DeviceProfile])) {
        throw new Error('设备档案有修改，请先保存档案 / Save the edited device profile first');
      }
      return session;
    }
    const selected = await saveProfile(profile);
    const created = await memoryRequest<MemorySession>('/sessions', 'POST', { deviceId: selected.id });
    setSession(created); persistSession(created.id);
    setOverview((prev) => ({ ...prev, sessions: [created, ...prev.sessions] }));
    return created;
  }, [ready, overview.devices, deviceId, session, saveProfile]);
  const updateSession = useCallback((updated: MemorySession) => {
    setSession(updated); persistSession(updated.id);
    setOverview((prev) => ({ ...prev, sessions: [updated, ...prev.sessions.filter((s) => s.id !== updated.id)] }));
  }, []);
  const action = useCallback(async (callback: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await callback(); } catch (err) { setError(err instanceof Error ? err.message : 'Memory unavailable'); }
    finally { setBusy(false); }
  }, []);
  const selectDevice = useCallback((id: string) => {
    setDeviceId(id); setSession(null); persistSession(); callbacks.current.onRestore(null);
    callbacks.current.onDevice(overview.devices.find((d) => d.id === id) || null);
  }, [overview.devices]);
  return { ...overview, session, deviceId, ready, busy, error, refresh, saveProfile, prepare, updateSession, action, selectDevice,
    retry: () => setBoot((v) => v + 1),
    restore: (id: string) => action(async () => activate(await memoryRequest<SessionDetail>(`/sessions/${id}`))),
    newDiagnosis: () => { setSession(null); persistSession(); callbacks.current.onRestore(null); },
    saveProgress: (progress: string) => action(async () => {
      if (!session) throw new Error('请先开始本次诊断 / Start a diagnosis first');
      updateSession(await memoryRequest<MemorySession>(`/sessions/${session.id}`, 'PATCH', { progress, revision: session.revision }));
    }),
    clear: async () => {
      if (session) activate(await memoryRequest<SessionDetail>(`/sessions/${session.id}/clear`, 'POST', { revision: session.revision }));
      else callbacks.current.onRestore(null);
    },
    deleteDiagnosis: () => action(async () => {
      if (!session) return;
      await memoryRequest(`/sessions/${session.id}`, 'DELETE');
      setSession(null); persistSession(); callbacks.current.onRestore(null); await refresh();
    }),
    deleteDevice: () => action(async () => {
      if (!deviceId) return;
      await memoryRequest(`/devices/${deviceId}`, 'DELETE');
      setDeviceId(''); setSession(null); persistSession(); callbacks.current.onRestore(null); callbacks.current.onDevice(null); await refresh();
    }),
  };
}
