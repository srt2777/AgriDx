import { useEffect, useMemo, useState } from 'react';
import { useLang } from '@/hooks/useLang';
import meta from '../../../config/model-registry.json';
export interface ModelRecord {id:string;manufacturer:string;model:string;product:string;category:string;rows:number[]}
let pending:Promise<ModelRecord[]>|undefined;
function loadRecords(){return pending??=fetch('/assets/model-registry/records.json').then(async response=>{
  if(!response.ok)throw new Error('Model registry unavailable');const bytes=await response.arrayBuffer();
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==meta.recordsSha256)throw new Error('Model registry integrity mismatch');
  const rows:ModelRecord[]=JSON.parse(new TextDecoder().decode(bytes));if(rows.length!==meta.models)throw new Error('Model registry count mismatch');return rows;
}).catch(error=>{pending=undefined;throw error;});}
export function ModelRegistry(){
  const lang=useLang(),t=(zh:string,en:string)=>lang==='zh'?zh:en;
  const [records,setRecords]=useState<ModelRecord[]>([]),[error,setError]=useState(false),[revision,setRevision]=useState(0),[query,setQuery]=useState(''),[category,setCategory]=useState(''),[page,setPage]=useState(0);
  useEffect(()=>{let active=true;setError(false);void loadRecords().then(rows=>{if(active)setRecords(rows);}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[revision]);
  const categories=useMemo(()=>[...new Set(records.map(r=>r.category))].sort(),[records]);
  const found=useMemo(()=>records.filter(r=>(!category||r.category===category)&&`${r.manufacturer} ${r.model} ${r.product}`.toLowerCase().includes(query.trim().toLowerCase())),[records,query,category]);
  const pages=Math.max(1,Math.ceil(found.length/20));
  return <section className="wb-panel"><div className="wb-panel-heading"><div><p className="wb-eyebrow">MODEL ARCHIVE</p><h2>{t('公开产品型号档案','Published product model archive')}</h2></div><span className="wb-tag">{meta.models.toLocaleString()} {t('型号','models')}</span></div>
    <p className="wb-notice">{t('来源为官方公布的产品目录，仅核对企业、型号与原表记录；不等同于维修手册、当前证书有效性或整机验证。','Official published product records; not repair manuals, current certificate status or whole-machine validation.')}</p>
    <p className="wb-muted"><a href={meta.sourceUrl} target="_blank" rel="noreferrer">{meta.publisher} · {meta.publishedAt}</a> · {meta.manufacturers} {t('家企业','manufacturers')} · {meta.categories} {t('类产品','categories')} · <a href="/assets/model-registry/jiangsu-2025-3.xls" download>{t('下载原表','Original spreadsheet')}</a></p>
    <div className="wb-form-grid wb-two-fields"><label>{t('搜索型号档案','Search model archive')}<input value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder={t('企业、型号、产品名称','Manufacturer, model, product')}/></label><label>{t('产品类别','Product category')}<select value={category} onChange={e=>{setCategory(e.target.value);setPage(0);}}><option value="">{t('全部类别','All categories')}</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label></div>
    {error?<p role="alert">{t('档案加载或校验失败','Archive load or integrity check failed')} <button onClick={()=>setRevision(v=>v+1)}>{t('重试','Retry')}</button></p>:!records.length?<p role="status">{t('正在校验档案…','Verifying archive…')}</p>:<><p role="status">{found.length.toLocaleString()} {t('条匹配','matches')}</p><div className="wb-table-wrap"><table><thead><tr>{[t('企业','Manufacturer'),t('型号 / 产品','Model / product'),t('类别','Category'),t('原表行号','Source row')].map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{found.slice(page*20,page*20+20).map(r=><tr key={r.id}><td>{r.manufacturer}</td><td><strong>{r.model}</strong><small>{r.product}</small></td><td>{r.category}</td><td><a href={meta.sourceUrl} target="_blank" rel="noreferrer">{meta.sheet} {r.rows.join(', ')}</a></td></tr>)}</tbody></table></div><div className="wb-actions"><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>{t('上一页','Previous')}</button><span>{page+1} / {pages}</span><button disabled={page+1>=pages} onClick={()=>setPage(p=>p+1)}>{t('下一页','Next')}</button></div></>}
  </section>;
}
