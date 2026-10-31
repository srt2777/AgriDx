import type { KnowledgeOrganization } from '../../../shared/knowledge-catalog';
import type { TaxonomyNode } from './knowledge-taxonomy-data';

/** Only existing topic membership is graphed; no diagnostic or causal relation is introduced. */
export function learningTaxonomy(organization: KnowledgeOrganization, labels: { general: string; terminology: string }): TaxonomyNode[] {
  const nodes: TaxonomyNode[] = [];
  for (const [order, kind] of (['general', 'terminology'] as const).entries()) {
    const id = JSON.stringify(['learning', kind]);
    const query = { collection: 'learning', kind };
    nodes.push({ id, label: labels[kind], level: 'brand', order, count: organization.counts[kind], query });
    organization.topics.filter(topic => topic.kind === kind).forEach((topic, topicOrder) => {
      nodes.push({ id: JSON.stringify(['learning', kind, topic.name]), parent: id, label: topic.name, level: 'model',
        order: topicOrder, count: topic.count, query: { ...query, topic: topic.name } });
    });
  }
  return nodes;
}
