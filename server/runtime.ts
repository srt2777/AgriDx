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
  return {
    rootDirectory, version, getMemoryStore,
    telemetry: telemetryFromEnvironment(rootDirectory),
    diagnose: createDiagnosticService(llm),
    getKnowledgeStats: stats,
    getLlmStatus: () => llm.getStatus(),
    getCatalog: getKnowledgeCatalog,
  };
}
