import { CAMPUS_EXHIBITS } from '../../features/campus-equipment/campus-layout';

export type ZoneId = 'knowledge' | 'diagnosis' | 'models' | 'research';
export type DriveAction = 'forward' | 'backward' | 'left' | 'right' | 'brake';
export type WorldMode = 'overview' | 'drive';

export const WORLD_ZONES = [
  {
    id: 'knowledge',
    number: '01',
    zh: '农机知识',
    en: 'Knowledge',
    color: '#85caff',
    x: -7.5,
    z: -5.6,
    arrival: [-4.1, -3.4],
    path: '/knowledge',
  },
  {
    id: 'diagnosis',
    number: '02',
    zh: '智能诊断',
    en: 'Diagnosis',
    color: '#e9bb76',
    x: 7.5,
    z: -5.6,
    arrival: [4.1, -3.4],
    path: '/chat',
  },
  {
    id: 'models',
    number: '03',
    zh: '模型工坊',
    en: 'Model studio',
    color: '#83e1c1',
    x: -7.5,
    z: 5.6,
    arrival: [-4.1, 3.4],
    path: '/models',
  },
  {
    id: 'research',
    number: '04',
    zh: '研究依据',
    en: 'Research',
    color: '#d2dce9',
    x: 7.5,
    z: 5.6,
    arrival: [4.1, 3.4],
    path: '/research',
  },
] as const;

/** All pavilion destinations stay inside the modern workspace. */
export function pavilionDestination(id: ZoneId): { path: '/knowledge' | '/chat' | '/models' | '/research'; classicResearch: false } {
  const zone = WORLD_ZONES.find(item => item.id === id)!;
  return { path: zone.path, classicResearch: false };
}

export interface DriveState {
  x: number;
  z: number;
  heading: number;
  speed: number;
}
export const initialDriveState = (): DriveState => ({ x: 0, z: 1.8, heading: -Math.PI / 2, speed: 0 });
export const KEY_ACTIONS: Readonly<Record<string, DriveAction>> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'backward',
  ArrowDown: 'backward',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'brake',
};

/** The scene is a navigable schematic, with simple boundaries rather than a vehicle simulation. */
export function isWalkable(x: number, z: number): boolean {
  return (
    Number.isFinite(x) &&
    Number.isFinite(z) &&
    Math.abs(x) <= 12.4 &&
    Math.abs(z) <= 10 &&
    WORLD_ZONES.every((zone) => Math.hypot(x - zone.x, z - zone.z) >= 3.1) &&
    CAMPUS_EXHIBITS.every(item => Math.hypot(x - item.position[0], z - item.position[2]) >= 1.55)
  );
}

function moveWithinCampus(state: DriveState, x: number, z: number): DriveState {
  const nextX = Math.max(-12.4, Math.min(12.4, x));
  const nextZ = Math.max(-10, Math.min(10, z));
  if (isWalkable(nextX, nextZ)) return { ...state, x: nextX, z: nextZ };
  // Slide along a boundary so the driver can steer away from a pavilion.
  if (isWalkable(nextX, state.z)) return { ...state, x: nextX, speed: state.speed * 0.6 };
  if (isWalkable(state.x, nextZ)) return { ...state, z: nextZ, speed: state.speed * 0.6 };
  return { ...state, speed: 0 };
}

export function stepDrive(state: DriveState, actions: ReadonlySet<DriveAction>, elapsed: number): DriveState {
  const dt = Math.min(Math.max(elapsed, 0), 0.05);
  const targetSpeed = actions.has('brake')
    ? 0
    : (actions.has('forward') ? 3.7 : 0) - (actions.has('backward') ? 2.5 : 0);
  const speed =
    state.speed + (targetSpeed - state.speed) * (1 - Math.exp(-(actions.has('brake') ? 20 : 7) * dt));
  const steering = Number(actions.has('left')) - Number(actions.has('right'));
  const heading = state.heading + steering * dt * 1.75 * (speed < -0.1 ? -1 : 1);
  const next = { ...state, heading, speed: Math.abs(speed) < 0.008 ? 0 : speed };
  return moveWithinCampus(
    next,
    state.x - Math.cos(heading) * speed * dt,
    state.z + Math.sin(heading) * speed * dt,
  );
}

export function nearbyZone(x: number, z: number): ZoneId | null {
  let closest: ZoneId | null = null;
  let distance = 4.5;
  for (const zone of WORLD_ZONES) {
    const candidate = Math.hypot(x - zone.x, z - zone.z);
    if (candidate < distance) {
      closest = zone.id;
      distance = candidate;
    }
  }
  return closest;
}

export function planRoute(state: DriveState, id: ZoneId): [number, number][] {
  const zone = WORLD_ZONES.find((item) => item.id === id)!;
  const destination: [number, number] = [...zone.arrival];
  const clearLine = (from: readonly [number, number], to: readonly [number, number]) => {
    const steps = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.12);
    for (let i = 0; i <= steps; i++) {
      const fraction = steps ? i / steps : 0;
      if (!isWalkable(from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction))
        return false;
    }
    return true;
  };
  const start: [number, number] = [state.x, state.z];
  if (clearLine(start, destination)) return [destination];
  // A small grid supports visits even when manual exploration ends behind a pavilion.
  const columns = 49,
    rows = 39;
  const point = (index: number): [number, number] => [
    (index % columns) * 0.5 - 12,
    Math.floor(index / columns) * 0.5 - 9.5,
  ];
  const free = Array.from({ length: columns * rows }, (_, index) => {
    const [x, z] = point(index);
    return isWalkable(x, z) && WORLD_ZONES.every((item) => Math.hypot(x - item.x, z - item.z) >= 3.3);
  });
  function closestNode(position: [number, number]) {
    let best = -1,
      distance = Infinity;
    for (let i = 0; i < free.length; i++) {
      if (!free[i]) continue;
      const candidate = point(i);
      const d = Math.hypot(position[0] - candidate[0], position[1] - candidate[1]);
      if (d < distance && clearLine(position, candidate)) {
        best = i;
        distance = d;
      }
    }
    return best;
  }
  const first = closestNode(start),
    last = closestNode(destination);
  if (first < 0 || last < 0) return [];
  const previous = new Int32Array(free.length).fill(-1);
  const queue = [first];
  previous[first] = first;
  for (let cursor = 0; cursor < queue.length && previous[last] < 0; cursor++) {
    const node = queue[cursor];
    const column = node % columns,
      row = Math.floor(node / columns);
    const neighbors = [
      column > 0 ? node - 1 : -1,
      column < columns - 1 ? node + 1 : -1,
      row > 0 ? node - columns : -1,
      row < rows - 1 ? node + columns : -1,
    ];
    for (const neighbor of neighbors)
      if (neighbor >= 0 && free[neighbor] && previous[neighbor] < 0) {
        previous[neighbor] = node;
        queue.push(neighbor);
      }
  }
  if (previous[last] < 0) return [];
  const path: [number, number][] = [destination];
  for (let node = last; node !== first; node = previous[node]) path.unshift(point(node));
  path.unshift(point(first));
  const route: [number, number][] = [];
  let from = start,
    index = 0;
  while (index < path.length) {
    let next = path.length - 1;
    while (next > index && !clearLine(from, path[next])) next--;
    route.push(path[next]);
    from = path[next];
    index = next + 1;
  }
  return route;
}

export function stepRoute(
  state: DriveState,
  point: readonly [number, number],
  elapsed: number,
): { state: DriveState; arrived: boolean } {
  const dt = Math.min(Math.max(elapsed, 0), 0.05);
  const dx = point[0] - state.x,
    dz = point[1] - state.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.08) return { state: { ...state, x: point[0], z: point[1], speed: 0 }, arrived: true };
  const travel = Math.min(3.5 * dt, distance);
  const desiredHeading = Math.atan2(dz, -dx);
  const turn = Math.atan2(Math.sin(desiredHeading - state.heading), Math.cos(desiredHeading - state.heading));
  const next = moveWithinCampus(
    { ...state, heading: state.heading + turn * (1 - Math.exp(-8 * dt)), speed: 3.5 },
    state.x + (dx / distance) * travel,
    state.z + (dz / distance) * travel,
  );
  return { state: next, arrived: false };
}
