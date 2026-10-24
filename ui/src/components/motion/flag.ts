/**
 * One switch for the five premium motions added in 3.7.8 (#72/#73).
 * Default off. Set this to true to bring all five back together:
 * Liquid Glass Press, Morphing Modal, Border Beam, Thinking Orbs,
 * Spring Drawer + Tilt Card.
 */
export const PREMIUM_MOTION_ENABLED = false;

/** Layout rules in premium-motion.css apply only while this attribute is on. */
export function applyPremiumMotionFlag(root: HTMLElement): void {
  if (PREMIUM_MOTION_ENABLED) root.dataset.premiumMotion = 'on';
  else delete root.dataset.premiumMotion;
}
