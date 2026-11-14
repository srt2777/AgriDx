import { researchKnowledge } from '@shared/research-knowledge';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { requestLiterature, resetLiteratureManifest } from '@/features/knowledge/literature-api';
import type { LiteraturePage } from '@shared/literature';
import './literature.css';

export default function LiteratureBrowser() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '', topic = params.get('topic') ?? '', page = params.get('page') ?? '1';
  const key = new URLSearchParams({q,topic,page}).toString();
  const [draft, setDraft] = useState(q), [revision, setRevision] = useState(0);
  const [state, setState] = useState<{key:string; data?:LiteraturePage; error?:boolean}>({key:''});
  useEffect(()=>setDraft(q),[q]);
  useEffect(()=>{
    const controller = new AbortController(); let active=true;
    setState({key});
    void requestLiterature(new URLSearchParams(key), controller.signal).then(data=>{
      if(active) setState({key,data});
    }).catch(()=>{if(active) setState({key,error:true});});
    return ()=>{active=false;controller.abort();};
  },[key,revision]);
  const data=state.key===key?state.data:undefined;
  function change(values: Record<string,string>) {
    const next = new URLSearchParams({view:'literature',q,topic,...values});
    for(const [name,value] of [...next]) if(!value) next.delete(name);
    setParams(next);
  }
  return <section className="literature-browser" aria-labelledby="literature-title">
    <header><h2 id="literature-title">农业文献归档与研究知识</h2>
      <p>Crossref 文献元数据 · 按 DOI 和标题去重 · 原始标题、作者与期刊信息</p>
      <p className="literature-boundary">用于查找文献。未核验全文、研究结论或实车适用性，不作为维修诊断依据。已按标题筛除通知、编者信息及缺少明确农机主题的记录；保留项仅为农机文献线索，未逐篇核验正文，不计入知识总数。</p>
    </header>
    <details className="literature-research"><summary>故障诊断与维修方向：{researchKnowledge.entries.length} 条正文研究知识（单列统计）</summary>
      <p>来自 {researchKnowledge.sources.length} 篇论文正文；原文位置已对照，未独立复现，不是维修操作规程。元数据归档不等于正文知识。</p>
      {researchKnowledge.entries.map(entry=><article key={entry.entryId}><h3>{entry.title}</h3><p>{entry.claim}</p><p>{entry.scopeBoundary}</p><Link to="/chat" state={{question:`查知识条目：${entry.entryId}`}}>引用知识条目 {entry.entryId}</Link></article>)}
    </details>
    <form className="literature-search" onSubmit={event=>{event.preventDefault();change({q:draft,page:'1'});}}>
      <label htmlFor="literature-q">标题、作者、期刊或 DOI<input id="literature-q" value={draft} maxLength={100} onChange={e=>setDraft(e.target.value)} placeholder="例如 tractor、irrigation、soil；按原文词语搜索" /></label>
      <button type="submit">搜索文献</button>
      <label htmlFor="literature-topic">领域<select id="literature-topic" value={topic} onChange={e=>change({topic:e.target.value,page:'1'})}>
        <option value="">全部领域</option>{(data?.topics??(topic?[topic]:[])).map(value=><option key={value}>{value}</option>)}
      </select></label>
    </form>
    {state.key===key && state.error ? <p role="alert">文献加载失败，尚未显示结果。<button onClick={()=>{resetLiteratureManifest();setRevision(v=>v+1);}}>重试</button></p> : !data ? <p role="status">正在加载文献分片…</p> : <>
      <p role="status">已入库 {data.records.toLocaleString()} 条文献记录，本次匹配 {data.total.toLocaleString()} 条。来源取得时间见各条记录；未下载或核验论文全文。</p>
      <div className="literature-results">{data.entries.map(entry=><article key={entry.id}>
        <span className="literature-tag">文献归档 · {entry.topic}</span>
        <h3><a href={entry.url} target="_blank" rel="noopener noreferrer">{entry.title}</a></h3>
        <p>{entry.journal} · {entry.published.join('-')} · {entry.publisher}</p>
        <p>{entry.authors.slice(0,8).join('；')}{entry.authors.length>8?` 等 ${entry.authors.length} 位作者`:''}</p>
        <p>归档编号：{entry.id} · 正文知识：尚未提炼</p>
        <Link to="/chat" state={{question:`查文献：${entry.doi}`}}>让 Agent 引用此文献</Link>
        <details><summary>来源与核验状态</summary><p>DOI：{entry.doi}</p><p>取得时间：{new Date(entry.retrievedAt).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'})}（北京时间）</p>
          <p>核验范围：来源接口、标识、字段与重复记录校验；不等于专家审核或论文结论验证。</p>
          <p>更正或撤稿状态：未逐篇独立核实，请查看出版社最新记录。{entry.updates.length>0?'来源记录含更新关联，请核对。':''}</p>
          <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">查看 Crossref 原始记录</a>
        </details>
      </article>)}</div>
      {data.total===0 && <p>没有匹配结果。请尝试原文关键词，或切换领域。</p>}
      <nav className="literature-pagination" aria-label="文献分页">
        <button disabled={data.page<=1} onClick={()=>change({page:String(data.page-1)})}>上一页</button>
        <span>第 {data.page.toLocaleString()} / {data.pages.toLocaleString()} 页</span>
        <button disabled={data.page>=data.pages} onClick={()=>change({page:String(data.page+1)})}>下一页</button>
      </nav>
    </>}
  </section>;
}
