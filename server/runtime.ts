import { InMemoryShadowReviewStore } from '../agent/shadow-review';
import { getMemoryStore } from './memory/store';
import fs from 'node:fs';
import path from 'node:path';
import { initializeEnvironment } from './config/environment';
import { createDiagnosticService, type DiagnosticService } from './diagnosis/service';
import { getKnowledgeCatalog, loadKnowledgeCatalog } from './knowledge/catalog';
import { loadKnowledgeBase, stats } from './knowledge/retriever';
import { getLlmRouter, type LlmStatus } from './llm/router';
import { telemetryFromEnvironment, type TelemetryRuntime } from './telemetry/runtime';

export interface ServerRuntime {
  rootDirectory: string;
  version: string;
  diagnose: DiagnosticService;
  getKnowledgeStats: typeof stats;
  getLlmStatus: () => LlmStatus;
  getCatalog: typeof getKnowledgeCatalog;
  getMemoryStore?: typeof getMemoryStore;
  /**
   * Shared shadow-review store, fed by the diagnosis service's
   * onShadowReview callback. Optional so existing test fixtures that build
   * a ServerRuntime without a shadow loop keep compiling; the production
   * runtime created by createServerRuntime always supplies it, and
   * createApp falls back to an isolated empty store only for runtimes
   * that omit it (their stub diagnose functions never feed it).
   */
  getShadowReviewStore?: () => InMemoryShadowReviewStore;
  telemetry?: TelemetryRuntime;
}

/** Explicit startup composition; importing the app factory performs no initialization. */
export function createServerRuntime(): ServerRuntime {
  initializeEnvironment();
  loadKnowledgeBase();
  loadKnowledgeCatalog();
  const llm = getLlmRouter();
  const rootDirectory = process.cwd();
  const version: string = JSON.parse(fs.readFileSync(path.resolve(rootDirectory, 'package.json'), 'utf8')).version;
  // One shared store for the whole server process: the diagnosis service
  // appends shadow records to it, and the internal shadow-review routes
  // read from the same instance. It is deliberately separate from the
  // diagnosis memory store, in-memory only, and capped at 100 records.
  const shadowReviewStore = new InMemoryShadowReviewStore();
  return {
    rootDirectory, version, getMemoryStore,
    telemetry: telemetryFromEnvironment(rootDirectory),
    diagnose: createDiagnosticService(llm, {
      onShadowReview: (record) => { shadowReviewStore.append(record); },
    }),
    getShadowReviewStore: () => shadowReviewStore,
    getKnowledgeStats: stats,
    getLlmStatus: () => llm.getStatus(),
    getCatalog: getKnowledgeCatalog,
  };
}
