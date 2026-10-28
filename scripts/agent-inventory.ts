import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const quote=(value:string)=>value.replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
const routes:string[]=[];
for(const file of [...walk(path.join(root,'server')),...walk(path.join(root,'integrations'))].filter(f=>/\.(ts|mjs)$/.test(f))){
 readFileSync(file,'utf8').split(/\r?\n/).forEach((line,index)=>{
   for(const match of line.matchAll(/\b(?:router|app|memoryRouter)\.(get|post|patch|put|delete|use)\(\s*(['"`])([^'"`]+)\2/g))routes.push(`| ${match[1].toUpperCase()} | ${quote(match[3])} | ${path.relative(root,file)}:${index+1} |`);
 });
}
const front:string[]=[];
for(const file of walk(path.join(root,'src')).filter(f=>/\.(ts|tsx|mjs)$/.test(f))){
 readFileSync(file,'utf8').split(/\r?\n/).forEach((line,index)=>{if(/\bfetch\(|\/api\//.test(line))front.push(`- ${path.relative(root,file)}:${index+1}`);});
}
const sources=JSON.parse(readFileSync('知识库/整理后的知识库/农用拖拉机知识库/sources.json','utf8')) as {document_type?:string;brand:string;model:string}[];
const types=new Map<string,number>();for(const source of sources){const key=source.document_type??'未记录';types.set(key,(types.get(key)??0)+1);}
const text=`# 来源与静态入口盘点\n\n通过 \`node --import tsx scripts/agent-inventory.ts\` 从当前代码生成。路由为代码中的局部路径，需结合父级 mount 前缀；动态路由和字符串拼接不能仅靠静态扫描完整还原。此清单不代表权限审计结论。\n\n## 来源分类\n\n来源记录共 ${sources.length} 条；标签沿用 sources.json，不虚构维修手册或技术通报数量。\n\n| 原始 document_type 标签 | 数量 |\n| --- | --- |\n${[...types].map(([type,count])=>`| ${quote(type)} | ${count} |`).join('\n')}\n\n## Node 路由与挂载\n\n| 方法 | 局部路径 | 代码位置 |\n| --- | --- | --- |\n${routes.join('\n')}\n\n## 前端请求与 API 相关位置\n\n以下为相关源码行索引，包含字符串引用而不只是真实网络调用。\n\n${[...new Set(front)].join('\n')}\n`;
writeFileSync('docs/agent/INVENTORY.md',text);
console.log(`盘点 ${routes.length} 个路由/挂载位置，${front.length} 个前端相关行，${sources.length} 条来源`);
