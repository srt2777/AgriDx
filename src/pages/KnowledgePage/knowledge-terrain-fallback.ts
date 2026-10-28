import type { RelationEdge } from '../../../shared/knowledge-relations';
import { membershipStrength } from '../../../shared/relation-strength';
import type { TaxonomyNode } from './knowledge-taxonomy-data';

/** Recover only catalog membership when relation evidence is unavailable. */
export function terrainMemberships(nodes: readonly TaxonomyNode[]): RelationEdge[] {
  const index=new Map(nodes.map(node=>[node.id,node])), edges:RelationEdge[]=[];
  for(const child of nodes){if(!child.parent)continue;const parent=index.get(child.parent);if(!parent)continue;
    edges.push({from:parent.id,to:child.id,type:'membership',strength:membershipStrength(parent.count,child.count),basis:'目录归属',evidence:{parentCount:parent.count,childCount:child.count}});
  }
  return edges;
}
