// Chromium CDP checks; runs against the explicitly simulated QA server, not production.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const [label='after',port='4411']=process.argv.slice(2);
if(!['before','after'].includes(label) || !/^\d{4,5}$/.test(port)) throw new Error('Use before/after and a local port.');
const output=path.resolve(process.env.CHAT_QA_OUTPUT_DIR || path.join(os.tmpdir(),'agridx-chat-reading-qa'));
await fs.mkdir(output,{recursive:true});
const cdpPort=Number(process.env.CHAT_QA_CDP_PORT || 9228);const after=label==='after';const origin=`http://127.0.0.1:${port}`;
const pages=await(await fetch(`http://127.0.0.1:${cdpPort}/json`)).json();
const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let seq=0;const pending=new Map();const errors=[];
ws.addEventListener('message',e=>{const v=JSON.parse(e.data);if(v.method==='Runtime.exceptionThrown')errors.push(v.params.exceptionDetails.exception?.description||v.params.exceptionDetails.text);if(v.id){const p=pending.get(v.id);pending.delete(v.id);v.error?p.reject(v.error):p.resolve(v.result);}});
const cmd=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const ev=async(expression)=>{const r=await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=async(expression)=>{for(let i=0;i<200;i++){if(await ev('Boolean('+expression+')'))return;await new Promise(r=>setTimeout(r,150));}throw new Error('Timeout: '+expression);};
const input=async(selector,value)=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await cmd('Runtime.enable');await cmd('Page.enable');await cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await cmd('Page.navigate',{url:origin+'/#/chat'});
await wait(`!!document.querySelector('textarea[aria-label="故障描述"]')`);
await ev(`localStorage.clear();localStorage.setItem('agridx-ui-version','new');location.reload()`);
await wait(`!!document.querySelector('input[aria-label="品牌"]') && !document.querySelector('input[aria-label="品牌"]').disabled`);
errors.length=0;
await input('input[aria-label="品牌"]','东方红');await input('input[aria-label="型号"]','LF1504');
const initialCalls=after ? JSON.parse(await fs.readFile(path.join(output,`${label}-calls.json`),'utf8').catch(()=>' {"calls":0}')).calls : 0;
await input('textarea[aria-label="故障描述"]','东方红 LF1504 旋耕时水温过高是什么原因');await ev(`document.querySelector('button[aria-label="发送"]').click()`);
await wait(`document.querySelectorAll('.chat-answer').length===1 && !document.querySelector('button[aria-label="停止等待"]')`);
await wait(`document.querySelector('.chat-answer h2') && document.querySelector('.chat-answer strong')`);
assert.match(await ev(`document.querySelector('.chat-answer').innerText`),/散热器外部受阻/);
const measurements=[]; const modeResults=[]; const stressResults=[];
if(after){
 const first=await ev(`JSON.parse(localStorage.getItem('__app_srt27_chat_history')).at(-1)`);
 const calls=JSON.parse(await fs.readFile(path.join(output,`${label}-calls.json`))).calls;
 assert.equal(first.coordination.requestedMode,'auto');assert.equal(first.provider,'deepseek');assert.equal(calls-initialCalls,1);
 modeResults.push({mode:'auto',provider:first.provider,externalAttempts:calls-initialCalls,requestedMode:first.coordination.requestedMode});
}
for(const [name,width,height,mobile] of [['desktop',1440,1000,false],['mobile',390,844,true],['small',320,740,true]]) {
 await cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
 if(mobile && await ev(`document.querySelector('[aria-controls="chat-machine-context"]').getAttribute('aria-expanded')==='true'`))await ev(`document.querySelector('[aria-controls="chat-machine-context"]').click()`);
 await ev(`document.querySelector('[role="log"]').scrollTop=0`);await new Promise(r=>setTimeout(r,300));
 const m=await ev(`(()=>{const p=document.querySelector('.chat-answer .prose p')||document.querySelector('.chat-answer p');const h=document.querySelector('.chat-answer h2');const u=document.querySelector('.chat-message.is-user .whitespace-pre-wrap');const box=document.querySelector('textarea[aria-label="故障描述"]');const c=getComputedStyle(p);return {width:innerWidth,pageWidth:document.documentElement.scrollWidth,body:parseFloat(c.fontSize),lineHeight:parseFloat(c.lineHeight),font:c.fontFamily,heading:parseFloat(getComputedStyle(h).fontSize),user:parseFloat(getComputedStyle(u).fontSize),input:parseFloat(getComputedStyle(box).fontSize),inputBottom:box.getBoundingClientRect().bottom,bodyWidth:p.getBoundingClientRect().width,paragraphMargin:parseFloat(getComputedStyle(p.nextElementSibling||p).marginTop),markdown:{paragraphs:document.querySelectorAll('.chat-answer .prose p').length,strong:document.querySelectorAll('.chat-answer strong').length,ordered:document.querySelectorAll('.chat-answer ol').length,unordered:document.querySelectorAll('.chat-answer ul').length},answer:document.querySelector('.chat-answer').innerText}})()`);
 if(after){assert.equal(m.body,width>=768?17:16);assert.ok(Math.abs(m.lineHeight/m.body-1.7)<0.02);assert.equal(m.heading,width>=768?20:18);assert.ok(m.paragraphMargin>=12);assert.ok(m.user>=16);assert.ok(m.input>=16);assert.ok(m.pageWidth<=width+1);assert.ok(m.bodyWidth<=752);assert.ok(m.inputBottom<=height+1);assert.ok(m.markdown.paragraphs>=3&&m.markdown.strong>=3&&m.markdown.ordered>=1&&m.markdown.unordered>=1);assert.doesNotMatch(m.answer,/命中|协调|评分|TK-\d|检索\d/);}
 measurements.push({name,...m});
 if(name!=='small')await fs.writeFile(path.join(output,`${label}-${name}.png`),Buffer.from((await cmd('Page.captureScreenshot',{format:'png'})).data,'base64'));
}
if(after){
 assert.equal(await ev(`document.querySelector('.chat-evidence').open`),false);
 assert.equal(await ev(`document.querySelector('.chat-answer').contains(document.querySelector('.chat-evidence'))`),false);
 const evidenceCalls=JSON.parse(await fs.readFile(path.join(output,`${label}-calls.json`))).calls;
 await ev(`document.querySelector('.chat-evidence').open=true`);
 assert.match(await ev(`document.querySelector('.chat-evidence').innerText`),/SIMULATED-NOT-A-REAL-MODEL/);
 assert.match(await ev(`document.querySelector('.chat-evidence').innerText`),/适用范围|型号|来源/);
 await ev(`document.querySelector('.chat-evidence').open=false`);
 assert.equal(JSON.parse(await fs.readFile(path.join(output,`${label}-calls.json`))).calls,evidenceCalls);

 await cmd('Browser.grantPermissions',{origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});await cmd('Page.bringToFront');
 await ev(`document.querySelector('button[aria-label="复制回答"]').click()`);
 await wait(`document.querySelector('.chat-answer-actions').innerText.includes('已复制')`);
 const copied=await ev(`navigator.clipboard.readText()`);assert.match(copied,/散热器外部受阻/);assert.doesNotMatch(copied,/TK-\d|SIMULATED|检索\d/);
 const count=async()=>JSON.parse(await fs.readFile(path.join(output,`${label}-calls.json`))).calls;
 let expected=1;
 for(const mode of ['knowledge_only','ai_assisted']){
  const beforeCalls=await count();
  await ev(`(()=>{const e=document.querySelector('#diagnosis-mode');e.value=${JSON.stringify(mode)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await input('textarea[aria-label="故障描述"]','仍是东方红 LF1504 旋耕时水温过高，轻负荷时正常。');
  await ev(`document.querySelector('button[aria-label="发送"]').click()`);expected++;
  await wait(`document.querySelectorAll('.chat-answer').length===${expected} && !document.querySelector('button[aria-label="停止等待"]')`);
  const last=await ev(`JSON.parse(localStorage.getItem('__app_srt27_chat_history')).at(-1)`);
  assert.equal(last.coordination.requestedMode,mode);
  const afterCalls=await count();assert.equal(afterCalls-beforeCalls,mode==='knowledge_only'?0:1);
  assert.equal(last.provider,mode==='knowledge_only'?'knowledge-base':'deepseek');
  modeResults.push({mode,provider:last.provider,externalAttempts:afterCalls-beforeCalls,requestedMode:last.coordination.requestedMode});
 }
 await input('textarea[aria-label="故障描述"]','排版测试');await ev(`document.querySelector('button[aria-label="发送"]').click()`);
 await wait(`document.querySelectorAll('.chat-answer').length===4 && !!document.querySelector('.chat-answer:last-of-type') && [...document.querySelectorAll('.chat-markdown')].at(-1).innerText.includes('长回答排版样本')`);
 await wait(`[...document.querySelectorAll('.chat-markdown')].at(-1).querySelector('table')`);
 for(const [width,height,mobile] of [[1440,1000,false],[320,740,true]]){
  await cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
  const stress=await ev(`(()=>{const a=[...document.querySelectorAll('.chat-markdown')].at(-1);return {fixture:'SYNTHETIC layout-only, not model accuracy',characters:a.innerText.length,paragraphs:a.querySelectorAll('p').length,width:innerWidth,pageWidth:document.documentElement.scrollWidth,overflow:[a,...a.querySelectorAll('*')].filter(e=>e.clientWidth>0 && e.scrollWidth>e.clientWidth+2).map(e=>e.tagName),table:!!a.querySelector('table'),code:!!a.querySelector('pre')}})()`);
  assert.ok(stress.characters>3000);assert.ok(stress.paragraphs>=22);assert.ok(stress.pageWidth<=width+1);assert.deepEqual(stress.overflow,[]);assert.ok(stress.table&&stress.code);stressResults.push(stress);
 }
 // Restore the same conversation under the classic shell, whose global reset is intentionally 14px.
 for(const [width,height,mobile] of [[1440,1000,false],[390,844,true]]){
  await cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
  await ev(`localStorage.setItem('agridx-ui-version','old');location.reload()`);
  await wait(`document.querySelector('.classic-version-shell') && document.querySelector('.chat-markdown h2')`);
  const classic=await ev(`(()=>{const p=document.querySelector('.chat-markdown p');return {body:parseFloat(getComputedStyle(p).fontSize),heading:parseFloat(getComputedStyle(document.querySelector('.chat-markdown h2')).fontSize),input:parseFloat(getComputedStyle(document.querySelector('textarea[aria-label="故障描述"]')).fontSize),width:innerWidth,pageWidth:document.documentElement.scrollWidth}})()`);
  assert.equal(classic.body,width>=768?17:16);assert.equal(classic.heading,width>=768?20:18);assert.ok(classic.input>=16);assert.ok(classic.pageWidth<=width+1);measurements.push({name:'classic',...classic});
 }
}
assert.deepEqual(errors,[]);
await fs.writeFile(path.join(output,`${label}-browser.json`),JSON.stringify({testType:'Actual Chromium + local production build + HTTP, simulated provider; not real model acceptance',passed:true,measurements,copyTested:after,evidenceTested:after,modeResults,stressResults,errors},null,2));
console.log(JSON.stringify(measurements.map(({answer,...m})=>m),null,2));ws.close();
