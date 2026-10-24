import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP_NAME, isNotificationGroupName, selectNotificationGroup, notificationGroupStatus, validNotificationKey } from "../src/group-target.js";

test("recognizes the production AXVARA’S subject and equivalent typography", () => {
  for (const subject of [GROUP_NAME, "AXVARA’S", "AXVARA‘S", "Axvaraʼs", " axvara's ", "ＡＸＶＡＲＡ＇Ｓ"]) {
    assert.equal(isNotificationGroupName(subject), true, subject);
    const group = { id: "123@g.us", subject };
    assert.equal(selectNotificationGroup([group]).id, group.id);
    assert.equal(selectNotificationGroup([group]).subject, subject);
  }
});

test("never treats missing apostrophes, other words or lookalikes as the destination", () => {
  for (const subject of ["AXVARAS", "AXVARA'S STORE", "MY AXVARA'S", "AXVARA'S 2", "АXVARA'S", ""]) {
    assert.equal(isNotificationGroupName(subject), false, subject);
    assert.throws(() => selectNotificationGroup([{ id: "456@g.us", subject }]), /belum ditemukan/);
  }
});

test("selects only an unambiguous target and refuses typography collisions", () => {
  const target = { id: "123@g.us", subject: "AXVARA’S" };
  assert.equal(selectNotificationGroup([{ id: "456@g.us", subject: "OTHER" }, target]), target);
  assert.throws(() => selectNotificationGroup([target, { id: "789@g.us", subject: GROUP_NAME }]), /beberapa grup/);
  assert.throws(() => selectNotificationGroup([]), /belum ditemukan/);
});

test("status satisfies Pages activation while preserving the actual WhatsApp title", () => {
  const group = selectNotificationGroup([{ id: "123@g.us", subject: "AXVARA’S" }]);
  assert.deepEqual(notificationGroupStatus(group), { groupId: group.id, groupName: GROUP_NAME, groupSubject: "AXVARA’S" });
  assert.deepEqual(notificationGroupStatus(null), { groupId: undefined, groupName: undefined, groupSubject: undefined });
});

test("broadcast and transaction keys cannot cross endpoints or address arbitrary recipients", async () => {
  const {validNotificationKey}=await import('../src/group-target.js');
  const broadcast='wa:broadcast:22222222-2222-4222-8222-222222222222';
  const sale='wa:sale-completed:AXV-20261024-1234ABCD';
  assert.equal(validNotificationKey(broadcast,true),true);
  assert.equal(validNotificationKey(broadcast,false),false);
  assert.equal(validNotificationKey(sale,false),true);
  assert.equal(validNotificationKey(sale,true),false);
  assert.equal(validNotificationKey('wa:broadcast:123@s.whatsapp.net',true),false);
});

test('welcome keys have their own durable namespace', () => {
  const key = 'wa:welcome:' + 'a'.repeat(64);
  assert.equal(validNotificationKey(key, 'welcome'), true);
  assert.equal(validNotificationKey(key, true), false);
  assert.equal(validNotificationKey(key, false), false);
  assert.equal(validNotificationKey('wa:broadcast:11111111-1111-4111-8111-111111111111', 'welcome'), false);
});
