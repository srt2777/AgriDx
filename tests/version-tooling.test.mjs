import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateLatestChangelog, validateVersionState } from '../scripts/check-version.mjs';
import { nextVersion } from '../scripts/version-update.mjs';
import { loadVersionPolicy } from '../scripts/version-policy.mjs';
import { updateVersionLog } from '../scripts/version-log.mjs';
import { verifyLive } from '../scripts/version-verify-live.mjs';

const body = (details='改动', verified='已通过测试', deploy='未部署', pr='未记录') => `## 4.0.0\n- 更新类型：maintenance；批次：batch-a。\n\n### 详细改动\n- ${details}\n\n### 知识库变化\n- 未记录\n\n### 兼容性\n- 未记录\n\n### 验证结果\n- ${verified}\n\n### 关联 PR\n- ${pr}\n\n### 部署记录\n- ${deploy}\n\n`;
const ledger = { schema: 1, batches: [{ id: 'batch-a', version: '4.0.0' }] };
test('release checks section contents instead of template headings', () => {
 for (const log of [body('未记录'), body('改动','未记录'), body('改动','未记录\n- 未记录'), body('改动',''), body('改动','测试通过','未记录；待核对'), body('改动','测试通过','未部署','')]) {
  assert.throws(() => validateLatestChangelog(log, ledger, {release:true}), /缺少实际内容/);
  const warnings=[]; validateLatestChangelog(log, ledger, {warn:message=>warnings.push(message)}); assert.equal(warnings.length,1);
 }
 assert.equal(validateLatestChangelog(body(),ledger,{release:true}), '4.0.0');
});
test('policy maximum is loaded from JSON and used for both checks', () => {
 const dir=mkdtempSync(path.join(tmpdir(),'policy-'));
 try { writeFileSync(path.join(dir,'version-policy.json'), JSON.stringify({maxMajor:5,grantedOn:'2026-10-25',note:'test'})); const policy=loadVersionPolicy(dir); assert.equal(nextVersion('4.0.0','breaking',policy),'5.0.0'); const version='5.0.0'; assert.equal(validateVersionState({packageJson:{version},lockJson:{version,packages:{'':{version}}},readme:`当前项目版本：**${version}**`,changelog:`## ${version}`,policy}),version); assert.throws(()=>nextVersion('5.0.0','breaking',policy),/上限/); }
 finally { rmSync(dir,{recursive:true,force:true}); }
});
test('version log changes only requested section and is idempotent', () => {
 const dir=mkdtempSync(path.join(tmpdir(),'version-log-'));
 try { writeFileSync(path.join(dir,'version-batches.json'),JSON.stringify(ledger)); const other='## 3.0.0\n- 原文\n'; writeFileSync(path.join(dir,'CHANGELOG.md'), body('改动','未记录','未部署')+other);
  assert.equal(updateVersionLog({directory:dir,batch:'batch-a',verified:'测试通过'}).changed,true);
  const result=readFileSync(path.join(dir,'CHANGELOG.md'),'utf8'); assert.ok(result.endsWith(other)); assert.match(result,/### 验证结果\s+- 测试通过/);
  assert.equal(updateVersionLog({directory:dir,batch:'batch-a',verified:'测试通过'}).changed,false);
  assert.throws(()=>updateVersionLog({directory:dir,batch:'batch-a',verified:'其他内容'}),/replace/);
  assert.equal(readFileSync(path.join(dir,'CHANGELOG.md'),'utf8'),result);
  assert.throws(()=>updateVersionLog({directory:dir,batch:'missing',pr:'10'}),/批次/);
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('live verification never treats unavailable or inconsistent evidence as success', async () => {
 const sha='a'.repeat(40); const fetcher=async url=>new Response(url.includes('commits/main')?JSON.stringify({sha}):url.includes('workflows')?JSON.stringify({workflow_runs:[{head_sha:sha,status:'completed',conclusion:'success'}]}):url.endsWith('/')?`<meta name="agridx-build-commit" content="${sha}">`:JSON.stringify({version:'4.0.0',commit:sha}));
 assert.equal((await verifyLive({url:'https://example.test',fetcher})).verdict,'已核对一致');
 assert.equal((await verifyLive({url:'https://example.test',fetcher:async()=>{throw Error('offline');}})).verdict,'未验证或不一致');
});

test('rebase coordinates concurrent ledger entries and refuses ambiguous history', async () => {
 const { planVersionRebase } = await import('../scripts/version-rebase.mjs');
 const state = (version, items, sections) => ({
  'package.json': JSON.stringify({version}), 'package-lock.json': JSON.stringify({version,packages:{'':{version}}}),
  'README.md': `当前项目版本：**${version}**`, 'CHANGELOG.md': sections, 'version-batches.json': JSON.stringify({schema:1,batches:items}),
 });
 const past={id:'past',base:'4.0.0',version:'4.0.1',kind:'fix'};
 const theirs={id:'theirs',base:'4.0.1',version:'4.0.2',kind:'fix'};
 const ours={id:'ours',base:'4.0.1',version:'4.0.2',kind:'maintenance'};
 const old='## 4.0.1\n历史\n';
 const base=state('4.0.1',[past],old);
 const main=state('4.0.2',[past,theirs],'## 4.0.2\ntheirs\n'+old);
 const branch=state('4.0.2',[past,ours],'## 4.0.2\nours\n'+old);
 const result=planVersionRebase({base,main,branch});
 assert.equal(result.version,'4.0.3'); assert.match(result.files['CHANGELOG.md'],/## 4\.0\.3\nours\n## 4\.0\.2\ntheirs/);
 assert.deepEqual(JSON.parse(result.files['version-batches.json']).batches.map(x=>x.id),['past','theirs','ours']);
 assert.throws(()=>planVersionRebase({base,main:{...main,'CHANGELOG.md':main['CHANGELOG.md']+'篡改'},branch}),/历史日志/);
 assert.throws(()=>planVersionRebase({base,main,branch:{...branch,'version-batches.json':JSON.stringify({schema:1,batches:[past,ours,ours]})}}));
});
