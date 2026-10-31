import { useUiCopy } from '@/ui/useUiCopy';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronRight, Search } from 'lucide-react';
import type { KnowledgeLibrary, KnowledgeOrganization, LibraryEntry, LibraryKind } from '@shared/knowledge-catalog';
import DeferredMarkdown from '@/components/DeferredMarkdown';
import { KnowledgePeek } from '@/components/CardPeek';
import { useUiVersion } from '@/hooks/useUiVersion';

function LibraryCard({ entry, lang }: { entry: LibraryEntry; lang: string }) {
  const [open, setOpen] = useState(false);
  const version = useUiVersion();
  const { t, format, separator } = useUiCopy(lang);
  const terminology = entry.collection === 'learning' && entry.learningKind === 'terminology';
  const category = terminology ? t('术语参考', 'Terminology reference') : entry.collection === 'learning' ? t('通识学习', 'General learning') : t('来源归档', 'Source archive');
  return <details className="evidence-entry" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><BookOpen size={20} strokeWidth={1.4} /><div><h3>{format(entry.title)}</h3>
      <span>{entry.entryId}{separator}{category}{(version === 'new' || format(entry.entryType) !== category) && <>{separator}{format(entry.entryType)}</>}</span>
    </div>{version === 'new' && <KnowledgePeek kind={entry.collection === 'learning' ? 'learning' : 'archive'} caption={entry.entryType} />}<ChevronRight size={18} className="evidence-toggle" /></summary>
    {open && <div className="evidence-entry-body">
      <dl className="evidence-provenance">
        <div><dt>{t('核验状态', 'Verification status')}</dt><dd>{entry.status}</dd></div>
        {entry.collection === 'learning' ? <>
          <div><dt>{t('学习主题', 'Learning topic')}</dt><dd>{entry.topic}</dd></div>
          <div><dt>{t('使用范围', 'Use')}</dt><dd>{terminology
            ? t('中英文术语与词表关系查阅；上位和关联词不表示部件组成、故障因果或机型适配。', 'Chinese/English vocabulary and thesaurus relationships; broader or related terms do not prove components, fault causes or model applicability.')
            : t('参与问答的原理解释与待验证分析；未逐条原厂或实车核验，不作为本机维修操作或参数依据。', 'Used in answers for general principles and tentative analysis; not individually OEM or vehicle verified, or evidence for model-specific repairs or parameters.')}</dd></div>
          {terminology && entry.sourceUrl && <div><dt>{t('概念来源', 'Concept source')}</dt><dd><a href={entry.sourceUrl} target="_blank" rel="noreferrer">FAO AGROVOC</a></dd></div>}
        </> : <>
          <div><dt>{t('资料来源 / 定位', 'Source / locator')}</dt><dd>{entry.sourceUrl ? <a href={entry.sourceUrl} target="_blank" rel="noreferrer">{entry.sourceId}</a> : entry.sourceId}{separator}{entry.locator}{separator}{entry.version}</dd></div>
          <div><dt>{t('适用范围', 'Applicability')}</dt><dd>{entry.scopeBoundary}</dd></div>
        </>}
      </dl>
      <div className="prose prose-sm max-w-none overflow-x-auto dark:prose-invert"><DeferredMarkdown>{entry.content}</DeferredMarkdown></div>
      {entry.collection === 'archive' && <div className="evidence-entry-footer"><Link className="hero-text-link" to={`/knowledge?${new URLSearchParams({ brand: entry.brand, model: entry.models[0] })}`}>
        {t('查看这份资料的机型目录', 'Open this document’s model directory')}<ChevronRight size={15} />
      </Link></div>}
    </div>}
  </details>;
}

export default function KnowledgeLibraryBrowser({ library, organization, filters, lang, onChange }: {
  library: KnowledgeLibrary;
  organization?: KnowledgeOrganization;
  filters: { kind?: string; topic?: string; entryType?: string };
  lang: string;
  onChange: (values: { q?: string; page?: string; collection?: string; kind?: string; topic?: string; entryType?: string; role?: string }) => void;
}) {
  const { t, format, separator } = useUiCopy(lang);
  const pages = Math.max(1, Math.ceil(library.total / library.pageSize));
  const kinds: { id: LibraryKind; label: string }[] = [
    { id: 'archive', label: t('来源归档', 'Source archives') },
    { id: 'general', label: t('通用原理', 'General principles') },
    { id: 'terminology', label: t('农业术语', 'Agricultural terminology') },
  ];
  const topics = organization?.topics.filter(topic => topic.kind === filters.kind) ?? [];
  return <section className="unified-library" aria-labelledby="unified-library-heading">
    <div className="catalog-evidence-heading"><h2 id="unified-library-heading">{t('知识目录', 'Knowledge catalog')}</h2>
      <span>{t(`当前 ${library.total.toLocaleString()} 条 · 第 ${library.page} / ${pages} 页`, `${library.total.toLocaleString()} entries · Page ${library.page} / ${pages}`)}</span></div>
    {organization && <div className="library-organizer" aria-label={t('按资料分类', 'Browse by collection')}>
      <label><span>{t('资料分类', 'Collection')}</span><select value={filters.kind ?? ''} onChange={event => {
        const kind = event.target.value;
        onChange({ collection: kind ? kind === 'archive' ? 'archive' : 'learning' : 'all', kind, topic: '', entryType: '', role: '' });
      }}><option value="">{t('全部分类', 'All collections')}</option>{kinds.map(({ id, label }) => <option value={id} key={id}>{label} ({organization.counts[id].toLocaleString()})</option>)}</select></label>
      {(filters.kind === 'general' || filters.kind === 'terminology') && <label><span>{t('主题', 'Topic')}</span><select value={filters.topic ?? ''} onChange={event => onChange({ topic: event.target.value })}>
        <option value="">{t('全部主题', 'All topics')}</option>{topics.map(topic => <option value={topic.name} key={topic.name}>{format(topic.name)} ({topic.count})</option>)}
      </select></label>}
      {filters.kind === 'archive' && <label><span>{t('资料类型', 'Archive type')}</span><select value={filters.entryType ?? ''} onChange={event => onChange({ entryType: event.target.value })}>
        <option value="">{t('全部类型', 'All types')}</option>{organization.archiveTypes.map(type => <option value={type.name} key={type.name}>{format(type.name)} ({type.count})</option>)}
      </select></label>}
    </div>}
    <form className="library-search" key={library.query} onSubmit={event => {
      event.preventDefault();
      onChange({ q: String(new FormData(event.currentTarget).get('q') ?? '').trim() });
    }}>
      <label className="sr-only" htmlFor="library-query">{t('搜索全部知识正文、标题或编号', 'Search knowledge text, titles or IDs')}</label>
      <input id="library-query" name="q" type="search" maxLength={100} defaultValue={library.query} placeholder={t('搜索正文、标题、编号或学习主题', 'Search text, title, ID or learning topic')} />
      <button type="submit" className="catalog-action"><Search size={16} />{t('搜索', 'Search')}</button>
      {library.query && <button type="button" className="catalog-reset" onClick={() => onChange({ q: '' })}>{t('清除', 'Clear')}</button>}
    </form>
    {library.entries.length ? library.entries.map(entry => <LibraryCard key={entry.entryId} entry={entry} lang={lang} />)
      : <div className="catalog-empty"><BookOpen size={25} /><p>{t('没有找到匹配条目，请更换关键词或资料类型。', 'No matching entries. Try another keyword or collection.')}</p></div>}
    <nav className="library-pagination" aria-label={t('知识目录分页', 'Knowledge library pagination')}>
      <button className="catalog-action" disabled={library.page <= 1} onClick={() => onChange({ page: String(library.page - 1) })}>{t('上一页', 'Previous')}</button>
      <span>{library.page} / {pages}</span>
      <button className="catalog-action" disabled={library.page >= pages} onClick={() => onChange({ page: String(library.page + 1) })}>{t('下一页', 'Next')}</button>
    </nav>
  </section>;
}
