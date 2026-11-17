import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import Fastify from "fastify";
import { proto } from "@whiskeysockets/baileys";
import {
  BOT_NUMBER,
  deliveryClaim,
  groupAllowsBotSend,
  initializePromoRuntime,
  pool,
  PROMO_BOT_NUMBER,
  PROMO_BOT_REVISION,
} from "../src/durable.js";
import {
  currentPromoBotKey,
  currentPromoKey,
  PROMO_IMAGE_URL,
  promoBotKeyMatchesTarget,
  validPromoBotKey,
} from "../src/group-target.js";
import { registerPromoBot } from "../src/promo-bot.js";

const PROMO_PHONE = "628999888777";
const OTHER_PHONE = "628555444333";
const GROUP_A = "120363412672344593@g.us";
const GROUP_B = "628123456789-1612345678@g.us";

function createFakeSocket(phone: string) {
  const evEmitter = new EventEmitter();
  const ev = {
    on: (event: string, listener: (...args: any[]) => void) => evEmitter.on(event, listener),
    removeAllListeners: (event?: string) => evEmitter.removeAllListeners(event),
    emit: (event: string, ...args: any[]) => evEmitter.emit(event, ...args),
  };
  const calls = {
    ended: 0,
    requestPairingCode: [] as string[],
    groupFetchAllParticipating: 0,
    groupMetadata: [] as string[],
    sendMessage: [] as Array<{ target: string; content: unknown }>,
  };
  let participatingGroups: Record<string, any> = {};
  let sendImpl: (target: string, content: unknown) => Promise<any> = async () => ({
    key: { id: "WA-PROMO-MSG-1" },
    message: proto.Message.fromObject({ imageMessage: { caption: "ok", mediaKey: Buffer.from([1, 2, 3]) } }),
  });

  const socket = {
    ev,
    user: { id: `${phone}:1@s.whatsapp.net`, lid: "promo-lid@lid" },
    end: async () => {
      calls.ended += 1;
    },
    requestPairingCode: async (num: string) => {
      calls.requestPairingCode.push(num);
      return "ABCD-EFGH";
    },
    groupFetchAllParticipating: async () => {
      calls.groupFetchAllParticipating += 1;
      return participatingGroups;
    },
    groupMetadata: async (jid: string) => {
      calls.groupMetadata.push(jid);
      if (!participatingGroups[jid]) throw new Error("item-not-found");
      return participatingGroups[jid];
    },
    sendMessage: async (target: string, content: unknown) => {
      calls.sendMessage.push({ target, content });
      return sendImpl(target, content);
    },
  };

  return {
    socket,
    ev: evEmitter,
    calls,
    setParticipating(groups: Record<string, any>) {
      participatingGroups = groups;
    },
    setSendImpl(fn: (target: string, content: unknown) => Promise<any>) {
      sendImpl = fn;
    },
  };
}

function setupMockDb() {
  const originalConnect = pool.connect.bind(pool);
  const originalQuery = pool.query.bind(pool);

  let promoRuntime: { phone: string | null; revision: string | null } | null = { phone: null, revision: null };
  const control = new Map<string, { next_send_at: Date; paused_until: Date | null; last_sent_at: Date | null; last_ack_at: Date | null }>();
  const delivery = new Map<string, { key: string; fingerprint: string; target: string; payload: string; status: string; message_id: string | null }>();
  const queryLog: Array<{ sql: string; args: unknown[] }> = [];
  let failRuntimeUpdate = false;

  const query = async (sql: string, args: unknown[] = []) => {
    queryLog.push({ sql, args });
    if (sql.includes("INSERT INTO axvara_wa_promo_runtime") && sql.includes("ON CONFLICT DO NOTHING")) {
      if (!promoRuntime) promoRuntime = { phone: null, revision: null };
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO axvara_wa_promo_runtime") && sql.includes("DO UPDATE SET phone=")) {
      if (failRuntimeUpdate) throw new Error("db_write_failed");
      promoRuntime = { phone: String(args[0]), revision: String(args[1]) };
      return { rows: [] };
    }
    if (sql.includes("FROM axvara_wa_promo_runtime")) {
      return { rows: promoRuntime ? [{ ...promoRuntime }] : [] };
    }
    if (sql.includes("INSERT INTO axvara_wa_control") && sql.includes("ON CONFLICT DO NOTHING")) {
      const phone = String(args[0]);
      if (!control.has(phone)) {
        control.set(phone, { next_send_at: new Date(0), paused_until: null, last_sent_at: null, last_ack_at: null });
      }
      return { rows: [] };
    }
    if (sql.includes("FROM axvara_wa_control")) {
      const phone = String(args[0]);
      const row = control.get(phone);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes("UPDATE axvara_wa_control SET next_send_at")) {
      const phone = String(args[0]);
      const row = control.get(phone) ?? { next_send_at: new Date(0), paused_until: null, last_sent_at: null, last_ack_at: null };
      row.next_send_at = new Date(Date.now() + 60_000);
      control.set(phone, row);
      return { rows: [] };
    }
    if (sql.includes("UPDATE axvara_wa_control SET paused_until")) {
      const phone = String(args[0]);
      const mins = Number(args[1]);
      const row = control.get(phone) ?? { next_send_at: new Date(0), paused_until: null, last_sent_at: null, last_ack_at: null };
      row.paused_until = new Date(Date.now() + mins * 60_000);
      control.set(phone, row);
      return { rows: [] };
    }
    if (sql.includes("UPDATE axvara_wa_control SET last_sent_at")) {
      const phone = String(args[0]);
      const row = control.get(phone);
      if (row) row.last_sent_at = new Date();
      return { rows: [] };
    }
    if (sql.includes("UPDATE axvara_wa_control SET last_ack_at")) {
      const phone = String(args[0]);
      const row = control.get(phone);
      if (row) row.last_ack_at = new Date();
      return { rows: [] };
    }
    if (sql.includes("SELECT * FROM axvara_wa_delivery WHERE key=")) {
      const row = delivery.get(String(args[0]));
      return { rows: row ? [row] : [] };
    }
    if (sql.includes("SELECT key,payload FROM axvara_wa_delivery WHERE message_id=")) {
      const row = [...delivery.values()].find(d => d.message_id === args[0] && d.target === args[1]);
      return { rows: row ? [{ key: row.key, payload: row.payload }] : [] };
    }
    if (sql.includes("INSERT INTO axvara_wa_delivery")) {
      const [key, fp, target, payload] = args as string[];
      delivery.set(key, { key, fingerprint: fp, target, payload, status: "sending", message_id: null });
      return { rows: [] };
    }
    if (sql.includes("UPDATE axvara_wa_delivery SET status=")) {
      const [key, status, messageId, payload] = args as [string, string, string | null, string | null];
      const existing = delivery.get(key);
      if (existing && (existing.status !== "sent" || status === "sent")) {
        existing.status = status;
        existing.message_id = messageId;
        if (payload) existing.payload = payload;
      }
      return { rows: [] };
    }
    return { rows: [] };
  };

  pool.connect = (async () => ({ query, release: () => {} })) as any;
  pool.query = query as any;

  return {
    control,
    delivery,
    queryLog,
    setFailRuntimeUpdate(val: boolean) {
      failRuntimeUpdate = val;
    },
    setRuntime(val: { phone: string | null; revision: string | null } | null) {
      promoRuntime = val;
    },
    restore() {
      pool.connect = originalConnect;
      pool.query = originalQuery;
    },
  };
}

function wibSlotKey(now = new Date(), groupJid = GROUP_A): { key: string; current: boolean } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value;
  const hour = Number(part("hour"));
  const slot = hour >= 9 && hour < 12 ? "morning" : hour >= 17 && hour < 20 ? "evening" : null;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const groupSuffix = groupJid.replace(/@g\.us$/, "");
  return {
    key: `wa:promo2:${date}:${slot ?? "morning"}:${groupSuffix}`,
    current: slot !== null,
  };
}

test("promo-bot key validation, WIB slot sharing, and target suffix matching", () => {
  assert.equal(validPromoBotKey("wa:promo2:2026-11-17:morning:120363412672344593"), true);
  assert.equal(validPromoBotKey("wa:promo2:2026-11-17:evening:628123456789-1612345678"), true);
  for (const bad of [
    "wa:promo:2026-11-17:morning",
    "wa:promo2:2026-11-17:night:120363412672344593",
    "wa:promo2:2026-11-17:morning:120363412672344593@g.us",
    "wa:promo2:2026-11-17:morning:",
    123,
  ]) {
    assert.equal(validPromoBotKey(bad), false);
  }

  for (const [key, now, expected] of [
    ["wa:promo2:2026-11-17:morning:123", "2026-11-17T01:59:59Z", false],
    ["wa:promo2:2026-11-17:morning:123", "2026-11-17T02:00:00Z", true],
    ["wa:promo2:2026-11-17:morning:123", "2026-11-17T04:59:59Z", true],
    ["wa:promo2:2026-11-17:morning:123", "2026-11-17T05:00:00Z", false],
    ["wa:promo2:2026-11-17:evening:123-456", "2026-11-17T10:00:00Z", true],
    ["wa:promo2:2026-11-17:evening:123-456", "2026-11-17T13:00:00Z", false],
    ["wa:promo2:2026-11-16:evening:123", "2026-11-17T10:00:00Z", false],
  ] as const) {
    assert.equal(currentPromoBotKey(key, new Date(now)), expected);
  }
  assert.equal(currentPromoKey("wa:promo:2026-11-17:morning", new Date("2026-11-17T02:00:00Z")), true);

  assert.equal(promoBotKeyMatchesTarget("wa:promo2:2026-11-17:morning:120363412672344593", GROUP_A), true);
  assert.equal(promoBotKeyMatchesTarget("wa:promo2:2026-11-17:evening:628123456789-1612345678", GROUP_B), true);
  assert.equal(promoBotKeyMatchesTarget("wa:promo2:2026-11-17:morning:120363412672344593", GROUP_B), false);
  assert.equal(promoBotKeyMatchesTarget("wa:promo2:2026-11-17:morning:120363412672344593", "120363412672344593@s.whatsapp.net"), false);
  assert.equal(promoBotKeyMatchesTarget("wa:promo2:2026-11-17:morning:120363412672344593", "120363412672344593"), false);
});

test("groupAllowsBotSend and deliveryClaim support phone parameter without changing default behavior", async () => {
  const db = setupMockDb();
  try {
    assert.equal(
      groupAllowsBotSend({ announce: true, participants: [{ id: PROMO_PHONE + "@s.whatsapp.net", admin: "admin" }] }, undefined, PROMO_PHONE),
      true,
    );
    assert.equal(
      groupAllowsBotSend({ announce: true, participants: [{ id: PROMO_PHONE + "@s.whatsapp.net", admin: null }] }, undefined, PROMO_PHONE),
      false,
    );
    assert.equal(
      groupAllowsBotSend({ announce: true, participants: [{ id: BOT_NUMBER + "@s.whatsapp.net", admin: "admin" }] }, undefined, PROMO_PHONE),
      false,
    );
    assert.equal(
      groupAllowsBotSend({ announce: false, participants: [{ id: "promo-lid@lid", admin: null }] }, "promo-lid:2@lid", PROMO_PHONE),
      true,
    );

    db.control.set(PROMO_PHONE, { next_send_at: new Date(0), paused_until: null, last_sent_at: null, last_ack_at: null });
    db.control.set(BOT_NUMBER, { next_send_at: new Date(Date.now() + 60_000), paused_until: null, last_sent_at: null, last_ack_at: null });

    const claimed = await deliveryClaim("wa:promo2:2026-11-17:morning:123", GROUP_A, "payload", PROMO_PHONE);
    assert.deepEqual(claimed, { claimed: true });
    assert.ok(db.control.get(PROMO_PHONE)!.next_send_at.getTime() > Date.now());

    const paced = await deliveryClaim("wa:promo2:2026-11-17:morning:456", GROUP_B, "payload", PROMO_PHONE);
    assert.deepEqual(paced, { reason: "notification_paced" });
  } finally {
    db.restore();
  }
});

test("promo-bot number change CAS, same_as_notification_bot, pair, and groups cache/isolation", async () => {
  const db = setupMockDb();
  const sockets = new Map<string, ReturnType<typeof createFakeSocket>>();
  const clearedAuthPhones: string[] = [];
  let mainBotNumber = BOT_NUMBER;
  let capturedGetMessage: ((key: any) => Promise<any>) | undefined;

  const app = Fastify({ logger: false });
  const controller = registerPromoBot(app, {
    validGatewayToken: raw => raw === "secret-token",
    getMainBotNumber: () => mainBotNumber,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    createSocket: ((config: any) => {
      capturedGetMessage = config.getMessage;
      const phone = PROMO_BOT_NUMBER || PROMO_PHONE;
      const fake = createFakeSocket(phone);
      sockets.set(phone, fake);
      return fake.socket as any;
    }) as any,
    authProvider: (async (phone: string) => ({
      state: { creds: {} as any, keys: {} as any },
      saveCreds: async () => {},
      clearAuth: async () => {
        clearedAuthPhones.push(phone);
      },
    })) as any,
    loadImage: async () => Buffer.from([82, 73, 70, 70]),
    sendTimeoutMs: 50,
  });

  try {
    await initializePromoRuntime();
    await controller.start();
    assert.equal(PROMO_BOT_NUMBER, null);
    assert.equal(PROMO_BOT_REVISION, null);

    // 401 without token
    const unauth = await app.inject({ method: "GET", url: "/promo-bot/status" });
    assert.equal(unauth.statusCode, 401);

    // Initial unconfigured status
    const s0 = await app.inject({ method: "GET", url: "/promo-bot/status", headers: { "x-gateway-token": "secret-token" } });
    assert.equal(s0.statusCode, 200);
    assert.deepEqual(s0.json(), {
      configured: false,
      connected: false,
      blocked: false,
      botNumber: null,
      botRevision: null,
      lastSendAt: null,
      lastAckAt: null,
    });

    // 400 invalid_bot_number
    const badNum = await app.inject({
      method: "POST",
      url: "/promo-bot/number",
      headers: { "x-gateway-token": "secret-token" },
      payload: { newBotNumber: "bad", botNumber: null, botRevision: null },
    });
    assert.equal(badNum.statusCode, 400);
    assert.equal(badNum.json().reason, "invalid_bot_number");

    // 409 same_as_notification_bot
    const sameNum = await app.inject({
      method: "POST",
      url: "/promo-bot/number",
      headers: { "x-gateway-token": "secret-token" },
      payload: { newBotNumber: BOT_NUMBER, botNumber: null, botRevision: null },
    });
    assert.equal(sameNum.statusCode, 409);
    assert.equal(sameNum.json().reason, "same_as_notification_bot");

    // Configure PROMO_PHONE via CAS (null/null)
    const setRes = await app.inject({
      method: "POST",
      url: "/promo-bot/number",
      headers: { "x-gateway-token": "secret-token" },
      payload: { newBotNumber: PROMO_PHONE, botNumber: null, botRevision: null },
    });
    assert.equal(setRes.statusCode, 200);
    const body1 = setRes.json();
    assert.equal(body1.configured, true);
    assert.equal(body1.connected, false);
    assert.equal(body1.blocked, false);
    assert.equal(body1.botNumber, PROMO_PHONE);
    assert.ok(typeof body1.botRevision === "string" && body1.botRevision.length > 0);

    const fake1 = sockets.get(PROMO_PHONE)!;
    assert.equal(fake1.calls.requestPairingCode.length, 0); // no auto pairing
    assert.equal(fake1.ev.listenerCount("messages.upsert"), 0); // no messages.upsert forwarding

    // Stale CAS rejected with 409 bot_configuration_changed
    const staleCas = await app.inject({
      method: "POST",
      url: "/promo-bot/number",
      headers: { "x-gateway-token": "secret-token" },
      payload: { newBotNumber: OTHER_PHONE, botNumber: null, botRevision: null },
    });
    assert.equal(staleCas.statusCode, 409);
    assert.equal(staleCas.json().reason, "bot_configuration_changed");

    // Pairing requires explicit action and clears only promo auth after 401
    fake1.ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 401 } } } });
    const blockedStatus = (await app.inject({ method: "GET", url: "/promo-bot/status", headers: { "x-gateway-token": "secret-token" } })).json();
    assert.equal(blockedStatus.blocked, true);

    // Pair on 401 clears only PROMO_PHONE auth and requests pairing code once QR arrives
    const pairPromise = app.inject({
      method: "POST",
      url: "/promo-bot/pair",
      headers: { "x-gateway-token": "secret-token" },
      payload: { botNumber: PROMO_PHONE, botRevision: body1.botRevision },
    });
    setTimeout(() => {
      const latestFake = sockets.get(PROMO_PHONE)!;
      latestFake.ev.emit("connection.update", { qr: "dummy-qr" });
    }, 20);
    const pairRes = await pairPromise;
    assert.equal(pairRes.statusCode, 200);
    assert.deepEqual(clearedAuthPhones, [PROMO_PHONE]);
    assert.equal(pairRes.json().pairingCode, "ABCD-EFGH");

    // Groups before connected -> 503 whatsapp_not_connected
    const groupsOffline = await app.inject({
      method: "GET",
      url: `/promo-bot/groups?botNumber=${PROMO_PHONE}&botRevision=${body1.botRevision}`,
      headers: { "x-gateway-token": "secret-token" },
    });
    assert.equal(groupsOffline.statusCode, 503);
    assert.equal(groupsOffline.json().reason, "whatsapp_not_connected");

    // Connect socket & test groups sorted + cached + invalidated on groups.update
    const latestFake = sockets.get(PROMO_PHONE)!;
    latestFake.setParticipating({
      [GROUP_B]: { id: GROUP_B, subject: "Zebra Group", announce: true, size: 12, participants: [{ id: `${PROMO_PHONE}@s.whatsapp.net`, admin: null }] },
      [GROUP_A]: { id: GROUP_A, subject: "Alpha Group", announce: true, size: 5, participants: [{ id: `${PROMO_PHONE}@s.whatsapp.net`, admin: "admin" }] },
    });
    latestFake.ev.emit("connection.update", { connection: "open" });

    const g1 = await app.inject({
      method: "GET",
      url: `/promo-bot/groups?botNumber=${PROMO_PHONE}&botRevision=${body1.botRevision}`,
      headers: { "x-gateway-token": "secret-token" },
    });
    assert.equal(g1.statusCode, 200);
    assert.deepEqual(g1.json().groups, [
      { id: GROUP_A, subject: "Alpha Group", size: 5, canSend: true },
      { id: GROUP_B, subject: "Zebra Group", size: 12, canSend: false },
    ]);
    assert.equal(latestFake.calls.groupFetchAllParticipating, 1);

    // Cached second call does not re-fetch
    await app.inject({
      method: "GET",
      url: `/promo-bot/groups?botNumber=${PROMO_PHONE}&botRevision=${body1.botRevision}`,
      headers: { "x-gateway-token": "secret-token" },
    });
    assert.equal(latestFake.calls.groupFetchAllParticipating, 1);

    // Invalidated by groups.update
    latestFake.ev.emit("groups.update", [{ id: GROUP_A }]);
    await app.inject({
      method: "GET",
      url: `/promo-bot/groups?botNumber=${PROMO_PHONE}&botRevision=${body1.botRevision}`,
      headers: { "x-gateway-token": "secret-token" },
    });
    assert.equal(latestFake.calls.groupFetchAllParticipating, 2);

    // DB failure during /promo-bot/number -> 503 and blocked
    db.setFailRuntimeUpdate(true);
    const failSwitch = await app.inject({
      method: "POST",
      url: "/promo-bot/number",
      headers: { "x-gateway-token": "secret-token" },
      payload: { newBotNumber: OTHER_PHONE, botNumber: PROMO_PHONE, botRevision: body1.botRevision },
    });
    assert.equal(failSwitch.statusCode, 503);
    db.setFailRuntimeUpdate(false);

    // Test getMessage only returns wa:promo2:* payloads
    const msgProto = proto.Message.fromObject({ imageMessage: { caption: "promo2" } });
    db.delivery.set("wa:promo2:2026-11-17:morning:123", {
      key: "wa:promo2:2026-11-17:morning:123",
      fingerprint: "fp1",
      target: GROUP_A,
      payload: JSON.stringify(msgProto),
      status: "sent",
      message_id: "MSG-PROMO2",
    });
    db.delivery.set("wa:promo:2026-11-17:morning", {
      key: "wa:promo:2026-11-17:morning",
      fingerprint: "fp2",
      target: GROUP_A,
      payload: JSON.stringify(msgProto),
      status: "sent",
      message_id: "MSG-MAIN",
    });
    assert.equal((await capturedGetMessage!({ id: "MSG-PROMO2", remoteJid: GROUP_A }))?.imageMessage?.caption, "promo2");
    assert.equal(await capturedGetMessage!({ id: "MSG-MAIN", remoteJid: GROUP_A }), undefined);

    // If main bot switches to PROMO_PHONE, promo bot becomes blocked + error
    mainBotNumber = PROMO_PHONE;
    controller.onMainBotNumberChanged();
    const conflictStatus = (await app.inject({ method: "GET", url: "/promo-bot/status", headers: { "x-gateway-token": "secret-token" } })).json();
    assert.equal(conflictStatus.blocked, true);
    assert.equal(conflictStatus.connected, false);
    assert.ok(conflictStatus.error);
  } finally {
    await controller.stop();
    await app.close();
    db.restore();
  }
});

test("promo-bot send-promo validation paths, delivery, timeout, and restriction isolation", async t => {
  const db = setupMockDb();
  const sockets = new Map<string, ReturnType<typeof createFakeSocket>>();
  let imageAvailable = true;

  // Pin clock inside a valid morning WIB slot (2026-11-17 09:30 WIB = 02:30Z)
  const slotNow = new Date("2026-11-17T02:30:00Z");
  t.mock.timers.enable({ apis: ["Date"], now: slotNow });

  const app = Fastify({ logger: false });
  const controller = registerPromoBot(app, {
    validGatewayToken: raw => raw === "secret-token",
    getMainBotNumber: () => BOT_NUMBER,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    createSocket: (() => {
      const fake = createFakeSocket(PROMO_PHONE);
      sockets.set(PROMO_PHONE, fake);
      return fake.socket as any;
    }) as any,
    authProvider: (async () => ({
      state: { creds: {} as any, keys: {} as any },
      saveCreds: async () => {},
      clearAuth: async () => {},
    })) as any,
    loadImage: async () => {
      if (!imageAvailable) throw new Error("promo_image_unavailable");
      return Buffer.from([82, 73, 70, 70]);
    },
    sendTimeoutMs: 40,
  });

  try {
    db.setRuntime({ phone: PROMO_PHONE, revision: "rev-1" });
    await controller.start();
    const fake = sockets.get(PROMO_PHONE)!;
    fake.setParticipating({
      [GROUP_A]: { id: GROUP_A, subject: "Allowed Group", announce: false, participants: [{ id: `${PROMO_PHONE}@s.whatsapp.net`, admin: null }] },
      [GROUP_B]: { id: GROUP_B, subject: "Locked Group", announce: true, participants: [{ id: `${PROMO_PHONE}@s.whatsapp.net`, admin: null }] },
    });
    fake.ev.emit("connection.update", { connection: "open" });

    const { key: validKeyA } = wibSlotKey(slotNow, GROUP_A);
    const { key: validKeyB } = wibSlotKey(slotNow, GROUP_B);

    // 400: empty message / >12000
    const emptyMsg = await app.inject({
      method: "POST",
      url: "/promo-bot/send-promo",
      headers: { "x-gateway-token": "secret-token" },
      payload: { target: GROUP_A, message: "   ", idempotencyKey: validKeyA, botNumber: PROMO_PHONE, botRevision: "rev-1" },
    });
    assert.equal(emptyMsg.statusCode, 400);
    assert.equal(emptyMsg.json().reason, "invalid_notification");

    // 400: mismatched suffix
    const mismatchedSuffix = await app.inject({
      method: "POST",
      url: "/promo-bot/send-promo",
      headers: { "x-gateway-token": "secret-token" },
      payload: { target: GROUP_B, message: "Promo ready!", idempotencyKey: validKeyA, botNumber: PROMO_PHONE, botRevision: "rev-1" },
    });
    assert.equal(mismatchedSuffix.statusCode, 400);
    assert.equal(mismatchedSuffix.json().reason, "invalid_notification");

    // 409: identity mismatch
    const wrongRev = await app.inject({
      method: "POST",
      url: "/promo-bot/send-promo",
      headers: { "x-gateway-token": "secret-token" },
      payload: { target: GROUP_A, message: "Promo ready!", idempotencyKey: validKeyA, botNumber: PROMO_PHONE, botRevision: "wrong" },
    });
    assert.equal(wrongRev.statusCode, 409);
    assert.equal(wrongRev.json().reason, "bot_configuration_changed");

    // 410: expired / wrong slot
    const expiredRes = await app.inject({
      method: "POST",
      url: "/promo-bot/send-promo",
      headers: { "x-gateway-token": "secret-token" },
      payload: {
        target: GROUP_A,
        message: "Promo ready!",
        idempotencyKey: `wa:promo2:2026-11-16:morning:${GROUP_A.replace("@g.us", "")}`,
        botNumber: PROMO_PHONE,
        botRevision: "rev-1",
      },
    });
    assert.equal(expiredRes.statusCode, 410);
    assert.equal(expiredRes.json().reason, "promo_expired");

    // 409: promo_group_not_allowed (announce group without admin, or non-participating group)
    const notAllowed = await app.inject({
      method: "POST",
      url: "/promo-bot/send-promo",
      headers: { "x-gateway-token": "secret-token" },
      payload: { target: GROUP_B, message: "Promo ready!", idempotencyKey: validKeyB, botNumber: PROMO_PHONE, botRevision: "rev-1" },
    });
    assert.equal(notAllowed.statusCode, 409);
    assert.equal(notAllowed.json().reason, "promo_group_not_allowed");

    const notInGroup = await app.inject({
      method: "POST",
      url: "/promo-bot/send-promo",
      headers: { "x-gateway-token": "secret-token" },
      payload: {
        target: "999999999999@g.us",
        message: "Promo ready!",
        idempotencyKey: "wa:promo2:2026-11-17:morning:999999999999",
        botNumber: PROMO_PHONE,
        botRevision: "rev-1",
      },
    });
    assert.equal(notInGroup.statusCode, 409);
    assert.equal(notInGroup.json().reason, "promo_group_not_allowed");

    // 503: promo_image_unavailable
    imageAvailable = false;
    const noImg = await app.inject({
      method: "POST",
      url: "/promo-bot/send-promo",
      headers: { "x-gateway-token": "secret-token" },
      payload: { target: GROUP_A, message: "Promo ready!", idempotencyKey: validKeyA, botNumber: PROMO_PHONE, botRevision: "rev-1" },
    });
    assert.equal(noImg.statusCode, 503);
    assert.equal(noImg.json().reason, "promo_image_unavailable");
    imageAvailable = true;

    // 200: successful send stores encrypted message + sets control timestamps on PROMO_PHONE
    const okRes = await app.inject({
      method: "POST",
      url: "/promo-bot/send-promo",
      headers: { "x-gateway-token": "secret-token" },
      payload: { target: GROUP_A, message: "Promo ready!", idempotencyKey: validKeyA, botNumber: PROMO_PHONE, botRevision: "rev-1" },
    });
    assert.equal(okRes.statusCode, 200);
    assert.deepEqual(okRes.json(), { status: true, id: "WA-PROMO-MSG-1" });
    assert.equal(db.delivery.get(validKeyA)?.status, "sent");
    assert.equal(db.delivery.get(validKeyA)?.message_id, "WA-PROMO-MSG-1");
    assert.ok(db.control.get(PROMO_PHONE)?.last_sent_at);

    // Verify fingerprint binds { image: { url: PROMO_IMAGE_URL }, caption }
    assert.equal(fake.calls.sendMessage.length, 1);
    assert.deepEqual(fake.calls.sendMessage[0], {
      target: GROUP_A,
      content: { image: Buffer.from([82, 73, 70, 70]), caption: "Promo ready!" },
    });
    assert.equal(PROMO_IMAGE_URL, "https://axvara.tech/banners/ready-promo.webp");

    // Pacing 60s returns 429 notification_paced for another group
    const GROUP_C = "120363412672344594@g.us";
    fake.setParticipating({
      [GROUP_A]: { id: GROUP_A, subject: "Allowed Group", announce: false, participants: [{ id: `${PROMO_PHONE}@s.whatsapp.net`, admin: null }] },
      [GROUP_B]: { id: GROUP_B, subject: "Locked Group", announce: true, participants: [{ id: `${PROMO_PHONE}@s.whatsapp.net`, admin: null }] },
      [GROUP_C]: { id: GROUP_C, subject: "Allowed Group C", announce: false, participants: [{ id: `${PROMO_PHONE}@s.whatsapp.net`, admin: null }] },
    });
    const pacedRes = await app.inject({
      method: "POST",
      url: "/promo-bot/send-promo",
      headers: { "x-gateway-token": "secret-token" },
      payload: { target: GROUP_C, message: "Promo ready!", idempotencyKey: "wa:promo2:2026-11-17:morning:120363412672344594", botNumber: PROMO_PHONE, botRevision: "rev-1" },
    });
    assert.equal(pacedRes.statusCode, 429);
    assert.equal(pacedRes.json().reason, "notification_paced");

    // Timeout marks unknown, pauses PROMO_PHONE, and blocks promo session
    db.control.get(PROMO_PHONE)!.next_send_at = new Date(0);
    fake.setSendImpl(() => new Promise(() => {})); // never resolves
    const timeoutPromise = app.inject({
      method: "POST",
      url: "/promo-bot/send-promo",
      headers: { "x-gateway-token": "secret-token" },
      payload: { target: GROUP_C, message: "Promo timeout!", idempotencyKey: "wa:promo2:2026-11-17:morning:120363412672344594", botNumber: PROMO_PHONE, botRevision: "rev-1" },
    });
    // Advance timers so the 40ms sendTimeoutMs fires cleanly
    t.mock.timers.tick(50);
    const timeoutRes = await timeoutPromise;
    assert.equal(timeoutRes.statusCode, 409);
    assert.deepEqual(timeoutRes.json(), { status: false, outcomeUnknown: true, reason: "delivery_outcome_unknown" });
    assert.equal(db.delivery.get("wa:promo2:2026-11-17:morning:120363412672344594")?.status, "unknown");
    assert.equal(controller.health().blocked, true);
    assert.ok((db.control.get(PROMO_PHONE)?.paused_until?.getTime() ?? 0) > Date.now());
  } finally {
    t.mock.timers.reset();
    await controller.stop();
    await app.close();
    db.restore();
  }
});

test("promo-bot restriction pauses 24h, group-participants.update invalidates cache without webhook, and health reflects state", async t => {
  const db = setupMockDb();
  const sockets = new Map<string, ReturnType<typeof createFakeSocket>>();
  const slotNow = new Date("2026-11-17T10:30:00Z"); // 17:30 WIB (evening)
  t.mock.timers.enable({ apis: ["Date"], now: slotNow });
  const fetchSpy = t.mock.method(globalThis, "fetch", async () => new Response("ok"));

  const app = Fastify({ logger: false });
  const controller = registerPromoBot(app, {
    validGatewayToken: raw => raw === "secret-token",
    getMainBotNumber: () => BOT_NUMBER,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    createSocket: (() => {
      const fake = createFakeSocket(PROMO_PHONE);
      sockets.set(PROMO_PHONE, fake);
      return fake.socket as any;
    }) as any,
    authProvider: (async () => ({
      state: { creds: {} as any, keys: {} as any },
      saveCreds: async () => {},
      clearAuth: async () => {},
    })) as any,
    loadImage: async () => Buffer.from([82, 73, 70, 70]),
  });

  try {
    db.setRuntime({ phone: PROMO_PHONE, revision: "rev-2" });
    await controller.start();
    assert.deepEqual(controller.health(), { configured: true, connected: false, blocked: false });

    const fake = sockets.get(PROMO_PHONE)!;
    fake.setParticipating({
      [GROUP_A]: { id: GROUP_A, subject: "Group A", announce: false, participants: [{ id: `${PROMO_PHONE}@s.whatsapp.net`, admin: null }] },
    });
    fake.ev.emit("connection.update", { connection: "open" });
    assert.deepEqual(controller.health(), { configured: true, connected: true, blocked: false });

    // Same-number POST /promo-bot/number is idempotent and keeps rev-2
    const sameRes = await app.inject({
      method: "POST",
      url: "/promo-bot/number",
      headers: { "x-gateway-token": "secret-token" },
      payload: { newBotNumber: PROMO_PHONE, botNumber: PROMO_PHONE, botRevision: "rev-2" },
    });
    assert.equal(sameRes.statusCode, 200);
    assert.equal(sameRes.json().botRevision, "rev-2");

    // Populate cache then trigger group-participants.update -> invalidates cache, calls NO webhook
    await app.inject({
      method: "GET",
      url: `/promo-bot/groups?botNumber=${PROMO_PHONE}&botRevision=rev-2`,
      headers: { "x-gateway-token": "secret-token" },
    });
    fake.ev.emit("group-participants.update", { id: GROUP_A, action: "add", participants: [{ id: "111@s.whatsapp.net" }] });
    assert.equal(fetchSpy.mock.calls.length, 0);
    await app.inject({
      method: "GET",
      url: `/promo-bot/groups?botNumber=${PROMO_PHONE}&botRevision=rev-2`,
      headers: { "x-gateway-token": "secret-token" },
    });
    assert.equal(fake.calls.groupFetchAllParticipating, 2);

    // Restriction error during send-promo blocks promo bot and sets 24h pause
    fake.setSendImpl(async () => {
      throw Object.assign(new Error("forbidden"), { output: { statusCode: 403 } });
    });
    const key = `wa:promo2:2026-11-17:evening:${GROUP_A.replace("@g.us", "")}`;
    const res = await app.inject({
      method: "POST",
      url: "/promo-bot/send-promo",
      headers: { "x-gateway-token": "secret-token" },
      payload: { target: GROUP_A, message: "Promo sore!", idempotencyKey: key, botNumber: PROMO_PHONE, botRevision: "rev-2" },
    });
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.json(), { status: false, outcomeUnknown: true, reason: "delivery_outcome_unknown" });
    assert.equal(controller.health().blocked, true);
    const pausedUntil = db.control.get(PROMO_PHONE)?.paused_until?.getTime() ?? 0;
    assert.ok(pausedUntil - Date.now() >= 23 * 60 * 60_000);
  } finally {
    t.mock.timers.reset();
    await controller.stop();
    await app.close();
    db.restore();
  }
});
