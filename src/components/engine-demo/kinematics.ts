// Illustrative units: crank radius .32, connecting rod length 1.12.
export function pistonPosition(angle: number) {
  const radius = .32, rod = 1.12;
  return radius * Math.cos(angle) + Math.sqrt(rod * rod - radius * radius * Math.sin(angle) ** 2);
}
