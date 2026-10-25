// Local QA only: injected simulated provider, temporary memory; no external model request.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
const root=process.cwd(); const port=Number(process.argv[2] || 4411); const label=process.argv[3] || 'after';
const output=path.resolve(process.env.CHAT_QA_OUTPUT_DIR || path.join(os.tmpdir(),'agridx-chat-reading-qa'));
if(!Number.isInteger(port) || port<1024 || port>65535 || !['before','after'].includes(label)) throw new Error('Use a local port and before/after label.');
fs.mkdirSync(output,{recursive:true});
const local=(file)=>import(pathToFileURL(path.join(root,file)).href);
const {createApp}=await local('server/app.ts');
const {attachFrontend}=await local('server/http/frontend.ts');
const {createDiagnosticService}=await local('server/diagnosis/service.ts');
const {loadKnowledgeBase,stats}=await local('server/knowledge/retriever.ts');
const {getKnowledgeCatalog}=await local('server/knowledge/catalog.ts');
const {MemoryStore}=await local('server/memory/store.ts');
process.env.ALLOW_EXTERNAL_AI='true';process.env.DIAGNOSIS_MODE='auto';process.env.DIAGNOSIS_LOG_DECISIONS='false';
loadKnowledgeBase();let calls=0;
const answer=`旋耕时水温升高，可能是作业负荷增加后，冷却系统的散热能力跟不上。需要结合现场观察区分原因，不能仅凭水温高就判断水泵损坏。

## 可能的原因

- **散热器外部受阻**：田间草屑或尘土遮挡表面时，空气通过散热器会受到影响。这只是需要核实的方向。
- **冷却系统状态异常**：冷却液不足或循环异常也可能出现类似现象，需要由合格人员依据适用资料检查，不能据此决定换件。
- **作业负荷偏大**：如果只在持续旋耕时出现，而轻负荷时没有相同现象，负荷变化和散热条件值得一起核对。

### 先做安全观察

1. 按本机规程安全停机并完全冷却后，仅从外部查看散热器表面有无草屑遮挡；不要触碰风扇，不拆洗或加液。
2. 记录已有的报警原文、发生工况及已经观察到的变化，不必为了补充信息再次试车。

> 不要在热机或带压时打开冷却系统盖，也不要靠近高温蒸汽。出现明显危险征兆时停止作业，联系合格维修人员。

轻负荷时是否也出现？仪表有没有报警原文？`;
const provider={hasAnyConfigured:()=>true,chat:async()=>{calls++;fs.writeFileSync(path.join(output,`${label}-calls.json`),JSON.stringify({testType:'SIMULATED provider, actual local HTTP and archive',calls},null,2));return{result:{provider:'deepseek',model:'SIMULATED-NOT-A-REAL-MODEL',content:answer},primary:'deepseek',fellBack:false,attempts:1}}};
const store=new MemoryStore(path.join(output,`${label}.sqlite`));
const diagnosis=createDiagnosticService(provider,{config:{logDecisions:false}});
const diagnose=async(...args)=>{
  const request=args[0];
  if(request?.history?.at(-1)?.content==='排版测试'){
    const paragraph='这是仅用于阅读与换行验收的合成段落，不代表维修事实或模型判断。段落之间应有清晰间距，中文与English mixed content应能自然换行。';
    const long='layoutFixture'.repeat(32);
    const content='## 长回答排版样本\n\n'+Array.from({length:22},(_,i)=>`### 段落 ${i+1}\n\n${paragraph}\n\n- **观察记录**：仅为排版样本。\n- 保留列表间距。`).join('\n\n')+'\n\n| 项目 | 长字符串 |\n| --- | --- |\n| 合成值 | '+long+' |\n\n```text\n'+long+'\n```\n\nhttps://example.invalid/'+long;
    return {choices:[{message:{role:'assistant',content}}],diagnosticReply:{understanding:'仅用于排版验收',supportLevel:'none',sourceNote:'合成布局样本，无真实来源',causes:[],suggestions:[],questions:[],aiSupplement:content},model:'SIMULATED-LAYOUT-FIXTURE',provider:'deepseek',answerMode:'general-guidance',fellBack:false,knowledgeChunks:0,knowledgeSources:[]};
  }
  return diagnosis(...args);
};
const app=createApp({rootDirectory:root,version:'ui-reading-test',diagnose,getKnowledgeStats:stats,getLlmStatus:()=>({configured:true,primary:'deepseek',preference:'deepseek',configValid:true,proxyConfigured:false,providers:[{provider:'deepseek',configured:true,model:'SIMULATED-NOT-A-REAL-MODEL'}]}),getCatalog:getKnowledgeCatalog,getMemoryStore:()=>store});
await attachFrontend(app);app.listen(port,'127.0.0.1',()=>console.log(`SIMULATED provider ${label} port ${port}; pid ${process.pid}`));
