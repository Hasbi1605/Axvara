import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attemptRows, gamesEnv, itemRow, seedGamesOrder, seedGamesProduct, type GamesFixture } from "./helpers/games-fixture";
import { createD1Fixture } from "./helpers/d1-fixture";

const notify = vi.hoisted(() => vi.fn(async () => "sent"));
vi.mock("@/lib/games/notify", () => ({ notifyGamesNeedsCheck: notify }));

const SECRET = "whsec-test";
let fx: GamesFixture;

const sign = (raw: string, secret = SECRET) => `sha1=${createHmac("sha1", secret).update(raw).digest("hex")}`;
const payload = (ref_id: string, status: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ data: { trx_id: "t1", ref_id, customer_no: "12345(6789)", buyer_sku_code: "ml86", message: `m ${status}`, status, rc: status === "Sukses" ? "00" : "02", sn: status === "Sukses" ? "SN-9" : "", price: 19000, ...extra } });
async function hook(raw: string, headers: Record<string, string> = {}, signature: string | null = sign(raw)) {
  const { POST } = await import("@/app/api/games/digiflazz/webhook/route");
  const h: Record<string, string> = { "content-type": "application/json", ...headers };
  if (signature !== null) h["x-hub-signature"] = signature;
  const res = await POST(new NextRequest("https://axvara.test/api/games/digiflazz/webhook", { method: "POST", headers: h, body: raw }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}
const events = () => fx.sql.prepare("SELECT * FROM dana_webhook_events WHERE provider='digiflazz' ORDER BY id").all() as Record<string, unknown>[];
const prime = (code: string, itemStatus = "submitting", attemptNo = 1) => {
  seedGamesOrder(fx, code, { itemStatus, attemptNo });
  for (let n = 1; n <= attemptNo; n++) {
    fx.sql.prepare("INSERT INTO games_dispatch_attempts(ref_id,order_code,attempt_no,buyer_sku_code,status) VALUES(?,?,?,?,?)")
      .run(`${code}-${n}`, code, n, n === 1 ? "ml86" : "ml86b", n === attemptNo ? "submitting" : "failed");
  }
};

beforeEach(async () => {
  fx = createD1Fixture();
  gamesEnv((n, v) => vi.stubEnv(n, v));
  vi.stubEnv("DIGIFLAZZ_WEBHOOK_SECRET", SECRET);
  notify.mockClear();
  await seedGamesProduct(fx);
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("POST /api/games/digiflazz/webhook", () => {
  it("is 503 without DIGIFLAZZ_WEBHOOK_SECRET", async () => {
    vi.stubEnv("DIGIFLAZZ_WEBHOOK_SECRET", "");
    prime("AXV-G-1");
    expect((await hook(payload("AXV-G-1-1", "Sukses"))).status).toBe(503);
    expect(itemRow(fx, "AXV-G-1").status).toBe("submitting");
  });

  it("rejects missing, malformed and wrong-secret signatures with 401 and mutates nothing", async () => {
    prime("AXV-G-1");
    const raw = payload("AXV-G-1-1", "Sukses");
    expect((await hook(raw, {}, null)).status).toBe(401);
    expect((await hook(raw, {}, "sha1=deadbeef")).status).toBe(401);
    expect((await hook(raw, {}, sign(raw, "other-secret"))).status).toBe(401);
    expect((await hook(raw, {}, createHmac("sha1", SECRET).update(raw).digest("hex"))).status).toBe(401); // tanpa prefix sha1=
    expect((await hook(raw + " ")).status).toBe(200); // signature dihitung dari body persis yang dikirim
    // Signature milik body lain ditolak:
    expect((await hook(raw, {}, sign(raw + " "))).status).toBe(401);
    expect(events().length).toBe(1);
  });

  it("valid Sukses transitions the active attempt and records the event as matched", async () => {
    prime("AXV-G-1");
    const r = await hook(payload("AXV-G-1-1", "Sukses"));
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "success", sn: "SN-9" });
    expect(attemptRows(fx, "AXV-G-1")).toMatchObject([{ status: "success", rc: "00" }]);
    expect(events()).toMatchObject([{ event_key: "digiflazz:AXV-G-1-1:Sukses", provider: "digiflazz", status: "matched", order_code: "AXV-G-1", amount: 19000 }]);
  });

  it("dedupes redelivery (same ref_id+status) without re-applying", async () => {
    prime("AXV-G-1", "pending");
    const raw = payload("AXV-G-1-1", "Sukses");
    expect((await hook(raw)).body).toEqual({ ok: true });
    fx.sql.exec("UPDATE games_order_items SET status='pending', sn=NULL"); // simulasi: bila diterapkan ulang akan berubah lagi
    const again = await hook(raw);
    expect(again).toEqual({ status: 200, body: { ok: true, duplicate: true } });
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "pending", sn: null });
    expect(events()).toHaveLength(1);
  });

  it("a failed apply is retried: event is not marked matched and 503 asks Digiflazz to redeliver", async () => {
    prime("AXV-G-1");
    fx.control.fail = (q) => q.startsWith("UPDATE games_order_items SET status='success'");
    const raw = payload("AXV-G-1-1", "Sukses");
    expect((await hook(raw)).status).toBe(503);
    expect(events()).toMatchObject([{ status: "failed" }]);
    fx.control.fail = null;
    expect((await hook(raw)).body).toEqual({ ok: true });
    expect(itemRow(fx, "AXV-G-1").status).toBe("success");
    expect(events()).toMatchObject([{ status: "matched" }]);
  });

  it("unknown ref_id -> 200 ignored:true, event recorded as ignored", async () => {
    const r = await hook(payload("SOMETHING-ELSE-1", "Sukses"));
    expect(r).toEqual({ status: 200, body: { ok: true, ignored: true } });
    expect(events()).toMatchObject([{ status: "ignored", last_error: "unknown_ref", order_code: null }]);
  });

  it("webhook for a non-current attempt is ignored", async () => {
    prime("AXV-G-1", "pending", 2);
    expect((await hook(payload("AXV-G-1-1", "Sukses"))).body).toEqual({ ok: true, ignored: true });
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "pending", attempt_no: 2, sn: null });
    expect(events()).toMatchObject([{ status: "ignored", last_error: "stale_or_terminal" }]);
  });

  it("terminal items never change by a later webhook", async () => {
    prime("AXV-G-1");
    await hook(payload("AXV-G-1-1", "Sukses"));
    expect((await hook(payload("AXV-G-1-1", "Gagal"))).body).toEqual({ ok: true, ignored: true });
    expect((await hook(payload("AXV-G-1-1", "Pending"))).body).toEqual({ ok: true, ignored: true });
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "success", sn: "SN-9" });
    expect(attemptRows(fx, "AXV-G-1")[0].status).toBe("success");
    expect(notify).not.toHaveBeenCalled();
  });

  it("Pending then Gagal webhooks follow the dispatch rules (backup queued; no backup -> needs_check + notify)", async () => {
    prime("AXV-G-1");
    expect((await hook(payload("AXV-G-1-1", "Pending"))).body).toEqual({ ok: true });
    expect(itemRow(fx, "AXV-G-1").status).toBe("pending");
    expect((await hook(payload("AXV-G-1-1", "Gagal"))).body).toEqual({ ok: true });
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "queued", attempt_no: 2 });
    fx.sql.exec("UPDATE games_order_items SET status='pending'");
    fx.sql.exec("INSERT INTO games_dispatch_attempts(ref_id,order_code,attempt_no,buyer_sku_code,status) VALUES('AXV-G-1-2','AXV-G-1',2,'ml86b','pending')");
    expect((await hook(payload("AXV-G-1-2", "Gagal"))).body).toEqual({ ok: true });
    expect(itemRow(fx, "AXV-G-1")).toMatchObject({ status: "needs_check", attempt_no: 2 });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("ping (header or body without data) is acknowledged after signature verification", async () => {
    const raw = JSON.stringify({ sed: "Hello!" });
    expect((await hook(raw, { "x-digiflazz-event": "ping" })).status).toBe(200);
    expect((await hook(raw)).status).toBe(200);
    expect((await hook(raw, { "x-digiflazz-event": "ping" }, "sha1=bad")).status).toBe(401);
    expect(events()).toHaveLength(0);
  });

  it("rejects invalid JSON, non-object payloads and invalid data with 400 (signed)", async () => {
    expect((await hook("not-json")).status).toBe(400);
    expect((await hook("[]")).status).toBe(400);
    expect((await hook(JSON.stringify({ data: { ref_id: "AXV-G-1-1", status: "Weird" } }))).status).toBe(400);
    expect((await hook(JSON.stringify({ data: { ref_id: "bad ref!", status: "Sukses" } }))).status).toBe(400);
    expect(events()).toHaveLength(0);
  });

  it("caps the body size before verification", async () => {
    const raw = JSON.stringify({ data: { ref_id: "AXV-G-1-1", status: "Sukses", message: "x".repeat(20_000) } });
    expect((await hook(raw)).status).toBe(413);
  });
});
