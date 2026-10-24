export interface CampusSky {
  fog: string;
  top: string;
  horizon: string;
  sun: string;
  ambient: number;
  /** Warm rim mixed only into a thin band at the horizon. */
  glow: string;
  glowAmount: number;
}

export type CampusPeriod = 'night' | 'dawn' | 'day' | 'dusk';

/** Shanghai clock as hours plus a fraction. 06:30 is 6.5. */
export function shanghaiHour(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour + minute / 60;
}

export function campusPeriod(hour: number): CampusPeriod {
  const wrapped = ((hour % 24) + 24) % 24;
  if (wrapped < 5 || wrapped >= 20) return 'night';
  if (wrapped < 9) return 'dawn';
  if (wrapped < 16.5) return 'day';
  return 'dusk';
}

/** Dev-only preview: `?sky=night|dawn|noon|dusk`. Production always uses Shanghai time. */
export function previewHour(): number | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  const hash = window.location.hash;
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const sky = new URLSearchParams(window.location.search).get('sky')
    ?? new URLSearchParams(hashQuery).get('sky');
  if (sky === 'night') return 2;
  if (sky === 'dawn') return 6.5;
  if (sky === 'noon') return 12;
  if (sky === 'dusk') return 18;
  return null;
}

const DARK: Record<CampusPeriod, CampusSky> = {
  night: { fog: '#101820', top: '#122033', horizon: '#1c3348', sun: '#d5e4f0', ambient: 0.7, glow: '#e8c8a4', glowAmount: 0 },
  dawn: { fog: '#142430', top: '#173044', horizon: '#245068', sun: '#e4eef6', ambient: 0.78, glow: '#e8c8a4', glowAmount: 0.48 },
  day: { fog: '#1a2c3a', top: '#1e4664', horizon: '#3d6d84', sun: '#f4f8fb', ambient: 0.9, glow: '#e8c8a4', glowAmount: 0 },
  dusk: { fog: '#121e2c', top: '#15283c', horizon: '#1e4560', sun: '#dce8f2', ambient: 0.74, glow: '#e4b896', glowAmount: 0.3 },
};

const LIGHT: Record<CampusPeriod, CampusSky> = {
  night: { fog: '#d5e0ea', top: '#b7c9da', horizon: '#e3edf4', sun: '#f4f7fb', ambient: 1.05, glow: '#f0d2b4', glowAmount: 0 },
  dawn: { fog: '#e3ebf2', top: '#c5d6e6', horizon: '#dceaf2', sun: '#f4f7fa', ambient: 1.1, glow: '#f0d2b4', glowAmount: 0.28 },
  day: { fog: '#eaf1f6', top: '#c5d7e8', horizon: '#e7f0f6', sun: '#fbfefe', ambient: 1.15, glow: '#f0d2b4', glowAmount: 0 },
  dusk: { fog: '#dce6ef', top: '#c0d0e0', horizon: '#d5e4ee', sun: '#f3f6f8', ambient: 1.06, glow: '#f0cbb0', glowAmount: 0.26 },
};

/** Sky, fog, and sun stay in the blue/teal family. Dawn and dusk only warm a thin horizon rim. */
export function campusSky(theme: 'dark' | 'light', hour = previewHour() ?? shanghaiHour()): CampusSky {
  const period = campusPeriod(hour);
  return theme === 'light' ? LIGHT[period] : DARK[period];
}
