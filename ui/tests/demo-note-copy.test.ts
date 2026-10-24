import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { demoNoteCopy } from '../src/lib/demo-note-copy';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('关于演示的中英文条数一致，并区分示例数据与已索引资料', () => {
  const zh = demoNoteCopy('zh');
  const en = demoNoteCopy('en');
  assert.equal(zh.points.length, en.points.length);
  assert.match(zh.points[0], /示例数据/);
  assert.match(zh.points[0], /不是在线机队/);
  assert.match(en.points[0], /example data/i);
  assert.match(en.points[0], /not a live fleet/i);
  assert.match(zh.points[2], /传感器/);
  assert.match(en.points[2], /Sensors/);
  const motif = readFileSync(path.join(root, 'ui/src/wheat-motif.css'), 'utf8');
  assert.match(motif, /--wheat-ear/);
  assert.match(motif, /svg\.lucide/);
});
