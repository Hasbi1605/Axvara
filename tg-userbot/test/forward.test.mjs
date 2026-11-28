// test/forward.test.mjs — logika forward dengan fake `invoke` (tanpa Telegram).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createForwarder, extractMessageId, STATE_TTL_MS } from "../src/forward.mjs";

const FROM = "-1001111111111";
const TO = "-1002222222222";
const req = (over = {}) => ({ fromChatId: FROM, messageId: 42, toChatId: TO, idempotencyKey: "key-aaaaaaaa", ...over });

function setup({ invoke, now, isReady } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tgu-"));
  const stateFile = path.join(dir, "state.json");
  const calls = [];
  const fakeInvoke = invoke ?? (async (r) => {
    calls.push(r);
    return { className: "Updates", updates: [{ className: "UpdateNewChannelMessage", message: { id: 777 } }] };
  });
  const wrapped = async (r) => { if (invoke) calls.push(r); return fakeInvoke(r); };
  const f = createForwarder({
    invoke: invoke ? wrapped : fakeInvoke,
    resolvePeer: async (id) => ({ peer: id }),
    allowFrom: FROM,
    allowTo: TO,
    stateFile,
    now,
    isReady,
  });
  const read = () => JSON.parse(fs.readFileSync(stateFile, "utf8"));
  return { f, calls, stateFile, read };
}

const rejects = (p, code, status) => assert.rejects(p, (e) => { assert.equal(e.code, code); assert.equal(e.status, status); return true; });

test("sukses: id channel diambil dari UpdateNewChannelMessage dan request benar", async () => {
  const { f, calls, read } = setup();
  const out = await f.forward(req());
  assert.deepEqual(out, { messageId: 777, replay: false });
  assert.equal(calls.length, 1);
  const a = calls[0];
  assert.equal(a.className, "messages.ForwardMessages");
  assert.equal(a.dropAuthor, true);
  assert.deepEqual(a.id, [42]);
  assert.deepEqual(a.fromPeer, { peer: FROM });
  assert.deepEqual(a.toPeer, { peer: TO });
  assert.equal(a.randomId.length, 1);
  assert.equal(read().entries["key-aaaaaaaa"].status, "done");
});

test("fallback: UpdateMessageID cocok randomId; UpdateShort didukung", () => {
  assert.equal(extractMessageId({ updates: [{ className: "UpdateMessageID", id: 9, randomId: 5n }] }, 5n), 9);
  assert.equal(extractMessageId({ updates: [{ className: "UpdateMessageID", id: 9, randomId: 6n }] }, 5n), null);
  assert.equal(extractMessageId({ update: { className: "UpdateNewChannelMessage", message: { id: 3 } } }, 1n), 3);
  assert.equal(extractMessageId({}, 1n), null);
});

test("replay: kunci done mengembalikan id sama tanpa invoke kedua", async () => {
  const { f, calls } = setup();
  await f.forward(req());
  const again = await f.forward(req());
  assert.deepEqual(again, { messageId: 777, replay: true });
  assert.equal(calls.length, 1);
});

test("kunci sama dengan parameter beda ditolak invalid_request", async () => {
  const { f, calls } = setup();
  await f.forward(req());
  await rejects(f.forward(req({ messageId: 43 })), "invalid_request", 400);
  assert.equal(calls.length, 1);
});

test("pending dari percobaan sebelumnya -> outcome_unknown tanpa invoke", async () => {
  const { f, calls, stateFile } = setup();
  fs.writeFileSync(stateFile, JSON.stringify({ version: 1, entries: { "key-aaaaaaaa": { status: "pending", at: Date.now(), fp: `${FROM}:42:${TO}` } } }), { mode: 0o600 });
  const f2 = createForwarder({ invoke: async () => { calls.push(1); return {}; }, resolvePeer: async () => ({}), allowFrom: FROM, allowTo: TO, stateFile });
  await rejects(f2.forward(req()), "outcome_unknown", 502);
  assert.equal(calls.length, 0);
});

test("chat di luar allowlist -> forbidden_chat tanpa invoke", async () => {
  const { f, calls } = setup();
  await rejects(f.forward(req({ fromChatId: "-1003333333333" })), "forbidden_chat", 403);
  await rejects(f.forward(req({ toChatId: "-1003333333333" })), "forbidden_chat", 403);
  assert.equal(calls.length, 0);
});

test("input tidak valid -> invalid_request", async () => {
  const { f, calls } = setup();
  const bad = [
    { fromChatId: 1111 }, { fromChatId: "-100123" }, { fromChatId: "1001111111111" }, { toChatId: "@channel" },
    { messageId: 0 }, { messageId: -1 }, { messageId: 1.5 }, { messageId: "42" }, { messageId: 2 ** 31 },
    { idempotencyKey: "short" }, { idempotencyKey: "has space!!" }, { idempotencyKey: "a".repeat(129) }, { idempotencyKey: 123456789 },
  ];
  for (const b of bad) await rejects(f.forward(req(b)), "invalid_request", 400);
  await rejects(f.forward(undefined), "invalid_request", 400);
  assert.equal(calls.length, 0);
});

test("RPC ditolak: pending dihapus, telegram_rejected dengan nama RPC, bisa dicoba ulang", async () => {
  let n = 0;
  const { f, read } = setup({
    invoke: async () => {
      n++;
      if (n === 1) throw Object.assign(new Error("400: CHAT_WRITE_FORBIDDEN"), { errorMessage: "CHAT_WRITE_FORBIDDEN", code: 403 });
      return { updates: [{ className: "UpdateNewChannelMessage", message: { id: 5 } }] };
    },
  });
  await assert.rejects(f.forward(req()), (e) => {
    assert.equal(e.code, "telegram_rejected");
    assert.equal(e.status, 409);
    assert.equal(e.rpc, "CHAT_WRITE_FORBIDDEN");
    assert.equal(e.retryAfter, undefined);
    return true;
  });
  assert.deepEqual(read().entries, {});
  assert.deepEqual(await f.forward(req()), { messageId: 5, replay: false });
});

test("FLOOD_WAIT: retryAfter dari errorMessage maupun FloodWaitError.seconds", async () => {
  for (const err of [
    Object.assign(new Error("x"), { errorMessage: "FLOOD_WAIT_37", code: 420 }),
    Object.assign(new Error("x"), { name: "FloodWaitError", errorMessage: "A wait of 37 seconds is required", seconds: 37, code: 420 }),
  ]) {
    const { f, read } = setup({ invoke: async () => { throw err; } });
    await assert.rejects(f.forward(req()), (e) => {
      assert.equal(e.code, "telegram_rejected");
      assert.equal(e.rpc, "FLOOD_WAIT");
      assert.equal(e.retryAfter, 37);
      return true;
    });
    assert.deepEqual(read().entries, {});
  }
});

test("error jaringan/timeout setelah terkirim: pending dipertahankan, percobaan ulang ditolak", async () => {
  let n = 0;
  const { f, read } = setup({ invoke: async () => { n++; throw new Error("Connection closed"); } });
  await rejects(f.forward(req()), "outcome_unknown", 502);
  assert.equal(read().entries["key-aaaaaaaa"].status, "pending");
  await rejects(f.forward(req()), "outcome_unknown", 502);
  assert.equal(n, 1);
});

test("RPC server error 5xx dianggap tak pasti (pending tetap)", async () => {
  const { f, read } = setup({ invoke: async () => { throw Object.assign(new Error("x"), { errorMessage: "INTERNAL", code: 500 }); } });
  await rejects(f.forward(req()), "outcome_unknown", 502);
  assert.equal(read().entries["key-aaaaaaaa"].status, "pending");
});

test("sesi belum siap -> userbot_not_ready tanpa invoke dan tanpa state", async () => {
  const { f, calls, stateFile } = setup({ isReady: () => false });
  await rejects(f.forward(req()), "userbot_not_ready", 503);
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(stateFile), false);
});

test("pending tersimpan SEBELUM invoke dipanggil", async () => {
  let seen;
  const { f, stateFile } = setup({
    invoke: async () => {
      seen = JSON.parse(fs.readFileSync(stateFile, "utf8")).entries["key-aaaaaaaa"]?.status;
      return { updates: [{ className: "UpdateNewChannelMessage", message: { id: 1 } }] };
    },
  });
  await f.forward(req());
  assert.equal(seen, "pending");
});

test("file state mode 0600 (dan tanpa sisa tmp)", async () => {
  const { f, stateFile } = setup();
  await f.forward(req());
  assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(stateFile)), ["state.json"]);
});

test("pruning: entri >7 hari dibuang saat penulisan berikutnya", async () => {
  let t = 1_000_000_000_000;
  const { f, read } = setup({ now: () => t });
  await f.forward(req({ idempotencyKey: "old-key-0001" }));
  t += STATE_TTL_MS - 1000;
  await f.forward(req({ idempotencyKey: "mid-key-0001" }));
  assert.ok("old-key-0001" in read().entries);
  t += 2000; // old kini > 7 hari, mid belum
  await f.forward(req({ idempotencyKey: "new-key-0001" }));
  const keys = Object.keys(read().entries).sort();
  assert.deepEqual(keys, ["mid-key-0001", "new-key-0001"]);
});

test("state rusak -> fail closed saat startup", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tgu-"));
  const stateFile = path.join(dir, "state.json");
  fs.writeFileSync(stateFile, "{rusak");
  assert.throws(() => createForwarder({ invoke: async () => ({}), resolvePeer: async () => ({}), allowFrom: FROM, allowTo: TO, stateFile }));
});

test("kunci '__proto__' tidak merusak state", async () => {
  const { f, read } = setup();
  await f.forward(req({ idempotencyKey: "__proto__" }));
  assert.equal(Object.getOwnPropertyDescriptor(read().entries, "__proto__")?.value.status, "done");
  assert.deepEqual(await f.forward(req({ idempotencyKey: "__proto__" })), { messageId: 777, replay: true });
});
