import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDsmlToolCalls, stripDsmlMarkup } from '../agent/dsml';

const v4 = `<｜DSML｜tool_calls>
<｜DSML｜invoke name="search_knowledge">
<｜DSML｜parameter name="brand" string="true">东方红</｜DSML｜parameter>
<｜DSML｜parameter name="model" string="true">LX2204</｜DSML｜parameter>
<｜DSML｜parameter name="query" string="true">水温表 冷却水温度 过高 故障表 LXFL 排除方法</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>`;

test('DSML: parses the DeepSeek V4 tool_calls block into a structured call', () => {
  const calls = parseDsmlToolCalls(v4);
  assert.deepEqual(calls, [{ id: 'dsml-1', name: 'search_knowledge',
    input: { brand: '东方红', model: 'LX2204', query: '水温表 冷却水温度 过高 故障表 LXFL 排除方法' } }]);
});

test('DSML: parses the V4.1 spaced variant and the ASCII-pipe variant', () => {
  const v41 = `<｜DSML｜ calls>
<｜DSML｜ invoke name="calculator">
<｜DSML｜ parameter name="expression" string="true">2+2</｜DSML｜ parameter>
</｜DSML｜ invoke>
</｜DSML｜ calls>`;
  assert.deepEqual(parseDsmlToolCalls(v41), [{ id: 'dsml-1', name: 'calculator', input: { expression: '2+2' } }]);
  const ascii = `<|DSML|tool_calls><|DSML|invoke name="get_current_time"><|DSML|parameter name="zone" string="true">Asia/Shanghai</|DSML|parameter></|DSML|invoke></|DSML|tool_calls>`;
  assert.deepEqual(parseDsmlToolCalls(ascii), [{ id: 'dsml-1', name: 'get_current_time', input: { zone: 'Asia/Shanghai' } }]);
});

test('DSML: string="false" parameters are JSON, CDATA values are unwrapped', () => {
  const block = `<｜DSML｜tool_calls><｜DSML｜invoke name="calculator"><｜DSML｜parameter name="values" string="false">[1, 2]</｜DSML｜parameter><｜DSML｜parameter name="note" string="true"><![CDATA[hello]]></｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>`;
  assert.deepEqual(parseDsmlToolCalls(block), [{ id: 'dsml-1', name: 'calculator', input: { values: [1, 2], note: 'hello' } }]);
});

test('DSML: malformed blocks return null instead of a half-parsed call', () => {
  assert.equal(parseDsmlToolCalls('plain answer, no markup'), null);
  assert.equal(parseDsmlToolCalls('<｜DSML｜tool_calls><｜DSML｜invoke name="search_knowledge">'), null);
  const badJson = `<｜DSML｜tool_calls><｜DSML｜invoke name="calculator"><｜DSML｜parameter name="values" string="false">[1,</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>`;
  assert.equal(parseDsmlToolCalls(badJson), null);
  const many = `<｜DSML｜tool_calls>${Array.from({ length: 5 }, (_, i) => `<｜DSML｜invoke name="calculator"><｜DSML｜parameter name="expression" string="true">${i}</｜DSML｜parameter></｜DSML｜invoke>`).join('')}</｜DSML｜tool_calls>`;
  assert.equal(parseDsmlToolCalls(many), null);
});

test('DSML: stripping removes the whole call block including parameter values, keeps prose', () => {
  const mixed = `可能原因尚待检查验证。\n\n${v4}\n\n先记录已经观察到的报警文字。`;
  const stripped = stripDsmlMarkup(mixed);
  assert.doesNotMatch(stripped, /DSML|search_knowledge|东方红|LX2204|故障表/);
  assert.match(stripped, /可能原因尚待检查验证/);
  assert.match(stripped, /先记录已经观察到的报警文字/);
  assert.equal(stripDsmlMarkup(v4), '');
  assert.equal(stripDsmlMarkup('plain answer'), 'plain answer');
});
