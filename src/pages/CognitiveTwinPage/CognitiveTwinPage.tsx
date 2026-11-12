import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { analyzeTwin, twinHandoff, type TwinCase, type TwinEvent, type TwinSource, type Finding } from '../../../shared/cognitive-twin';
import { createTwinCase, listTwinCases, saveTwinEvent, deleteTwinCase } from '../../features/cognitive-twin/store';
import './cognitive-twin.css';
const findingLabels = { supported: '有支持报告', conflicting: '有冲突报告', unknown: '无法确定' };
const sourceLabel = (s: TwinSource) => s === 'simulated' ? '仿真演示 · 非实车' : '人工报告 · 未独立核验';
const errorText = (e: unknown) => e instanceof Error ? e.message : '操作失败，请重试';
export default function CognitiveTwinPage() {
  const [cases, setCases] = useState<TwinCase[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [replay, setReplay] = useState<number | null>(null);
  const [device, setDevice] = useState('');
  const [model, setModel] = useState('未知');
  const [source, setSource] = useState<TwinSource>('simulated');
  const [checked, setChecked] = useState(false);
  const [fan, setFan] = useState<'unknown'|'present'|'absent'>('unknown');
  const [temperature, setTemperature] = useState('');
  const [note, setNote] = useState('');
  const [checkId, setCheckId] = useState('');
  const [finding, setFinding] = useState<Finding>('unknown');
  const [checkNote, setCheckNote] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [retest, setRetest] = useState('');
  const [reviewId, setReviewId] = useState('');
  const current = cases.find(c => c.id === selected);
  const viewing = current && replay !== null ? { ...current, revision: replay, events: current.events.slice(0, replay) } : current;
  const analysis = viewing ? analyzeTwin(viewing, replay !== null ? Date.parse(viewing.events.at(-1)?.at ?? viewing.createdAt) : now) : undefined;
  useEffect(() => {
    let active = true;
    listTwinCases().then(rows => { if (active) { setCases(rows); setSelected(rows[0]?.id ?? ''); setLoaded(true); } }).catch(e => { if (active) setError(errorText(e)); });
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const run = async (task: () => Promise<void>) => {
    if (busy) return; setBusy(true); setError('');
    try { await task(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); setNow(Date.now()); }
  };
  const choose = (id: string) => { setSelected(id); setReplay(null); setNote(''); setTemperature(''); setCheckNote(''); setCheckId(''); setReviewId(''); setReviewer(''); setRetest(''); setFinding('unknown'); };
  const create = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    const value = await createTwinCase({ id: crypto.randomUUID(), revision: 0, createdAt: new Date().toISOString(), source,
      profile: { equipmentId: device.trim(), model, configurationChecked: checked, optionalFan: fan }, events: [] });
    setCases(rows => [value, ...rows]); choose(value.id); setLoaded(true);
  }); };
  const add = async (event: TwinEvent) => {
    if (!current || replay !== null) return;
    const updated = await saveTwinEvent(current.id, event, current.revision);
    setCases(rows => rows.map(c => c.id === updated.id ? updated : c));
  };
  const base = () => ({ id: crypto.randomUUID(), at: new Date().toISOString(), source: current!.source });
  const exportCase = () => {
    if (!current) return;
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), boundary: sourceLabel(current.source), case: current }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `sijia-twin-${current.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="ct-page" lang="zh-CN">
    <header className="ct-hero"><div><p className="ct-eyebrow">司稼 / 认知数字孪生原型</p><h1>发动机过热 · 证据工作台</h1><p>记录设备状态，核对候选原因，用检查反馈更新判断。</p></div><Link to="/chat">返回智能诊断 →</Link></header>
    <p className="ct-boundary">资料范围：纽荷兰 T1254B / T1404-B，操作员手册 91783224。当前支持仿真演示与人工报告，尚未接入真实传感器；保存于本浏览器，不与诊断账户或其他浏览器同步。共享浏览器可见，清理站点数据会丢失记录。</p>
    <div className="ct-toolbar"><label>已有案例<select aria-label="已有案例" value={selected} disabled={busy} onChange={e => choose(e.target.value)}><option value="">选择或新建案例</option>{cases.map(c => <option key={c.id} value={c.id}>{c.profile.equipmentId} · {c.profile.model} · {sourceLabel(c.source)} · {c.id.slice(0,8)}</option>)}</select></label><button disabled={busy} onClick={() => void run(async () => { const rows = await listTwinCases(); setCases(rows); choose(rows.some(c => c.id === selected) ? selected : rows[0]?.id ?? ''); setLoaded(true); })}>重新载入</button></div>
    {error && <p className="ct-error" role="alert">{error}</p>}
    {!loaded && !error && <p role="status">正在读取本机案例…</p>}
    <details className="ct-panel" open={!current}><summary>新建设备案例</summary><form onSubmit={create} className="ct-form">
      <label>设备编号或名称<input required maxLength={80} value={device} onChange={e => setDevice(e.target.value)} placeholder="例如：校赛演示车 01" /></label>
      <label>型号<select value={model} onChange={e => { setModel(e.target.value); setChecked(false); }}><option>未知</option><option>T1254B</option><option>T1404-B</option></select></label>
      <label>资料来源<select value={source} onChange={e => setSource(e.target.value as TwinSource)}><option value="simulated">仿真演示（非实车）</option><option value="user-reported">人工报告（未独立核验）</option></select></label>
      <label>Visctronic 风扇配置<select value={fan} onChange={e => setFan(e.target.value as typeof fan)}><option value="unknown">未知</option><option value="present">已确认装配</option><option value="absent">已确认未装配</option></select></label>
      <label className="ct-wide ct-checkbox"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />我已核对本案例的型号、PIN、市场、排放、变速箱和手册版本；仿真模式下仅代表场景设定。</label>
      <p className="ct-wide">设备身份及来源建立后固定；需要纠正时新建案例，保留原案例证据。</p><button disabled={busy || !device.trim()}>建立案例</button>
    </form></details>
    {current && viewing && analysis && <>
      <section className="ct-panel ct-state"><div><span className="ct-badge">{sourceLabel(current.source)}</span><h2>{current.profile.equipmentId} / {current.profile.model}</h2><p>状态版本 {viewing.revision} · {replay !== null ? '历史回放（只读，按当时记录时间分析）' : '当前状态'}</p></div><strong>{analysis.state === 'information_needed' ? '等待补充信息' : analysis.state === 'review_recorded' ? '已记录人工确认声明' : '等待检查反馈'}</strong></section>
      {analysis.review && <p className="ct-boundary">{current.source === 'simulated' ? '这是模拟确认，不是实车结论。' : '这是提交者记录的确认声明，不代表平台独立核验。'} 确认人：{analysis.review.reviewer}；复测：{analysis.review.retest}</p>}
      <div className="ct-grid"><section className="ct-panel"><h2>① 状态感知</h2><p>最新显示值：<b>{analysis.latest?.kind === 'observation' && analysis.latest.temperature !== null ? `${analysis.latest.temperature} ℃` : '未记录'}</b></p><p>{analysis.latest?.note ?? '尚无观测；系统不会补造读数。'}</p><p className="ct-muted">数值仅保存显示值，不设厂家过热阈值。30 分钟有效期仅为原型新鲜度策略。</p><form onSubmit={e => { e.preventDefault(); void run(async () => { await add({ ...base(), kind: 'observation', temperature: temperature.trim() ? Number(temperature) : null, note: note.trim() }); setNote(''); setTemperature(''); }); }}>
        <fieldset disabled={busy || replay !== null}><label>本次温度显示（℃，可留空）<input type="number" min={-50} max={200} step="any" value={temperature} onChange={e => setTemperature(e.target.value)} /></label><label>当前现象与工况<textarea required maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="记录显示异常、负载、运行时长及观测方式；不确定的内容留待核实。" /></label><button>保存本次观测</button></fieldset></form></section>
      <section className="ct-panel"><h2>② 下一步检查</h2><p className="ct-next">{analysis.nextCheck}</p>{analysis.missing.length > 0 && <ul>{analysis.missing.map(x => <li key={x}>{x}</li>)}</ul>}<p className="ct-muted">本页收集已完成的检查报告，不提供拆卸或调压指令。冷却系统须按原手册安全程序检查，不得热机开盖。</p><form onSubmit={e => { e.preventDefault(); void run(async () => { await add({ ...base(), kind: 'check', evidenceId: checkId, finding, note: checkNote.trim() }); setCheckNote(''); }); }}><fieldset disabled={busy || replay !== null || !analysis.ready}>
        <label>检查关联的候选原因<select required value={checkId} onChange={e => setCheckId(e.target.value)}><option value="">请选择</option>{analysis.candidates.filter(c => c.applicable).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        <label>报告与候选原因的关系<select value={finding} onChange={e => setFinding(e.target.value as Finding)}><option value="unknown">无法确定 / 未检查</option><option value="supported">有支持证据（不是确诊）</option><option value="conflicting">有冲突证据（不是排除）</option></select></label><label>检查方式、结果与依据<textarea required maxLength={1000} value={checkNote} onChange={e => setCheckNote(e.target.value)} /></label><button>追加检查反馈</button></fieldset></form></section></div>
      <section className="ct-panel"><h2>③ 候选原因与依据</h2><p>11 条候选来自同一手册故障表。排序按原资料，不表示概率；支持与冲突均来自本案例报告。</p><div className="ct-candidates">{analysis.candidates.map(c => <article key={c.id} className={c.applicable ? '' : 'ct-inactive'}><span className="ct-badge">{!c.applicable ? '适用条件未满足' : findingLabels[c.finding]}</span><h3>{c.title}</h3><p>{c.id} · {c.locator}</p>{c.hasConflictHistory && <p className="ct-error">历史报告存在支持与冲突，请复核。</p>}{c.check && <p>最近检查：{c.check.note}</p>}<details><summary>来源与核验边界</summary><p>{c.sourceId}</p><p>{c.status}</p><p>2022 年 1 月第 1 版；仅适用匹配机型与配置。原表候选不等于本次根因。</p><Link to={`/knowledge?q=${encodeURIComponent(c.id)}`}>查阅知识条目 →</Link></details></article>)}</div></section>
      <section className="ct-panel"><h2>④ 人工确认与复测</h2><p>确认声明会保留提交者和复测依据；新观测或检查会重新开启分析，不自动写入公共知识库。</p><form className="ct-form" onSubmit={e => { e.preventDefault(); void run(async () => { await add({ ...base(), kind: 'review', evidenceId: reviewId, reviewer: reviewer.trim(), retest: retest.trim(), note: '人工提交的原因确认与复测声明，未独立核验' }); setRetest(''); }); }}><fieldset className="ct-wide ct-form" disabled={busy || replay !== null || !analysis.ready}>
        <label>已有支持报告的原因<select required value={reviewId} onChange={e => setReviewId(e.target.value)}><option value="">请选择</option>{analysis.candidates.filter(c => c.applicable && c.finding === 'supported').map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label><label>确认人<input required maxLength={80} value={reviewer} onChange={e => setReviewer(e.target.value)} /></label><label className="ct-wide">维修结果、复测方式与依据<textarea required maxLength={1000} value={retest} onChange={e => setRetest(e.target.value)} /></label><button>记录确认声明</button></fieldset></form></section>
      <section className="ct-panel"><h2>⑤ 事件记忆与回放</h2><label>回放版本<select disabled={busy} value={replay ?? 'current'} onChange={e => setReplay(e.target.value === 'current' ? null : Number(e.target.value))}><option value="current">当前版本</option><option value="0">0 · 建立案例</option>{current.events.map((e,i) => <option key={e.id} value={i+1}>{i+1} · {new Date(e.at).toLocaleString()} · {e.kind === 'observation' ? '观测' : e.kind === 'check' ? '检查' : '确认声明'}</option>)}</select></label><ol>{viewing.events.map(e => <li key={e.id}><b>{e.kind === 'observation' ? '观测' : e.kind === 'check' ? findingLabels[e.finding] : '确认声明'}</b> · {new Date(e.at).toLocaleString()} · {sourceLabel(e.source)}<p>{e.note}{e.kind === 'review' && `；${e.reviewer}：${e.retest}`}</p></li>)}</ol><div className="ct-actions"><button onClick={exportCase}>导出完整案例 JSON</button><button disabled={busy} onClick={() => { if (window.confirm('删除此案例及全部事件？请先导出需要保留的记录。')) void run(async () => { await deleteTwinCase(current.id,current.revision); setCases(rows => rows.filter(c => c.id !== current.id)); choose(''); }); }}>删除本案例</button>{replay === null && <Link to="/chat" state={{ machineType: '拖拉机', brand: '纽荷兰', model: current.profile.model === '未知' ? '' : current.profile.model, question: twinHandoff(current, now) }}>带摘要继续诊断（先预览再发送） →</Link>}</div></section>
    </>}
  </div>;
}
