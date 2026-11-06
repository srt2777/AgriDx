// Test helper (not a test file): isolated child probe for undici fetch paths.
// The undici advisories crash the process even when fetch() rejects, so the
// malicious-upstream cases must run here, never in the test runner process.
// Usage:
//   node --import tsx tests/dep-security-undici-probe.ts \
//     --impl global|undici --case excessive|ok --upstream <url> [--proxy <url>]
// Exit 0 = expected outcome and process survived 800ms afterwards.
// Exit 2 = fetch behaved unexpectedly (wrong status / no rejection).
// Any other exit / signal = the process died (vulnerable behaviour).
import assert from 'node:assert/strict';
import { fetch as patchedFetch, Headers as PatchedHeaders, Request as PatchedRequest, Response as PatchedResponse } from 'undici';
import { initializeEnvironment } from '../server/config/environment';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const impl = arg('--impl');
const testCase = arg('--case');
const upstream = arg('--upstream');
const proxy = arg('--proxy');
if ((impl !== 'global' && impl !== 'undici') || (testCase !== 'excessive' && testCase !== 'ok') || !upstream) {
  console.error('usage: dep-security-undici-probe.ts --impl global|undici --case excessive|ok --upstream <url> [--proxy <url>]');
  process.exit(2);
}

// Exercise the real server initialization with only a local, controlled proxy.
process.env.HTTPS_PROXY = proxy ?? '';
process.env.https_proxy = '';
process.env.HTTP_PROXY = '';
process.env.http_proxy = '';
initializeEnvironment();
assert.equal(globalThis.fetch, patchedFetch);
assert.equal(globalThis.Headers, PatchedHeaders);
assert.equal(globalThis.Request, PatchedRequest);
assert.equal(globalThis.Response, PatchedResponse);

const fetchFn: typeof fetch =
  impl === 'undici' ? (await import('undici')).fetch : globalThis.fetch;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const response = await fetchFn(upstream);
  if (testCase === 'ok') {
    if (response.status !== 200) {
      console.log(`UNEXPECTED STATUS ${response.status}`);
      process.exit(2);
    }
    await response.text();
    console.log('fetch ok: 200');
  } else {
    console.log(`UNEXPECTED SUCCESS status=${response.status}`);
    process.exit(2);
  }
} catch (error) {
  if (testCase === 'ok') {
    console.log(`UNEXPECTED REJECTION: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  console.log(`fetch rejected as expected: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
}

// The undici advisories kill the process asynchronously after the rejection;
// surviving this window is the actual assertion.
await sleep(800);
console.log('SURVIVED');
