/** Shared causal-edge types: symptom → candidate cause → remedy, traced to one card. */
export interface CausalEdge {
  edgeId: string;
  symptomEntryId: string;
  symptom: string;
  cause: string;
  remedy: string;
  /** Numeric condition quoted from the remedy text, or null when the card gives none. */
  threshold: string | null;
  sourceId: string;
  pages: { pdf?: string; printed?: string };
  evidenceKind: '故障表' | '知识卡选摘';
  /** Only ever "故障表候选": never a probability or a verified causal claim. */
  strengthBasis: '故障表候选';
  brand: string;
  model: string;
}
export interface KnowledgeCausalEdges {
  kbVersion: string | null;
  snapshotSha256: string | null;
  edges: CausalEdge[];
  degraded: string[];
  limitations: string[];
}
