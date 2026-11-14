import { test } from 'node:test';
import assert from 'node:assert/strict';
import { literatureExclusionReason } from '../shared/literature-quality';
test('notice and unrelated records are excluded even in an agricultural journal', () => {
  for (const title of ['Editorial: tractor research', 'Correction: tractor transmission analysis', 'Milk protein composition and nutrition', 'Seed transmission of Papaya meleira virus', 'Studies of Tiller Formation in Reed Canarygrass', '江苏省农机补贴审核公告']) assert.ok(literatureExclusionReason({title}));
  assert.equal(literatureExclusionReason({title:'Fault diagnosis of tractor hydraulic systems under varying loads'}), null);
  assert.ok(literatureExclusionReason({title:'Fault diagnosis of tractor hydraulic systems', updates:[{type:'retraction'}]}));
});
