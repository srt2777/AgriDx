import { randomUUID } from 'node:crypto';
import { TELEMETRY_WATERMARK, TELEMETRY_WINDOWS, type TelemetryFrame, type TelemetryHistory, type TelemetryResetReason, type TelemetryWindow,
  type TelemetryScenarioCommand, type TelemetryScenarioId, type TelemetryScenarioState } from '../../shared/telemetry';
import { loadTelemetryDemoConfig, simulateTelemetry, telemetryCatalog, type TelemetryDemoConfig } from './simulator';

export interface TelemetryCursor { runId: string; sequence: number }
export function parseTelemetryCursor(value: string | undefined): TelemetryCursor | null {
  if (value === undefined) return null;
  const match = /^([a-zA-Z0-9-]{1,64}):([1-9][0-9]{0,14})$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[2]))) throw new RangeError('Invalid telemetry cursor');
  return { runId: match[1], sequence: Number(match[2]) };
}

/** Bounded by frame count; no growing splice/shift array or persistence. */
export class TelemetryRing {
  private readonly frames: (TelemetryFrame | undefined)[];
  private start = 0;
  private count = 0;
  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 2 || capacity > 3600) throw new RangeError('Invalid telemetry capacity');
    this.frames = new Array(capacity);
  }
  get size() { return this.count; }
  get oldestSequence() { return this.frames[this.start]?.sequence; }
  get newestSequence() { return this.frames[(this.start + this.count - 1) % this.capacity]?.sequence; }
  push(frame: TelemetryFrame) {
    const latest = this.frames[(this.start + this.count - 1) % this.capacity];
    if (latest && (frame.runId !== latest.runId || frame.sequence <= latest.sequence)) throw new RangeError('Non-monotonic telemetry frame');
    const slot = (this.start + this.count) % this.capacity;
    this.frames[slot] = structuredClone(frame);
    if (this.count === this.capacity) this.start = (this.start + 1) % this.capacity;
    else this.count++;
  }
  since(sequence: number): TelemetryFrame[] {
    const frames: TelemetryFrame[] = [];
    for (let index = 0; index < this.count; index++) {
      const frame = this.frames[(this.start + index) % this.capacity]!;
      if (frame.sequence > sequence) frames.push(structuredClone(frame));
    }
    return frames;
  }
  latest(): TelemetryFrame | undefined {
    const frame = this.frames[(this.start + this.count - 1) % this.capacity];
    return frame && structuredClone(frame);
  }
  history(channelId: string, from: number, to: number) {
    const points = [];
    for (let index = 0; index < this.count; index++) {
      const frame = this.frames[(this.start + index) % this.capacity]!;
      if (frame.at < from || frame.at > to) continue;
      const point = frame.points.find(item => item.channelId === channelId);
      if (point) points.push({ ...point });
    }
    return points;
  }
}

export class TelemetryScenarioConflict extends Error {
  constructor() { super('Telemetry scenario changed'); }
}

/** App-owned producer, shared by history and every SSE client; starts lazily on first read. */
export class TelemetryRuntime {
  private currentRunId: string;
  private epoch: number;
  private buffer: TelemetryRing;
  private readonly metadata;
  private scenarioId: TelemetryScenarioId = 'normal';
  private scenarioLoop = false;
  private revision = 0;
  private timer?: ReturnType<typeof setInterval>;
  private lastStep = -1;
  private closed = false;
  private listeners = new Set<(frame: TelemetryFrame) => void>();
  constructor(private readonly config: TelemetryDemoConfig, private readonly options: {
    now?: () => number; seed?: number; runId?: string; automatic?: boolean; newRunId?: () => string;
  } = {}) {
    this.epoch = this.now();
    if (!Number.isSafeInteger(this.epoch) || this.epoch < 0) throw new RangeError('Invalid telemetry clock');
    this.currentRunId = options.runId ?? randomUUID();
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(this.runId)) throw new RangeError('Invalid telemetry run ID');
    this.metadata = telemetryCatalog(config, options.seed ?? config.seed);
    this.buffer = new TelemetryRing(config.capacity);
  }
  get runId() { return this.currentRunId; }
  private now() { return (this.options.now ?? Date.now)(); }
  private ensure() {
    if (this.closed) throw new Error('Telemetry runtime closed');
    this.tick();
    if (!this.timer && this.options.automatic !== false) {
      this.timer = setInterval(() => this.tick(), this.config.sampleMs);
      this.timer.unref();
    }
  }
  catalog() { return structuredClone(this.metadata); }
  channel(id: string) { return this.catalog().channels.find(channel => channel.id === id); }
  scenario(): TelemetryScenarioState {
    if (this.closed) throw new Error('Telemetry runtime closed');
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid telemetry clock');
    const elapsed = Math.max(0, now - this.epoch), duration = this.metadata.scenarios.find(item => item.id === this.scenarioId)!.durationMs;
    return { schemaVersion: 1, source: 'simulated', watermark: TELEMETRY_WATERMARK, scope: 'shared-service', runId: this.runId,
      revision: this.revision, id: this.scenarioId, loop: this.scenarioLoop, startedAt: this.epoch,
      elapsedMs: this.scenarioLoop ? elapsed % duration : Math.min(elapsed, duration) };
  }
  /** Restart one shared simulated run. Commands never supply samples, thresholds or device data. */
  changeScenario(command: TelemetryScenarioCommand): TelemetryScenarioState {
    if (this.closed) throw new Error('Telemetry runtime closed');
    if (!command || typeof command !== 'object' || Object.keys(command).length !== 4
      || Object.keys(command).some(key => !['expectedRunId', 'revision', 'id', 'loop'].includes(key))
      || typeof command.expectedRunId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(command.expectedRunId)
      || !Number.isSafeInteger(command.revision) || command.revision < 0 || typeof command.loop !== 'boolean'
      || !this.metadata.scenarios.some(item => item.id === command.id)) throw new RangeError('Invalid telemetry scenario command');
    if (command.expectedRunId !== this.runId || command.revision !== this.revision) throw new TelemetryScenarioConflict();
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < this.epoch || now < (this.buffer.latest()?.at ?? this.epoch)) throw new Error('Invalid telemetry clock');
    if (this.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Telemetry revision exhausted');
    const runId = (this.options.newRunId ?? randomUUID)();
    if (typeof runId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(runId) || runId === this.runId) throw new Error('Invalid telemetry run ID');
    const buffer = new TelemetryRing(this.config.capacity);
    this.currentRunId = runId; this.epoch = now; this.buffer = buffer; this.lastStep = -1;
    this.scenarioId = command.id; this.scenarioLoop = command.loop; this.revision++;
    this.ensure();
    return this.scenario();
  }
  /** Catch-up is bounded by retention even after a long pause or forward clock jump. */
  tick() {
    if (this.closed) return;
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < this.epoch) return;
    const target = Math.floor((now - this.epoch) / this.config.sampleMs);
    const from = Math.max(this.lastStep + 1, target - this.config.capacity + 1);
    for (let step = from; step <= target; step++) {
      const simulation = simulateTelemetry(this.config, { elapsedMs: step * this.config.sampleMs, epochMs: this.epoch, seed: this.metadata.seed,
        scenario: this.scenarioId, loop: this.scenarioLoop });
      const frame: TelemetryFrame = { ...simulation, scenario: { ...simulation.scenario, revision: this.revision, startedAt: this.epoch },
        schemaVersion: 1, source: 'simulated', watermark: TELEMETRY_WATERMARK, runId: this.runId, sequence: step + 1 };
      this.buffer.push(frame);
      this.lastStep = step;
      for (const listener of this.listeners) {
        try { listener(structuredClone(frame)); } catch { /* One failed client must not stop the shared producer. */ }
      }
    }
  }
  history(channelId: string, window: TelemetryWindow): TelemetryHistory {
    const channel = this.channel(channelId);
    if (!channel || !Object.hasOwn(TELEMETRY_WINDOWS, window)) throw new RangeError('Unknown telemetry history scope');
    this.ensure();
    const clock = this.now();
    if (!Number.isSafeInteger(clock) || clock < 0) throw new Error('Invalid telemetry clock');
    const to = Math.max(this.epoch, clock), from = Math.max(this.epoch, to - TELEMETRY_WINDOWS[window]);
    return { schemaVersion: 1, source: 'simulated', watermark: TELEMETRY_WATERMARK, runId: this.runId, channel, window, from, to,
      points: this.buffer.history(channelId, from, to) };
  }
  replay(cursor: TelemetryCursor | null): { frames: TelemetryFrame[]; reset?: TelemetryResetReason } {
    this.ensure();
    const latest = this.buffer.latest();
    // A clock rollback before the first read can leave an intentionally empty buffer.
    if (!latest) return { frames: [], ...(cursor ? { reset: cursor.runId !== this.runId ? 'server_restart' as const : 'history_expired' as const } : {}) };
    const reset = cursor && (cursor.runId !== this.runId ? 'server_restart' : cursor.sequence > latest.sequence ? 'cursor_ahead'
      : cursor.sequence < this.buffer.oldestSequence! - 1 || latest.sequence - cursor.sequence > 30 ? 'history_expired' : undefined);
    if (!cursor || reset) return { frames: [latest], ...(reset ? { reset } : {}) };
    return { frames: this.buffer.since(cursor.sequence) };
  }
  subscribe(listener: (frame: TelemetryFrame) => void): () => void {
    this.ensure();
    if (this.listeners.size >= 32) throw new RangeError('Telemetry subscriber limit');
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.listeners.clear();
  }
}

/** Unknown modes fail closed; there is no device/ingest mode in this stage. */
export function telemetryFromEnvironment(root: string, env: NodeJS.ProcessEnv = process.env): TelemetryRuntime | undefined {
  if ((env.TELEMETRY_MODE ?? 'simulated') !== 'simulated') return undefined;
  const seed = env.TELEMETRY_SEED;
  if (seed !== undefined && (!/^(0|[1-9][0-9]{0,9})$/.test(seed) || Number(seed) > 0xffffffff)) throw new RangeError('Invalid telemetry seed configuration');
  return new TelemetryRuntime(loadTelemetryDemoConfig(root), { seed: seed === undefined ? undefined : Number(seed) });
}
