import evidence from './overheat-evidence.json';
export const OVERHEAT_EVIDENCE = evidence;
export type TwinSource = 'simulated' | 'user-reported';
export type Finding = 'supported' | 'conflicting' | 'unknown';
export interface TwinProfile { equipmentId: string; model: string; configurationChecked: boolean; optionalFan: 'unknown' | 'present' | 'absent' }
export type TwinEvent = { id: string; at: string; source: TwinSource } & (
  { kind: 'observation'; temperature: number | null; note: string } |
  { kind: 'check'; evidenceId: string; finding: Finding; note: string } |
  { kind: 'review'; evidenceId: string; reviewer: string; note: string; retest: string }
);
export interface TwinCase { id: string; revision: number; createdAt: string; source: TwinSource; profile: TwinProfile; events: TwinEvent[] }
export const FRESHNESS_MS = 30 * 60 * 1000; // Prototype freshness policy, never an OEM threshold.
const validId = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 120;
const text = (s: unknown, max = 1000): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const date = (s: unknown): s is string => typeof s === 'string' && Number.isFinite(Date.parse(s));
export function validateCase(value: TwinCase): void {
  if (!value || !validId(value.id) || !['simulated', 'user-reported'].includes(value.source) || !date(value.createdAt) ||
    !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.events) || value.events.length > 500) throw Error('案例格式无效');
  const p = value.profile;
  if (!p || !text(p.equipmentId, 80) || !['未知', 'T1254B', 'T1404-B'].includes(p.model) || typeof p.configurationChecked !== 'boolean' || !['unknown','present','absent'].includes(p.optionalFan)) throw Error('设备档案无效');
  if (value.revision !== value.events.length) throw Error('案例版本不一致');
  const ids = new Set<string>();
  for (const event of value.events) {
    if (!event || !validId(event.id) || ids.has(event.id) || !date(event.at) || event.source !== value.source || !text(event.note)) throw Error('记录的来源、编号、时间或内容无效');
    ids.add(event.id);
    if (event.kind === 'observation') {
      if (event.temperature !== null && (typeof event.temperature !== 'number' || !Number.isFinite(event.temperature) || event.temperature < -50 || event.temperature > 200)) throw Error('温度输入超出录入范围（不是故障阈值）');
    } else if (event.kind === 'check' || event.kind === 'review') {
      if (!evidence.some(e => e.id === event.evidenceId)) throw Error('未知知识条目');
      if (event.kind === 'check' && !['supported','conflicting','unknown'].includes(event.finding)) throw Error('检查结果无效');
      if (event.kind === 'review' && (!text(event.reviewer,80) || !text(event.retest))) throw Error('请填写确认人和复测记录');
    } else throw Error('未知事件类型');
  }
}
export function appendEvent(current: TwinCase, event: TwinEvent, expectedRevision: number, now = Date.now()): TwinCase {
  validateCase(current);
  const prior = current.events.find(e => e.id === event.id);
  if (prior) {
    if (JSON.stringify(prior) !== JSON.stringify(event)) throw Error('重复编号的内容不一致');
    return current;
  }
  if (expectedRevision !== current.revision) throw Error('案例已在其他窗口更新，请重新载入');
  if (Date.parse(event.at) > now + 60_000 || Date.parse(event.at) < Date.parse(current.createdAt)) throw Error('记录时间须在案例建立之后，且不能在未来');
  const next = { ...current, revision: current.revision + 1, events: [...current.events, event] };
  validateCase(next);
  if (event.kind === 'check') {
    const result = analyzeTwin(current, now);
    if (!result.ready || !result.candidates.some(c => c.id === event.evidenceId && c.applicable)) throw Error('需先补充有效观测并核对候选的适用配置');
  }
  if (event.kind === 'review') {
    const result = analyzeTwin(current, now);
    if (!result.ready || !result.candidates.some(c => c.id === event.evidenceId && c.applicable && c.finding === 'supported')) throw Error('需先核对机型配置、补充有效观测和支持该原因的检查记录');
  }
  return next;
}
export function analyzeTwin(value: TwinCase, now = Date.now()) {
  validateCase(value);
  const applicable = ['T1254B','T1404-B'].includes(value.profile.model) && value.profile.configurationChecked;
  const observations = value.events.filter(e => e.kind === 'observation');
  const latest = observations.at(-1);
  const observationIndex = latest ? value.events.indexOf(latest) : -1;
  const fresh = !!latest && now - Date.parse(latest.at) <= FRESHNESS_MS && Date.parse(latest.at) <= now + 60_000;
  const candidates = evidence.map(e => {
    const checks = value.events.filter(v => v.kind === 'check' && v.evidenceId === e.id);
    const last = checks.at(-1);
    const recent = last && value.events.indexOf(last) > observationIndex && now - Date.parse(last.at) <= FRESHNESS_MS;
    return { ...e, applicable: applicable && (!e.optional || value.profile.optionalFan === 'present'),
      finding: (recent && last?.kind === 'check' ? last.finding : 'unknown') as Finding,
      check: last, hasConflictHistory: checks.some(c => c.kind === 'check' && c.finding === 'supported') && checks.some(c => c.kind === 'check' && c.finding === 'conflicting') };
  });
  const ready = applicable && fresh;
  const lastEvent = value.events.at(-1);
  const review = ready && lastEvent?.kind === 'review' && candidates.some(c => c.id === lastEvent.evidenceId && c.applicable && c.finding === 'supported') ? lastEvent : undefined;
  const missing = [!applicable && '核对型号、PIN、市场、排放、变速箱与手册版本', !latest && '记录本次温度显示或过热现象', latest && !fresh && '观测已过期，请重新采集或报告', value.profile.optionalFan === 'unknown' && 'Visctronic 风扇配置未知，专用候选暂不适用'].filter(Boolean) as string[];
  const next = candidates.find(c => c.applicable && c.finding === 'unknown');
  return { candidates, latest, ready, review, missing,
    state: !ready ? 'information_needed' : review ? 'review_recorded' : 'check_pending',
    nextCheck: !ready ? missing[0] : next ? `补充“${next.title}”的检查报告；未检查请保留“无法确定”，不能按症状直接确诊。` : '已有检查报告仍不能自动确诊；复核冲突并记录维修人员确认及复测结果。' };
}
export function twinHandoff(value: TwinCase, now = Date.now()): string {
  const a = analyzeTwin(value, now);
  const supported = a.candidates.filter(c => c.applicable && c.finding === 'supported').map(c => `${c.title}（${c.id}）`).join('；') || '无';
  const checks = value.events.filter(e => e.kind === 'check').slice(-3).map(e => e.kind === 'check' ? `${e.evidenceId} ${e.finding}: ${e.note.slice(0,120)}` : '').join('；');
  return `发动机过热认知孪生原型摘要。来源：${value.source === 'simulated' ? '仿真演示，不是实车读数' : '用户手工报告，未独立核验'}。设备：${value.profile.equipmentId}；型号：${value.profile.model}；配置已核对：${value.profile.configurationChecked ? '是（用户声明）' : '否'}。观测：${a.latest?.note.slice(0,300) ?? '无'}（${a.latest?.at ?? '无时间'}）；温度：${a.latest?.kind === 'observation' && a.latest.temperature !== null ? `${a.latest.temperature}℃` : '未记录'}。当前有支持报告的候选：${supported}。最近检查报告（保留历史，非确诊）：${checks || '无'}。待补：${a.missing.join('；') || '根因仍待确认'}。请核对证据和缺失信息，不能将本摘要视为实车确诊或厂家参数。`.slice(0, 1900);
}
