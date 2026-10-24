import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGraphFlowLoop } from '../src/pages/KnowledgePage/graph-flow-loop';

test('flow has one frame chain, throttles, cancels and resumes without catching up', () => {
  let active = true, serial = 0;
  const queue = new Map<number, FrameRequestCallback>();
  const frames: number[] = [];
  const loop = createGraphFlowLoop({ active: () => active, render: delta => frames.push(delta), request: callback => { queue.set(++serial, callback); return serial; }, cancel: id => { queue.delete(id); } });
  const pump = (time: number) => { const item = queue.entries().next().value; assert.ok(item); queue.delete(item[0]); item[1](time); };
  loop.start(); loop.start(); assert.equal(queue.size, 1);
  pump(0); pump(16); pump(34);
  assert.deepEqual(frames, [0, .034]);
  loop.stop(); assert.equal(queue.size, 0);
  loop.start(); pump(90000); assert.equal(frames.at(-1), 0);
  active = false; pump(90034); assert.equal(queue.size, 0);
  loop.start(); assert.equal(queue.size, 0);
  active = true; loop.start(); pump(99000); assert.equal(frames.at(-1), 0);
  pump(99900); assert.equal(frames.at(-1), .06);
  loop.stop(); assert.equal(queue.size, 0);
});
