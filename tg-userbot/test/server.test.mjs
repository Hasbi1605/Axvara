// test/server.test.mjs — routing HTTP loopback dengan forwarder palsu.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "../src/server.mjs";
import { ForwardError } from "../src/forward.mjs";

async function start(forward, ready = true) {
  const server = createServer({ forwarder: { forward }, isReady: () => ready });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const rq = (method, path, body, headers = {}) => new Promise((resolve, reject) => {
    const q = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve({ status: res.statusCode, json: d ? JSON.parse(d) : null }));
    });
    q.on("error", reject);
    q.end(body);
  });
  return { rq, close: () => server.close() };
}

test("health tanpa secret, forward sukses dan error bertipe", async () => {
  const { rq, close } = await start(async (i) => {
    if (i.messageId === 1) return { messageId: 9, replay: false };
    throw new ForwardError("telegram_rejected", { rpc: "FLOOD_WAIT", retryAfter: 5 });
  });
  try {
    assert.deepEqual((await rq("GET", "/health")).json, { ok: true, ready: true });
    assert.deepEqual((await rq("POST", "/forward", JSON.stringify({ messageId: 1 }))).json, { ok: true, messageId: 9, replay: false });
    const r = await rq("POST", "/forward", JSON.stringify({ messageId: 2 }));
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, { ok: false, error: "telegram_rejected", rpc: "FLOOD_WAIT", retryAfter: 5 });
    assert.equal((await rq("POST", "/forward", "{bad")).status, 400);
    assert.equal((await rq("POST", "/forward", "[]")).status, 400);
    assert.equal((await rq("GET", "/nope")).status, 404);
    assert.equal((await rq("GET", "/forward")).status, 405);
  } finally { close(); }
});

test("body >4 KB ditolak 413; Host non-loopback ditolak 403", async () => {
  const { rq, close } = await start(async () => assert.fail("tidak boleh dipanggil"));
  try {
    const r = await rq("POST", "/forward", JSON.stringify({ x: "a".repeat(5000) }));
    assert.equal(r.status, 413);
    assert.equal((await rq("GET", "/health", undefined, { host: "evil.example" })).status, 403);
  } finally { close(); }
});

test("health ready=false saat sesi belum siap; error tak dikenal -> 500 internal", async () => {
  const { rq, close } = await start(async () => { throw new Error("boom"); }, false);
  try {
    assert.deepEqual((await rq("GET", "/health")).json, { ok: true, ready: false });
    const r = await rq("POST", "/forward", "{}");
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { ok: false, error: "internal" });
  } finally { close(); }
});
