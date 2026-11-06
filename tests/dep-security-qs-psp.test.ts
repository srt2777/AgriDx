/**
 * PR1 依赖安全：qs 与 postcss-selector-parser 兼容升级回归测试。
 *
 * - qs@6.16.0: GHSA-6pq8-jhm2-2vcw，arrayFormat 'comma' 下对含不可调用
 *   自有 toString 的数组元素调用 stringify 会抛未捕获 TypeError；
 *   修复于 6.16.1，随 body-parser 2.4.0 的 qs ^6.16.1 约束自动带入。
 * - postcss-selector-parser@6.0.10: GHSA-rj75-hqrm-r3gf，扁平选择器
 *   解析二次复杂度可致 CPU 耗尽；修复于 6.1.5 / 7.1.6。注意
 *   @tailwindcss/typography 0.5.20 将其精确锁定为 6.0.10，常规升级
 *   无法移动，需用 package.json overrides 固定到同大版本修复版 6.1.5。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import qs from 'qs';
import selectorParser from 'postcss-selector-parser';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function installedVersion(packageName: string): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'node_modules', packageName, 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

function parseSemver(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  return [major, minor, patch];
}

test('qs 版本 >= 6.16.1（GHSA-6pq8-jhm2-2vcw 修复线）', () => {
  const version = installedVersion('qs');
  const [major, minor, patch] = parseSemver(version);
  assert.ok(major > 6 || (major === 6 && (minor > 16 || (minor === 16 && patch >= 1))), `qs ${version} must be >= 6.16.1`);
});

test('GHSA-6pq8-jhm2-2vcw：comma 格式下含不可调用 toString 的数组元素不再抛错', () => {
  const output = qs.stringify({ a: [{ toString: 42 }] }, { arrayFormat: 'comma' });
  assert.equal(typeof output, 'string');
  const output2 = qs.stringify({ a: ['x', { toString: 'not-a-function' }] }, { arrayFormat: 'comma' });
  assert.equal(typeof output2, 'string');
});

test('qs 常规 comma 序列化行为不变', () => {
  assert.equal(qs.stringify({ a: ['x', 'y'] }, { arrayFormat: 'comma' }), 'a=x%2Cy');
  assert.equal(qs.stringify({ a: ['x', 'y'] }, { arrayFormat: 'comma', encode: false }), 'a=x,y');
});

test('postcss-selector-parser 版本处于修复线（6.x >= 6.1.5 或 7.x >= 7.1.6）', () => {
  const version = installedVersion('postcss-selector-parser');
  const [major, minor, patch] = parseSemver(version);
  const fixed = (major === 6 && (minor > 1 || (minor === 1 && patch >= 5))) ||
    (major === 7 && (minor > 1 || (minor === 1 && patch >= 6))) ||
    major > 7;
  assert.ok(fixed, `postcss-selector-parser ${version} must be >= 6.1.5 (6.x) or >= 7.1.6 (7.x)`);
});

test('postcss-selector-parser：扁平选择器列表与 typography 风格选择器可正常解析', () => {
  const flat = Array.from({ length: 300 }, (_, i) => `.c${i}`).join(', ');
  const root = selectorParser().astSync(flat);
  assert.equal(root.nodes.length, 300);
  const typography = selectorParser().astSync('.prose :where(h1):not(:where([class~="not-prose"]))');
  assert.equal(typography.nodes.length, 1);
});
