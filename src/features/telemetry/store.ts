import { ApiError, requestJson } from '../../lib/api-client';
import { TELEMETRY_WATERMARK, telemetryConnectionState, type TelemetryCatalog, type TelemetryFrame, type TelemetryPoint,
  type TelemetryScenarioCommand, type TelemetryScenarioId, type TelemetryScenarioState } from '../../../shared/telemetry';
import { mergeTelemetryPoints, parseTelemetryCatalog, parseTelemetryEvent, parseTelemetryFrame, parseTelemetryHistory, parseTelemetryScenarioState } from './protocol';

export interface TelemetryScenarioControl {
  phase: 'idle' | 'pending' | 'error' | 'conflict';
  error: 'unavailable' | 'invalid_data' | 'rate_limited' | null;
  conflict: TelemetryScenarioState | null;
}
const IDLE_CONTROL: TelemetryScenarioControl = { phase: 'idle', error: null, conflict: null };

export interface TelemetrySnapshot {
  catalog: TelemetryCatalog | null;
  phase: 'loading' | 'ready' | 'empty' | 'error';
  error: 'unavailable' | 'invalid_data' | null;
  connected: boolean;
  runId: string | null;
  sequence: number;
  epoch: number;
  receivedAt: number | null;
  now: number;
  latest: Record<string, TelemetryPoint>;
  points: Record<string, readonly TelemetryPoint[]>;
  historyStatus: Record<string, 'loading' | 'ready' | 'error'>;
  alerts: TelemetryFrame['alerts'];
  scenario: TelemetryFrame['scenario'] | null;
  scenarioControl: TelemetryScenarioControl;
}
type Stream = Pick<EventSource, 'addEventListener' | 'close' | 'onopen' | 'onerror'>;
export const EMPTY_TELEMETRY: TelemetrySnapshot = { catalog: null, phase: 'loading', error: null, connected: false,
  runId: null, sequence: 0, epoch: 0, receivedAt: null, now: 0, latest: {}, points: {}, historyStatus: {}, alerts: [], scenario: null, scenarioControl: IDLE_CONTROL };

/** Tab-local, ref-counted transport. It never generates a sample or reads a diagnosis/knowledge API. */
export class TelemetryStore {
  private snapshot: TelemetrySnapshot = EMPTY_TELEMETRY;
  private listeners = new Set<() => void>();
  private source?: Stream;
  private generation = 0;
  private freshness?: ReturnType<typeof setInterval>;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private pending = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private command?: { controller: AbortController; promise: Promise<void>; timeout: ReturnType<typeof setTimeout> };
  constructor(private readonly options: {
    open?: () => Stream;
    history?: (path: string, signal: AbortSignal) => Promise<unknown>;
    command?: (command: TelemetryScenarioCommand, signal: AbortSignal) => Promise<unknown>;
    now?: () => number;
    supported?: boolean;
  } = {}) {}
  private now = () => (this.options.now ?? Date.now)();
  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => EMPTY_TELEMETRY;
  private update(patch: Partial<TelemetrySnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch, now: this.now() };
    this.listeners.forEach(listener => listener());
  }
  subscribe = (listener: () => void) => {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = undefined;
    this.listeners.add(listener);
    if (!this.source && this.snapshot.error !== 'invalid_data') this.start();
    return () => {
      this.listeners.delete(listener);
      // React Strict Mode can resubscribe within this tick; reuse its existing connection.
      if (this.listeners.size === 0) this.closeTimer = setTimeout(() => { this.closeTimer = undefined; if (!this.listeners.size) this.stop(); }, 0);
    };
  };
  private abortHistory() {
    this.pending.forEach(item => item.controller.abort()); this.pending.clear();
  }
  private clearData() {
    this.abortHistory();
    // An applied command broadcasts its new run before the HTTP reply; keep that command alive.
    this.update({ points: {}, latest: {}, historyStatus: {}, alerts: [], scenario: null, runId: null, sequence: 0, receivedAt: null, phase: 'loading', error: null, epoch: this.snapshot.epoch + 1 });
  }
  private fail(code: 'unavailable' | 'invalid_data', close = false) {
    if (close) this.stop();
    this.update({ phase: 'error', error: code, connected: false });
  }
  private start() {
    if (this.options.supported === false) { this.fail('unavailable'); return; }
    const generation = ++this.generation;
    this.abortHistory();
    // A newly constructed EventSource has no previous native cursor. Refill any unobserved gap.
    this.update({ phase: 'loading', error: null, connected: false, historyStatus: {}, epoch: this.snapshot.epoch + 1 });
    let source: Stream;
    try { source = (this.options.open ?? (() => new EventSource('/api/telemetry/stream')))(); }
    catch { this.fail('unavailable'); return; }
    this.source = source;
    const current = () => this.generation === generation && this.source === source;
    source.onopen = () => { if (current()) this.update({ connected: true, error: null, phase: Object.keys(this.snapshot.latest).length ? 'ready' : 'loading' }); };
    source.onerror = () => { if (current()) this.fail('unavailable'); }; // Native EventSource retains Last-Event-ID and retries.
    const event = (name: string, consume: (data: unknown) => void) => source.addEventListener(name, ((message: MessageEvent<string>) => {
      if (!current()) return;
      try { consume(parseTelemetryEvent(message.data)); } catch { this.fail('invalid_data', true); }
    }) as EventListener);
    event('catalog', data => {
      const catalog = parseTelemetryCatalog(data);
      if (this.snapshot.catalog && JSON.stringify(catalog) !== JSON.stringify(this.snapshot.catalog)) this.clearData();
      this.update({ catalog });
    });
    event('telemetry', data => {
      if (!this.snapshot.catalog) throw new Error('Missing telemetry catalogue');
      const frame = parseTelemetryFrame(data, this.snapshot.catalog);
      if (this.snapshot.runId && frame.runId !== this.snapshot.runId) this.clearData();
      if (frame.sequence <= this.snapshot.sequence) return;
      const points = { ...this.snapshot.points }, latest = { ...this.snapshot.latest };
      for (const point of frame.points) {
        points[point.channelId] = mergeTelemetryPoints(points[point.channelId] ?? [], [point]);
        if (!latest[point.channelId] || point.at >= latest[point.channelId].at) latest[point.channelId] = point;
      }
      this.update({ points, latest, runId: frame.runId, sequence: frame.sequence, alerts: frame.alerts, scenario: frame.scenario,
        receivedAt: this.now(), phase: 'ready', error: null, connected: true });
    });
    event('reset', data => {
      if (!data || typeof data !== 'object') throw new Error('Invalid telemetry reset');
      const reset = data as Record<string, unknown>;
      if (reset.source !== 'simulated' || reset.watermark !== TELEMETRY_WATERMARK || reset.schemaVersion !== 1
        || typeof reset.runId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(reset.runId)
        || !['server_restart', 'history_expired', 'cursor_ahead'].includes(String(reset.reason))) throw new Error('Invalid telemetry reset');
      this.clearData(); this.update({ runId: reset.runId, phase: 'loading', error: null });
    });
    event('heartbeat', data => {
      const heartbeat = data as Record<string, unknown> | null;
      if (!heartbeat || heartbeat.source !== 'simulated' || heartbeat.watermark !== TELEMETRY_WATERMARK || heartbeat.schemaVersion !== 1
        || !Number.isSafeInteger(heartbeat.at) || Number(heartbeat.at) < 0) throw new Error('Invalid telemetry heartbeat');
      // Deliberately do not touch receivedAt: connection liveness is not sample freshness.
    });
    this.freshness = setInterval(() => this.refresh(), 1000);
  }
  refresh = () => this.update({});
  connectionState = () => this.snapshot.catalog ? telemetryConnectionState('simulated', this.snapshot.connected, this.snapshot.receivedAt,
    this.snapshot.now, this.snapshot.catalog.staleAfterMs) : this.snapshot.connected ? 'delayed' : 'offline';
  private stop() {
    this.generation++;
    this.source?.close(); this.source = undefined;
    if (this.freshness) clearInterval(this.freshness); this.freshness = undefined;
    this.abortHistory(); this.update({ connected: false });
    if (this.command) {
      const command = this.command; this.command = undefined; clearTimeout(command.timeout); command.controller.abort();
      this.update({ scenarioControl: IDLE_CONTROL });
    }
  }
  retry = () => {
    this.stop(); this.clearData(); this.update({ catalog: null, phase: 'loading', error: null, scenarioControl: IDLE_CONTROL });
    if (this.listeners.size) this.start();
  };
  loadHistory = (channelId: string): Promise<void> => {
    const catalog = this.snapshot.catalog;
    if (!catalog || !catalog.channels.some(channel => channel.id === channelId) || this.options.supported === false) return Promise.resolve();
    if (this.pending.has(channelId)) return this.pending.get(channelId)!.promise;
    if (this.snapshot.historyStatus[channelId] === 'ready') return Promise.resolve();
    const controller = new AbortController(), epoch = this.snapshot.epoch;
    const timeout = setTimeout(() => controller.abort(), 12000);
    const promise = Promise.resolve().then(async () => {
      try {
        const raw = await (this.options.history ?? ((path, signal) => requestJson(path, { signal, cache: 'no-store' })))(
          `/api/telemetry/history?${new URLSearchParams({ channel: channelId, window: '1h' })}`, controller.signal);
        controller.signal.throwIfAborted();
        const history = parseTelemetryHistory(raw, catalog, channelId, '1h');
        if (epoch !== this.snapshot.epoch) return;
        if (this.snapshot.runId && history.runId !== this.snapshot.runId) throw new Error('Stale telemetry run');
        const merged = mergeTelemetryPoints(history.points, this.snapshot.points[channelId] ?? []), last = merged.at(-1);
        const latest = { ...this.snapshot.latest }; if (last) latest[channelId] = last;
        this.update({ runId: history.runId, points: { ...this.snapshot.points, [channelId]: merged }, latest,
          historyStatus: { ...this.snapshot.historyStatus, [channelId]: 'ready' },
          phase: this.snapshot.phase === 'loading' ? (Object.keys(latest).length ? 'ready' : 'empty') : this.snapshot.phase });
      } catch {
        if (epoch === this.snapshot.epoch && !controller.signal.aborted) this.update({ historyStatus: { ...this.snapshot.historyStatus, [channelId]: 'error' } });
        else if (epoch === this.snapshot.epoch && this.pending.has(channelId)) this.update({ historyStatus: { ...this.snapshot.historyStatus, [channelId]: 'error' } });
      } finally {
        clearTimeout(timeout);
        if (this.pending.get(channelId)?.controller === controller) this.pending.delete(channelId);
      }
    });
    this.pending.set(channelId, { controller, promise });
    this.update({ historyStatus: { ...this.snapshot.historyStatus, [channelId]: 'loading' } }); return promise;
  };
  retryHistory = (channelId: string) => {
    const status = { ...this.snapshot.historyStatus }; delete status[channelId]; this.update({ historyStatus: status });
    return this.loadHistory(channelId);
  };
  /** One manual write at a time, no automatic retries, and never write a control reply into measurements. */
  changeScenario = (id: TelemetryScenarioId, loop: boolean): Promise<void> => {
    if (this.command) return this.command.promise;
    const { catalog, scenario, runId } = this.snapshot;
    if (!catalog || !runId || scenario?.revision === undefined || scenario.startedAt === undefined
      || this.connectionState() !== 'simulated' || !catalog.scenarios.some(item => item.id === id) || typeof loop !== 'boolean') {
      this.update({ scenarioControl: { phase: 'error', error: 'unavailable', conflict: null } }); return Promise.resolve();
    }
    const payload: TelemetryScenarioCommand = { expectedRunId: runId, revision: scenario.revision, id, loop };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const current = () => this.command?.controller === controller;
    const promise = Promise.resolve().then(async () => {
      let received = false;
      try {
        const raw = await (this.options.command ?? ((command, signal) => requestJson('/api/telemetry/scenario', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal, cache: 'no-store',
        })))(payload, controller.signal);
        received = true;
        controller.signal.throwIfAborted();
        const reply = parseTelemetryScenarioState(raw, catalog);
        if (reply.id !== id || reply.loop !== loop || reply.revision !== payload.revision + 1 || reply.runId === payload.expectedRunId) throw new Error('Invalid scenario command reply');
        if (current()) this.update({ scenarioControl: IDLE_CONTROL });
      } catch (error) {
        if (!current()) return;
        if (error instanceof ApiError && error.status === 409) {
          try {
            const state = parseTelemetryScenarioState((error.payload as { state?: unknown })?.state, catalog);
            this.update({ scenarioControl: { phase: 'conflict', error: null, conflict: state } });
          } catch { this.update({ scenarioControl: { phase: 'error', error: 'invalid_data', conflict: null } }); }
        } else this.update({ scenarioControl: { phase: 'error', error: error instanceof ApiError && error.status === 429 ? 'rate_limited'
          : error instanceof ApiError || controller.signal.aborted || !received ? 'unavailable' : 'invalid_data', conflict: null } });
      } finally {
        clearTimeout(timeout); if (current()) this.command = undefined;
      }
    });
    this.command = { controller, promise, timeout };
    this.update({ scenarioControl: { phase: 'pending', error: null, conflict: null } }); return promise;
  };
  dispose() {
    if (this.closeTimer) clearTimeout(this.closeTimer); this.closeTimer = undefined;
    this.listeners.clear(); this.stop();
  }
}

let browserStore: TelemetryStore | undefined;
export function getTelemetryStore(): TelemetryStore {
  return browserStore ??= new TelemetryStore({ supported: !(typeof __AGRIDX_DEV_PREVIEW__ !== 'undefined' && __AGRIDX_DEV_PREVIEW__) });
}
