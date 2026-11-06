import type { ErrorRequestHandler, RequestHandler } from 'express';

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
};

/** Each app has its own rate state; no timer or HTTP listener is created. */
export function createChatRateLimiter(): RequestHandler {
  const buckets = new Map<string, { count: number; reset: number }>();
  return (req, res, next) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.reset < now) buckets.delete(key);
    }
    const bucket = buckets.get(ip);
    if (!bucket) buckets.set(ip, { count: 1, reset: now + 60_000 });
    else if (++bucket.count > 30) {
      res.status(429).json({ error: '请求过于频繁，请稍后再试', code: 'rate_limited' });
      return;
    }
    next();
  };
}

export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: '接口不存在', code: 'not_found' });
};

export const errorHandler: ErrorRequestHandler = (error: Error & { type?: string; status?: number; statusCode?: number }, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: '请求体必须为有效的 JSON 对象', code: 'bad_request' });
    return;
  }
  // PR1 依赖安全：body-parser 的读取错误此前全部落到 500。超限、非法编码与
  // 字符集错误已有明确的客户端状态码，应如实返回而非记为服务器内部错误。
  if (error.type === 'entity.too.large') {
    res.status(413).json({ error: '请求体过大', code: 'entity_too_large' });
    return;
  }
  if (error.type === 'encoding.unsupported' || error.type === 'charset.unsupported') {
    res.status(415).json({ error: '不支持的请求编码或字符集', code: 'unsupported_media' });
    return;
  }
  // 解压读取失败（如无效 gzip 体）带有 http-errors 的 400 状态但无 type。
  if ((error.status === 400 || error.statusCode === 400) && !error.type) {
    res.status(400).json({ error: '请求体无法读取', code: 'bad_request' });
    return;
  }
  console.error('[server] unhandled:', error.message);
  res.status(500).json({ error: '服务器内部错误' });
};
