export interface GlassInteraction {
  x: number;
  y: number;
  active: boolean;
  pressed: boolean;
}

export interface GlassOpticsHandle {
  update: (interaction: GlassInteraction) => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** A bounded, aspect-correct normal map for the actual rounded rectangle, not a stretched stock texture. */
export function createGlassMaps(width: number, height: number, cornerRadius: number, maxPixels = 98_304) {
  const factor = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  const shortSide = Math.max(1, Math.floor(Math.min(width, height) * factor));
  const longSide = Math.max(1, Math.min(Math.floor(maxPixels / shortSide), Math.round(shortSide * Math.max(width, height) / Math.min(width, height))));
  const mapWidth = width >= height ? longSide : shortSide;
  const mapHeight = width >= height ? shortSide : longSide;
  const radius = clamp(cornerRadius, 0, Math.min(width, height) / 2);
  const band = Math.min(24, Math.min(width, height) * .38);
  const normal = new Uint8ClampedArray(mapWidth * mapHeight * 4);
  const rim = new Uint8ClampedArray(normal.length);

  for (let row = 0; row < mapHeight; row++) {
    for (let column = 0; column < mapWidth; column++) {
      const x = (column + .5) / mapWidth * width - width / 2;
      const y = (row + .5) / mapHeight * height - height / 2;
      const qx = Math.abs(x) - width / 2 + radius;
      const qy = Math.abs(y) - height / 2 + radius;
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const length = Math.hypot(ox, oy);
      const depth = -(length + Math.min(Math.max(qx, qy), 0) - radius);
      const t = clamp(depth / band, 0, 1);
      const weight = depth >= 0 ? 1 - t * t * (3 - 2 * t) : 0;
      const nx = length > 0 ? ox / length * Math.sign(x) : qx > qy ? Math.sign(x) : 0;
      const ny = length > 0 ? oy / length * Math.sign(y) : qy >= qx ? Math.sign(y) : 0;
      const index = (row * mapWidth + column) * 4;
      normal[index] = 128 + nx * weight * 120;
      normal[index + 1] = 128;
      normal[index + 2] = 128 + ny * weight * 120;
      normal[index + 3] = 255;
      rim[index] = rim[index + 1] = rim[index + 2] = 255;
      rim[index + 3] = weight * 255;
    }
  }
  return { width: mapWidth, height: mapHeight, normal, rim };
}

/** Clamp long frame gaps so a restored tab cannot launch an unstable spring. */
export function stepGlassSpring(position: number, velocity: number, target: number, seconds: number) {
  const dt = clamp(seconds, 0, 1 / 30);
  const nextVelocity = velocity + ((target - position) * 360 - velocity * 30) * dt;
  const nextPosition = position + nextVelocity * dt;
  const settled = Math.abs(target - nextPosition) < .0008 && Math.abs(nextVelocity) < .008;
  return { position: settled ? target : nextPosition, velocity: settled ? 0 : nextVelocity, settled };
}
