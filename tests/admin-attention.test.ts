// tests/admin-attention.test.ts — Rundown backend admin 13 November 2026:
// satu definisi "Perlu dicek" untuk Rekonsiliasi + overview (B3), aksi
// "mark_reviewed" ber-audit (B2), dan data "Perlu tindakan" fulfillment (B4).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import { createAdminToken, createIdleToken } from "@/lib/auth";

let fixture: ReturnType<typeof createD1Fixture>;

beforeEach(() => {
  fixture = createD1Fixture();
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "7".repeat(64));
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in fixture"); }));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function adminRequest(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const session = await createAdminToken("admin@axvara.tech");
  const idle = await createIdleToken(session.sid);
  const headers = new Headers(init.headers);
  headers.set("cookie", `axvara_admin_token=${session.token}; axvara_idle=${idle}`);
  return new NextRequest(url, { ...init, headers });
}

function insertEvent(key: string, amount: number, status: string, createdAt = "datetime('now')") {
  fixture.sql.exec(
    `INSERT INTO dana_webhook_events(event_key,payload_hash,amount,provider,status,created_at)
     VALUES('${key}','hash',${amount},'dana','${status}',${createdAt})`,
  );
  return Number(fixture.sql.prepare("SELECT id FROM dana_webhook_events WHERE event_key=?").get(key)!.id);
}
const eventRow = (id: number) => fixture.sql.prepare("SELECT * FROM dana_webhook_events WHERE id=?").get(id) as Record<string, unknown>;

describe("B3 — satu definisi 'Perlu dicek' (overview = Rekonsiliasi)", () => {
  it("menghitung event received/ignored/failed yang belum ditandai, tanpa jendela waktu", async () => {
    insertEvent("old-received", 10000, "received", "datetime('now','-40 days')");
    insertEvent("failed-now", 10100, "failed");
    insertEvent("ignored-now", 10200, "ignored");
    insertEvent("matched-now", 10300, "matched");
    const reviewedId = insertEvent("reviewed-old", 10400, "ignored", "datetime('now','-60 days')");
    fixture.sql.prepare("UPDATE dana_webhook_events SET reviewed_by='admin@axvara.tech', review_note='sudah dicek' WHERE id=?").run(reviewedId);

    const { GET: overviewRoute } = await import("@/app/api/admin/overview/route");
    const overview = await (await overviewRoute(await adminRequest("http://x/api/admin/overview?period=week"))).json();
    const { GET: eventsRoute } = await import("@/app/api/admin/payments/events/route");
    const events = await (await eventsRoute(await adminRequest("http://x/api/admin/payments/events?status=attention"))).json();
    const counts = events.counts as Record<string, number>;

    expect(overview.payment_attention).toBe(3);
    expect(events.attention).toBe(3);
    // Angka kartu UI (jumlah status attention) identik dengan badge overview.
    expect(Number(counts.received || 0) + Number(counts.ignored || 0) + Number(counts.failed || 0)).toBe(overview.payment_attention);
    expect(events.events).toHaveLength(3);
  });
});

describe("B2 — mark_reviewed", () => {
  async function mark(body: unknown) {
    const { POST } = await import("@/app/api/admin/payments/events/route");
    return POST(await adminRequest("http://x/api/admin/payments/events", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
  }

  it("menolak tanpa sesi admin", async () => {
    const { POST } = await import("@/app/api/admin/payments/events/route");
    const res = await POST(new NextRequest("http://x/api/admin/payments/events", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "mark_reviewed", event_id: 1, note: "sudah dicek" }),
    }));
    expect(res.status).toBe(401);
  });

  it("catatan wajib (min 5 karakter) dan event harus ada", async () => {
    const id = insertEvent("to-review", 10000, "received");
    expect((await mark({ action: "mark_reviewed", event_id: id, note: "ok" })).status).toBe(400);
    expect((await mark({ action: "mark_reviewed", event_id: id })).status).toBe(400);
    expect((await mark({ action: "mark_reviewed", event_id: 9999, note: "sudah dicek" })).status).toBe(404);
    expect(eventRow(id).status).toBe("received");
  });

  it("menandai terminal + audit, idempoten, dan tidak menyentuh order/ledger", async () => {
    await insertTestProduct(fixture.sql);
    insertTestOrder(fixture.sql, "AXV-20261113-REVIEW01");
    const orderBefore = fixture.sql.prepare("SELECT * FROM orders WHERE code='AXV-20261113-REVIEW01'").get();
    const id = insertEvent("review-me", 10000, "failed");

    const first = await mark({ action: "mark_reviewed", event_id: id, note: "Mutasi tidak ada di rekening merchant." });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, status: "reviewed", event_id: id });
    expect(eventRow(id)).toMatchObject({ status: "ignored", reviewed_by: "admin@axvara.tech", review_note: "Mutasi tidak ada di rekening merchant." });
    expect(eventRow(id).processed_at).toBeTruthy();

    const second = await mark({ action: "mark_reviewed", event_id: id, note: "dicek ulang" });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: "already_reviewed" });
    expect(eventRow(id).review_note).toBe("Mutasi tidak ada di rekening merchant.");

    // Tidak ada mutasi order/ledger.
    expect(fixture.sql.prepare("SELECT * FROM orders WHERE code='AXV-20261113-REVIEW01'").get()).toEqual(orderBefore);
    expect(fixture.sql.prepare("SELECT count(*) AS n FROM payment_transactions").get()!.n).toBe(0);
    // Event yang sudah dicek keluar dari hitungan "Perlu dicek".
    const { GET } = await import("@/app/api/admin/payments/events/route");
    const body = await (await GET(await adminRequest("http://x/api/admin/payments/events?status=attention"))).json();
    expect(body.attention).toBe(0);
  });

  it("menolak event yang sudah cocok dengan pesanan", async () => {
    const id = insertEvent("already-matched", 10000, "matched");
    const res = await mark({ action: "mark_reviewed", event_id: id, note: "sudah dicek" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "event_not_actionable" });
  });

  it("event yang sudah dicek tidak bisa dicocokkan ulang diam-diam", async () => {
    const id = insertEvent("reviewed-then-retry", 10000, "ignored");
    expect((await mark({ action: "mark_reviewed", event_id: id, note: "sudah dicek manual" })).status).toBe(200);
    const res = await mark({ action: "retry_match", event_id: id });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "event_reviewed" });
  });
});

describe("B4 — data 'Perlu tindakan' fulfillment di bot health", () => {
  it("mengembalikan order macet/manual dan jumlah outbox gagal 7 hari (read-only)", async () => {
    await insertTestProduct(fixture.sql);
    insertTestOrder(fixture.sql, "AXV-20261113-MANUAL01", { status: "lunas" });
    fixture.sql.prepare("UPDATE orders SET fulfillment_status='manual_required' WHERE code='AXV-20261113-MANUAL01'").run();
    insertTestOrder(fixture.sql, "AXV-20261113-STUCK001", { status: "lunas" });
    fixture.sql.prepare("UPDATE orders SET fulfillment_status='queued', updated_at=datetime('now','-40 minutes') WHERE code='AXV-20261113-STUCK001'").run();
    insertTestOrder(fixture.sql, "AXV-20261113-FRESH001", { status: "lunas" });
    fixture.sql.prepare("UPDATE orders SET fulfillment_status='queued', updated_at=datetime('now') WHERE code='AXV-20261113-FRESH001'").run();
    insertTestOrder(fixture.sql, "AXV-20261113-PENDING1");
    fixture.sql.prepare("UPDATE orders SET fulfillment_status='failed' WHERE code='AXV-20261113-PENDING1'").run();
    fixture.sql.exec(`INSERT INTO whatsapp_outbox(idempotency_key,destination,payload,status,updated_at) VALUES
      ('wa-1','628','{}','failed',datetime('now')),
      ('wa-2','628','{}','dead',datetime('now','-30 days'))`);

    const { GET } = await import("@/app/api/admin/bot/health/route");
    const body = await (await GET(await adminRequest("http://x/api/admin/bot/health"))).json();

    expect(body.whatsapp_discovery).toBe(false);
    expect(body.whatsapp_payment).toBe(false);
    expect(body.whatsapp_proof_intake).toBe(false);
    expect(body.whatsapp_buyer_flows).toBe("retired");
    expect(body.fulfillment_action.orders.map((row: { code: string }) => row.code).sort()).toEqual([
      "AXV-20261113-MANUAL01", "AXV-20261113-STUCK001",
    ]);
    expect(body.fulfillment_action.orders[0]).toMatchObject({
      product: "Fixture", status: expect.stringMatching(/manual_required|queued/), updated_at: expect.any(String),
    });
    expect(body.fulfillment_action.whatsapp_outbox_failed_7d).toBe(1);
    // Read-only: status order tidak berubah oleh laporan.
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-20261113-STUCK001'").get()!.fulfillment_status).toBe("queued");
  });
});
