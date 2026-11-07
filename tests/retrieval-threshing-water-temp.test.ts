import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadKnowledgeBase, retrieve } from '../server/knowledge/retriever';
import { resolveDiagnosticContext } from '../server/knowledge/conversation';
import { resolveScope } from '../server/knowledge/scope';
import { decideDiagnosisRoute } from '../server/diagnosis/router';

loadKnowledgeBase();

const TRACTOR_LX2204 = { machineType: '拖拉机', brand: '东方红', model: 'LX2204' } as const;
const WATER_TEMP_QUESTION = '东方红 LX2204 拖拉机水温表显示90℃以上，风扇、水箱都正常，可能是什么原因？该怎么排查？';
const THRESHING_QUESTION = '联合收获机收割时脱粒不净、损失大，可能是什么原因？该怎么排查？';

function runDiagnosis(question: string, explicitScope: Record<string, string> = {}) {
  const context = resolveDiagnosticContext([{ role: 'user', content: question }], explicitScope);
  const scope = resolveScope(context.query, context.scope);
  const found = retrieve(context.query, 6, context.scope);
  const decision = decideDiagnosisRoute({
    query: context.query,
    currentQuery: context.currentQuery,
    scope: context.scope,
    retrieved: found,
    clarificationNeeded: context.clarificationNeeded,
    llmConfigured: true,
  });
  return { context, scope, found, decision };
}

test('水温表问题检索到水温条目，机油压力表条目不再出现（2026-11-07 实测回归）', () => {
  const { found, decision } = runDiagnosis(WATER_TEMP_QUESTION, { ...TRACTOR_LX2204 });
  // 正确条目：东方红 LX2004/LX2204《水温表指示异常》，故障表 11 原行号 1。
  assert.equal(found[0]?.entryId, 'KB-YTO-EBUY-LXFL-030');
  assert.ok(found[0]!.relevance!.score >= 8, `水温条目应达到高相关阈值，实际 ${found[0]!.relevance!.score}`);
  // 错位条目：同一来源的《机油压力表显示不正常》与水温症状无关，不得作为证据返回。
  assert.ok(!found.some(chunk => chunk.entryId === 'KB-YTO-EBUY-LXFL-033'),
    'KB-YTO-EBUY-LXFL-033（机油压力表）不得出现在水温表问题的检索结果里');
  assert.deepEqual(decision.directEligibleIds, ['KB-YTO-EBUY-LXFL-030']);
  assert.equal(decision.route, 'local');
  assert.equal(decision.reason, 'direct_reference');
});

test('机油压力表问题仍检索到机油压力表条目（反向回归：修水温不许修坏机油表）', () => {
  const { found } = runDiagnosis('东方红 LX2204 机油压力表显示不正常', { ...TRACTOR_LX2204 });
  assert.equal(found[0]?.entryId, 'KB-YTO-EBUY-LXFL-033');
});

test('“联合收获机”按机型词识别：拖拉机在用时触发机型冲突，不再套用拖拉机资料', () => {
  const { scope, found, decision } = runDiagnosis(THRESHING_QUESTION, { ...TRACTOR_LX2204 });
  assert.equal(scope.identityConflict, true);
  assert.deepEqual(found, []);
  assert.equal(decision.route, 'clarify');
  assert.equal(decision.reason, 'identity_conflict');
  assert.equal(decision.retrievalOutcome, 'no_results');
});

test('“联合收获机”无机型上下文时不属于拖拉机归档，检索不到归档条目', () => {
  const { scope, found, decision } = runDiagnosis(THRESHING_QUESTION, {});
  assert.equal(scope.tractorArchive, false);
  assert.ok(found.every(chunk => !chunk.entryId || chunk.entryType === '通识学习'));
  assert.equal(decision.retrievalOutcome, 'no_results');
});

test('“脱粒不净”在归档中确实无条目：如实无结果，不编造来源', () => {
  const { found } = runDiagnosis(THRESHING_QUESTION, { ...TRACTOR_LX2204 });
  assert.deepEqual(found, []);
});

test('挂接的收获机具不改变当前拖拉机身份（机具例外仍生效）', () => {
  const { scope, found } = runDiagnosis('拖拉机挂接收获机后水温高怎么办？', { ...TRACTOR_LX2204 });
  assert.equal(scope.identityConflict, false);
  assert.equal(scope.tractorArchive, true);
  assert.equal(found[0]?.entryId, 'KB-YTO-EBUY-LXFL-030');
});

test('“配套收获机械”也是机具例外：归档条目本身不得被机型冲突挡掉', () => {
  // 归档条目 KB-WZ-TSME-0374《配套收获机械时加高一级滤清器效果更好》说的
  // 是拖拉机配套收获机具时的滤清器做法；只认“收割机”时它能被检索到，
  // 补上“收获机”后若无配套例外会被误判为机型冲突（knowledge.test.ts 曾因此失败）。
  // 条目本身是五征 TS/ME 系列的，用对应品牌语境提问（东方红语境下五征条目
  // 按品牌隔离本就不应返回，那是另一层正确的过滤，与机型冲突无关）。
  // 型号只给品牌不给具体型号：“TS/ME系列”“TS”这类系列写法在既有模型
  // 分词下匹配不到条目的具体型号（TS800Ⅲ 等），与机型例外无关，不在此测。
  const { scope, found } = runDiagnosis('配套收获机械时加高一级滤清器效果更好', { machineType: '拖拉机', brand: '五征' });
  assert.equal(scope.identityConflict, false);
  assert.equal(scope.tractorArchive, true);
  assert.ok(found.some(chunk => chunk.entryId === 'KB-WZ-TSME-0374'));
});
