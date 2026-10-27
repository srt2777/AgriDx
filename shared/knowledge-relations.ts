/** These edges describe document associations only, never repair causality. */
export type RelationType = 'membership' | 'shared-component' | 'semantic';
export interface RelationEdge {
  from: string;
  to: string;
  type: RelationType;
  strength: number;
  basis: string;
  evidence: Record<string, string | number | boolean | null>;
}
export interface KnowledgeRelations {
  kbVersion: string | null;
  formulaVersion: string;
  nodes: string[];
  edges: RelationEdge[];
  degraded: string[];
  limitations: string[];
  page?: { offset: number; limit: number; total: number; hasMore: boolean };
}
