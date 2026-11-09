import { useEffect } from 'react';
import { bindCardSpotlight } from '@/components/motion/useCardSpotlight';
import './card-spotlight.css';

/** Mount once. Cards opt in with `card-spotlight`; the glow follows the pointer in CSS. */
export function CardSpotlight() {
  useEffect(() => bindCardSpotlight(document), []);
  return null;
}
