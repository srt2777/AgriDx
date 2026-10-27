import type { SemanticCandidateReport } from '../../server/knowledge/relations-semantic';
export function readSemanticReport(root: string): { report?: SemanticCandidateReport; snapshotSha256?: string; reason?: string };
