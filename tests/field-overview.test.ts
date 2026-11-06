import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { counts, history, machines, shifts, statuses, totals } from '../src/pages/FieldOverview/snapshot';

test('the demo register, overview and area chart describe the same snapshot', () => {
  assert.equal(new Set(machines.map(machine => machine.id)).size, machines.length);
  assert.equal(statuses.reduce((n, status) => n + counts[status], 0), machines.length);
  assert.equal(totals.online, counts.working + counts.standby);
  assert.equal(shifts.day.values.reduce((sum, value) => sum + Math.round(value * 10), 0), Math.round(totals.area * 10));
  assert.equal(shifts.week.values.at(-1), totals.area);
  for (const key of ['area', 'online', 'hours', 'fuel'] as const) {
    assert.equal(history[key].at(-1), totals[key]);
  }
});
