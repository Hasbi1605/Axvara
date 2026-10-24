import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP_NAME, isNotificationGroupName, selectNotificationGroup, notificationGroupStatus } from "../src/group-target.js";

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
