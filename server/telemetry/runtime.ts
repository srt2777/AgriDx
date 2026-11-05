import { TelemetryRuntime } from '../../shared/telemetry-runtime';
import { loadTelemetryDemoConfig } from './simulator';
export * from '../../shared/telemetry-runtime';

/** Unknown modes fail closed; there is no device/ingest mode in this stage. */
export function telemetryFromEnvironment(root: string, env: NodeJS.ProcessEnv = process.env): TelemetryRuntime | undefined {
  if ((env.TELEMETRY_MODE ?? 'simulated') !== 'simulated') return undefined;
  const seed = env.TELEMETRY_SEED;
  if (seed !== undefined && (!/^(0|[1-9][0-9]{0,9})$/.test(seed) || Number(seed) > 0xffffffff)) throw new RangeError('Invalid telemetry seed configuration');
  return new TelemetryRuntime(loadTelemetryDemoConfig(root), { seed: seed === undefined ? undefined : Number(seed) });
}
