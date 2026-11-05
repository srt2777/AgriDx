import rawConfig from '../../../config/telemetry-demo.json';
import { TelemetryRuntime } from '../../../shared/telemetry-runtime';
import { validateTelemetryDemoConfig } from '../../../shared/telemetry-simulator';
import { TELEMETRY_WINDOWS, type TelemetryScenarioCommand, type TelemetryWindow } from '../../../shared/telemetry';

/** Explicit static-preview simulation, never a fallback for a failed real service. */
export function createPreviewTelemetryTransport(now = Date.now) {
  const config = validateTelemetryDemoConfig(rawConfig);
  // Seed a five-minute illustrative history so the first view already contains charts.
  let warming = true;
  const runtime = new TelemetryRuntime(config, {
    now: () => Math.max(0, now() - (warming ? 300000 : 0)), automatic: false, scope: 'browser-tab',
  });
  warming = false;
  return {
    now,
    open() {
      let closed = false;
      const target = new EventTarget();
      const stream = {
        onopen: null as EventSource['onopen'], onerror: null as EventSource['onerror'],
        addEventListener: target.addEventListener.bind(target) as EventSource['addEventListener'],
        close() { closed = true; clearInterval(timer); unsubscribe?.(); },
      };
      const emit = (name: string, data: unknown) => {
        if (!closed) target.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) }));
      };
      let unsubscribe: (() => void) | undefined;
      const timer = setInterval(() => runtime.tick(), config.sampleMs);
      queueMicrotask(() => {
        if (closed) return;
        stream.onopen?.call(stream as unknown as EventSource, new Event('open'));
        emit('catalog', runtime.catalog());
        for (const frame of runtime.replay(null).frames) emit('telemetry', frame);
        unsubscribe = runtime.subscribe(frame => emit('telemetry', frame));
      });
      return stream;
    },
    async history(path: string, signal: AbortSignal) {
      signal.throwIfAborted();
      const query = new URL(path, 'https://preview.invalid').searchParams;
      const window = query.get('window');
      if (!window || !Object.hasOwn(TELEMETRY_WINDOWS, window)) throw new RangeError('Invalid history window');
      return runtime.history(query.get('channel') ?? '', window as TelemetryWindow);
    },
    async command(command: TelemetryScenarioCommand, signal: AbortSignal) {
      signal.throwIfAborted();
      return runtime.changeScenario(command);
    },
  };
}
