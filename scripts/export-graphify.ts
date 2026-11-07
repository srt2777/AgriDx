import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getKnowledgeCatalog, loadKnowledgeCatalog } from '../server/knowledge/catalog';
import { graphTaxonomyNodes } from '../src/pages/KnowledgePage/knowledge-taxonomy-data';
import { learningTaxonomy } from '../src/pages/KnowledgePage/knowledge-learning-graph';

/** Export the current local catalog in Graphify/NetworkX node-link format. */
export function buildGraphifyCatalog() {
  const catalog = loadKnowledgeCatalog();
  const taxonomy = [...graphTaxonomyNodes(catalog), ...(catalog.organization ? learningTaxonomy(catalog.organization, { general: '通用原理', terminology: '农业术语' }) : [])];
  const nodes: Record<string, unknown>[] = taxonomy.map(node => ({
    id: node.id, label: node.label, node_type: node.level, count: node.count,
    scope: node.scope ?? null, catalog_query: node.query, file_type: 'catalog',
  }));
  const links: Record<string, unknown>[] = taxonomy.flatMap(node => node.parent ? [{
    source: node.parent, target: node.id, relation: 'catalog_membership', confidence: 'EXTRACTED',
    evidence: '司稼知识目录归属，非故障因果或兼容性',
  }] : []);
  const seenEntries = new Set<string>();
  const includedModels = new Set(taxonomy.filter(node => node.level === 'model').map(node => node.id));
  for (const brand of catalog.brands) for (const model of brand.models) {
    const modelId = JSON.stringify([brand.id, model.id]);
    if (!includedModels.has(modelId)) continue;
    const selection = getKnowledgeCatalog({ brand: brand.id, model: model.id }).selected;
    for (const entry of selection?.entries ?? []) {
      const id = `entry:${entry.entryId}`;
      if (!seenEntries.has(id)) {
        seenEntries.add(id);
        nodes.push({ id, label: entry.title, node_type: 'evidence', file_type: 'document',
          source_file: entry.knowledgePath, source_id: entry.sourceId, source_title: entry.sourceTitle ?? null,
          source_location: entry.locator, pages: entry.pages ?? null, version: entry.version,
          applicability: entry.scopeBoundary, review_status: entry.status });
      }
      links.push({ source: modelId, target: id, relation: 'catalog_evidence', confidence: 'EXTRACTED',
        evidence: '司稼目录中的资料关联；适用范围和核验状态见原始条目' });
    }
  }
  return { directed: true, multigraph: false,
    graph: { schema_version: 1, origin: 'AgriDx catalog export', kb_version: catalog.kbVersion ?? null,
      limitations: '目录归属与资料关联不代表维修因果、兼容性或实车核验。' }, nodes, links };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  if (argv.length !== 2 || argv[0] !== '--out' || !argv[1].trim()) throw new Error('用法：npm run knowledge:graphify -- --out graphify-out/graph.json');
  const file = path.resolve(argv[1]);
  const graph = buildGraphifyCatalog();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(graph), { flag: 'wx' });
  console.log(`已导出 ${graph.nodes.length} 个节点和 ${graph.links.length} 条资料关联：${file}`);
}
