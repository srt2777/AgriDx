import type { RelationEdge } from '../../../shared/knowledge-relations';
import type { TaxonomyNode } from './knowledge-taxonomy-data';

/** Cache entries must change with snapshot, fallback mode, grid, filtering or relation data. */
export function terrainCacheKey(version:string|null, warning:string, width:number, height:number, nodes:readonly TaxonomyNode[], edges:readonly RelationEdge[]):string {
  return JSON.stringify([version,warning,width,height,nodes.map(node=>[node.id,node.count]),edges.map(edge=>[edge.from,edge.to,edge.type,edge.strength])]);
}
