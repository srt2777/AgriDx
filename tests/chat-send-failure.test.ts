import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyChatSendFailure } from '../src/features/chat/session';

test('chat send failure: transport, timeout, invalid response and abort are distinguished', () => {
  assert.equal(classifyChatSendFailure(new TypeError('Failed to fetch')), 'transport');
  assert.equal(classifyChatSendFailure(new TypeError('NetworkError when attempting to fetch resource.')), 'transport');
  assert.equal(classifyChatSendFailure(new DOMException('Timeout', 'TimeoutError')), 'timeout');
  assert.equal(classifyChatSendFailure(new DOMException('aborted', 'AbortError')), 'aborted');
  assert.equal(classifyChatSendFailure(new Error('Empty chat response')), 'invalid_response');
  assert.equal(classifyChatSendFailure(new Error('Invalid chat response')), 'invalid_response');
  assert.equal(classifyChatSendFailure(new Error('something else')), 'unknown');
  assert.equal(classifyChatSendFailure('not an error'), 'unknown');
});
