import type { UiVersion } from '@/hooks/useUiVersion';

/** Independent interface release numbers; the project build version remains separate. */
export const UI_RELEASES: Record<UiVersion, string> = {
  new: 'NV1.2',
  old: 'OV1.5',
};
