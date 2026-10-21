/** One motion scale for new-version CSS and the demand-rendered scenes. */
export const MOTION = {
  ms: {
    press: 160,
    color: 180,
    hover: 220,
    enter: 520,
    rise: 640,
    count: 900,
    cinematic: 2800,
    parallax: 940,
  },
  ease: {
    out: 'cubic-bezier(0.16, 1, 0.3, 1)',
    standard: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    press: 'cubic-bezier(0.2, 0.8, 0.2, 1.15)',
  },
  spring: { drive: 9, damp: 7 },
} as const;

/** Exponential blend. About 95% of the way lands near `3000 / durationMs`. */
export function rateFor(durationMs: number): number {
  return 3000 / durationMs;
}

export function frameEase(ratePerSecond: number, deltaSeconds: number, reduced: boolean, cap = 0.2): number {
  if (reduced) return 1;
  return 1 - Math.exp(-ratePerSecond * Math.min(deltaSeconds, cap));
}

export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

export function motionTokenCss(): string {
  return `:root {
  --motion-press: ${MOTION.ms.press}ms;
  --motion-color: ${MOTION.ms.color}ms;
  --motion-hover: ${MOTION.ms.hover}ms;
  --motion-enter: ${MOTION.ms.enter}ms;
  --motion-rise: ${MOTION.ms.rise}ms;
  --motion-ease-out: ${MOTION.ease.out};
  --motion-ease-standard: ${MOTION.ease.standard};
  --motion-ease-press: ${MOTION.ease.press};
}`;
}

export function installMotionTokens(): void {
  if (typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.setAttribute('data-motion-tokens', 'true');
  style.textContent = motionTokenCss();
  document.head.appendChild(style);
}
