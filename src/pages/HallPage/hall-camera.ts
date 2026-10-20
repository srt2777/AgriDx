import { HALL_ZONES, type HallZoneId } from './hall-example-data';

/** Default isometric overview. A zone offset is used only after the visitor picks one. */
export const HALL_OVERVIEW = {
  position: [16.2, 13.2, 16.2] as [number, number, number],
  look: [0, 0.35, 0.1] as [number, number, number],
};

const CLOSE = [6.4, 5.6, 6.4] as const;
const WIDE = [8.8, 7.8, 8.8] as const;

export function hallCameraGoal(focus: HallZoneId | null, width: number): {
  position: [number, number, number];
  look: [number, number, number];
} {
  if (!focus) return { position: [...HALL_OVERVIEW.position], look: [...HALL_OVERVIEW.look] };
  const zone = HALL_ZONES.find((item) => item.id === focus)!;
  const offset = width < 720 ? WIDE : CLOSE;
  return {
    position: [zone.position[0] + offset[0], offset[1], zone.position[2] + offset[2]],
    look: [zone.position[0], 0.55, zone.position[2]],
  };
}
