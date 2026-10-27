import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { prepareSite, validateSite } from '../scripts/dev-preview-gateway/prepare-site.mjs';
import { gatewaySourceHash } from '../scripts/dev-preview-gateway/hash.mjs';
import { gatewayHashStatus, gatewayMeetsRequirements } from '../src/dev-preview/gateway-compat';

test('V4 site identity is checked against its own registration', () => {
  const root=mkdtempSync(path.join(tmpdir(),'agridx-site-check-'));const target=path.join(root,'site');
  try {
    mkdirSync(path.join(root,'.openai'),{recursive:true});mkdirSync(path.join(target,'.openai'),{recursive:true});
    const registry=JSON.parse(readFileSync('.openai/development-sites.json','utf8'));
    const v4=registry.sites.find((site:{name:string})=>site.name==='AgriDx v4 开发版');
    assert.ok(v4);writeFileSync(path.join(root,'.openai/development-sites.json'),JSON.stringify(registry));
    writeFileSync(path.join(target,'.openai/hosting.json'),JSON.stringify({project_id:v4.project_id,d1:'DB'}));
    assert.equal(validateSite(root,target,v4.name).site.project_id,v4.project_id);
    assert.throws(()=>validateSite(root,target,'原公开开发站'),/不一致/);
    writeFileSync(path.join(target,'.openai/hosting.json'),JSON.stringify({project_id:v4.project_id,d1:'OTHER'}));
    assert.throws(()=>validateSite(root,target,v4.name),/D1/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test('prepares a registered V4 checkout and preserves existing migrations', () => {
  const temp=mkdtempSync(path.join(tmpdir(),'agridx-v4-prepare-')), root=path.join(temp,'source'), target=path.join(temp,'site');
  const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,stdio:'ignore'});
  try {
    mkdirSync(path.join(root,'.openai'),{recursive:true});mkdirSync(path.join(root,'scripts/dev-preview-gateway'),{recursive:true});mkdirSync(path.join(target,'.openai'),{recursive:true});
    const registry=JSON.parse(readFileSync('.openai/development-sites.json','utf8'));const v4=registry.sites.find((site:{name:string})=>site.name==='AgriDx v4 开发版');
    writeFileSync(path.join(root,'.openai/development-sites.json'),JSON.stringify(registry));writeFileSync(path.join(root,'package.json'),'{"version":"4.0.0"}');
    for(const name of ['worker.js','ai.js','build-worker.mjs','drizzle']) cpSync(path.join('scripts/dev-preview-gateway',name),path.join(root,'scripts/dev-preview-gateway',name),{recursive:true});
    writeFileSync(path.join(target,'.openai/hosting.json'),JSON.stringify({project_id:v4.project_id,d1:'DB'}));
    for(const dir of [root,target]) {git(dir,'init');git(dir,'config','user.email','test@example.invalid');git(dir,'config','user.name','Test');git(dir,'add','.');git(dir,'commit','-m','fixture');}
    const result=prepareSite({directory:root,target,siteName:v4.name}) as {release:{sourceHash:string}};
    assert.match(result.release.sourceHash,/^[a-f0-9]{64}$/);
    assert.ok(readFileSync(path.join(target,'scripts/build-sites-v4.mjs'),'utf8').includes('single-file'));
    execFileSync(process.execPath,[path.join(target,'scripts/build-sites-v4.mjs')],{cwd:target});
    assert.doesNotMatch(readFileSync(path.join(target,'dist/server/index.js'),'utf8'),/^import /m);
    assert.ok(readFileSync(path.join(target,'dist/drizzle/0002_worried_iron_patriot.sql'),'utf8').includes('last_test_ok'));
  } finally { rmSync(temp,{recursive:true,force:true}); }
});
test('gateway compatibility uses schema and capabilities and does not infer source identity', () => {
  const requirement={minimumSchema:2,capabilities:['onboarding','readiness']}, hash=gatewaySourceHash();
  const gateway={gatewayVersion:'1.1.0',schemaVersion:2,capabilities:{onboarding:true,readiness:true},gatewaySourceHash:hash};
  assert.equal(gatewayMeetsRequirements(gateway,requirement),true);assert.equal(gatewayHashStatus(gateway,hash),'match');
  assert.equal(gatewayMeetsRequirements({...gateway,schemaVersion:1},requirement),false);
  assert.equal(gatewayMeetsRequirements({...gateway,capabilities:{onboarding:true}},requirement),false);
  assert.equal(gatewayHashStatus({...gateway,gatewaySourceHash:'b'.repeat(64)},hash),'mismatch');
  assert.equal(gatewayHashStatus(null,hash),'unknown');
});
