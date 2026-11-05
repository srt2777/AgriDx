import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateTelemetryDemoConfig, type TelemetryDemoConfig } from '../../shared/telemetry-simulator';
export * from '../../shared/telemetry-simulator';

export function loadTelemetryDemoConfig(root = process.cwd()): TelemetryDemoConfig {
  return validateTelemetryDemoConfig(JSON.parse(readFileSync(path.join(root, 'config/telemetry-demo.json'), 'utf8')));
}
