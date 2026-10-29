import type { Observation, PlannerEvent } from './types';

/** This parser recognizes only a bounded set of explicit reports for a trusted step. */
export interface PlannerFeedbackInput {
  text: string;
  eventId: string;
  episodeId: string;
  stepKey: string;
  previous?: Pick<Observation, 'eventId' | 'value' | 'source'>;
  /** Trusted host has established that an unknown observation is awaiting clarification. */
  allowRefineUnknown?: boolean;
  /** Supplied by the host's existing step definition, never inferred from the text. */
  subjectAliases?: readonly string[];
}

type FeedbackValue = 'checked' | 'unchecked' | 'normal' | 'abnormal' | null;
export type PlannerFeedbackResult =
  | { kind: 'observation'; event: Extract<PlannerEvent, { type: 'observation' }>; evidence: { raw: string; normalized: FeedbackValue; correction: boolean } }
  | { kind: 'duplicate'; evidence: { raw: string; normalized: FeedbackValue } }
  | { kind: 'clarify'; question: string };

const clarify = (): PlannerFeedbackResult => ({ kind: 'clarify', question: '请确认这项已有检查是正常、异常、尚未检查，还是不确定？' });

/**
 * Plain user reports are not verified repair facts. The caller must bind this
 * function to an owner-checked episode and the current step; this function is
 * deliberately not a free-text symptom extractor or an HTTP input validator.
 */
export function parsePlannerFeedback(input: PlannerFeedbackInput): PlannerFeedbackResult {
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 400 || /[?？]/.test(input.text)) return clarify();
  const raw = input.text.trim();
  // Only normalize whitespace and punctuation at clause boundaries: do not
  // erase negation, digits or arbitrary text in order to force a match.
  let body = raw.replace(/\s+/g, '').replace(/[，,。.!！?？:：;；]/g, '');
  let correction = false;
  for (const prefix of ['更正一下', '之前说错了', '刚才说错了', '更正', '纠正']) {
    if (body.startsWith(prefix)) { correction = true; body = body.slice(prefix.length); break; }
  }
  const aliases = [...new Set(input.subjectAliases ?? [])].filter(alias => typeof alias === 'string' && alias.trim().length > 0 && alias.length <= 100)
    .sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    const normalizedAlias = alias.replace(/\s+/g, '');
    if (body.startsWith(normalizedAlias)) { body = body.slice(normalizedAlias.length); break; }
  }
  if (body.startsWith('的')) body = body.slice(1);

  const labels: ReadonlyArray<readonly [FeedbackValue, readonly string[]]> = [
    ['unchecked', ['未检查', '没检查', '没有检查', '还没检查', '尚未检查', '还未检查', '没有查', '没查', '未查']],
    ['abnormal', ['异常', '不正常', '检查异常', '检查不正常', '检查结果异常', '检查结果不正常', '有异常', '有问题', '发现异常', '查过了有问题', '检查了异常', '已检查异常']],
    ['normal', ['正常', '没问题', '没有问题', '检查正常', '检查结果正常', '检查没问题', '检查没有问题', '检查过了正常', '检查了正常', '已检查正常', '查过了正常', '查过了没问题', '检查过没有问题', '检查过了没问题']],
    ['checked', ['已检查', '检查过', '检查过了', '已查', '查过', '查过了', '已经检查', '已经检查过', '已经检查过了']],
    [null, ['不确定', '不知道', '不清楚', '记不清', '记不清了', '无法确定', '结果不确定', '检查结果不确定']],
  ];
  const match = labels.find(([, phrases]) => phrases.includes(body));
  if (!match) return clarify();
  const value = match[0], previous = input.previous;
  if (correction && !previous) return clarify();
  if (previous && previous.value === value && previous.source === 'user_report') return { kind: 'duplicate', evidence: { raw, normalized: value } };
  // A trusted host may refine an explicitly unknown result. All other changes
  // require explicit correction; the reducer checks the latest event ID.
  const refineUnknown = input.allowRefineUnknown === true && previous?.value === null
    && (value === 'normal' || value === 'abnormal' || value === 'unchecked');
  if (previous && !correction && !refineUnknown) return clarify();
  const event: Extract<PlannerEvent, { type: 'observation' }> = {
    type: 'observation', id: input.eventId, episodeId: input.episodeId, stepKey: input.stepKey,
    value, source: 'user_report', ...(previous ? { corrects: previous.eventId } : {}),
  };
  return { kind: 'observation', event, evidence: { raw, normalized: value, correction } };
}
