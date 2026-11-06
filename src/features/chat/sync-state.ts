/**
 * Diagnosis-record sync state (PR2: diagnosis-recovery-20261106).
 *
 * The server already returns the generated answer with `memorySaveFailed`
 * when a turn cannot be saved, and deterministic MemoryErrors still come
 * back as errors. What was missing was the client-side recovery flow, so
 * this module owns the one piece of state the whole flow keys on:
 *
 * - `synced`: the active session matches the saved record; sending is allowed.
 * - `unsaved`: a turn was generated but not saved (or its save outcome is
 *   unknown after a network cut). Sending is blocked until the user reloads
 *   the saved record and rechecks it; the unsaved turn is kept as an
 *   independent copy bound to its session and device, never as a live
 *   message that a later restore could silently overwrite.
 * - `recovering`: a reload of the saved record is in flight; sending stays
 *   blocked until it resolves.
 *
 * A recovered copy is kept after the reload (so the user can copy/export
 * it), but it no longer blocks sending: the original question is restored
 * as a draft and the user resubmits it explicitly. Resubmitting creates a
 * new answer; it never writes the old answer into the record, and there is
 * no "resubmit the assistant text" endpoint — the pending copy is not a
 * reliable cross-restart save mechanism, only a same-browser draft.
 *
 * Everything here is pure (storage is injected) so the rules are testable
 * without a browser. The hooks only wire these rules to React state.
 */
import type { SessionDetail } from '../../../shared/memory';

export type SyncStatus = 'synced' | 'unsaved' | 'recovering';

export interface PendingUnsavedTurn {
  sessionId: string;
  deviceId: string;
  /** Saved-record revision the failed turn was attempted against. */
  revision: number;
  question: string;
  /** Empty when the save outcome is unknown (network cut before any answer arrived). */
  answer: string;
  /** True when the request may or may not have been saved; only a reload can decide. */
  uncertain: boolean;
  /** True once the saved record has been reloaded for this turn; the copy is kept but no longer blocks. */
  recovered: boolean;
  failedAt: string;
}

export const PENDING_TURN_KEY = '__agridx_chat_unsaved_turn';

/** Deterministic memory errors must keep returning errors, never `memorySaveFailed`. */
export const DETERMINISTIC_MEMORY_CODES = [
  'memory_conflict', 'memory_limit', 'memory_busy', 'memory_device_changed', 'memory_not_found', 'bad_request',
] as const;

export function isDeterministicMemoryCode(code: unknown): code is (typeof DETERMINISTIC_MEMORY_CODES)[number] {
  return typeof code === 'string' && (DETERMINISTIC_MEMORY_CODES as readonly string[]).includes(code);
}

export function createPendingTurn(input: {
  sessionId: string; deviceId: string; revision: number; question: string; answer?: string; uncertain?: boolean; recovered?: boolean;
}): PendingUnsavedTurn {
  return {
    sessionId: input.sessionId, deviceId: input.deviceId, revision: input.revision,
    question: input.question, answer: input.answer ?? '', uncertain: input.uncertain ?? false,
    recovered: input.recovered ?? false, failedAt: new Date().toISOString(),
  };
}

const isSafeInt = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isBoundedText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;

/** Returns the turn only when every field is present and in bounds; anything else is discarded, never repaired. */
export function validatePendingTurn(value: unknown): PendingUnsavedTurn | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.sessionId !== 'string' || !record.sessionId
    || typeof record.deviceId !== 'string' || !record.deviceId
    || !isSafeInt(record.revision)
    || !isBoundedText(record.question, 2000) || !record.question.trim()
    || !isBoundedText(record.answer, 16000)
    || typeof record.uncertain !== 'boolean' || typeof record.recovered !== 'boolean'
    || typeof record.failedAt !== 'string') return null;
  return {
    sessionId: record.sessionId, deviceId: record.deviceId, revision: record.revision,
    question: record.question, answer: record.answer, uncertain: record.uncertain,
    recovered: record.recovered, failedAt: record.failedAt,
  };
}

export type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function loadPendingTurn(storage: PendingStorage): PendingUnsavedTurn | null {
  try {
    const saved = storage.getItem(PENDING_TURN_KEY);
    if (!saved) return null;
    return validatePendingTurn(JSON.parse(saved));
  } catch { return null; }
}

/** False when browser storage failed; the caller must then say the copy is kept in this page only. */
export function savePendingTurn(storage: PendingStorage, turn: PendingUnsavedTurn): boolean {
  try { storage.setItem(PENDING_TURN_KEY, JSON.stringify(turn)); return true; } catch { return false; }
}

export function clearPendingTurn(storage: PendingStorage): void {
  try { storage.removeItem(PENDING_TURN_KEY); } catch { /* Nothing else can preserve the copy. */ }
}

export function syncStatusFor(args: { sessionId?: string | null; pending: PendingUnsavedTurn | null; recovering?: boolean }): SyncStatus {
  if (args.recovering) return 'recovering';
  if (args.pending && args.sessionId && args.pending.sessionId === args.sessionId && !args.pending.recovered) return 'unsaved';
  return 'synced';
}

export function isSendBlocked(status: SyncStatus): boolean {
  return status !== 'synced';
}

export function pendingAppliesToSession(pending: PendingUnsavedTurn | null, sessionId?: string | null): boolean {
  return !!pending && !!sessionId && pending.sessionId === sessionId;
}

/**
 * After a reload, the saved record decides: when its last user message is
 * the pending question, that turn was saved after all (for example the
 * response was lost after the server committed it), so there is nothing to
 * resubmit. Otherwise the question stays pending and becomes the draft.
 */
export function resolvePendingAfterReload(
  pending: PendingUnsavedTurn,
  messages: Pick<SessionDetail['messages'][number], 'role' | 'content'>[],
): 'saved' | 'unsaved' {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  return lastUser && lastUser.content === pending.question ? 'saved' : 'unsaved';
}

/** Switching/clearing/deleting a session drops only that session's copy; other sessions keep theirs. */
export function clearPendingForSession(pending: PendingUnsavedTurn | null, sessionId: string): PendingUnsavedTurn | null {
  return pending && pending.sessionId === sessionId ? null : pending;
}

export function clearPendingForDevice(pending: PendingUnsavedTurn | null, deviceId: string): PendingUnsavedTurn | null {
  return pending && pending.deviceId === deviceId ? null : pending;
}

/** Plain-text export of the pending copy, labelled as unsaved so it cannot be mistaken for the record. */
export function pendingTurnExportText(turn: PendingUnsavedTurn): string {
  return [
    '未保存到诊断记录（本轮未保存，重新提交会生成新的回答）',
    `问题：${turn.question}`,
    turn.answer ? `回答：${turn.answer}` : '回答：未收到（网络中断，保存结果未确认）',
    `记录版本：${turn.revision}`,
    `时间：${turn.failedAt}`,
  ].join('\n');
}
