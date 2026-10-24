interface QuestionRecord {
  question: string;
  machineType?: string;
  brand?: string;
  model?: string;
  outcome: 'success' | 'error' | 'cancelled';
  knowledgeChunks: number;
  latencyMs: number;
}

let visitorReady: Promise<unknown> = Promise.resolve();
function enabled() {
  return typeof window !== 'undefined' && typeof __AGRIDX_DEV_PREVIEW__ !== 'undefined' && __AGRIDX_DEV_PREVIEW__
    && navigator.doNotTrack !== '1';
}
function send(kind: 'visit' | 'question', data: object) {
  return fetch(`/api/dev-events/${kind}`, {
    method: 'POST', credentials: 'same-origin', keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, id: crypto.randomUUID() }),
  }).catch(() => undefined); // Collection failure must never interrupt the website or diagnosis.
}

export function recordVisit(path: string) {
  if (!enabled() || !['/', '/chat', '/knowledge', '/models'].includes(path)) return;
  // Serialize cookie creation across route changes and questions from the same tab.
  visitorReady = visitorReady.then(() => send('visit', { path, referrer: document.referrer }));
}

export function recordQuestion(data: QuestionRecord) {
  if (!enabled()) return;
  void visitorReady.then(() => send('question', { ...data, release: __AGRIDX_PREVIEW_RELEASE__.commit }));
}
