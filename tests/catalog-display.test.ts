import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { displayArchiveEntry, hiddenCatalogBrand } from '../src/pages/KnowledgePage/catalog-display';

test('display hides the chosen brand while preserving the indexed entry and its source', () => {
  const result = getKnowledgeCatalog({ collection: 'archive', q: 'KB-QX-QY210PRO-V01-010' });
  const entry = result.library?.entries[0];
  assert.ok(entry && entry.collection === 'archive');
  assert.equal(entry.brand, hiddenCatalogBrand);
  const displayed = displayArchiveEntry(entry);
  assert.doesNotMatch(`${displayed.title} ${displayed.content} ${displayed.scopeBoundary}`, /千寻|千耘/);
  assert.match(entry.title, /千寻/);
  assert.equal(displayed.sourceUrl, entry.sourceUrl);
  assert.equal(displayed.entryId, entry.entryId);
  assert.equal(displayed.knowledgePath, entry.knowledgePath);
  assert.equal(result.library?.total, 1);
});

test('all indexed entries for this brand retain their sources and hide names in displayed fields', () => {
  const catalog = getKnowledgeCatalog({ collection: 'archive', q: 'KB-QX-QY210PRO-V01' });
  const entries = catalog.library?.entries ?? [];
  assert.equal(entries.length, 10);
  for (const entry of entries) {
    assert.equal(entry.collection, 'archive');
    const shown = displayArchiveEntry(entry);
    assert.doesNotMatch(`${shown.title} ${shown.content} ${shown.status} ${shown.collection === 'archive' ? `${shown.locator} ${shown.scopeBoundary}` : ''}`, /千寻|千耘/);
    assert.equal(shown.entryId, entry.entryId);
  }
});
