/** First impression after choosing the new campus. Reduced motion skips the flight. */
export const CAMPUS_INTRO_MS = 4800;
export const CAMPUS_TITLE_REVEAL_MS = 1400;

export function campusIntroPlan(reduced: boolean): { play: boolean; holdMs: number; titleMs: number } {
  if (reduced) return { play: false, holdMs: 0, titleMs: 0 };
  return { play: true, holdMs: CAMPUS_INTRO_MS, titleMs: CAMPUS_TITLE_REVEAL_MS };
}
