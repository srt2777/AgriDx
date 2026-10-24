import type { KnowledgeCatalog, LibraryEntry } from '../../../shared/knowledge-catalog';

export type Scenario = 'quiet' | 'temperature' | 'outage';
export const DURATION = 120;
export const ALARM_AT = 45;
export const OUTAGE_AT = 60;
export const DEMO_RECORD_KEY = 'agridx-fault-demo-records-v1';
export const EVIDENCE_ID = 'KB-LX2620-005';
export const EVIDENCE_QUERY = `collection=archive&q=${EVIDENCE_ID}`;
export const SCENARIOS: { id: Scenario; zh: string; en: string }[] = [
  { id: 'quiet', zh: '无告警示例', en: 'No-alert example' },
  { id: 'temperature', zh: '温度告警示例', en: 'Temperature alert' },
  { id: 'outage', zh: '数据中断示例', en: 'Data interruption' },
];
export const CHECKS = [
  { id: 'scope', zh: '核对铭牌型号、市场与配置', en: 'Check the plate, market and configuration' },
  { id: 'symptom', zh: '记录警灯、现象和发生工况', en: 'Record indicators, symptoms and operating conditions' },
  { id: 'evidence', zh: '阅读适用资料及安全边界', en: 'Read applicable evidence and safety boundaries' },
  { id: 'review', zh: '记录检查结果与待复查项目', en: 'Record findings and items needing recheck' },
] as const;
export interface DemoRecord { scenario: Scenario; at: number; checkId: typeof CHECKS[number]['id']; note: string }
export function clampTime(value: number) { return Number.isFinite(value) ? Math.min(DURATION, Math.max(0, value)) : 0; }
export function frame(scenario: Scenario, value: number) {
  const time = clampTime(value);
  const offline = scenario === 'outage' && time >= OUTAGE_AT;
  const sampleAt = offline ? OUTAGE_AT - 1 : Math.floor(time);
  const heat = scenario === 'temperature' ? Math.min(32, Math.max(0, sampleAt - 25) * .65) : 0;
  return { time, sampleAt, offline, alert: scenario === 'temperature' && time >= ALARM_AT,
    temperature: Math.round((76 + Math.sin(sampleAt / 12) * 2 + heat) * 10) / 10,
    rpm: Math.round(1450 + Math.sin(sampleAt / 9) * 120),
    pressure: Math.round((310 + Math.sin(sampleAt / 13) * 18) * 10) / 10 };
}
/** A reviewed archive entry is required; never substitute TK learning or another model. */
export function demoEvidence(catalog: KnowledgeCatalog | null): Extract<LibraryEntry, { collection: 'archive' }> | null {
  const entry = catalog?.library?.entries.find(item => item.entryId === EVIDENCE_ID);
  return entry?.collection === 'archive' && entry.brand === '久保田' && entry.models.some(model => model.includes('LX2620'))
    && entry.sourceId === 'SRC-KB-LX2620-6C82063118' ? entry : null;
}
export function parseRecords(raw: string | null): DemoRecord[] {
  try {
    const data: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(data)) return [];
    return data.filter((row): row is DemoRecord => row !== null && typeof row === 'object'
      && SCENARIOS.some(s => s.id === row.scenario) && Number.isFinite(row.at) && row.at >= 0 && row.at <= DURATION
      && CHECKS.some(check => check.id === row.checkId) && typeof row.note === 'string' && row.note.length > 0 && row.note.length <= 1000).slice(-100);
  } catch { return []; }
}
export function diagnosisDraft(scenario: Scenario, time: number, records: DemoRecord[], zh: boolean) {
  return { machineType: '拖拉机', brand: '久保田', model: 'LX2620',
    question: `${zh ? '模拟演示，未连接实车。非真实设备报告；请先核对完整型号、市场和配置。' : 'SIMULATION, no live machine. Not a real device report; confirm model, market and configuration.'}\n`
      + `${SCENARIOS.find(item => item.id === scenario)![zh ? 'zh' : 'en']} · t=${clampTime(time).toFixed(0)}s\n`
      + `${zh ? '仅温度场景的资料示例' : 'Evidence example for temperature scenario only'}: ${EVIDENCE_ID} (Kubota LX2620 / LX2620SU, US manual).\n`
      + records.filter(row => row.scenario === scenario).map(row => `[${row.at.toFixed(0)}s / ${row.checkId}] ${row.note}`).join('\n').slice(0, 1200) };
}
