import { createMemoryRoutes } from './memory/routes';
import { getMemoryStore } from './memory/store';
import express from 'express';
import cors from 'cors';
import { apiNotFound, createChatRateLimiter, errorHandler, securityHeaders } from './http/middleware';
import { createCatalogRoutes } from './routes/catalog';
import { createChatRoutes } from './routes/chat';
import { createShadowReviewRoutes } from './routes/shadow-review';
import { createStatusRoutes } from './routes/status';
import { createModelingRoutes } from './routes/modeling';
import { createTelemetryRoutes } from './routes/telemetry';
import { InMemoryShadowReviewStore } from '../agent/shadow-review';
import type { ServerRuntime } from './runtime';

/** Assemble HTTP only; callers control initialization and listening. */
export function createApp(runtime: ServerRuntime): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(cors());
  app.use('/api/modeling', createModelingRoutes());
  // Telemetry owns its small command parser; mount before the general JSON parser.
  app.use('/api', createTelemetryRoutes(runtime.telemetry));
  app.use(express.json({ limit: '256kb' }));
  app.use('/api/chat', createChatRateLimiter());
  const memory = runtime.getMemoryStore ?? getMemoryStore;
  app.use('/api/memory', createMemoryRoutes(memory));
  // Shared shadow-review store for the internal review page. Production
  // runtimes supply it; runtimes that omit it get an isolated empty store
  // that their stub diagnose functions never feed, so existing tests are
  // unaffected.
  const shadowReviewStore = runtime.getShadowReviewStore?.() ?? new InMemoryShadowReviewStore();
  app.use('/api', createStatusRoutes(runtime), createCatalogRoutes(runtime.getCatalog), createChatRoutes(runtime.diagnose, memory),
    createShadowReviewRoutes(() => shadowReviewStore));
  app.use('/api', apiNotFound);
  app.use(errorHandler);
  return app;
}
