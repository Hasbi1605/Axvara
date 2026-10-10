// tests/warung-rebahan/incident-20261010.regression.test.ts
//
// INSIDEN 10 Okt 2026 malam (AXV-20261010-E180A60E Vidio Mobile, -AA965842
// Netflix, -90402478 Netflix): order WR lunas tertahan saldo habis, saldo
// sudah diisi, link dipulihkan ke `pending` (reconcileBlockedBalance) — lalu
// DIAM 30+ menit tanpa request ke WR dan tanpa last_error. Kredensial order
// yang sudah `completed` juga tidak pernah dikirim (delivery_status tetap
// `not_required`).
//
// Akar yang dikunci di sini:
// 1. Budget 40 statement per request cron habis dipakai `reconcileMissingWrLinks`
//    (1 SELECT per item per kandidat × 12 kandidat, DIPANGGIL DUA KALI) sebelum
//    SELECT antrean due — dan SELECT itu `.catch(() => [])` sehingga budget
//    habis terbaca "tidak ada antrean". Volume-dependent: baru muncul di hari
//    dengan ≥10 order lunas.
// 2. Link `completed` + kredensial tersimpan tetapi `delivery_status` tidak
//    pernah di-queue (request webhook terputus di tengah) tidak punya penyapu.
// 3. API WR kini punya `delivery_mode` (auto/manual/mixed) per varian — kelas
//    instan/antrean harus mengikutinya, bukan tebakan/screenshot lama.
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupWrFixture, seedWrCatalog } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function callLite(job: string) {
  const { POST } = await import("@/app/api/cron/lite/route");
  const { NextRequest } = await import("next/server");
  const res = await POST(new NextRequest(`http://localhost/api/cron/lite?job=${job}`, {
    method: "POST", headers: { authorization: "Bearer s" },
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

function stubWrEnv() {
  vi.stubEnv("CRON_SECRET", "s");
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
}

type Fx = Awaited<ReturnType<typeof setupWrFixture>>;

/** Hari ramai: `n` order lunas WR 7 hari terakhir yang SUDAH punya link completed. */
function seedBusyDay(fx: Fx, n: number) {
  for (let i = 0; i < n; i++) {
    const code = `AXV-BUSY-${String(i).padStart(4, "0")}`;
    fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status,variant_id,paid_at)
      VALUES(?,?,?,?,7500,'qris','lunas','paid','web','delivered',1,datetime('now','-1 hour'))`)
      .run(code, "Buyer", "628000000000", JSON.stringify([{ product_id: 1, variant_id: 1, name: "CapCut Pro — Pro 7 Hari", price: 7500, qty: 1 }]));
    fx.sql.prepare(`INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,attempt_count,max_attempts,idempotency_key,delivery_status)
      VALUES(?,?,'var-1',1,5000,'completed',1,3,?,'delivered')`).run(code, `RBHN-BUSY-${i}`, `wr:${code}:var-1:1`);
  }
}

function seedRevivedLink(fx: Fx, code: string) {
  fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status,variant_id,paid_at)
    VALUES(?,?,?,?,?,7500,'qris','lunas','paid','web','manual_required',1,datetime('now','-30 minutes'))`)
    .run(code, "Yuda", "6281200000000", "buyer@example.com", JSON.stringify([{ product_id: 1, variant_id: 1, name: "CapCut Pro — Pro 7 Hari", price: 7500, qty: 1 }]));
  // Persis bentuk prod link 20/21: pending, attempt 0, due, last_error NULL.
  fx.sql.prepare(`INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,attempt_count,max_attempts,next_attempt_at,idempotency_key)
    VALUES(?,'var-1',1,5000,'pending',0,3,datetime('now','-20 minutes'),?)`).run(code, `wr:${code}:var-1:1`);
}

function wrFetchMock() {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/order")) {
      return new Response(JSON.stringify({ success: true, message: "ok", data: { order_id: "RBHN-NEW-1", status: "processing", payment_status: "paid", total_amount: 5000, current_balance: 45000 } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/balance")) {
      return new Response(JSON.stringify({ success: true, message: "ok", data: { balance: 50000, currency: "IDR" } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/transactions")) {
      return new Response(JSON.stringify({ success: true, message: "ok", data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

describe("Insiden 10 Okt — antrean WR macet di hari ramai", () => {
  it("lite wr_orders tetap meneruskan link due ke WR walau ada 12+ order lunas 7 hari terakhir", async () => {
    const fx = await setupWrFixture();
    try {
      stubWrEnv();
      seedWrCatalog(fx);
      seedBusyDay(fx, 14);
      seedRevivedLink(fx, "AXV-20261010-AA965842");
      const calls = wrFetchMock();
      const { status, body } = await callLite("wr_orders");
      expect(status).toBe(200);
      expect(calls.some((u) => u.includes("/order"))).toBe(true);
      expect(body).toMatchObject({ processed: 1, succeeded: 1 });
      const link = fx.sql.prepare("SELECT status, wr_order_id FROM wr_order_links WHERE order_code='AXV-20261010-AA965842'").get() as { status: string; wr_order_id: string };
      expect(link).toEqual({ status: "processing", wr_order_id: "RBHN-NEW-1" });
    } finally {
      fx.close();
    }
  });

  it("probe yatim memakai jumlah statement tetap (tidak tumbuh per kandidat)", async () => {
    const fx = await setupWrFixture();
    try {
      stubWrEnv();
      seedWrCatalog(fx);
      seedBusyDay(fx, 20);
      const { createBudgetedDatabase } = await import("@/lib/db-access");
      const budget = createBudgetedDatabase(40);
      const { reconcileMissingWrLinks } = await import("@/lib/warung-rebahan/order");
      const before = 38;
      await reconcileMissingWrLinks(budget.access);
      // Tidak ada yatim → cukup 1 SELECT; sisa budget hampir utuh.
      let left = 0;
      for (let n = before; n >= 0; n--) if (budget.access.canSpend(n)) { left = n; break; }
      expect(left).toBeGreaterThanOrEqual(36);
    } finally {
      fx.close();
    }
  });

  it("budget habis tidak lagi terbaca 'antrean kosong' secara diam-diam", async () => {
    const fx = await setupWrFixture();
    try {
      stubWrEnv();
      seedWrCatalog(fx);
      seedRevivedLink(fx, "AXV-20261010-E180A60E");
      wrFetchMock();
      const { createBudgetedDatabase, QueryBudgetExceeded } = await import("@/lib/db-access");
      const budget = createBudgetedDatabase(2); // plafon 0 → SELECT antrean pun tak muat
      const { processWrPendingOrders } = await import("@/lib/warung-rebahan/order");
      await expect(processWrPendingOrders(budget.access, { skipOrphanProbe: true })).rejects.toBeInstanceOf(QueryBudgetExceeded);
    } finally {
      fx.close();
    }
  });
});

describe("Insiden 10 Okt — kredensial completed tidak pernah dikirim", () => {
  it("completion terputus SEBELUM settle (item belum delivered) → di-queue ulang & dikirim cron", async () => {
    const fx = await setupWrFixture();
    try {
      stubWrEnv();
      seedWrCatalog(fx);
      const code = "AXV-20261010-90402478";
      fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status,variant_id,paid_at)
        VALUES(?,?,?,?,?,7500,'qris','lunas','paid','web','manual_required',1,datetime('now','-1 hour'))`)
        .run(code, "Gis", "", "buyer@example.com", JSON.stringify([{ product_id: 1, variant_id: 1, name: "CapCut Pro — Pro 7 Hari", price: 7500, qty: 1 }]));
      // Item BELUM delivered = completion terputus sebelum settle: pembeli
      // belum menerima apa pun → inilah satu-satunya kasus yang boleh requeue.
      fx.sql.prepare(`INSERT INTO fulfillment_items(id,order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,attempt_count)
        VALUES(145,?,0,1,1,1,'manual','web','queued',0)`).run(code);
      const { encryptSecret } = await import("@/lib/fulfillment/crypto");
      const ct = await encryptSecret("Email: a@b.c\nPassword: x");
      fx.sql.prepare(`INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,attempt_count,max_attempts,idempotency_key,wr_account_details,wr_account_iv,completed_at,fulfillment_item_id,delivery_status)
        VALUES(?,'RBHN-20261010-DF2612','var-1',1,5000,'completed',1,3,?,?,?,datetime('now','-30 minutes'),145,'not_required')`)
        .run(code, `wr:${code}:var-1:1`, ct.ciphertext, ct.iv);
      wrFetchMock();
      const { body } = await callLite("wr_orders");
      expect(body.credentials_requeued).toBe(1);
      const link = fx.sql.prepare("SELECT delivery_status, delivery_attempt_count FROM wr_order_links WHERE order_code=?").get(code) as { delivery_status: string; delivery_attempt_count: number };
      expect(link.delivery_attempt_count).toBeGreaterThanOrEqual(1);
      expect(["delivered", "failed"]).toContain(link.delivery_status);
    } finally {
      fx.close();
    }
  });

  it("link completed yang itemnya SUDAH delivered (WR) TIDAK di-queue ulang — anti kirim ulang 2026-10-11", async () => {
    const fx = await setupWrFixture();
    try {
      stubWrEnv();
      seedWrCatalog(fx);
      // Persis bentuk prod link 19: item delivered via WR (wr:145), order
      // sudah handover manual oleh owner → penyapu WAJIB diam.
      const code = "AXV-20261010-90402478";
      fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status,variant_id,paid_at)
        VALUES(?,?,?,?,?,7500,'qris','lunas','paid','web','delivered',1,datetime('now','-1 hour'))`)
        .run(code, "Gis", "", "buyer@example.com", JSON.stringify([{ product_id: 1, variant_id: 1, name: "CapCut Pro — Pro 7 Hari", price: 7500, qty: 1 }]));
      fx.sql.prepare(`INSERT INTO fulfillment_items(id,order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,attempt_count,delivered_message_id)
        VALUES(145,?,0,1,1,1,'manual','web','delivered',0,'wr:145')`).run(code);
      const { encryptSecret } = await import("@/lib/fulfillment/crypto");
      const ct = await encryptSecret("Email: a@b.c\nPassword: x");
      fx.sql.prepare(`INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,attempt_count,max_attempts,idempotency_key,wr_account_details,wr_account_iv,completed_at,fulfillment_item_id,delivery_status)
        VALUES(?,'RBHN-20261010-DF2612','var-1',1,5000,'completed',1,3,?,?,?,datetime('now','-30 minutes'),145,'not_required')`)
        .run(code, `wr:${code}:var-1:1`, ct.ciphertext, ct.iv);
      wrFetchMock();
      const { body } = await callLite("wr_orders");
      expect(body.credentials_requeued ?? 0).toBe(0);
      const link = fx.sql.prepare("SELECT delivery_status, delivery_attempt_count FROM wr_order_links WHERE order_code=?").get(code) as { delivery_status: string; delivery_attempt_count: number };
      expect(link.delivery_status).toBe("not_required");
      expect(link.delivery_attempt_count).toBe(0);
    } finally {
      fx.close();
    }
  });

  it("item yang sudah diserahkan admin manual TIDAK disentuh penyapu sama sekali", async () => {
    const fx = await setupWrFixture();
    try {
      stubWrEnv();
      seedWrCatalog(fx);
      const code = "AXV-20261010-3B581CAD";
      fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status,variant_id,paid_at)
        VALUES(?,?,?,?,7500,'qris','lunas','paid','telegram','delivered',1,datetime('now','-1 hour'))`)
        .run(code, "A", "", JSON.stringify([{ product_id: 1, variant_id: 1, name: "CapCut", price: 7500, qty: 1 }]));
      fx.sql.prepare(`INSERT INTO fulfillment_items(id,order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,attempt_count,delivered_message_id,last_error)
        VALUES(148,?,0,1,1,1,'manual','telegram','delivered',0,'manual','manual_handover:admin@x:2026-10-10T16:52:51.384Z')`).run(code);
      const { encryptSecret } = await import("@/lib/fulfillment/crypto");
      const ct = await encryptSecret("Email: a@b.c");
      fx.sql.prepare(`INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,attempt_count,max_attempts,idempotency_key,wr_account_details,wr_account_iv,completed_at,delivery_status)
        VALUES(?,'RBHN-20261010-027957','var-1',1,5000,'completed',1,3,?,?,?,datetime('now','-10 minutes'),'not_required')`)
        .run(code, `wr:${code}:var-1:1`, ct.ciphertext, ct.iv);
      const fetchCalls = wrFetchMock();
      // Penyapu WAJIB diam (anti kirim ulang 2026-10-11): item sudah
      // delivered-manual → status tetap not_required, attempt tetap 0.
      const { body } = await callLite("wr_orders");
      expect(body.credentials_requeued ?? 0).toBe(0);
      const link = fx.sql.prepare("SELECT delivery_status, delivery_attempt_count, delivery_last_error FROM wr_order_links WHERE order_code=?").get(code) as { delivery_status: string; delivery_attempt_count: number; delivery_last_error: string | null };
      expect(link.delivery_status).toBe("not_required");
      expect(link.delivery_attempt_count).toBe(0);
      expect(fetchCalls.some((u) => u.includes("api.telegram.org"))).toBe(false);
    } finally {
      fx.close();
    }
  });
});

describe("delivery_mode API WR = sumber kebenaran kelas instan/antrean", () => {
  it("auto → restock, manual/mixed → made_by_order, kosong → null", async () => {
    const { deliveryClassFromApiMode } = await import("@/lib/warung-rebahan/delivery-class");
    expect(deliveryClassFromApiMode("auto")).toBe("restock");
    expect(deliveryClassFromApiMode("AUTO ")).toBe("restock");
    expect(deliveryClassFromApiMode("manual")).toBe("made_by_order");
    expect(deliveryClassFromApiMode("mixed")).toBe("made_by_order");
    expect(deliveryClassFromApiMode(undefined)).toBeNull();
    expect(deliveryClassFromApiMode("")).toBeNull();
  });
});

describe("sync menulis delivery_mode API WR", () => {
  it("varian lama berkelas screenshot 'restock' tapi API 'manual' → made_by_order; varian baru langsung ikut API", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
    const fx = await setupWrFixture();
    try {
      const { createDatabaseAccess } = await import("@/lib/db-access");
      const { syncProducts } = await import("@/lib/warung-rebahan/sync");
      const db = createDatabaseAccess(fx.db);
      const product = (mode1: string, mode2?: string) => ({
        id: "prod-vidio", name: "Vidio Platinum", category: "Streaming", description: "x",
        variants: [
          { id: "var-mobile", name: "Mobile", price: 25000, duration: "28 Hari", type: "Private", warranty: "25 Hari", stock: 3, terms: null, delivery_terms: null, delivery_mode: mode1 },
          ...(mode2 ? [{ id: "var-alldev", name: "All Device", price: 40000, duration: "28 Hari", type: "Private", warranty: "25 Hari", stock: 3, terms: null, delivery_terms: null, delivery_mode: mode2 }] : []),
        ],
      });
      await syncProducts(db, async () => [product("auto")]);
      // Simulasi seed screenshot lama yang salah.
      fx.sql.prepare("UPDATE wr_variants SET wr_delivery_class='restock', wr_delivery_source='screenshot', wr_delivery_mode=NULL WHERE wr_variant_id='var-mobile'").run();
      await syncProducts(db, async () => [product("manual", "mixed")]);
      const rows = fx.sql.prepare("SELECT wr_variant_id, wr_delivery_class, wr_delivery_mode FROM wr_variants ORDER BY wr_variant_id").all();
      expect(rows).toEqual([
        { wr_variant_id: "var-alldev", wr_delivery_class: "made_by_order", wr_delivery_mode: "mixed" },
        { wr_variant_id: "var-mobile", wr_delivery_class: "made_by_order", wr_delivery_mode: "manual" },
      ]);
    } finally {
      fx.close();
    }
  });
});

describe("webhook WR resmi (api-docs 2026-10)", () => {
  async function sign(secret: string, body: string) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function post(body: string) {
    const { POST } = await import("@/app/api/webhook/warung/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/api/webhook/warung", {
      method: "POST",
      headers: { "content-type": "application/json", "x-digitals-signature": await sign("s", body), "x-digitals-delivery": "dlv-1" },
      body,
    });
    return POST(req);
  }

  it("order.completed (data.accounts) → kredensial tersimpan + antre kirim; order.refunded → failed", async () => {
    const fx = await setupWrFixture();
    try {
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "s");
      vi.stubEnv("WARUNG_REBAHAN_WEBHOOK_SECRET", "s");
      seedWrCatalog(fx);
      for (const [code, wrId] of [["AXV-WH-0001", "RBHN-WH-1"], ["AXV-WH-0002", "RBHN-WH-2"]]) {
        fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status,variant_id,paid_at)
          VALUES(?,?,?,?,7500,'qris','lunas','paid','telegram','manual_required',1,datetime('now'))`)
          .run(code, "B", "", JSON.stringify([{ product_id: 1, variant_id: 1, name: "CapCut", price: 7500, qty: 1 }]));
        fx.sql.prepare(`INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,attempt_count,max_attempts,idempotency_key)
          VALUES(?,?,'var-1',1,5000,'processing',1,3,?)`).run(code, wrId, `wr:${code}:var-1:1`);
      }
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, description: "no chat" }), { status: 400 })));
      const done = await post(JSON.stringify({ id: "evt-1", event: "order.completed", data: { order_id: "RBHN-WH-1", status: "completed", accounts: [{ product: "CapCut - Pro", details: "a@b.c | pw" }] } }));
      expect(done.status).toBe(200);
      const l1 = fx.sql.prepare("SELECT status, wr_account_details IS NOT NULL AS ct, delivery_status FROM wr_order_links WHERE wr_order_id='RBHN-WH-1'").get() as Record<string, unknown>;
      expect(l1.status).toBe("completed");
      expect(l1.ct).toBe(1);
      expect(l1.delivery_status).not.toBe("not_required");

      const refund = await post(JSON.stringify({ id: "evt-2", event: "order.refunded", data: { order_id: "RBHN-WH-2", status: "refunded", refunded: 5000, note: "stok kosong" } }));
      expect(refund.status).toBe(200);
      const l2 = fx.sql.prepare("SELECT status, last_error FROM wr_order_links WHERE wr_order_id='RBHN-WH-2'").get() as Record<string, unknown>;
      expect(l2.status).toBe("failed");
      expect(String(l2.last_error)).toContain("refunded");
    } finally {
      fx.close();
    }
  });
});
