import type { KnowledgeRelations } from './knowledge-relations';

/** The complete graph can exceed the engine's maximum string length. Keep the
 * normal JSON wire format, including property order, without joining all edges. */
export function* relationJsonChunks(relations: KnowledgeRelations): Generator<string> {
  let prefix = '{';
  for (const [key, value] of Object.entries(relations)) {
    if (value === undefined) continue;
    const field = prefix + JSON.stringify(key) + ':';
    prefix = ',';
    if (key !== 'edges') {
      yield field + JSON.stringify(value);
      continue;
    }
    yield field + '[';
    const batchSize = 256;
    for (let start = 0; start < relations.edges.length; start += batchSize) {
      const batch = relations.edges.slice(start, start + batchSize);
      yield (start ? ',' : '') + batch.map(edge => JSON.stringify(edge)).join(',');
    }
    yield ']';
  }
  yield '}';
}
