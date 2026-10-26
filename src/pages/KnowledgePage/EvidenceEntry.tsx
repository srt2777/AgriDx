import { useUiCopy } from '@/ui/useUiCopy';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronRight, FileText, ShieldCheck } from 'lucide-react';
import type { CatalogEntry } from '@shared/knowledge-catalog';
import { useLang } from '@/hooks/useLang';
import { useUiVersion } from '@/hooks/useUiVersion';
import DeferredMarkdown from '@/components/DeferredMarkdown';
import { KnowledgePeek } from '@/components/CardPeek';

interface DiagnosisState {
  machineType?: string;
  brand?: string;
  model?: string;
  question: string;
}

export default function EvidenceEntry({ entry, diagnosisState }: { entry: CatalogEntry; diagnosisState: DiagnosisState }) {
  const lang = useLang();
  const version = useUiVersion();
  const { t, format, separator } = useUiCopy(lang);
  const [open, setOpen] = useState(false);
  return <details className="evidence-entry" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>
      <FileText size={20} strokeWidth={1.4} />
      <div><h3>{format(entry.title)}</h3><span>{entry.entryId}{separator}{entry.entryType}{separator}{entry.locator || t('定位待核实', 'Locator unconfirmed')}{separator}{entry.status}</span></div>
      {version === 'new' && <KnowledgePeek kind="archive" caption={entry.entryType} />}
      <ChevronRight size={18} className="evidence-toggle" />
    </summary>
    {open && <div className="evidence-entry-body">
      <dl className="evidence-provenance">
        <div><dt>{t('资料来源', 'Source')}</dt><dd>{entry.sourceUrl ? <a href={entry.sourceUrl} target="_blank" rel="noreferrer">{entry.sourceId}</a> : entry.sourceId}</dd></div>
        <div><dt>{t('版次 / 页码 / 定位', 'Version / pages / locator')}</dt><dd>{entry.version || t('版次待核实', 'Version unconfirmed')}{entry.pages?.pdf || entry.pages?.printed ? `${separator}${t('页码', 'Pages')} ${entry.pages.pdf ?? entry.pages.printed}` : ''}{separator}{entry.locator || t('定位待核实', 'Locator unconfirmed')}</dd></div>
        <div><dt>{t('适用范围', 'Applicability')}</dt><dd>{entry.scopeBoundary || t('待核实', 'Needs verification')}</dd></div>
      </dl>
      <div className="prose prose-sm max-w-none overflow-x-auto dark:prose-invert"><DeferredMarkdown>{entry.content}</DeferredMarkdown></div>
      <div className="evidence-entry-footer">
        <span><ShieldCheck size={15} />{t('资料没有给出的数值与关联，需进一步核实。', 'Unspecified parameters and relationships need verification.')}</span>
        <Link to="/chat" state={diagnosisState} className="hero-text-link">{t('围绕这条资料提问', 'Ask about this evidence')}<ArrowRight size={15} /></Link>
      </div>
    </div>}
  </details>;
}
