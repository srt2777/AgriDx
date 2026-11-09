import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { getMemoryStore, MemoryError, profileFrom, validId } from './store';

const COOKIE = 'agridx_memory';
/** Anonymous browser identity. HttpOnly capability, not a user account or device fingerprint. */
export function memoryOwner(req: Request, res: Response): string {
  const cookie = req.headers.cookie?.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const token = cookie && /^[a-f0-9]{64}$/.test(cookie) ? cookie : randomBytes(32).toString('hex');
  if (token !== cookie) res.cookie(COOKIE, token, { httpOnly: true, secure: req.secure, sameSite: 'strict', maxAge: 365 * 24 * 3600 * 1000, path: '/api' });
  return createHash('sha256').update(token).digest('hex');
}
export function sameOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (origin) {
    try {
      const expected = new URL(`${req.protocol}://${req.get('host')}`).origin;
      if (new URL(origin).origin !== expected) throw new Error('origin');
    } catch {
      res.status(403).json({ code: 'memory_origin', error: '请从本站访问诊断记忆' }); return;
    }
  }
  if (req.get('sec-fetch-site') === 'cross-site') {
    res.status(403).json({ code: 'memory_origin', error: '请从本站访问诊断记忆' }); return;
  }
  next();
}
export function revisionFrom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new MemoryError(400, 'bad_request', '请提供有效的诊断记录版本');
  return value;
}
/** Same mapping as memoryFailure, without writing the response: the chat route needs the payload for SSE error events after headers are sent. */
export function memoryErrorPayload(error: unknown): { status: number; code: string; error: string } {
  if (error instanceof MemoryError) return { status: error.status, code: error.code, error: error.message };
  // The 503 body must stay sanitized, but the underlying store error has
  // to reach the server log: without it the failure is undiagnosable from
  // logs (2026-11-04 only "[memory] storage operation failed" was
  // recorded, with no SQLite text). The detail comes from the store
  // (SQLite), never from request content or credentials.
  const code = (error as { code?: unknown })?.code;
  const detail = error instanceof Error
    ? `${error.name}: ${error.message}${typeof code === 'string' || typeof code === 'number' ? ` (code=${code})` : ''}`
    : String(error);
  console.warn('[memory] storage operation failed', detail);
  return { status: 503, code: 'memory_unavailable', error: '诊断记忆暂时无法保存或读取，请稍后重试；已有记录不会被清空' };
}
export function memoryFailure(error: unknown, res: Response) {
  const payload = memoryErrorPayload(error);
  res.status(payload.status).json({ code: payload.code, error: payload.error });
}
export function createMemoryRoutes(store = getMemoryStore) {
const memoryRouter = Router();
memoryRouter.use(sameOrigin);
memoryRouter.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
memoryRouter.use((req, res, next) => { res.locals.memoryOwner = memoryOwner(req, res); next(); });
const route = (callback: (req: Request, res: Response, owner: string) => unknown) => (req: Request, res: Response) => {
  try { callback(req, res, res.locals.memoryOwner as string); } catch (error) { memoryFailure(error, res); }
};
const id = (value: unknown): string => {
  if (!validId(value)) throw new MemoryError(400, 'bad_request', '记录编号格式错误');
  return value;
};
memoryRouter.get('/', route((_req, res, owner) => res.json(store().overview(owner))));
memoryRouter.post('/devices', route((req, res, owner) => res.status(201).json(store().saveDevice(owner, profileFrom(req.body)))));
memoryRouter.patch('/devices/:id', route((req, res, owner) => res.json(store().saveDevice(owner, profileFrom(req.body), id(req.params.id)))));
memoryRouter.delete('/devices/:id', route((req, res, owner) => { store().deleteDevice(owner, id(req.params.id)); res.json({ ok: true }); }));
memoryRouter.get('/devices/:id/long-term', route((req, res, owner) => res.json(store().longTerm(owner, id(req.params.id)))));
memoryRouter.post('/devices/:id/long-term', route((req, res, owner) => {
  if (typeof req.body?.content !== 'string' || typeof req.body?.kind !== 'string' || typeof req.body?.sessionId !== 'string' ||
      (req.body.supersedesId !== undefined && typeof req.body.supersedesId !== 'string')) throw new MemoryError(400, 'bad_request', '长期记忆记录格式错误');
  res.status(201).json(store().recordLongTermObservation(owner, id(req.params.id), id(req.body.sessionId), req.body.kind, req.body.content,
    req.body.supersedesId ? { supersedesId: id(req.body.supersedesId) } : {}));
}));
memoryRouter.post('/devices/:id/long-term/prune', route((req, res, owner) => res.json(store().pruneLongTerm(owner, id(req.params.id)))));
memoryRouter.post('/devices/:id/long-term/:entryId/demote', route((req, res, owner) => {
  if (typeof req.body?.reason !== 'string') throw new MemoryError(400, 'bad_request', '降级原因格式错误');
  res.json(store().demoteLongTerm(owner, id(req.params.id), id(req.params.entryId), req.body.reason));
}));
memoryRouter.post('/sessions', route((req, res, owner) => res.status(201).json(store().createSession(owner, id(req.body?.deviceId)))));
memoryRouter.get('/sessions/:id', route((req, res, owner) => res.json(store().session(owner, id(req.params.id)))));
memoryRouter.patch('/sessions/:id', route((req, res, owner) => {
  if (typeof req.body?.progress !== 'string' || req.body.progress.length > 2000) throw new MemoryError(400, 'bad_request', '检查进度须为文本（上限2000字符）');
  res.json(store().updateProgress(owner, id(req.params.id), revisionFrom(req.body.revision), req.body.progress.trim()));
}));
memoryRouter.post('/sessions/:id/clear', route((req, res, owner) => {
  const sessionId = id(req.params.id);
  store().clearSession(owner, sessionId, revisionFrom(req.body?.revision));
  res.json(store().session(owner, sessionId));
}));
memoryRouter.delete('/sessions/:id', route((req, res, owner) => { store().deleteSession(owner, id(req.params.id)); res.json({ ok: true }); }));

return memoryRouter;
}
