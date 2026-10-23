import assert from 'node:assert/strict';
import { test } from 'node:test';
import { probeWebGL } from '../src/lib/webgl';

test('WebGL probe requires WebGL 2 and releases its temporary context', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let released = 0;
  const requests: string[] = [];
  let available = true;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ getContext: (kind: string) => {
      requests.push(kind);
      return available ? { getExtension: () => ({ loseContext: () => released++ }) } : null;
    } }),
  } });
  try {
    assert.equal(probeWebGL(), true);
    assert.equal(released, 1);
    available = false;
    assert.equal(probeWebGL(), false);
    assert.deepEqual(requests, ['webgl2', 'webgl2']);
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
