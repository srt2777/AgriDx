import type { LibraryEntry } from '@shared/knowledge-catalog';

/** Display-only naming preference; archived records and source links remain unchanged. */
export const hiddenCatalogBrand = '千寻位置';
export function displayArchiveEntry(entry: LibraryEntry): LibraryEntry {
  if (entry.collection !== 'archive' || entry.brand !== hiddenCatalogBrand) return entry;
  const display = (value: string) => value.replaceAll('千寻位置 / 千耘', '导航系统').replaceAll('千寻位置', '导航系统').replaceAll('千寻服务', '定位服务').replaceAll('千寻', '定位服务').replaceAll('千耘', '导航系统');
  return { ...entry, title: display(entry.title), content: display(entry.content),
    locator: display(entry.locator), scopeBoundary: display(entry.scopeBoundary), status: display(entry.status) };
}
