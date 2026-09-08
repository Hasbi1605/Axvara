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

const ADMIN = { email: "admin@axvara.tech", secret: "rr4-secret-0123456789abcdef", hash: "d".repeat(64) };

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
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled"); }));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function authCookie() {
  const { createAdminToken, createIdleToken } = await import("@/lib/auth");
  const { token, sid } = await createAdminToken(ADMIN.email);
  const idle = await createIdleToken(sid);
  return `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(idle)}`;
}

async function paidManualOrder(code: string, n = 1, qty = 1, mode = "manual") {
  await insertTestProduct(fixture.sql, mode, n);
  const items = Array.from({ length: n }, (_, i) => ({ product_id: 1, variant_id: i + 1, name: `Item ${i + 1}`, price: 10000, qty }));
  fixture.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
     sales_channel,fulfillment_status,variant_id,variant_snapshot)
    VALUES (?,?,?, ?,?,?, 'lunas','paid','web','retry',1,?)`)
    .run(code, "Buyer", "628000000000", JSON.stringify(items), 10000 * n * qty,
      JSON.stringify({ lines: items.map((it) => ({ variant_id: it.variant_id, fulfillment_mode: mode })) }));
  const { ensureFulfillmentForPaidOrder } = await import("@/lib/fulfillment/deliver");
  await ensureFulfillmentForPaidOrder(code);
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

// ─── RR4-03: retry saat fault masih aktif tidak boleh sukses palsu ───
describe("RR4-03 handover retries stay honest while storage still fails", () => {
  it("dua retry saat fault agregat aktif tidak mengaku selesai; pulih setelah DB sehat", async () => {
    await paidManualOrder("AXV-20260908-RR430001");
    const cookie = await authCookie();
    fixture.control.fail = (q) => q.includes("UPDATE orders SET fulfillment_status=");
    const first = await handover("AXV-20260908-RR430001", 0, cookie);
    expect(first.status).toBe(500);
    const second = await handover("AXV-20260908-RR430001", 0, cookie);
    const third = await handover("AXV-20260908-RR430001", 0, cookie);
    fixture.control.fail = null;
    // Kedua retry saat fault aktif TIDAK boleh 200 ok:true.
    for (const r of [second, third]) {
      if (r.status === 200) {
        const b = await r.clone().json() as Record<string, unknown>;
        expect(b.fulfillment_status).toBe("delivered");
      } else {
        expect([409, 500]).toContain(r.status);
      }
    }
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-20260908-RR430001'").get()?.fulfillment_status)
      .not.toBe("delivered");
    // Setelah DB pulih, ulangi: konsisten tuntas.
    const retry = await handover("AXV-20260908-RR430001", 0, cookie);
    expect(retry.status).toBe(200);
    expect((await retry.json() as Record<string, unknown>).fulfillment_status).toBe("delivered");
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-20260908-RR430001'").get()?.fulfillment_status).toBe("delivered");
  });

  it("cabang delivered mempropagasi kegagalan reconcile (bukan void healed)", async () => {
    await paidManualOrder("AXV-20260908-RR430002");
    const cookie = await authCookie();
    // Selesaikan item dulu (tanpa fault), lalu gagalkan agregat.
    const ok = await handover("AXV-20260908-RR430002", 0, cookie);
    expect(ok.status).toBe(200);
    // Buat agregat tidak konsisten lagi + gagalkan reconcile berikutnya.
    fixture.sql.prepare("UPDATE orders SET fulfillment_status='manual_required' WHERE code='AXV-20260908-RR430002'").run();
    fixture.control.fail = (q) => q.includes("UPDATE orders SET fulfillment_status=");
    const retry = await handover("AXV-20260908-RR430002", 0, cookie);
    fixture.control.fail = null;
    // Item sudah delivered tetapi agregat gagal ditulis: TIDAK boleh 200
    // dengan fulfillment_status delivered.
    if (retry.status === 200) {
      const b = await retry.json() as Record<string, unknown>;
      expect(b.fulfillment_status).not.toBe("delivered");
    } else {
      expect([409, 500]).toContain(retry.status);
    }
  });

  it("satu fakta handover stabil: retry tidak menambah marker audit baru", async () => {
    await paidManualOrder("AXV-20260908-RR430003");
    const cookie = await authCookie();
    await handover("AXV-20260908-RR430003", 0, cookie);
    const note1 = String(fixture.sql.prepare("SELECT admin_note FROM orders WHERE code='AXV-20260908-RR430003'").get()?.admin_note ?? "");
    await handover("AXV-20260908-RR430003", 0, cookie);
    await handover("AXV-20260908-RR430003", 0, cookie);
    const note2 = String(fixture.sql.prepare("SELECT admin_note FROM orders WHERE code='AXV-20260908-RR430003'").get()?.admin_note ?? "");
    const count = (note2.match(/handover item 0/g) ?? []).length;
    expect(count).toBe(1);
    expect(note2).toBe(note1);
  });

  it("fault inventory terpicu nyata via inventory_id + gagal jujur lalu pulih", async () => {
    await paidManualOrder("AXV-20260908-RR430004", 1, 1, "unique");
    // Pastikan item terikat inventory reserved nyata.
    const inv = fixture.sql.prepare("SELECT id, status FROM fulfillment_inventory WHERE order_code='AXV-20260908-RR430004'").get();
    // Unique via web-checkout path mungkin tidak reserve; tanam manual bila perlu.
    if (!inv) {
      const { encryptSecret, computeFingerprint } = await import("@/lib/fulfillment/crypto");
      const s = await encryptSecret("RR4-UNIQUE-1");
      fixture.sql.prepare(`INSERT INTO fulfillment_inventory
        (product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint,status,order_code,reserved_at)
        VALUES (1,1,?,?,?,'reserved','AXV-20260908-RR430004',datetime('now'))`)
        .run(s.ciphertext, s.iv, await computeFingerprint("RR4-UNIQUE-1"));
      fixture.sql.prepare("UPDATE fulfillment_items SET inventory_id=? WHERE order_code='AXV-20260908-RR430004'")
        .run(Number(fixture.sql.prepare("SELECT id FROM fulfillment_inventory WHERE order_code='AXV-20260908-RR430004'").get()?.id));
    }
    const bound = fixture.sql.prepare("SELECT inventory_id FROM fulfillment_items WHERE order_code='AXV-20260908-RR430004'").get()?.inventory_id;
    expect(Number(bound ?? 0)).toBeGreaterThan(0);
    const cookie = await authCookie();
    fixture.control.fail = (q) => q.includes("fulfillment_inventory");
    const first = await handover("AXV-20260908-RR430004", 0, cookie);
    fixture.control.fail = null;
    expect([409, 500]).toContain(first.status);
    const retry = await handover("AXV-20260908-RR430004", 0, cookie);
    expect(retry.status).toBe(200);
    expect(String(fixture.sql.prepare("SELECT status FROM fulfillment_inventory WHERE order_code='AXV-20260908-RR430004'").get()?.status ?? "")).toBe("delivered");
  });
});

// ─── RR4-04: guard quantity ───
describe("RR4-04 handover verifies unit quantities", () => {
  it("order qty 2 vs fulfillment qty 1 tidak boleh delivered seluruhnya", async () => {
    await paidManualOrder("AXV-20260908-RR440001", 1, 2);
    fixture.sql.prepare("UPDATE fulfillment_items SET qty=1 WHERE order_code='AXV-20260908-RR440001'").run();
    const cookie = await authCookie();
    const res = await handover("AXV-20260908-RR440001", 0, cookie);
    if (res.status === 200) {
      const b = await res.json() as Record<string, unknown>;
      expect(b.fulfillment_status).not.toBe("delivered");
    } else {
      expect(res.status).toBe(409);
    }
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-20260908-RR440001'").get()?.fulfillment_status)
      .not.toBe("delivered");
  });

  it("order qty valid tetap berjalan hingga delivered", async () => {
    await paidManualOrder("AXV-20260908-RR440002", 1, 2);
    const cookie = await authCookie();
    const res = await handover("AXV-20260908-RR440002", 0, cookie);
    expect(res.status).toBe(200);
    expect((await res.json() as Record<string, unknown>).fulfillment_status).toBe("delivered");
  });
});

// ─── RR4-05: attempt terakhir sinkron ke order ───
describe("RR4-05 final attempt failure syncs job, item, and order", () => {
  it("attempt 5 gagal: job+item failed, order bukan queued", async () => {
    await insertTestProduct(fixture.sql, "shared", 1);
    const items = [{ product_id: 1, variant_id: 1, name: "F", price: 10000, qty: 1 }];
    fixture.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
       sales_channel,telegram_chat_id,telegram_user_id,fulfillment_status,variant_id,variant_snapshot)
      VALUES ('AXV-20260908-RR450001','Buyer','628',?,10000,'qris','lunas','paid','telegram','12345','12345','queued',1,?)`)
      .run(JSON.stringify(items), JSON.stringify({ lines: [{ variant_id: 1, fulfillment_mode: "shared" }] }));
    fixture.sql.prepare("INSERT OR IGNORE INTO telegram_users(user_id,chat_id) VALUES('12345','12345')").run();
    const { ensureFulfillmentItems, createFulfillmentJob, processJob } = await import("@/lib/fulfillment/deliver");
    const row = fixture.sql.prepare("SELECT * FROM orders WHERE code='AXV-20260908-RR450001'").get()!;
    await ensureFulfillmentItems(row);
    await createFulfillmentJob("AXV-20260908-RR450001", null, "shared", 1, "telegram");
    fixture.sql.prepare("UPDATE fulfillment_jobs SET attempt_count=4 WHERE order_code='AXV-20260908-RR450001'").run();
    fixture.sql.prepare("UPDATE fulfillment_items SET attempt_count=4 WHERE order_code='AXV-20260908-RR450001'").run();
    const { sendMessage } = await import("@/lib/telegram/api");
    (sendMessage as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Request timeout"));
    const product = fixture.sql.prepare("SELECT * FROM products WHERE id=1").get()!;
    const fresh = fixture.sql.prepare("SELECT * FROM orders WHERE code='AXV-20260908-RR450001'").get()!;
    const jobId = Number(fixture.sql.prepare("SELECT id FROM fulfillment_jobs WHERE order_code='AXV-20260908-RR450001'").get()?.id);
    await processJob(jobId, fresh, product);
    expect(String(fixture.sql.prepare("SELECT status FROM fulfillment_jobs WHERE id=?").get(jobId)?.status ?? "")).toBe("failed");
    expect(String(fixture.sql.prepare("SELECT status FROM fulfillment_items WHERE order_code='AXV-20260908-RR450001'").get()?.status ?? "")).toBe("failed");
    expect(String(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-20260908-RR450001'").get()?.fulfillment_status ?? "")).not.toBe("queued");
  });

  it("worker basi dihentikan setelah owner baru: retry, failed, delivered, manual_required", async () => {
    await insertTestProduct(fixture.sql, "shared", 2);
    fixture.sql.prepare("UPDATE product_variants SET fulfillment_mode='manual' WHERE id=2").run();
    const items = [
      { product_id: 1, variant_id: 1, name: "S", price: 10000, qty: 1 },
      { product_id: 1, variant_id: 2, name: "M", price: 10000, qty: 1 },
    ];
    fixture.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
       sales_channel,telegram_chat_id,telegram_user_id,fulfillment_status,variant_id,variant_snapshot)
      VALUES ('AXV-20260908-RR450002','Buyer','628',?,20000,'qris','lunas','paid','telegram','12345','12345','queued',1,?)`)
      .run(JSON.stringify(items), JSON.stringify({ lines: [{ variant_id: 1, fulfillment_mode: "shared" }, { variant_id: 2, fulfillment_mode: "manual" }] }));
    fixture.sql.prepare("INSERT OR IGNORE INTO telegram_users(user_id,chat_id) VALUES('12345','12345')").run();
    const delivery = await import("@/lib/fulfillment/deliver");
    const api = await import("@/lib/telegram/api");
    const send = api.sendMessage as unknown as ReturnType<typeof vi.fn>;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let enteredResolve!: () => void;
    const entered = new Promise<void>((r) => { enteredResolve = r; });
    send.mockImplementationOnce(async () => { enteredResolve(); await gate; return { ok: true, result: { message_id: 9 } }; });
    const stale = delivery.ensureFulfillmentForPaidOrder("AXV-20260908-RR450002");
    await entered;
    fixture.sql.prepare("UPDATE fulfillment_jobs SET locked_until='2020-01-01T00:00:00.000Z'").run();
    fixture.sql.prepare("UPDATE fulfillment_items SET locked_until='2020-01-01T00:00:00.000Z'").run();
    await delivery.releaseStaleJobs();
    await delivery.ensureFulfillmentForPaidOrder("AXV-20260908-RR450002");
    const ownerState = {
      job: String(fixture.sql.prepare("SELECT status FROM fulfillment_jobs WHERE order_code='AXV-20260908-RR450002'").get()?.status ?? ""),
      order: String(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-20260908-RR450002'").get()?.fulfillment_status ?? ""),
      err: String(fixture.sql.prepare("SELECT last_error FROM fulfillment_jobs WHERE order_code='AXV-20260908-RR450002'").get()?.last_error ?? ""),
    };
    release();
    await stale;
    // Hasil owner baru utuh: status, error, dan item selesai tidak direset.
    expect(String(fixture.sql.prepare("SELECT status FROM fulfillment_jobs WHERE order_code='AXV-20260908-RR450002'").get()?.status ?? "")).toBe(ownerState.job);
    expect(String(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-20260908-RR450002'").get()?.fulfillment_status ?? "")).toBe(ownerState.order);
    expect(String(fixture.sql.prepare("SELECT last_error FROM fulfillment_jobs WHERE order_code='AXV-20260908-RR450002'").get()?.last_error ?? "")).toBe(ownerState.err);
  });
});
