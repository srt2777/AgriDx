import { EXHIBITS } from './hall-machines';
import { HALL_EXAMPLE_DEVICES } from './hall-example-data';

/** Reuse the eight existing schematics on the campus perimeter, away from pavilions and the central road. */
const POSITIONS: Record<string, [number, number, number]> = {
  a1: [-11, .12, -8.5], a2: [-4.5, .12, -9.2], b2: [4.5, .12, -9.2], b3: [11, .12, -8.5],
  c3: [-11, .12, 8.5], c1: [-4.5, .12, 9.2], d1: [4.5, .12, 9.2], d3: [11, .12, 8.5],
};
export const CAMPUS_EXHIBITS = EXHIBITS.map(item => ({ ...item, position: POSITIONS[item.id], scale: item.scale * .8 }));

export function exhibitForDevice(id: string | null) {
  const device = HALL_EXAMPLE_DEVICES.find(item => item.id === id);
  if (!device) return null;
  return CAMPUS_EXHIBITS.find(item => item.id === id)
    ?? CAMPUS_EXHIBITS.find(item => HALL_EXAMPLE_DEVICES.find(row => row.id === item.id)?.zone === device.zone) ?? null;
}

export function equipmentCamera(id: string, narrow: boolean) {
  const exhibit = exhibitForDevice(id);
  if (!exhibit) return null;
  const [x, , z] = exhibit.position;
  return { look: [x, 1, z] as [number, number, number], position: [x + (narrow ? 8 : 6), narrow ? 9 : 6, z + (narrow ? 11 : 8)] as [number, number, number] };
}
