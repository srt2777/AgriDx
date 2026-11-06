import { requestJson, ApiError, isRecord } from '@/lib/api-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DeviceProfile, MemoryDevice, MemoryOverview, MemorySession, SessionDetail } from '../../shared/memory';
import {
  clearPendingForDevice,
  clearPendingForSession,
  clearPendingTurn,
  createPendingTurn,
  loadPendingTurn,
  pendingAppliesToSession,
  resolvePendingAfterReload,
  savePendingTurn,
  syncStatusFor,
  type PendingUnsavedTurn,
  type SyncStatus,
} from '../features/chat/sync-state';

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
  // PR2 recovery state: the pending unsaved turn is kept separately from the
  // displayed messages, bound to its session and device, so a boot reload,
  // a restore or a late response can never silently overwrite it.
  const [pendingTurn, setPendingTurnState] = useState<PendingUnsavedTurn | null>(() => loadPendingTurn(localStorage));
  const [recovering, setRecovering] = useState(false);
  const [pendingStorageFailed, setPendingStorageFailed] = useState(false);
  const pendingRef = useRef(pendingTurn);
  const setPendingTurn = useCallback((turn: PendingUnsavedTurn | null) => {
    pendingRef.current = turn;
    setPendingTurnState(turn);
  }, []);
  const syncStatus: SyncStatus = useMemo(
    () => syncStatusFor({ sessionId: session?.id ?? null, pending: pendingTurn, recovering }),
    [session?.id, pendingTurn, recovering],
  );
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
            callbacks.current.onDevice(detail.device);
            // A pending unsaved turn for this session must not be overwritten
            // by the saved record on boot: keep the local messages (which
            // still hold the unsaved turn) and leave the explicit reload to
            // the user. The session/device are set, only onRestore is skipped.
            if (!pendingAppliesToSession(pendingRef.current, id)) callbacks.current.onRestore(detail);
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
  const updateSession = useCallback((updated: MemorySession, opts?: { clearsPendingForQuestion?: string }) => {
    setSession(updated); persistSession(updated.id);
    setOverview((prev) => ({ ...prev, sessions: [updated, ...prev.sessions.filter((s) => s.id !== updated.id)] }));
    // A successful save only clears the pending copy when it is the
    // resubmission of that exact question. Saving a different question must
    // not silently drop the unsaved answer copy.
    if (opts?.clearsPendingForQuestion && pendingRef.current?.sessionId === updated.id
      && pendingRef.current.question === opts.clearsPendingForQuestion) {
      clearPendingTurn(localStorage); setPendingTurn(null);
    }
  }, [setPendingTurn]);
  /** Record a turn whose answer arrived but was not saved. Sending stays blocked until recovery. */
  const markSaveFailed = useCallback((question: string, answer: string) => {
    if (!session) return false;
    const turn = createPendingTurn({ sessionId: session.id, deviceId, revision: session.revision, question, answer });
    setPendingStorageFailed(!savePendingTurn(localStorage, turn));
    setPendingTurn(turn);
    return true;
  }, [session, deviceId, setPendingTurn]);
  /** Record a turn whose save outcome is unknown (network cut / timeout). Only a reload can decide. */
  const markSaveUncertain = useCallback((question: string) => {
    if (!session) return false;
    const turn = createPendingTurn({ sessionId: session.id, deviceId, revision: session.revision, question, uncertain: true });
    setPendingStorageFailed(!savePendingTurn(localStorage, turn));
    setPendingTurn(turn);
    return true;
  }, [session, deviceId, setPendingTurn]);
  const discardPendingTurn = useCallback(() => {
    clearPendingTurn(localStorage); setPendingTurn(null); setPendingStorageFailed(false);
  }, [setPendingTurn]);
  /**
   * Reload the saved record for the active session and resolve the pending
   * turn against it. The pending copy is kept (marked recovered) so the
   * user can copy/export it, and the original question comes back as a
   * draft for an explicit resubmission — resubmitting creates a new answer
   * and never writes the old answer into the record. When the reloaded
   * record already contains the question, the turn was saved after all and
   * the copy is dropped instead of resubmitted.
   */
  const reloadSavedRecord = useCallback(async (): Promise<{ turn: PendingUnsavedTurn; saved: boolean; detail: SessionDetail } | null> => {
    const pending = pendingRef.current;
    if (!session || !pending || pending.sessionId !== session.id) return null;
    setRecovering(true);
    try {
      const detail = await memoryRequest<SessionDetail>(`/sessions/${session.id}`);
      if (resolvePendingAfterReload(pending, detail.messages) === 'saved') {
        clearPendingTurn(localStorage); setPendingTurn(null);
        activate(detail);
        return { turn: pending, saved: true, detail };
      }
      const recovered = { ...pending, recovered: true };
      setPendingStorageFailed(!savePendingTurn(localStorage, recovered));
      setPendingTurn(recovered);
      activate(detail);
      return { turn: recovered, saved: false, detail };
    } finally { setRecovering(false); }
  }, [session, activate, setPendingTurn]);
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
    syncStatus, pendingTurn, pendingStorageFailed, markSaveFailed, markSaveUncertain, reloadSavedRecord, discardPendingTurn,
    retry: () => setBoot((v) => v + 1),
    restore: (id: string) => action(async () => {
      // Restoring the very record with an unsaved turn would overwrite the
      // local messages holding that turn. Go through the explicit reload
      // instead; restoring any other record is unaffected.
      if (pendingAppliesToSession(pendingRef.current, id) && !pendingRef.current!.recovered) {
        throw new Error('本轮未保存到诊断记录，请先重新载入已保存记录。');
      }
      activate(await memoryRequest<SessionDetail>(`/sessions/${id}`));
    }),
    newDiagnosis: () => { setSession(null); persistSession(); callbacks.current.onRestore(null); },
    saveProgress: (progress: string) => action(async () => {
      if (!session) throw new Error('请先开始本次诊断 / Start a diagnosis first');
      // Saving progress would advance the saved revision past the pending
      // turn and make its resubmission conflict; recheck the record first.
      if (pendingAppliesToSession(pendingRef.current, session.id) && !pendingRef.current!.recovered) {
        throw new Error('本轮未保存到诊断记录，请先重新载入已保存记录后再保存检查进度。');
      }
      updateSession(await memoryRequest<MemorySession>(`/sessions/${session.id}`, 'PATCH', { progress, revision: session.revision }));
    }),
    clear: async () => {
      // Clearing deletes the saved record, so the pending copy for this
      // session must go with it and can never be revived afterwards.
      if (session && pendingRef.current?.sessionId === session.id) { clearPendingTurn(localStorage); setPendingTurn(null); }
      if (session) activate(await memoryRequest<SessionDetail>(`/sessions/${session.id}/clear`, 'POST', { revision: session.revision }));
      else callbacks.current.onRestore(null);
    },
    deleteDiagnosis: () => action(async () => {
      if (!session) return;
      const doomed = session.id;
      await memoryRequest(`/sessions/${session.id}`, 'DELETE');
      const kept = clearPendingForSession(pendingRef.current, doomed);
      if (kept) { setPendingTurn(kept); } else { clearPendingTurn(localStorage); setPendingTurn(null); }
      setSession(null); persistSession(); callbacks.current.onRestore(null); await refresh();
    }),
    deleteDevice: () => action(async () => {
      if (!deviceId) return;
      const doomed = deviceId;
      await memoryRequest(`/devices/${deviceId}`, 'DELETE');
      const kept = clearPendingForDevice(pendingRef.current, doomed);
      if (kept) { setPendingTurn(kept); } else { clearPendingTurn(localStorage); setPendingTurn(null); }
      setDeviceId(''); setSession(null); persistSession(); callbacks.current.onRestore(null); callbacks.current.onDevice(null); await refresh();
    }),
  };
}
