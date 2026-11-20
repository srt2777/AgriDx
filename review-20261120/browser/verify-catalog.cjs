const { chromium } = require('playwright-core');
const rows = require('./catalog-4.1.50.json');
(async () => {
  const browser = await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE,headless:true});
  try {
    const page = await browser.newPage();
    await page.goto(process.argv[2] || 'https://agridx-v4-development.orangeglade33.chatgpt.site/');
    await page.getByText('知识库',{exact:true}).first().click();
    await page.waitForFunction(()=>performance.getEntriesByType('resource').some(e=>/\/api-[^/]+\.js$/.test(e.name)));
    const result = await page.evaluate(async rows=>{
      const commit=document.querySelector('meta[name="agridx-build-commit"]').content;
      const urls=performance.getEntriesByType('resource').map(e=>e.name).filter(u=>/\/api-[^/]+\.js$/.test(u));
      let api;
      for(const url of urls){const m=await import(url);if(m.previewFetch){api=m.previewFetch;break;}}
      if(!api)throw Error('开发站知识模块尚未加载');
      const info=await (await api('/api/health')).json();
      const failures=[],cache=new Map();let ok=0;
      for(const row of rows)for(const model of row.models){
        const params=new URLSearchParams({brand:row.brand,model}).toString();
        if(!cache.has(params)){const response=await api('/api/knowledge/catalog?'+params);const d=await response.json();cache.set(params,new Map((d.selected?.entries??[]).map(e=>[e.entryId,e])));}
        const entry=cache.get(params).get(row.entry_id);
        const digest=entry?.content && Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(entry.content))),v=>v.toString(16).padStart(2,'0')).join('');
        if(digest===row.bodyHash && entry.sourceId===row.source_id && entry.locator===row.locator && entry.title===row.title)ok++;
        else failures.push({id:row.entry_id,model,found:!!entry});
      }
      const removed=[3,5,6,10,11,12,15,16].map(n=>'KB-WZ-TSME-'+String(n).padStart(4,'0'));
      const removedVisible=[];
      for(const id of removed){
        const query=new URLSearchParams({collection:'archive',q:id});
        const doc=await (await api('/api/knowledge/catalog?'+query)).json();
        if(!doc.library||doc.library.entries.some(x=>(x.entryId??x.id)===id))removedVisible.push(id);
      }
      return {commit,version:info.version,removedVisible,entries:rows.length,matchedPairs:ok,failedPairs:failures.length,failures};
    },rows);
    console.log(JSON.stringify(result,null,2));
    if (result.failedPairs || result.removedVisible.length) process.exitCode = 1;
  } finally {await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
