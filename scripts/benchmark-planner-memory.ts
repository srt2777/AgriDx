import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { planDiagnosticTurn } from '../server/diagnosis/plannerIntegration';
import { MemoryStore } from '../server/memory/store';

// Separate synthetic sessions with a real temporary WAL database. Seed history
// outside the timed operation; no real data, retrieval, HTTP, LLM or tools.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agridx-planner-memory-bench-'));
const filename = path.join(dir, 'memory.sqlite');
const store = new MemoryStore(filename);
const seedDb = new DatabaseSync(filename);
const lengths = [1, 20, 100, 400];
const sampleCount = 30;
const scope = { machineType: '拖拉机', brand: '东方红', model: 'LF1504' };
const topicRoot = '拖拉机旋耕时水温过高';
const results = [];
try {
  const insert = seedDb.prepare('INSERT INTO memory_messages(session_id, payload) VALUES(?, ?)');
  const update = seedDb.prepare('UPDATE memory_sessions SET revision = ? WHERE id = ?');
  for (const turns of lengths) {
    const sessionReads: number[] = [], reads: number[] = [], baseWrites: number[] = [], writes: number[] = [];
    for (let i = 0; i < sampleCount; i++) {
      const owner = `synthetic-${turns}-${i}`;
      const device = store.saveDevice(owner, { name: '合成设备', ...scope, hours: null, notes: '' });
      const session = store.createSession(owner, device.id);
      const planned = planDiagnosticTurn({ sessionId: session.id, sessionSeed: '0123456789abcdef0123456789abcdef', deviceId: device.id, revision: 0, topicRoot,
        currentQuery: topicRoot, scope, context: { routerInput: { query: topicRoot, currentQuery: topicRoot, scope,
          retrieved: [], clarificationNeeded: false, requestedMode: 'knowledge_only', llmConfigured: false } } });
      const checkpoint = planned.commit.checkpoint;
      if (!checkpoint) throw new Error('Synthetic planner fixture missing checkpoint');
      store.appendTurn(owner, session.id, 0, topicRoot, { content: '合成回答' }, [], planned.commit);
      // Match the production shape: every previous turn contains user text and
      // an assistant snapshot. Fixtures are synthetic and contain no identifiers.
      seedDb.exec('BEGIN IMMEDIATE');
      try {
        for (let turn = 1; turn < turns; turn++) {
          insert.run(session.id, JSON.stringify({ id: `u${turn}`, role: 'user', content: '合成反馈', createdAt: '2000-01-01' }));
          insert.run(session.id, JSON.stringify({ id: `a${turn}`, role: 'assistant', content: '合成回答', createdAt: '2000-01-01', _plannerCheckpoint: checkpoint }));
        }
        update.run(turns, session.id);
        seedDb.exec('COMMIT');
      } catch (error) { seedDb.exec('ROLLBACK'); throw error; }
      let start = performance.now();
      store.session(owner, session.id);
      sessionReads.push(performance.now() - start);
      start = performance.now();
      const restored = store.plannerCheckpoint(owner, session.id);
      reads.push(performance.now() - start);
      if (!restored) throw new Error('Synthetic checkpoint did not restore');
      start = performance.now();
      store.appendTurn(owner, session.id, turns, '合成反馈', { content: '合成回答' });
      baseWrites.push(performance.now() - start);
      start = performance.now();
      store.appendTurn(owner, session.id, turns + 1, '合成反馈', { content: '合成回答' }, [], {
        previous: { episodeId: restored.state.episodeId, planVersion: restored.state.planVersion }, checkpoint: restored,
      });
      writes.push(performance.now() - start);
    }
    const metrics = (samples: number[]) => {
      samples.sort((a, b) => a - b);
      const quantile = (q: number) => Number(samples[Math.ceil(samples.length * q) - 1].toFixed(4));
      return { p50Ms: quantile(.5), p95Ms: quantile(.95), maxMs: quantile(1) };
    };
    const pairedAdditionalAppend = writes.map((duration, index) => duration - baseWrites[index]);
    results.push({ historyTurns: turns, samples: sampleCount, sessionRead: metrics(sessionReads), checkpointRead: metrics(reads),
      plainAppend: metrics(baseWrites), plannerAppend: metrics(writes), pairedAdditionalAppend: metrics(pairedAdditionalAppend) });
  }
  console.log(JSON.stringify({ testType: 'Synthetic temporary SQLite WAL checkpoint read and atomic transcript append; no retrieval, HTTP, LLM, tools or vehicle',
    node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model,
    note: 'History is seeded outside measured operations; each sample uses a separate synthetic session. Plain append is followed by Planner append (one extra turn); no warmup. Individual p95 differences are not p95 overhead; paired additional times still include one extra turn and measurement noise.',
    results, processMaxRssKiB: process.resourceUsage().maxRSS }, null, 2));
} finally {
  seedDb.close(); store.close(); fs.rmSync(dir, { recursive: true, force: true });
}
