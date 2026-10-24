import type { ReactNode } from 'react';
import { useUiVersion } from '@/hooks/useUiVersion';
import { useUiCopy } from './useUiCopy';

/** Keep important evidence boundaries discoverable without filling the page. */
export function ClassicDisclosure({ children }: { children: ReactNode }) {
  const version = useUiVersion();
  const { t } = useUiCopy();
  if (version !== 'old') return <>{children}</>;
  return <details className="classic-disclosure"><summary>{t('资料适用范围', 'Applicability')}</summary>{children}</details>;
}
