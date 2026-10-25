import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDiagnosticRequest } from '../server/diagnosis/request';
import { buildSystemPrompt } from '../server/knowledge/systemPrompt';

const base = { messages: [{ role: 'user', content: '发动机有异常' }] };
test('telemetry summary is optional, simulated-only and bounded', () => {
  assert.equal(parseDiagnosticRequest(base).telemetrySummary, undefined);
  const parsed = parseDiagnosticRequest({ ...base, telemetrySummary: { source: 'simulated', text: '冷却液温度：34 °C（采样源 simulated）' } });
  assert.equal(parsed.telemetrySummary?.source, 'simulated');
  assert.throws(() => parseDiagnosticRequest({ ...base, telemetrySummary: { source: 'device', text: 'real' } }), /仿真监测摘要/);
  assert.throws(() => parseDiagnosticRequest({ ...base, telemetrySummary: { source: 'simulated', text: 'x'.repeat(1601) } }), /仿真监测摘要/);
});

test('prompt carries an explicit simulation disclaimer only when supplied', () => {
  const common = { query: '发动机异常', currentQuery: '发动机异常', retrieved: [] as never[] };
  assert.doesNotMatch(buildSystemPrompt(common).message.content, /不是真实设备读数/);
  assert.match(buildSystemPrompt({ ...common, telemetrySummary: '冷却液温度：34 °C' }).message.content, /仿真演示数据，不是真实设备读数，不得据此给出确定性故障结论/);
});
