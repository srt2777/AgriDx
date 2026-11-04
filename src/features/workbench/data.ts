/** User imports remain unverified browser-local observations. */
export interface Observation { at: number; value: number }
export interface Dataset { id: string; name: string; unit: string; object: string; source: 'user-import'; createdAt: number; points: Observation[] }
export interface Activity { id: string; at: number; kind: 'import' | 'export' | 'handoff' | 'note' | 'delete'; text: string; object: string }
export interface WorkbenchData { datasets: Dataset[]; activities: Activity[] }
export const WORKBENCH_KEY = 'agridx-workbench-v1';
export const MAX_ROWS = 5000, MAX_DATASETS = 5, MAX_FILE_BYTES = 2 * 1024 * 1024;
export function parseCsv(text: string): string[][] {
  if (text.length > MAX_FILE_BYTES) throw new Error('CSV 超过 2 MB / CSV exceeds 2 MB');
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false, closed = false;
  const pushCell = () => { row.push(cell.trim()); cell = ''; closed = false; };
  const pushRow = () => { pushCell(); if (row.some(value => value !== '')) rows.push(row); row = []; if (rows.length > MAX_ROWS + 1) throw new Error('最多 5000 行 / Maximum 5000 rows'); };
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; } else cell += ch;
    } else if (ch === ',') pushCell();
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && input[i + 1] === '\n') i++; pushRow(); }
    else if (ch === '"' && !cell && !closed) quoted = true;
    else if (closed && ch.trim()) throw new Error('引号后存在无效字符 / Invalid quoted CSV'); else cell += ch;
  }
  if (quoted) throw new Error('CSV 引号未闭合 / Unclosed CSV quote');
  if (cell || row.length) pushRow();
  if (rows.length < 2 || rows[0].length < 2 || rows[0].length > 30 || rows[0].some(v => !v || v.length > 100) || new Set(rows[0]).size !== rows[0].length || rows.some(r => r.length !== rows[0].length)) throw new Error('需有唯一表头、至少两列，且每行列数一致 / Use unique headers and consistent rows with at least two columns');
  return rows;
}
export function mapObservations(rows: string[][], timeColumn: number, valueColumn: number, timeFormat: 'iso' | 'seconds' | 'milliseconds'): Observation[] {
  if (!rows.length || timeColumn === valueColumn || ![timeColumn, valueColumn].every(i => Number.isInteger(i) && i >= 0 && i < rows[0].length)) throw new Error('请选择不同的时间列和数值列 / Choose distinct time and value columns');
  const points = rows.slice(1).map((row, index) => {
    const raw = row[timeColumn], numericTime = Number(raw);
    const at = timeFormat === 'iso' ? (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? Date.parse(raw) : NaN) : raw.trim() && Number.isFinite(numericTime) ? numericTime * (timeFormat === 'seconds' ? 1000 : 1) : NaN;
    const value = row[valueColumn].trim() ? Number(row[valueColumn]) : NaN;
    if (!Number.isFinite(at) || at < 0 || at > 8640000000000000 || !Number.isFinite(value)) throw new Error(`第 ${index + 2} 行时间或数值无效 / Invalid time or value on row ${index + 2}`);
    return { at, value };
  }).sort((a, b) => a.at - b.at);
  if (!points.length || points.length > MAX_ROWS || points.some((p, i) => i > 0 && p.at === points[i - 1].at)) throw new Error('时间不可重复，且最多 5000 行 / Unique timestamps required, up to 5000 rows');
  return points;
}
export function observationStats(points: readonly Observation[]) {
  if (!points.length) return null;
  let min = Infinity, max = -Infinity, mean = 0;
  points.forEach((p, i) => { min = Math.min(min, p.value); max = Math.max(max, p.value); mean = mean * (i / (i + 1)) + p.value / (i + 1); });
  return { min, max, mean, count: points.length };
}
export function parseWorkbench(value: unknown): WorkbenchData {
  if (!value || typeof value !== 'object') return { datasets: [], activities: [] };
  const data = value as Partial<WorkbenchData>;
  const short = (v: unknown, n: number): v is string => typeof v === 'string' && v.length <= n;
  const time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 8640000000000000;
  const datasets = Array.isArray(data.datasets) ? data.datasets.slice(0, MAX_DATASETS).filter(d => d && short(d.id, 80) && short(d.name, 100) && short(d.unit, 20) && short(d.object, 150) && d.source === 'user-import' && time(d.createdAt) && Array.isArray(d.points) && d.points.length > 0 && d.points.length <= MAX_ROWS && d.points.every((p, i) => p && time(p.at) && Number.isFinite(p.value) && typeof p.value === 'number' && (i === 0 || p.at > d.points[i - 1].at))) : [];
  const activities = Array.isArray(data.activities) ? data.activities.slice(0, 100).filter(a => a && short(a.id, 80) && time(a.at) && ['import', 'export', 'handoff', 'note', 'delete'].includes(a.kind) && short(a.text, 1000) && short(a.object, 150)) : [];
  return { datasets, activities };
}
export function csvCell(value: string | number) { return `"${String(value).replace(/^\s*[=+@-]/, "'$&").replaceAll('"', '""')}"`; }
export function datasetCsv(dataset: Dataset) { return '\uFEFF' + [['time_iso', 'value', 'unit', 'object', 'source'], ...dataset.points.map(p => [new Date(p.at).toISOString(), p.value, dataset.unit, dataset.object, 'user-import / 用户导入，未核验'])].map(row => row.map(v => typeof v === 'number' ? String(v) : csvCell(v)).join(',')).join('\r\n'); }
export function downloadFile(content: string, name: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
