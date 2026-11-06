// Test helper (not a test file): boots the real app in an isolated child
// process so a dependency-level crash (e.g. an uncaught exception from
// body-parser) kills only this child, never the test runner.
// Usage: node --import tsx tests/dep-security-server.ts
// Prints `READY <port>` once listening on 127.0.0.1.
import http from 'node:http';
import { createApp } from '../server/app';
import { createServerRuntime } from '../server/runtime';

const app = createApp(createServerRuntime());
const server = http.createServer(app);
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') {
    console.error('dep-security-server: could not determine listen port');
    process.exit(2);
  }
  console.log(`READY ${address.port}`);
});
