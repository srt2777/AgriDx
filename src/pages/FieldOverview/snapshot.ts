// Fixed demonstration snapshot. No field, machine or weather feed is connected.
export type Status = 'working' | 'standby' | 'offline';
export const statusNames = {
  working: ['作业中', 'Working'],
  standby: ['待机', 'Standby'],
  offline: ['离线', 'Offline'],
} as const;
export interface Machine {
  id: string;
  kind: 'tractor' | 'combine' | 'seeder';
  plot: string;
  status: Status;
  area: number;
  hours: number;
  fuel: number;
}
export const kindNames = {
  tractor: ['轮式拖拉机', 'Wheel tractor'],
  combine: ['联合收割机', 'Combine harvester'],
  seeder: ['播种机组', 'Seeding unit'],
} as const;
export const machines: Machine[] = [
  { id: 'TR-01', kind: 'tractor', plot: 'A-01', status: 'working', area: 56.4, hours: 6.8, fuel: 28.6 },
  { id: 'HV-02', kind: 'combine', plot: 'B-02', status: 'working', area: 48.2, hours: 6.1, fuel: 30.1 },
  { id: 'SD-03', kind: 'seeder', plot: 'C-01', status: 'working', area: 42.6, hours: 5.4, fuel: 21.5 },
  { id: 'TR-04', kind: 'tractor', plot: 'A-03', status: 'standby', area: 26.8, hours: 3.5, fuel: 13.4 },
  { id: 'TR-05', kind: 'tractor', plot: 'A-02', status: 'working', area: 52.3, hours: 6.2, fuel: 27.8 },
  { id: 'HV-06', kind: 'combine', plot: 'B-01', status: 'working', area: 38.5, hours: 5.8, fuel: 26.2 },
  { id: 'SD-07', kind: 'seeder', plot: 'C-02', status: 'working', area: 37.2, hours: 5.0, fuel: 19.8 },
  { id: 'TR-08', kind: 'tractor', plot: 'A-03', status: 'standby', area: 24.8, hours: 3.8, fuel: 16.8 },
  { id: 'TR-09', kind: 'tractor', plot: '—', status: 'offline', area: 0, hours: 0, fuel: 0 },
  { id: 'HV-10', kind: 'combine', plot: '—', status: 'offline', area: 0, hours: 0, fuel: 0 },
];
export const statuses = Object.keys(statusNames) as Status[];
export const counts = Object.fromEntries(
  statuses.map((status) => [status, machines.filter((machine) => machine.status === status).length]),
) as Record<Status, number>;
function total(key: 'area' | 'hours' | 'fuel') {
  return Number(machines.reduce((sum, machine) => sum + machine[key], 0).toFixed(1));
}
export const totals = {
  area: total('area'),
  hours: total('hours'),
  fuel: total('fuel'),
  online: machines.length - counts.offline,
};
export const history = {
  area: [240.2, 274.0, 258.4, 306.8, 284.2, 301.2, totals.area],
  online: [5, 6, 6, 7, 6, 7, totals.online],
  hours: [29.4, 33.8, 32.2, 38.6, 35.2, 39.2, totals.hours],
  fuel: [154.5, 170.4, 160.2, 178.9, 162.6, 174.4, totals.fuel],
};
export const shifts = {
  day: {
    labels: ['06–08', '08–10', '10–12', '12–14', '14–16', '16–18', '18–20'],
    values: [8.4, 40.8, 59.2, 43.8, 75.6, 57.4, 41.6],
  },
  week: { labels: ['10/31', '11/01', '11/02', '11/03', '11/04', '11/05', '11/06'], values: history.area },
};
