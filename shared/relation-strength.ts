import type { RoleCoverage } from './knowledge-catalog';

/** Versioned heuristics; they are neither probabilities nor semantic similarity. */
export const RELATION_FORMULA_VERSION = '1.0.0';
export const SEMANTIC_RELATION_WEIGHTS: Readonly<Record<string, number>> = { complementary: .3, scope_variant: .35, partial_overlap: .45, semantic_duplicate: .55, uncertain: .2, exact_duplicate: .6 };
const roles = ['symptom', 'cause', 'check', 'action', 'retest'] as const;
export function membershipStrength(parent: number, child: number): number {
  if (parent <= 0 || child <= 0) return 0;
  return Math.min(1, Math.log1p(child) / Math.log1p(parent));
}
export function roleSimilarity(a: RoleCoverage | undefined, b: RoleCoverage | undefined): number {
  if (!a || !b) return 0;
  let intersection = 0, union = 0;
  for (const role of roles) { intersection += Math.min(a[role], b[role]); union += Math.max(a[role], b[role]); }
  return union ? intersection / union : 0;
}
export function componentStrength(aCount: number, bCount: number, aRole: RoleCoverage | undefined, bRole: RoleCoverage | undefined, aMembership: number, bMembership: number): number {
  if (aCount <= 0 || bCount <= 0) return 0;
  const balance = Math.log1p(Math.min(aCount, bCount)) / Math.log1p(Math.max(aCount, bCount));
  return Math.min(aMembership, bMembership) * balance * roleSimilarity(aRole, bRole);
}
