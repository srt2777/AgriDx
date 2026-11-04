import { useEffect, useRef, useState } from 'react';
import { Check, Download, Upload, X } from 'lucide-react';
import { useLang } from '@/hooks/useLang';
import { useWorkbench } from '@/features/workbench/WorkbenchContext';
import { downloadFile, mapObservations, MAX_DATASETS, MAX_FILE_BYTES, parseCsv } from '@/features/workbench/data';
import { useUpdateBlocker } from '@/features/updates/useUpdateBlocker';

export function DataImport() {
  const lang = useLang(), t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const work = useWorkbench(), request = useRef(0);
  const [rows, setRows] = useState<string[][]>([]), [name, setName] = useState(''), [unit, setUnit] = useState('');
  const [object, setObject] = useState(''), [timeColumn, setTimeColumn] = useState(0), [valueColumn, setValueColumn] = useState(1);
  const [format, setFormat] = useState<'iso' | 'seconds' | 'milliseconds'>('iso');
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => () => { request.current++; }, []);
  useUpdateBlocker('workbench-import', rows.length > 0 || busy);
  function reset() { request.current++; setRows([]); setName(''); setError(''); setBusy(false); }
  async function read(file: File | undefined) {
    if (!file) return; const token = ++request.current; setRows([]); setError(''); setMessage(''); setBusy(true);
    try {
      if (file.size > MAX_FILE_BYTES || !/\.csv$/i.test(file.name)) throw new Error(t('请选择不超过 2 MB 的 UTF-8 CSV 文件。', 'Choose a UTF-8 CSV file up to 2 MB.'));
      const parsed = parseCsv(await file.text()); if (token !== request.current) return;
      setRows(parsed); setName(file.name.slice(0, 100)); setTimeColumn(0); setValueColumn(1); setFormat('iso'); setUnit(''); setObject([work.brand?.name, work.model?.name].filter(Boolean).join(' '));
    } catch (e) { if (token === request.current) setError(e instanceof Error ? e.message : 'Import failed'); }
    finally { if (token === request.current) setBusy(false); }
  }
  function save() {
    setError('');
    try {
      if (work.data.datasets.length >= MAX_DATASETS) throw new Error(t('最多保留 5 个数据集，请先删除不需要的数据集。', 'Keep up to five datasets. Delete one before importing.'));
      if (!name.trim() || !unit.trim() || !object.trim()) throw new Error(t('请填写名称、单位和所属对象。', 'Enter a name, unit and object.'));
      const points = mapObservations(rows, timeColumn, valueColumn, format);
      work.addDataset({ id: crypto.randomUUID(), name: name.trim(), unit: unit.trim(), object: object.trim(), source: 'user-import', createdAt: Date.now(), points });
      reset(); setMessage(t('已加入当前浏览器数据集，可在数据可视化中查看。', 'Added to browser datasets. Open Analytics to inspect it.'));
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed'); }
  }
  return <section className="wb-panel"><div className="wb-panel-heading"><div><p className="wb-eyebrow">LOCAL DATA</p><h2>{t('导入与字段映射', 'Import & field mapping')}</h2></div><button type="button" onClick={() => downloadFile('time_iso,value\r\n', 'agridx-observations-template.csv')}><Download size={15} />{t('下载空模板', 'Blank template')}</button></div>
    <p className="wb-muted">{t('UTF-8 CSV · 2 MB / 5000 行 · 最多 5 个数据集。数据留在本浏览器，不上传；清除网站数据会删除记录。导入内容标为用户提供，未核验。', 'UTF-8 CSV · 2 MB / 5000 rows · up to 5 datasets. Stored in this browser, never uploaded; clearing site data removes records. Imports are unverified user observations.')}</p>
    <div className="wb-import-drop"><Upload size={26} /><label>{t('选择采集文件', 'Choose observations file')}<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { void read(e.target.files?.[0]); e.target.value = ''; }} /></label><span>{busy ? t('读取中…', 'Reading…') : t('先选择文件，再映射时间与数值字段', 'Choose a file, then map time and value fields')}</span></div>
    {rows.length > 0 && <div className="wb-import-form"><ol className="wb-steps"><li className="is-done"><Check size={15} />{t('读取文件', 'Read file')}</li><li className="is-current">02 {t('映射字段', 'Map fields')}</li><li>03 {t('校验并保存', 'Validate & save')}</li></ol>
      <div className="wb-form-grid"><label>{t('数据集名称', 'Dataset name')}<input value={name} maxLength={100} onChange={e => setName(e.target.value)} /></label><label>{t('所属对象（自行填写）', 'Object (user supplied)')}<input value={object} maxLength={150} onChange={e => setObject(e.target.value)} /></label><label>{t('数值单位', 'Value unit')}<input value={unit} placeholder="°C / rpm / mm" maxLength={20} onChange={e => setUnit(e.target.value)} /></label>
        <label>{t('时间列', 'Time column')}<select value={timeColumn} onChange={e => setTimeColumn(Number(e.target.value))}>{rows[0].map((h, i) => <option value={i} key={i}>{h}</option>)}</select></label><label>{t('数值列', 'Value column')}<select value={valueColumn} onChange={e => setValueColumn(Number(e.target.value))}>{rows[0].map((h, i) => <option value={i} key={i}>{h}</option>)}</select></label><label>{t('时间格式', 'Time format')}<select value={format} onChange={e => setFormat(e.target.value as typeof format)}><option value="iso">ISO 8601 (2026-11-04T12:00:00+08:00)</option><option value="seconds">Unix seconds</option><option value="milliseconds">Unix milliseconds</option></select></label></div>
      <div className="wb-table-wrap"><table><caption>{t('原始预览（前 5 行）', 'Raw preview (first 5 rows)')}</caption><thead><tr>{rows[0].map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{rows.slice(1, 6).map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>
      <div className="wb-actions"><button type="button" className="wb-primary" onClick={save}><Check size={16} />{t('校验并保存', 'Validate & save')} ({rows.length - 1})</button><button type="button" onClick={reset}><X size={16} />{t('取消导入', 'Cancel import')}</button></div></div>}
    {error && <p role="alert" className="wb-notice">{error}</p>}{message && <p role="status" className="wb-notice">{message}</p>}
  </section>;
}
