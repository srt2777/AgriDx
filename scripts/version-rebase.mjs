import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, main, rootDir } from './lib/process.mjs';
import { nextVersion } from './version-update.mjs';

const names = ['package.json', 'package-lock.json', 'README.md', 'CHANGELOG.md', 'version-batches.json'];
const readAt = (directory, ref, name) => execFileSync('git', ['show', `${ref}:${name}`], { cwd: directory, encoding: 'utf8' });
const normalizeVersion = (name, value) => {
 if (name === 'README.md') return value.replace(/(当前项目版本[：:]\s*\*\*)\d+\.\d+\.\d+(\*\*)/, '$1<VERSION>$2');
 const data = JSON.parse(value); data.version = '<VERSION>'; if (name === 'package-lock.json') data.packages[''].version = '<VERSION>'; return JSON.stringify(data);
};
export function planVersionRebase({ base, main, branch }) {
 for (const name of ['package.json', 'package-lock.json', 'README.md']) if (normalizeVersion(name, base[name]) !== normalizeVersion(name, main[name])) throw new Error(`main 的 ${name} 还包含其他修改，请先人工合并。`);
 const baseLedger = JSON.parse(base['version-batches.json']), mainLedger = JSON.parse(main['version-batches.json']), branchLedger = JSON.parse(branch['version-batches.json']);
 const prefix = baseLedger.batches;
 if (JSON.stringify(mainLedger.batches.slice(0,prefix.length)) !== JSON.stringify(prefix) || JSON.stringify(branchLedger.batches.slice(0,prefix.length)) !== JSON.stringify(prefix)) throw new Error('批次账本历史发生冲突，请人工合并。');
 const mine = branchLedger.batches.slice(prefix.length);
 if (mine.length !== 1) throw new Error('只支持一个本分支新增批次，请人工协调。');
 if (mainLedger.batches.some(item => item.id === mine[0].id)) throw new Error('main 已包含该批次 ID，请人工协调。');
 const baseVersion = JSON.parse(base['package.json']).version;
 const mainVersion = JSON.parse(main['package.json']).version;
 const branchVersion = JSON.parse(branch['package.json']).version;
 if (mine[0].base !== baseVersion || mine[0].version !== branchVersion || mainLedger.batches.at(-1)?.version !== mainVersion) throw new Error('批次基线或版本不一致，请人工协调。');
 if (baseVersion === mainVersion) return { changed:false, version:branchVersion, files:{} };
 const baseHeading = new RegExp(`^##\\s+${baseVersion.replaceAll('.', '\\.')}\\b`, 'm');
 const baseIndex = base['CHANGELOG.md'].search(baseHeading), mainIndex = main['CHANGELOG.md'].search(baseHeading), branchIndex = branch['CHANGELOG.md'].search(baseHeading);
 if ([baseIndex,mainIndex,branchIndex].some(index=>index<0) || main['CHANGELOG.md'].slice(mainIndex) !== base['CHANGELOG.md'].slice(baseIndex)) throw new Error('main 历史日志存在修改，不能安全自动合并。');
 const mainPrefix = main['CHANGELOG.md'].slice(0,mainIndex), firstHeading = mainPrefix.search(/^##\s+\d+\.\d+\.\d+\b/m);
 if (firstHeading < 0) throw new Error('无法定位 main 新增版本节。');
 if (mainPrefix.slice(0, firstHeading) !== base['CHANGELOG.md'].slice(0, baseIndex)) throw new Error('main 日志前言已变化，请人工合并。');
 const additions = mainPrefix.slice(firstHeading);
 const oldHeading = new RegExp(`^##\\s+${branchVersion.replaceAll('.', '\\.')}\\b`, 'm');
 const branchMatch = branch['CHANGELOG.md'].match(oldHeading);
 if (!branchMatch || branchMatch.index >= branchIndex || !branch['CHANGELOG.md'].slice(branchMatch.index,branchIndex).includes(mine[0].id)) throw new Error('无法唯一定位本分支日志节。');
 const version = nextVersion(mainVersion, mine[0].kind);
 const changelog = branch['CHANGELOG.md'].slice(0,branchMatch.index) + branch['CHANGELOG.md'].slice(branchMatch.index,branchIndex).replace(oldHeading, `## ${version}`) + additions + branch['CHANGELOG.md'].slice(branchIndex);
 const pkg=JSON.parse(branch['package.json']), lock=JSON.parse(branch['package-lock.json']); pkg.version=version; lock.version=version; lock.packages[''].version=version;
 const readme=branch['README.md'].replace(/(当前项目版本[：:]\s*\*\*)\d+\.\d+\.\d+(\*\*)/, `$1${version}$2`);
 mainLedger.batches.push({...mine[0],base:mainVersion,version});
 return {changed:true,base:mainVersion,version,batch:mine[0].id,files:{'package.json':JSON.stringify(pkg,null,2)+'\n','package-lock.json':JSON.stringify(lock,null,2)+'\n','README.md':readme,'CHANGELOG.md':changelog,'version-batches.json':JSON.stringify(mainLedger,null,2)+'\n'}};
}
export function rebaseVersion({ directory=rootDir, dryRun=false }={}) {
 const baseRef=execFileSync('git',['merge-base','HEAD','origin/main'],{cwd:directory,encoding:'utf8'}).trim();
 const base=Object.fromEntries(names.map(name=>[name,readAt(directory,baseRef,name)]));
 const main=Object.fromEntries(names.map(name=>[name,readAt(directory,'origin/main',name)]));
 const branch=Object.fromEntries(names.map(name=>[name,readFileSync(path.join(directory,name),'utf8')]));
 const plan=planVersionRebase({base,main,branch});
 if (!dryRun && plan.changed) {
  const written=[]; try { for(const [name,value] of Object.entries(plan.files)){written.push(name);writeFileSync(path.join(directory,name),value);} }
  catch(error){for(const name of written.reverse()) writeFileSync(path.join(directory,name),branch[name]); throw error;}
 }
 const {files,...result}=plan; return {...result,dryRun};
}
if (isMain(import.meta.url)) main(()=>{
 const args=process.argv.slice(2); if(args.length>1 || (args.length===1 && args[0]!=='--dry-run')) throw new Error('用法：version:rebase [--dry-run]');
 console.log(JSON.stringify(rebaseVersion({dryRun:args.includes('--dry-run')})));
},'version:rebase');
