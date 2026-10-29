import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DeviceProfile, MemoryDevice, MemoryMessage, MemoryOverview, MemorySession, SessionDetail, PriorDeviceReport } from '../../shared/memory';
import type { PlannerState } from '../../agent/planner/types';
import { canonical, createPlan, identifier, PLANNER_LIMITS, scopeKey } from '../../agent/planner/reducer';

import { MemoryError, summarizeReports } from '../../shared/memory-validation';
export { MemoryError, validId, profileFrom, summarizeReports } from '../../shared/memory-validation';

/** Private server-side data, never accepted from a chat client or returned with messages. */
export interface PlannerCheckpoint {
  sessionId: string;
  deviceId: string;
  topicKey: string;
  /** Original fault text, bound to this episode and hidden with the checkpoint. */
  topicRoot?: string;
  /** Pending topic/step disambiguation; server-owned, never exposed to clients. */
  topicPending?: 'topic' | 'step';
  state: PlannerState;
}
export interface PlannerCheckpointCommit {
  checkpoint: PlannerCheckpoint | null;
  previous: { episodeId: string; planVersion: number } | null;
}
type StoredMessage = MemoryMessage & { _plannerCheckpoint?: PlannerCheckpoint | null; _plannerTurnEventId?: string };
const MAX_CHECKPOINT_BYTES = 1024 * 1024;

/** Check stored data before it can enter the rule engine; SQLite is not a trusted schema validator. */
function validCheckpoint(value: unknown, sessionId: string, deviceId: string): value is PlannerCheckpoint {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_CHECKPOINT_BYTES) return false;
    const checkpoint = value as PlannerCheckpoint, state = checkpoint.state;
    if (checkpoint.sessionId !== sessionId || checkpoint.deviceId !== deviceId || typeof checkpoint.topicKey !== 'string' ||
        !checkpoint.topicKey.trim() || checkpoint.topicKey.length > 500 ||
        (checkpoint.topicRoot !== undefined && (typeof checkpoint.topicRoot !== 'string' || !checkpoint.topicRoot.trim() || checkpoint.topicRoot.length > 2000)) ||
        (checkpoint.topicPending !== undefined && !['topic', 'step'].includes(checkpoint.topicPending)) || !state || state.schemaVersion !== 1 ||
        !Number.isSafeInteger(state.planVersion) || state.planVersion < 1 || state.planVersion > 4096 ||
        !['active', 'awaiting_user', 'paused', 'resolved_reported', 'escalated', 'cancelled', 'exhausted'].includes(state.status) ||
        state.scopeKey !== scopeKey(state.scope)) return false;
    const template = createPlan({ planId: state.planId, episodeId: state.episodeId, scope: state.scope, steps: state.steps, evidence: state.evidence,
      budget: { maxActions: state.budget.maxActions, maxNoProgress: state.budget.maxNoProgress } });
    if (state.steps.some((step, i) => step.id !== template.steps[i].id || typeof step.scopeKey !== 'string' || step.scopeKey.length > 10000 ||
        !['pending', 'awaiting_user', 'reported', 'observed', 'invalidated'].includes(step.status))) return false;
    if (!Number.isInteger(state.budget.issuedActions) || state.budget.issuedActions < 0 || state.budget.issuedActions > state.budget.maxActions ||
        !Number.isInteger(state.budget.noProgress) || state.budget.noProgress < 0 || state.budget.noProgress > 4096) return false;
    if (!Array.isArray(state.askedKeys) || state.askedKeys.length > PLANNER_LIMITS.actions ||
        state.askedKeys.some(key => typeof key !== 'string' || key.length > 20000) ||
        !Array.isArray(state.audit) || state.audit.length > PLANNER_LIMITS.audit ||
        !state.acceptedEvents || typeof state.acceptedEvents !== 'object' || Array.isArray(state.acceptedEvents) ||
        Object.keys(state.acceptedEvents).length > PLANNER_LIMITS.events ||
        !state.observations || typeof state.observations !== 'object' || Array.isArray(state.observations) ||
        Object.keys(state.observations).length > PLANNER_LIMITS.steps) return false;
    for (const [id, signature] of Object.entries(state.acceptedEvents)) { identifier(id); if (typeof signature !== 'string' || signature.length > 20000) return false; }
    for (const [slot, observation] of Object.entries(state.observations)) {
      const step = state.steps.find(item => item.expectedObservation.slot === slot);
      if (!step || !observation || observation.stepId !== step.id || observation.slot !== slot || observation.verification !== 'unverified' ||
          !['user_report', 'tool_result', 'simulated'].includes(observation.source) ||
          typeof observation.scopeKey !== 'string' || observation.scopeKey.length > 10000 ||
          typeof observation.basisKey !== 'string' || observation.basisKey.length > 20000 ||
          !(observation.value === null || typeof observation.value === 'boolean' || typeof observation.value === 'string' && observation.value.length <= 400 ||
            typeof observation.value === 'number' && Number.isFinite(observation.value))) return false;
      identifier(observation.eventId); if (observation.corrects !== undefined) identifier(observation.corrects);
    }
    return state.audit.every(event => event && typeof event.eventId === 'string' && typeof event.type === 'string' &&
      typeof event.from === 'string' && typeof event.to === 'string' && Array.isArray(event.evidenceIds) && event.evidenceIds.length <= PLANNER_LIMITS.evidence &&
      event.evidenceIds.every(id => typeof id === 'string'));
  } catch { return false; }
}

/** Native SQLite, WAL + transactions. Runtime data must live on a persistent volume. */
export class MemoryStore {
  private db: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ':memory:') {
      fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS memory_devices (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, profile TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memory_devices_owner ON memory_devices(owner);
      CREATE TABLE IF NOT EXISTS memory_sessions (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, device_id TEXT NOT NULL REFERENCES memory_devices(id) ON DELETE CASCADE,
        title TEXT NOT NULL, progress TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
        revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memory_sessions_owner ON memory_sessions(owner);
      CREATE TABLE IF NOT EXISTS memory_messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES memory_sessions(id) ON DELETE CASCADE,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memory_messages_session ON memory_messages(session_id, sequence);
    `);
    if (filename !== ':memory:') fs.chmodSync(filename, 0o600);
  }
  close() { if (this.db.isOpen) this.db.close(); }
  private transaction<T>(callback: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = callback(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private sessionRow(row: Record<string, unknown>): MemorySession {
    return { id: String(row.id), deviceId: String(row.device_id), title: String(row.title),
      progress: String(row.progress), summary: String(row.summary), revision: Number(row.revision), updatedAt: String(row.updated_at) };
  }
  private deviceRow(row: Record<string, unknown>): MemoryDevice {
    return { ...JSON.parse(String(row.profile)) as DeviceProfile, id: String(row.id), updatedAt: String(row.updated_at) };
  }
  overview(owner: string): MemoryOverview {
    return {
      devices: this.db.prepare('SELECT * FROM memory_devices WHERE owner = ? ORDER BY updated_at DESC').all(owner).map((r) => this.deviceRow(r)),
      sessions: this.db.prepare('SELECT * FROM memory_sessions WHERE owner = ? ORDER BY updated_at DESC').all(owner).map((r) => this.sessionRow(r)),
    };
  }
  device(owner: string, id: string): MemoryDevice {
    const row = this.db.prepare('SELECT * FROM memory_devices WHERE id = ? AND owner = ?').get(id, owner);
    if (!row) throw new MemoryError(404, 'memory_not_found', '设备或诊断记录不存在');
    return this.deviceRow(row);
  }
  saveDevice(owner: string, profile: DeviceProfile, id?: string): MemoryDevice {
    return this.transaction(() => {
      const previous = id ? this.device(owner, id) : undefined;
      if (!id && this.overview(owner).devices.length >= 100) throw new MemoryError(409, 'memory_limit', '设备档案已达上限，请删除不再需要的档案');
      const device = { ...profile, id: id || randomUUID(), updatedAt: new Date().toISOString() };
      this.db.prepare(`INSERT INTO memory_devices(id, owner, profile, updated_at) VALUES(?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET profile = excluded.profile, updated_at = excluded.updated_at`).run(device.id, owner, JSON.stringify(profile), device.updatedAt);
      if (previous && ['machineType', 'brand', 'model'].some((field) => previous[field as keyof DeviceProfile] !== profile[field as keyof DeviceProfile])) {
        // Do not save an answer prepared for the old machine after a plate correction.
        this.db.prepare('UPDATE memory_sessions SET revision = revision + 1 WHERE owner = ? AND device_id = ?').run(owner, device.id);
      }
      return device;
    });
  }
  createSession(owner: string, deviceId: string): MemorySession {
    this.device(owner, deviceId);
    if (this.overview(owner).sessions.length >= 100) throw new MemoryError(409, 'memory_limit', '诊断记录已达上限，请删除不再需要的记录');
    const session = { id: randomUUID(), deviceId, title: '新诊断', progress: '', summary: '', revision: 0, updatedAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO memory_sessions(id, owner, device_id, title, updated_at) VALUES(?, ?, ?, ?, ?)')
      .run(session.id, owner, deviceId, session.title, session.updatedAt);
    return session;
  }
  session(owner: string, id: string): SessionDetail {
    const row = this.db.prepare('SELECT * FROM memory_sessions WHERE id = ? AND owner = ?').get(id, owner);
    if (!row) throw new MemoryError(404, 'memory_not_found', '设备或诊断记录不存在');
    const session = this.sessionRow(row);
    const messages = this.db.prepare('SELECT payload FROM memory_messages WHERE session_id = ? ORDER BY sequence').all(id)
      .map((r) => {
        const { _plannerCheckpoint: _privateCheckpoint, _plannerTurnEventId: _privateTurnId, ...message } = JSON.parse(String(r.payload)) as StoredMessage;
        return message;
      });
    return { ...session, device: this.device(owner, session.deviceId), messages };
  }
  /** Retrieve only user-entered checks for this exact device, outside the active session. */
  priorReports(owner: string, deviceId: string, excluded: string, query: string): PriorDeviceReport[] {
    this.device(owner, deviceId);
    const terms = new Set<string>();
    const stop = new Set(['检查', '正常', '请问', '如何', '什么', '下一', '一步', '继续', '故障', '问题', '已检', '查正', '结果']);
    for (const token of query.toLowerCase().match(/[a-z][a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) || []) {
      if (/^[a-z]/.test(token)) terms.add(token);
      else for (let i = 0; i < token.length - 1; i++) if (!stop.has(token.slice(i, i + 2))) terms.add(token.slice(i, i + 2));
    }
    if (!terms.size) return [];
    const rows = this.db.prepare("SELECT id, progress, updated_at FROM memory_sessions WHERE owner = ? AND device_id = ? AND id <> ? AND progress <> '' ORDER BY updated_at DESC LIMIT 20")
      .all(owner, deviceId, excluded);
    return rows.map((row) => {
      const first = this.db.prepare("SELECT json_extract(payload, '$.content') AS question FROM memory_messages WHERE session_id = ? AND json_extract(payload, '$.role') = 'user' ORDER BY sequence LIMIT 1").get(String(row.id));
      const report = { sessionId: String(row.id), updatedAt: String(row.updated_at), question: String(first?.question || '').slice(0, 400), progress: String(row.progress).slice(0, 800) };
      const text = `${report.question} ${report.progress}`.toLowerCase();
      return { report, score: [...terms].filter((t) => text.includes(t)).length };
    }).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map((candidate) => candidate.report);
  }
  private checkRevision(actual: number, expected: number) {
    if (actual !== expected) throw new MemoryError(409, 'memory_conflict', '诊断记录已更新，请重新载入后继续');
  }
  /** Read only the latest assistant's server-written checkpoint for the authorized session. */
  plannerCheckpoint(owner: string, id: string): PlannerCheckpoint | undefined {
    const session = this.session(owner, id);
    const row = this.db.prepare("SELECT payload FROM memory_messages WHERE session_id = ? AND json_extract(payload, '$.role') = 'assistant' AND json_type(payload, '$._plannerCheckpoint') IS NOT NULL ORDER BY sequence DESC LIMIT 1").get(id);
    if (!row) return undefined;
    const checkpoint = (JSON.parse(String(row.payload)) as StoredMessage)._plannerCheckpoint;
    if (checkpoint === null) return undefined;
    if (!validCheckpoint(checkpoint, id, session.deviceId)) {
      throw new MemoryError(409, 'memory_conflict', '诊断计划无法安全恢复，请重新载入后继续');
    }
    return checkpoint;
  }
  /** Resolve a Planner observation to its original user message inside the authorized session. */
  plannerTurnEvidence(owner: string, id: string, eventId: string): Pick<MemoryMessage, 'id' | 'content' | 'createdAt'> | undefined {
    this.session(owner, id);
    if (!/^turn-(?:0|[1-9][0-9]*)$/.test(eventId) || eventId.length > 32) return undefined;
    const row = this.db.prepare("SELECT payload FROM memory_messages WHERE session_id = ? AND json_extract(payload, '$.role') = 'user' AND json_extract(payload, '$._plannerTurnEventId') = ? LIMIT 1").get(id, eventId);
    if (!row) return undefined;
    const { id: messageId, content, createdAt } = JSON.parse(String(row.payload)) as StoredMessage;
    if (typeof messageId !== 'string' || typeof content !== 'string' || typeof createdAt !== 'string') {
      throw new MemoryError(409, 'memory_conflict', '诊断事件无法安全恢复，请重新载入后继续');
    }
    return { id: messageId, content, createdAt };
  }
  appendTurn(owner: string, id: string, expected: number, user: string, assistant: Omit<MemoryMessage, 'id' | 'role' | 'createdAt'>,
    imported: { role: 'user' | 'assistant'; content: string }[] = [], planner?: PlannerCheckpointCommit): MemorySession {
    return this.transaction(() => {
      const session = this.session(owner, id);
      this.checkRevision(session.revision, expected);
      if (planner) {
        const previousCheckpoint = this.plannerCheckpoint(owner, id);
        const previous = previousCheckpoint?.state;
        if ((previous?.episodeId ?? null) !== (planner.previous?.episodeId ?? null) ||
            (previous?.planVersion ?? null) !== (planner.previous?.planVersion ?? null)) {
          throw new MemoryError(409, 'memory_conflict', '诊断计划已更新，请重新载入后继续');
        }
        const checkpoint = planner.checkpoint;
        if (checkpoint && !validCheckpoint(checkpoint, id, session.deviceId)) {
          throw new MemoryError(400, 'bad_request', '诊断计划格式无效');
        }
        if (checkpoint && previous && checkpoint.state.episodeId === previous.episodeId &&
            (checkpoint.topicKey !== previousCheckpoint.topicKey || checkpoint.state.planId !== previous.planId || checkpoint.state.planVersion < previous.planVersion ||
             checkpoint.state.planVersion === previous.planVersion && canonical(checkpoint.state) !== canonical(previous))) {
          throw new MemoryError(409, 'memory_conflict', '诊断计划版本无效，请重新载入后继续');
        }
      }
      const now = new Date().toISOString();
      const initial = session.messages.length ? [] : imported.map((m) => ({ ...m, id: randomUUID(), createdAt: now }));
      const added: MemoryMessage[] = [...initial, { id: randomUUID(), role: 'user', content: user, createdAt: now },
        { ...assistant, content: assistant.content.slice(0, 16000), id: randomUUID(), role: 'assistant', createdAt: now }];
      const all = [...session.messages, ...added];
      if (all.length > 2000) throw new MemoryError(409, 'memory_limit', '本次诊断记录已达上限，请新建诊断');
      const insert = this.db.prepare('INSERT INTO memory_messages(session_id, payload) VALUES(?, ?)');
      for (const message of added) {
        let stored: StoredMessage = message;
        if (planner && message === added.at(-1)) stored = { ...message, _plannerCheckpoint: planner.checkpoint };
        else if (planner && message === added.at(-2)) stored = { ...message, _plannerTurnEventId: `turn-${expected}` };
        insert.run(id, JSON.stringify(stored));
      }
      this.db.prepare('UPDATE memory_sessions SET title = ?, summary = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND owner = ?')
        .run(session.messages.length ? session.title : all.find((m) => m.role === 'user')!.content.slice(0, 60), summarizeReports(all), now, id, owner);
      const { messages: _messages, device: _device, ...result } = this.session(owner, id);
      return result;
    });
  }
  updateProgress(owner: string, id: string, expected: number, progress: string): MemorySession {
    return this.transaction(() => {
      const session = this.session(owner, id);
      this.checkRevision(session.revision, expected);
      this.db.prepare('UPDATE memory_sessions SET progress = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND owner = ?')
        .run(progress, new Date().toISOString(), id, owner);
      const { messages: _messages, device: _device, ...result } = this.session(owner, id);
      return result;
    });
  }
  clearSession(owner: string, id: string, expected: number) {
    this.transaction(() => {
      const session = this.session(owner, id);
      this.checkRevision(session.revision, expected);
      this.db.prepare('DELETE FROM memory_messages WHERE session_id = ?').run(id);
      this.db.prepare("UPDATE memory_sessions SET title = '新诊断', progress = '', summary = '', revision = revision + 1, updated_at = ? WHERE id = ? AND owner = ?")
        .run(new Date().toISOString(), id, owner);
    });
  }
  deleteSession(owner: string, id: string) {
    this.session(owner, id);
    this.db.prepare('DELETE FROM memory_sessions WHERE id = ? AND owner = ?').run(id, owner);
  }
  deleteDevice(owner: string, id: string) {
    this.device(owner, id);
    this.db.prepare('DELETE FROM memory_devices WHERE id = ? AND owner = ?').run(id, owner);
  }
}

let instance: MemoryStore | undefined;
export function getMemoryStore(): MemoryStore {
  instance ??= new MemoryStore(process.env.MEMORY_DB_PATH?.trim() || path.join(os.homedir(), '.agridx', 'memory.sqlite'));
  return instance;
}
