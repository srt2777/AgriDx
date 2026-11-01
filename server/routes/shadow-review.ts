import { Router } from 'express';
import { decideShadowPromotion, toShadowReviewViewItem } from '../../agent/shadow-review-view';
import type { InMemoryShadowReviewStore } from '../../agent/shadow-review';
import { sameOrigin } from '../memory/routes';

/**
 * Internal shadow-review routes (review-only, never a diagnosis endpoint).
 *
 * Same-origin + no-store, the same pattern as the chat/memory routes.
 * This is NOT login authentication: the app's existing /api routes have no
 * login check, and this route is at the same level as /api/health. A
 * deployment that needs stronger access control must add it separately.
 *
 * GET /api/shadow-review returns only view items derived from the shared
 * in-memory store: comparison labels, shadow-only candidate evidence ids,
 * planner steps, redacted tool summaries, safety marks, durations and
 * timeout flags. It never returns answer text, full tool output or
 * credentials, and it never touches diagnosis memory.
 *
 * POST /api/shadow-review/promotion-check only RUNS the promotion gate
 * (decideShadowPromotion) for one record and returns the decision. It does
 * not persist anything, does not change any rule, does not write diagnosis
 * memory and does not promote anything: "approved" here only means the
 * gate's inputs passed, and real promotion still requires a human to
 * check proposal section 3.4 (verified evidence, manual page or scope
 * annotation, offline reproduction) and act outside this route.
 */
export function createShadowReviewRoutes(getStore: () => InMemoryShadowReviewStore): Router {
  const router = Router();
  router.use(sameOrigin);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  router.get('/shadow-review', (_req, res) => {
    const store = getStore();
    res.json({
      items: store.list().map(toShadowReviewViewItem),
      candidates: store.candidatesForPromotion().map(toShadowReviewViewItem),
    });
  });

  router.post('/shadow-review/promotion-check', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.sessionId !== 'string' || !body.sessionId.trim()) {
      res.status(400).json({ code: 'bad_request', error: '请提供有效的会话编号 sessionId' });
      return;
    }
    const records = getStore().list(body.sessionId);
    // A session can hold several shadow runs; the gate checks the latest one.
    const record = records.at(-1);
    if (!record) {
      res.status(404).json({ code: 'not_found', error: '未找到该会话的影子审阅记录' });
      return;
    }
    const decision = decideShadowPromotion({
      record,
      reviewer: typeof body.reviewer === 'string' ? body.reviewer : '',
      verified: body.verified === true,
    });
    res.json({
      checkOnly: true,
      sessionId: body.sessionId,
      decision,
      note: '这只是门控检查，不是执行推广：不改规则、不写诊断记忆、不自动推广。真正提炼仍需人工按审阅稿 3.4 核对证据、手册页码或范围标注、离线复现后操作。',
    });
  });

  return router;
}
