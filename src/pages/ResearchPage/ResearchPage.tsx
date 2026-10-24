import ResearchSection from '@/pages/HomePage/sections/ResearchSection';
import { useUiCopy } from '@/ui/useUiCopy';

/** Reuse the existing references without switching the visitor's interface version. */
export default function ResearchPage() {
  const { t } = useUiCopy();
  return <div className="page-container modern-research-page"><h1>{t('研究依据', 'Research')}</h1><ResearchSection /></div>;
}
