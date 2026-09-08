import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { NextRequest } from "next/server";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  sendPhoto: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  answerCallbackQuery: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  showLoadingBar: vi.fn(async () => {}),
  sendChatAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/whatsapp/gateway", () => ({
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "wa-1" })),
}));

const ADMIN = { email: "admin@axvara.tech", secret: "rr3-secret-0123456789abcdef", hash: "c".repeat(64) };

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  process.env.ADMIN_EMAIL = ADMIN.email;
  process.env.ADMIN_JWT_SECRET = ADMIN.secret;
  process.env.ADMIN_PASSWORD_SHA256 = ADMIN.hash;
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled"); }));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function authCookie() {
  const { createAdminToken, createIdleToken } = await import("@/lib/auth");
  const { token, sid } = await createAdminToken(ADMIN.email);
  const idle = await createIdleToken(sid);
  return `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(idle)}`;
}

async function paidManualOrder(code: string, modes: string[]) {
  await insertTestProduct(fixture.sql, modes[0], modes.length);
  for (let i = 1; i < modes.length; i++) {
    fixture.sql.prepare("UPDATE product_variants SET fulfillment_mode=? WHERE id=?").run(modes[i], i + 1);
  }
  const items = modes.map((_, i) => ({ product_id: 1, variant_id: i + 1, name: `Item ${i + 1}`, price: 10000, qty: 1 }));
  fixture.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
     sales_channel,fulfillment_status,variant_id,variant_snapshot)
    VALUES (?,?,?, ?,?,?, 'lunas','paid','web','retry',1,?)`)
    .run(code, "Buyer", "628000000000", JSON.stringify(items), 10000 * modes.length,
      JSON.stringify({ lines: modes.map((m, i) => ({ variant_id: i + 1, fulfillment_mode: m })) }));
}

async function handover(code: string, item_index: number, cookie: string, note = "serah terima") {
  const { POST } = await import("@/app/api/admin/orders/[code]/handover/route");
  return POST(
    new NextRequest(`http://localhost/api/admin/orders/${code}/handover`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ item_index, note }),
    }) as unknown as import("next/server").NextRequest,
    { params: Promise.resolve({ code }) },
  );
}

// ─── RR3-02: handover pada order yang materialisasinya terputus ───
describe("RR3-02 handover verifies the full order manifest", () => {
  it("refuses to deliver the aggregate while one order line has no fulfillment row", async () => {
    await paidManualOrder("AXV-20260908-RR020001", ["manual", "manual"]);
    const { ensureFulfillmentItems } = await import("@/lib/fulfillment/deliver");
    const row = fixture.sql.prepare("SELECT * FROM orders WHERE code='AXV-20260908-RR020001'").get()!;
    // Gagalkan INSERT baris kedua: hanya item 0 yang termaterialisasi.
    let inserts = 0;
    fixture.control.fail = (q) => q.includes("INSERT") && q.includes("fulfillment_items") && ++inserts === 2;
    await expect(ensureFulfillmentItems(row)).rejects.toThrow();
    fixture.control.fail = null;
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_items WHERE order_code='AXV-20260908-RR020001'").get()?.n).toBe(1);

    const cookie = await authCookie();
    const res = await handover("AXV-20260908-RR020001", 0, cookie);
    // Order punya 2 baris tetapi hanya 1 baris fulfillment: agregat TIDAK
    // boleh delivered — harus 409 incomplete atau tetap manual_required.
    if (res.status === 200) {
      const body = await res.json() as Record<string, unknown>;
      expect(body.fulfillment_status).not.toBe("delivered");
    } else {
      expect(res.status).toBe(409);
    }
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-20260908-RR020001'").get()?.fulfillment_status)
      .not.toBe("delivered");
  });

  it("completes only after the missing row is healed and every line handed over", async () => {
    await paidManualOrder("AXV-20260908-RR020002", ["manual", "manual"]);
    const { ensureFulfillmentItems } = await import("@/lib/fulfillment/deliver");
    const row = fixture.sql.prepare("SELECT * FROM orders WHERE code='AXV-20260908-RR020002'").get()!;
    let inserts = 0;
    fixture.control.fail = (q) => q.includes("INSERT") && q.includes("fulfillment_items") && ++inserts === 2;
    await expect(ensureFulfillmentItems(row)).rejects.toThrow();
    fixture.control.fail = null;
    const cookie = await authCookie();
    await handover("AXV-20260908-RR020002", 0, cookie);
    // Pulihkan materialisasi secara idempoten, lalu serahkan sisanya.
    const fresh = fixture.sql.prepare("SELECT * FROM orders WHERE code='AXV-20260908-RR020002'").get()!;
    await ensureFulfillmentItems(fresh);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_items WHERE order_code='AXV-20260908-RR020002'").get()?.n).toBe(2);
    const last = await handover("AXV-20260908-RR020002", 1, cookie);
    expect(last.status).toBe(200);
    expect((await last.json() as Record<string, unknown>).fulfillment_status).toBe("delivered");
  });
});

// ─── RR3-07: kegagalan tiap penulisan lanjutan + retry menyembuhkan ───
describe("RR3-07 partial handover writes reconcile on retry", () => {
  const probes = [
    { name: "inventory write", match: "fulfillment_inventory" },
    { name: "audit note write", match: "SET admin_note" },
    { name: "order aggregate write", match: "SET fulfillment_status" },
    { name: "job close write", match: "fulfillment_jobs" },
  ];
  for (const probe of probes) {
    it(`recovers after a failed ${probe.name} without double handover`, async () => {
      const code = `AXV-20260908-RR07${probes.indexOf(probe)}001`.slice(0, 24);
      await paidManualOrder(code, ["manual"]);
      const { ensureFulfillmentForPaidOrder } = await import("@/lib/fulfillment/deliver");
      await ensureFulfillmentForPaidOrder(code);
      const cookie = await authCookie();
      fixture.control.fail = (q) => q.includes(probe.match);
      const first = await handover(code, 0, cookie);
      fixture.control.fail = null;
      // Kegagalan lanjutan: item boleh delivered, tetapi respons HARUS jujur
      // (409 incomplete / 500) — bukan 200 seolah tuntas — kecuali seluruh
      // efek samping konsisten.
      if (first.status === 200) {
        const b = await first.json() as Record<string, unknown>;
        expect(b.fulfillment_status).toBe("delivered");
        expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code=?").get(code)?.fulfillment_status).toBe("delivered");
      } else {
        expect([409, 500]).toContain(first.status);
      }
      // Setelah storage pulih, panggil ulang: harus konsisten tuntas.
      const retry = await handover(code, 0, cookie);
      expect(retry.status).toBe(200);
      const rb = await retry.json() as Record<string, unknown>;
      expect(rb.item_status).toBe("delivered");
      expect(rb.fulfillment_status).toBe("delivered");
      expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code=?").get(code)?.fulfillment_status).toBe("delivered");
      // Satu jejak handover, tidak berganda tanpa alasan.
      const notes = String(fixture.sql.prepare("SELECT admin_note FROM orders WHERE code=?").get(code)?.admin_note ?? "");
      const count = (notes.match(/handover item 0/g) ?? []).length;
      expect(count).toBeLessThanOrEqual(2);
    });
  }

  it("double-click and concurrent duplicate handovers stay idempotent", async () => {
    await paidManualOrder("AXV-20260908-RR070101", ["manual"]);
    const { ensureFulfillmentForPaidOrder } = await import("@/lib/fulfillment/deliver");
    await ensureFulfillmentForPaidOrder("AXV-20260908-RR070101");
    const cookie = await authCookie();
    const [a, b] = await Promise.all([
      handover("AXV-20260908-RR070101", 0, cookie),
      handover("AXV-20260908-RR070101", 0, cookie),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_items WHERE order_code='AXV-20260908-RR070101' AND status='delivered'").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-20260908-RR070101'").get()?.fulfillment_status).toBe("delivered");
  });
});

// ─── RR3-04: revokasi gagal baca → tolak sesi ───
describe("RR3-04 revoked session is denied during revocation read outage", () => {
  it("requireAdmin and refresh deny a logged-out cookie when the revocation SELECT fails", async () => {
    const auth = await import("@/lib/auth");
    const { token, sid } = await auth.createAdminToken(ADMIN.email);
    const idle = await auth.createIdleToken(sid);
    const cookie = `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(idle)}`;
    const reqOf = () => new Request("https://axvara.tech/api/admin/overview", { headers: { cookie } }) as unknown as import("next/server").NextRequest;
    expect(await auth.requireAdmin(reqOf())).not.toBeNull();
    // Logout sukses, tercatat di D1.
    await auth.bumpAuthVersion(sid);
    expect(await auth.requireAdmin(reqOf())).toBeNull();
    auth.clearSessionCacheForTest();
    expect(await auth.requireAdmin(reqOf())).toBeNull();
    // Gagalkan HANYA baca revokasi → sesi tetap DITOLAK, tanpa mutasi.
    fixture.control.fail = (q) => q.includes("admin_session_revocations") && q.includes("SELECT");
    try {
      expect(await auth.requireAdmin(reqOf())).toBeNull();
      expect(await auth.requireAdminDetailed(reqOf())).toEqual({ ok: false, reason: "revoked" });
      const refresh = await import("@/app/api/auth/refresh/route");
      const res = await refresh.POST(reqOf());
      expect(res.status).toBe(401);
      const setCookies = res.headers.getSetCookie?.() ?? [res.headers.get("Set-Cookie") ?? ""];
      expect(setCookies.join(";")).not.toContain("axvara_idle=");
    } finally {
      fixture.control.fail = null;
    }
    // Setelah DB pulih: sesi logout tetap ditolak.
    expect(await auth.requireAdmin(reqOf())).toBeNull();
    // Sesi lain yang sah tetap bekerja.
    const other = await auth.createAdminToken(ADMIN.email);
    const otherIdle = await auth.createIdleToken(other.sid);
    const otherReq = () => new Request("https://axvara.tech/api/admin/overview", {
      headers: { cookie: `axvara_admin_token=${encodeURIComponent(other.token)}; axvara_idle=${encodeURIComponent(otherIdle)}` },
    }) as unknown as import("next/server").NextRequest;
    expect(await auth.requireAdmin(otherReq())).not.toBeNull();
  });
});

// ─── RR3-08: worker basi tidak menimpa order campuran ───
describe("RR3-08 stale worker cannot overwrite a mixed manual order", () => {
  it("order stays manual_required with the new worker's job state", async () => {
    await insertTestProduct(fixture.sql, "shared", 2);
    fixture.sql.prepare("UPDATE product_variants SET fulfillment_mode='manual' WHERE id=2").run();
    const items = [
      { product_id: 1, variant_id: 1, name: "S", price: 10000, qty: 1 },
      { product_id: 1, variant_id: 2, name: "M", price: 10000, qty: 1 },
    ];
    fixture.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
       sales_channel,telegram_chat_id,telegram_user_id,fulfillment_status,variant_id,variant_snapshot)
      VALUES ('AXV-20260908-RR080001','Buyer','628',?,20000,'qris','lunas','paid','telegram','12345','12345','queued',1,?)`)
      .run(JSON.stringify(items), JSON.stringify({ lines: [{ variant_id: 1, fulfillment_mode: "shared" }, { variant_id: 2, fulfillment_mode: "manual" }] }));
    fixture.sql.prepare("INSERT OR IGNORE INTO telegram_users(user_id,chat_id) VALUES('12345','12345')").run();
    const delivery = await import("@/lib/fulfillment/deliver");
    const api = await import("@/lib/telegram/api");
    const send = api.sendMessage as unknown as ReturnType<typeof vi.fn>;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let enteredResolve!: () => void;
    const entered = new Promise<void>((r) => { enteredResolve = r; });
    let calls = 0;
    send.mockImplementationOnce(async () => { calls++; enteredResolve(); await gate; return { ok: true, result: { message_id: 9 } }; });
    const stale = delivery.ensureFulfillmentForPaidOrder("AXV-20260908-RR080001");
    await entered;
    // Lease lewat; worker baru menyelesaikan pekerjaan.
    fixture.sql.prepare("UPDATE fulfillment_jobs SET locked_until='2020-01-01T00:00:00.000Z'").run();
    fixture.sql.prepare("UPDATE fulfillment_items SET locked_until='2020-01-01T00:00:00.000Z'").run();
    await delivery.releaseStaleJobs();
    await delivery.ensureFulfillmentForPaidOrder("AXV-20260908-RR080001");
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-20260908-RR080001'").get()?.fulfillment_status)
      .toBe("manual_required");
    release();
    await stale;
    // Hasil worker baru tetap berlaku.
    expect(calls).toBe(1);
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-20260908-RR080001'").get()?.fulfillment_status)
      .toBe("manual_required");
    const jobs = fixture.sql.prepare("SELECT status FROM fulfillment_jobs WHERE order_code='AXV-20260908-RR080001'").all();
    expect(jobs.every((j) => String(j.status) !== "retry")).toBe(true);
    expect(fixture.sql.prepare("SELECT status FROM fulfillment_items WHERE order_code='AXV-20260908-RR080001' AND item_index=0").get()?.status)
      .toBe("delivered");
  });
});
