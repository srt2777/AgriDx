import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAMPUS_EXHIBITS, equipmentCamera, exhibitForDevice } from '../src/features/campus-equipment/campus-layout';
import { HALL_EXAMPLE_DEVICES, HALL_ZONES } from '../src/features/campus-equipment/hall-example-data';
import { isWalkable, WORLD_ZONES } from '../src/pages/ExhibitionPage/world-navigation';
import { filterCommands } from '../src/lib/command-routes';

test('合并保留八个原有结构示意、十二条记录和四类装备，不把记录数冒充模型数', () => {
  assert.deepEqual(CAMPUS_EXHIBITS.map(item => item.id), ['a1','a2','b2','b3','c3','c1','d1','d3']);
  assert.equal(HALL_EXAMPLE_DEVICES.length, 12);
  assert.equal(HALL_ZONES.length, 4);
  for (const device of HALL_EXAMPLE_DEVICES) {
    const schematic = exhibitForDevice(device.id);
    assert.ok(schematic);
    assert.equal(HALL_EXAMPLE_DEVICES.find(row => row.id === schematic.id)?.zone, device.zone);
  }
  assert.equal(exhibitForDevice('unknown'), null);
  assert.notEqual(exhibitForDevice('a3')?.id, 'a3');
});

test('装备落在大厅地面内、避开原展台与中心道路，漫游不会穿过展品', () => {
  for (const item of CAMPUS_EXHIBITS) {
    const [x, , z] = item.position;
    assert.ok(Math.abs(x) + 1.5 < 14.5 && Math.abs(z) + 1.5 < 12);
    assert.ok(Math.abs(z) >= 8.5);
    for (const zone of WORLD_ZONES) assert.ok(Math.hypot(x-zone.x,z-zone.z) > 4.5);
    assert.equal(isWalkable(x,z), false);
  }
  assert.equal(isWalkable(0,0), true);
});

test('设备镜头在同一园区定位，手机视角更远；非法记录不改变镜头', () => {
  const desktop = equipmentCamera('c1', false)!;
  const mobile = equipmentCamera('c1', true)!;
  assert.deepEqual(desktop.look, mobile.look);
  assert.ok(mobile.position[1] > desktop.position[1]);
  assert.ok(Math.hypot(...mobile.position.map((v,i) => v-mobile.look[i])) > Math.hypot(...desktop.position.map((v,i) => v-desktop.look[i])));
  assert.equal(equipmentCamera('invalid', false), null);
  assert.deepEqual(equipmentCamera('a3',false), equipmentCamera('a1',false));
});

test('快速导航不再产生独立展厅入口，旧搜索词仍能找到大厅', () => {
  for (const word of ['展厅','hall','equipment']) assert.equal(filterCommands(word)[0]?.path, '/');
  assert.equal(filterCommands('').some(item => item.path === '/hall'), false);
});
