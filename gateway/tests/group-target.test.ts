import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP_NAME, isNotificationGroupName, selectNotificationGroup, notificationGroupStatus, validNotificationKey, notificationContent, currentPromoKey, PROMO_IMAGE_URL, loadPromoImage } from "../src/group-target.js";

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

test("ready promos are one image with the entire WhatsApp caption and an isolated key", () => {
  const message = "🔥 *PRODUK AXVARA READY SORE INI*\n" + "-".repeat(52) + "\n✅ Canva — Rp2.000";
  assert.deepEqual(notificationContent(message, "promo"), { image: { url: PROMO_IMAGE_URL }, caption: message });
  assert.equal(PROMO_IMAGE_URL, "https://axvara.tech/banners/ready-promo.webp");
  assert.deepEqual(notificationContent(message, "welcome"), { text: message });
  const key = "wa:promo:2026-11-11:evening";
  assert.equal(validNotificationKey(key, "promo"), true);
  for (const kind of [false, true, "welcome"] as const) assert.equal(validNotificationKey(key, kind), false);
  for (const bad of ["wa:promo:2026-11-11:night", "wa:promo:123@g.us", "wa:sale-completed:AXV-20261111-1234ABCD"]) assert.equal(validNotificationKey(bad, "promo"), false);
});

test("promo keys cannot send before their WIB slot, after it, or on another day", () => {
  for (const [key, now, expected] of [
    ["wa:promo:2026-11-11:morning", "2026-11-11T01:59:59Z", false],
    ["wa:promo:2026-11-11:morning", "2026-11-11T02:00:00Z", true],
    ["wa:promo:2026-11-11:morning", "2026-11-11T04:59:59Z", true],
    ["wa:promo:2026-11-11:morning", "2026-11-11T05:00:00Z", false],
    ["wa:promo:2026-11-11:evening", "2026-11-11T10:00:00Z", true],
    ["wa:promo:2026-11-11:evening", "2026-11-11T13:00:00Z", false],
    ["wa:promo:2026-11-10:evening", "2026-11-11T10:00:00Z", false],
  ] as const) assert.equal(currentPromoKey(key, new Date(now)), expected);
});

test("promo image download is fixed-host, bounded, and fails before a send claim", async t => {
  const calls: unknown[][] = [];
  const stub = t.mock.method(globalThis, "fetch", async (...args: unknown[]) => {
    calls.push(args);
    return new Response(Buffer.from([82,73,70,70]), { headers: { "content-type": "image/webp" } });
  });
  assert.deepEqual(await loadPromoImage(), Buffer.from([82,73,70,70]));
  assert.equal(calls[0][0], PROMO_IMAGE_URL);
  assert.equal((calls[0][1] as RequestInit).redirect, "error");
  for (const response of [new Response('missing', { status: 404 }), new Response('html', { headers: { 'content-type': 'text/html' } }), new Response(null, { headers: { 'content-type': 'image/webp' } }), new Response(new Uint8Array(5*1024*1024+1), { headers: { 'content-type': 'image/webp' } })]) {
    stub.mock.mockImplementation(async () => response);
    await assert.rejects(loadPromoImage(), /promo_image/);
  }
});
