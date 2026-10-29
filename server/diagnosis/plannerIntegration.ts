import { advancePlan, reducePlan, type PlannerContext, type PlannerEvent, type PlannerScope } from '../../agent/planner';
import { parsePlannerFeedback } from '../../agent/planner/feedback';
import { recordDecision, scopeKey } from '../../agent/planner/reducer';
import type { PlannerCheckpoint, PlannerCheckpointCommit } from '../memory/store';
import type { CoordinationDecision, DiagnosticReply } from '../../shared/diagnosis';
import { createDiagnosticPlan, identifyPlannerTopic, plannerStepAliases } from './plannerPlans';

/** Limited host hints: recognizable reports stay with their fault, while an
 * independently stated different fault starts a fresh episode. Unknown short
 * feedback is clarified rather than recorded as an observation. */
export function plannerConversationHints(checkpoint: PlannerCheckpoint) {
  const aliases = checkpoint.state.steps.flatMap(step => [...plannerStepAliases(step.key)]);
  const recognized = (text: string) => parsePlannerFeedback({ text, eventId: 'hint', episodeId: 'hint', stepKey: 'hint', subjectAliases: aliases }).kind !== 'clarify';
  return {
    isFeedback: (text: string) => recognized(text) || /^(?:我)?(?:暂时)?(?:想不起来|记不清|不知道|不清楚|不太清楚|不确定)[。！!]*$/.test(text),
    isNewTopic: (text: string, root: string) => {
      const next = identifyPlannerTopic(text), current = identifyPlannerTopic(root);
      return !recognized(text) && !!next && !!current && next !== current;
    },
  };
}

export interface PlannerTurn {
  commit: PlannerCheckpointCommit;
  restriction?: CoordinationDecision;
  questions?: DiagnosticReply['questions'];
  /** Do not claim an unshown action was issued if the existing AI reply already asks a question. */
  withoutProposal?: PlannerCheckpoint;
}

/** Run only for an owner-bound persistent session, using the already retrieved data.
 * Client input is never accepted as a checkpoint. The transcript is the evidence
 * location for each event ID (the session revision before that message). */
export function planDiagnosticTurn(input: {
  sessionId: string; sessionSeed: string; deviceId: string; revision: number; topicRoot: string; currentQuery: string;
  scope: PlannerScope; checkpoint?: PlannerCheckpoint; context: PlannerContext;
  engineSpecified?: boolean; faultCodesSpecified?: boolean; routing?: CoordinationDecision;
}): PlannerTurn {
  const prior = input.checkpoint;
  const previous = prior ? { episodeId: prior.state.episodeId, planVersion: prior.state.planVersion } : null;
  const explicitNewTopic = /(?:换(?:个|一个)|另(?:一个|外一个|一)?|新的?)(?:故障|问题)/.test(input.currentQuery);
  const text = input.currentQuery.trim();
  const control = /^(?:取消诊断|停止诊断|结束诊断|暂停诊断|先暂停|暂时暂停|故障已解决|问题已解决|已经修好|已修好)[。！!]*$/.test(text);
  const resumeOriginal = /^(?:继续|恢复)(?:(?:刚才|之前|原来|原)(?:的)?)?(?:故障|诊断|问题)[。！!]*$/.test(text);
  const named = prior?.state.steps.filter(step => plannerStepAliases(step.key).some(alias => text.includes(alias))) ?? [];
  const currentTopic = identifyPlannerTopic(text);
  if (prior?.topicPending && input.routing?.route === 'safe' && !/^(?:取消诊断|停止诊断|结束诊断)[。！!]*$/.test(text)) {
    const state = recordDecision(prior.state, { status: 'escalated', reason: 'safety_restriction' });
    return { restriction: input.routing, commit: { previous, checkpoint: { ...prior, state } } };
  }
  // Explicit equipment changes invalidate the old episode before retaining any
  // disambiguation state. Omitted fields are not interpreted as a change.
  if (prior && !explicitNewTopic) {
    const candidateScope = { ...input.scope,
      engineModel: input.engineSpecified ? input.scope.engineModel : prior.state.scope.engineModel,
      faultCodes: input.faultCodesSpecified ? input.scope.faultCodes : prior.state.scope.faultCodes };
    if (scopeKey(candidateScope) !== prior.state.scopeKey && !identifyPlannerTopic(input.topicRoot)) {
      return { commit: { previous, checkpoint: null } };
    }
  }
  if (prior?.topicPending && !explicitNewTopic && !(currentTopic && currentTopic !== prior.topicKey) && !control) {
    if (prior.topicPending === 'topic' && resumeOriginal) {
      const state = reducePlan(prior.state, { type: 'resume', id: `turn-${input.revision}`, episodeId: prior.state.episodeId });
      return { commit: { previous, checkpoint: { ...prior, state, topicPending: 'step' } },
        questions: [{ text: '请明确是哪一项已有检查，以及结果是正常、异常、未检查还是不确定。' }] };
    }
    if (prior.topicPending === 'topic' || named.length !== 1) {
      const state = reducePlan(prior.state, { type: 'continue', id: `turn-${input.revision}`, episodeId: prior.state.episodeId });
      return { commit: { previous, checkpoint: { ...prior, state } }, questions: prior.state.budget.noProgress >= prior.state.budget.maxNoProgress ? []
        : [{ text: prior.topicPending === 'topic' ? '请确认是继续原来的故障诊断，还是开始另一个问题？' : '请说明是哪一项已有检查及其结果。' }] };
    }
  }
  const recognizedFollowup = prior && (plannerConversationHints(prior).isFeedback(input.currentQuery) || control || Boolean(prior.topicPending === 'step' && named.length === 1));
  const topic = identifyPlannerTopic(input.topicRoot) ?? (recognizedFollowup && (prior?.topicKey === 'overheat' || prior?.topicKey === 'starting') ? prior.topicKey : undefined);
  if (!topic) {
    // Unknown wording is never assigned to an old step or silently treated as
    // a new fault. Ask for clarification while preserving its bounded history.
    if (!prior || explicitNewTopic || ['cancelled', 'resolved_reported', 'escalated', 'exhausted'].includes(prior.state.status)) return { commit: { previous, checkpoint: null } };
    const updated = reducePlan(prior.state, { type: 'continue', id: `turn-${input.revision}`, episodeId: prior.state.episodeId });
    const state = prior.state.stopReason === 'user_paused' ? updated : recordDecision(updated, { status: 'paused', reason: 'no_progress' });
    return { commit: { previous, checkpoint: { ...prior, state, topicPending: 'topic' } }, questions: prior.state.status === 'paused' ? []
      : [{ text: '请确认这条信息是在补充刚才的故障，还是在描述另一个问题，并说明对应的检查或故障现象。' }] };
  }
  const sameEpisode = !explicitNewTopic && prior?.topicKey === topic && prior.state.scopeKey === scopeKey(input.scope);
  let state = sameEpisode ? prior!.state : createDiagnosticPlan({ topic, scope: input.scope, sessionSeed: input.sessionSeed, revision: input.revision });
  const wasPausedForNoProgress = state.status === 'paused' && state.stopReason === 'no_progress';
  let clarification: string | undefined;
  let event: PlannerEvent | undefined;
  if (sameEpisode) {
    const text = input.currentQuery.trim();
    const eventId = `turn-${input.revision}`;
    if (/^(?:取消诊断|停止诊断|结束诊断)[。！!]*$/.test(text)) event = { type: 'cancel', id: eventId, episodeId: state.episodeId };
    else if (/^(?:暂停诊断|先暂停|暂时暂停)[。！!]*$/.test(text)) event = { type: 'pause', id: eventId, episodeId: state.episodeId };
    else if (/^(?:故障已解决|问题已解决|已经修好|已修好)[。！!]*$/.test(text)) event = { type: 'resolved_reported', id: eventId, episodeId: state.episodeId };
    else if (/^(?:继续诊断|恢复诊断)[。！!]*$/.test(text) && state.status === 'paused' && state.stopReason === 'user_paused') event = { type: 'resume', id: eventId, episodeId: state.episodeId };
    else if (state.status === 'awaiting_user' || state.status === 'active' && state.steps.some(step => plannerStepAliases(step.key).some(alias => text.includes(alias))) || state.status === 'paused' && (state.stopReason === 'no_progress' || state.stopReason === 'plan_review_complete' && /^(?:更正|纠正|之前说错|刚才说错)/.test(text))) {
      // Explicit subjects can correct earlier observations; unqualified answers
      // bind only to the currently issued question, never an arbitrary step.
      const named = state.steps.filter(step => plannerStepAliases(step.key).some(alias => text.includes(alias)));
      const step = named.length === 1 ? named[0] : named.length ? undefined : state.steps.find(item => item.status === 'awaiting_user');
      if (step) {
        const old = state.observations[step.expectedObservation.slot];
        const parsed = parsePlannerFeedback({ text, episodeId: state.episodeId, eventId, stepKey: step.key,
          previous: old, subjectAliases: plannerStepAliases(step.key), allowRefineUnknown: old?.value === null });
        if (parsed.kind === 'observation') {
          // "checked" does not provide a result; store unknown and ask for the
          // outcome. The raw user message remains in the owner-bound transcript.
          event = parsed.evidence.normalized === 'checked' ? { ...parsed.event, value: null } : parsed.event;
          if (parsed.evidence.normalized === 'checked') clarification = `请问${step.expectedObservation.label}是正常还是异常？如果不确定，可以说明。`;
        } else if (parsed.kind === 'clarify') {
          event = { type: 'continue', id: eventId, episodeId: state.episodeId };
          clarification = `请确认${step.expectedObservation.label}：正常、异常、未检查还是不确定？`;
        }
      } else {
        event = { type: 'continue', id: eventId, episodeId: state.episodeId };
        clarification = '请说明这次反馈对应哪一项已有检查，以及结果是否正常。';
      }
    }
  }
  if (event) state = reducePlan(state, event);
  const result = advancePlan(state, input.context);
  const checkpoint: PlannerCheckpoint = { sessionId: input.sessionId, deviceId: input.deviceId, topicKey: topic,
    topicRoot: sameEpisode ? prior?.topicRoot : input.topicRoot.slice(0, 2000), state: result.state };
  const commit = { previous, checkpoint };
  if (result.decision.routing.route === 'safe' || result.decision.routing.route === 'clarify') return { commit, restriction: result.decision.routing };
  if (clarification && (result.state.status === 'awaiting_user' || result.state.status === 'paused' && result.state.stopReason === 'no_progress' && !wasPausedForNoProgress)) return { commit, questions: [{ text: clarification }] };
  return { commit, questions: result.decision.questions, ...(result.decision.action ? { withoutProposal: { ...checkpoint, state } } : {}) };
}
