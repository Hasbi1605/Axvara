import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  CHECKOUT_LIMITS,
  checkoutLimited,
  checkoutSubjects,
  consumeCheckoutSlot,
} from "@/lib/checkout-guard";

const NOW = 1_800_000_000_000;
let claimSequence = 0;
const newClaim = () => `fixture-quote-${++claimSequence}`;

async function subjects(ip: string, n: number) {
  return checkoutSubjects({
    ip,
    wa: `628111111${String(2700 + n)}`,
    email: `buyer${n}@example.test`,
  });
}

describe("checkout guard (durable D1)", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("enam klaim paralel quote sama hanya mengonsumsi satu slot dan tetap bisa diulang saat kuota penuh", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db), s = await subjects("203.0.113.72", 1), quote = newClaim();
      const decisions = await Promise.all(Array.from({ length: 6 }, () => consumeCheckoutSlot(db, s, quote, NOW)));
      expect(decisions.every((d) => d.allowed)).toBe(true);
      expect(fx.sql.prepare("SELECT orders_created FROM checkout_attempts").all()).toEqual(Array(3).fill({ orders_created: 1 }));
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM checkout_claims").get()?.n).toBe(1);
      for (let n = 1; n < CHECKOUT_LIMITS.wa; n++) expect((await consumeCheckoutSlot(db, s, newClaim(), NOW)).allowed).toBe(true);
      expect((await consumeCheckoutSlot(db, s, newClaim(), NOW)).allowed).toBe(false);
      expect((await consumeCheckoutSlot(db, s, quote, NOW)).allowed).toBe(true);
      expect((await consumeCheckoutSlot(db, s, quote, NOW + 900_000)).allowed).toBe(true);
    } finally { fx.close(); }
  });

  it("permintaan dari jendela lama tidak mereset counter jendela yang lebih baru", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db), s = await subjects("203.0.113.73", 1);
      expect((await consumeCheckoutSlot(db, s, newClaim(), NOW + 900_000)).allowed).toBe(true);
      expect((await consumeCheckoutSlot(db, s, newClaim(), NOW)).allowed).toBe(true);
      expect(fx.sql.prepare("SELECT window_id,orders_created FROM checkout_attempts").all()).toEqual(Array(3).fill({ window_id: Math.floor(NOW / 900_000) + 1, orders_created: 2 }));
    } finally { fx.close(); }
  });

  it("normalisasi IPv6/email stabil dan HMAC berubah ketika secret berubah", async () => {
    vi.stubEnv("ADMIN_JWT_SECRET", "review-secret-one");
    const a = await checkoutSubjects({ ip: "2001:0DB8:0:0:0:0:0:1", wa: "6281234567890", email: " BUYER@EXAMPLE.TEST " });
    const b = await checkoutSubjects({ ip: "2001:db8::1", wa: "6281234567890", email: "buyer@example.test" });
    expect(a).toEqual(b);
    vi.stubEnv("ADMIN_JWT_SECRET", "review-secret-two");
    const changed = await checkoutSubjects({ ip: "2001:db8::1", wa: "6281234567890", email: "buyer@example.test" });
    for (let i = 0; i < a.length; i++) expect(changed[i].hash).not.toBe(a[i].hash);
  });

  it.each(["write", "missing-table"])("error %s pada limiter tidak mengizinkan checkout tanpa counter", async (failure) => {
    const fx = createD1Fixture();
    try {
      if (failure === "missing-table") fx.sql.exec("DROP TABLE checkout_attempts");
      else fx.control.fail = (sql) => sql.includes("INSERT INTO checkout_attempts");
      const decision = await consumeCheckoutSlot(createDatabaseAccess(fx.db), await subjects("203.0.113.71", 1), newClaim(), NOW);
      expect(decision).toMatchObject({ allowed: false, reason: "unavailable" });
    } finally { fx.close(); }
  });

  it("menahan flood satu IP yang memutar WA/email setelah batas IP tercapai", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      for (let n = 1; n <= CHECKOUT_LIMITS.ip; n++) {
        const decision = await consumeCheckoutSlot(db, await subjects("203.0.113.9", n), newClaim(), NOW);
        expect(decision.allowed).toBe(true);
      }
      // Kontak berikutnya benar-benar baru (simulasi S6..S15), IP sama.
      const flood = await subjects("203.0.113.9", 99);
      expect((await consumeCheckoutSlot(db, flood, newClaim(), NOW)).allowed).toBe(false);
      const precheck = await checkoutLimited(db, flood, NOW);
      expect(precheck.allowed).toBe(false);
      if (!precheck.allowed) expect(precheck.retryAfterSeconds).toBeGreaterThan(0);
      // Baris tersimpan hanya hash (64 hex) — tidak ada IP/WA/email mentah.
      // Satu baris IP bersama + satu baris per WA + satu per email yang diputar.
      const rows = await db.queryAll(`SELECT * FROM checkout_attempts`);
      expect(rows).toHaveLength(1 + CHECKOUT_LIMITS.ip * 2);
      const ipRow = rows.find((r) => r.scope === "ip");
      expect(Number(ipRow?.orders_created)).toBe(CHECKOUT_LIMITS.ip);
      expect(JSON.stringify(rows)).not.toContain("203.0.113.9");
      expect(JSON.stringify(rows)).not.toContain("628111111");
      expect(JSON.stringify(rows)).not.toContain("@example.test");
      for (const row of rows) expect(String(row.subject_hash)).toMatch(/^[0-9a-f]{64}$/);
    } finally { fx.close(); }
  });

  it("satu WA/email ditahan lintas IP, subjek berbeda tidak ikut terkunci", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      // Pemanggil (Market+Pedia) selalu menormalisasi WA ke 62… sebelum
      // guard; kontrak itu yang diuji di sini.
      const sameWa = await checkoutSubjects({ ip: "198.51.100.1", wa: "6281234567890", email: "a@example.test" });
      for (let n = 0; n < CHECKOUT_LIMITS.wa; n++) {
        const s = await checkoutSubjects({ ip: `198.51.100.${n + 1}`, wa: "6281234567890", email: `a${n}@example.test` });
        expect((await consumeCheckoutSlot(db, s, newClaim(), NOW)).allowed).toBe(true);
      }
      expect((await consumeCheckoutSlot(db, sameWa, newClaim(), NOW)).allowed).toBe(false);
      const other = await checkoutSubjects({ ip: "192.0.2.5", wa: "6289876543210", email: "other@example.test" });
      expect((await consumeCheckoutSlot(db, other, newClaim(), NOW)).allowed).toBe(true);
    } finally { fx.close(); }
  });

  it("klaim paralel dalam satu jendela tidak melampaui batas mana pun", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const attempts = await Promise.all(
        Array.from({ length: CHECKOUT_LIMITS.ip + 4 }, async (_, i) => {
          const s = await checkoutSubjects({
            ip: "203.0.113.20",
            wa: `628111111${String(3000 + i)}`,
            email: `race${i}@example.test`,
          });
          return consumeCheckoutSlot(db, s, newClaim(), NOW);
        }),
      );
      expect(attempts.filter((d) => d.allowed)).toHaveLength(CHECKOUT_LIMITS.ip);
      const ipRow = await db.queryFirst(`SELECT orders_created FROM checkout_attempts WHERE scope='ip'`);
      expect(Number(ipRow?.orders_created)).toBe(CHECKOUT_LIMITS.ip);
    } finally { fx.close(); }
  });

  it("jendela berikutnya memulihkan kuota tanpa menghapus histori subjek", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      // Subjek identik: batas paling ketat (WA/email = 3) yang mengikat.
      const s = await checkoutSubjects({ ip: "203.0.113.30", wa: "6281234567890", email: "a@example.test" });
      for (let n = 0; n < CHECKOUT_LIMITS.wa; n++) {
        expect((await consumeCheckoutSlot(db, s, newClaim(), NOW)).allowed).toBe(true);
      }
      expect((await consumeCheckoutSlot(db, s, newClaim(), NOW)).allowed).toBe(false);
      const nextWindow = NOW + 15 * 60_000;
      expect((await consumeCheckoutSlot(db, s, newClaim(), nextWindow)).allowed).toBe(true);
      const ipRow = await db.queryFirst(`SELECT orders_created FROM checkout_attempts WHERE scope='ip'`);
      expect(Number(ipRow?.orders_created)).toBe(1);
    } finally { fx.close(); }
  });

  it("dev tanpa D1 lolos, tetapi subjek kosong atau D1 produksi hilang ditolak", async () => {
    const db = createDatabaseAccess(null);
    expect(db.d1).toBeNull();
    expect((await consumeCheckoutSlot(db, await subjects("203.0.113.1", 1), newClaim(), NOW)).allowed).toBe(true);
    const fx = createD1Fixture();
    try {
      const withDb = createDatabaseAccess(fx.db);
      expect((await consumeCheckoutSlot(withDb, [], newClaim(), NOW)).allowed).toBe(false);
      vi.stubEnv("NODE_ENV", "production");
      expect(await consumeCheckoutSlot(db, [], newClaim(), NOW)).toMatchObject({ allowed: false, reason: "unavailable" });
    } finally { fx.close(); vi.unstubAllEnvs(); }
  });
});

describe("route web memakai guard durable", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(["parallel-retry", "limiter-write-error"])("Market %s preserves retry quota and rejects unavailable admission", async (scenario) => {
    const fx = createD1Fixture();
    try {
      const { insertTestProduct } = await import("./helpers/d1-fixture");
      await insertTestProduct(fx.sql, "manual", 1);
      fx.sql.exec("UPDATE product_variants SET price=1000; UPDATE products SET is_active=1");
      vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
      vi.stubEnv("ADMIN_JWT_SECRET", "checkout-route-review-secret");
      const qris = await import("@/lib/payments/dana-qris");
      const invoice = vi.spyOn(qris, "createActiveQrisInvoice").mockImplementation(async (code, amount) => ({
        orderCode: code, requestedAmount: amount, payableAmount: amount + 1, uniqueCode: 1,
        qrisPayload: "fixture", qrisUrl: "/fixture.png", expiresAt: "2099-01-01", isExisting: false,
      }));
      const { clearRateLimitBucketsForTest } = await import("@/lib/rateLimit");
      clearRateLimitBucketsForTest();
      const { createCheckoutQuoteToken } = await import("@/lib/auth");
      const { POST } = await import("@/app/api/orders/route");
      const { NextRequest } = await import("next/server");
      const { token } = await createCheckoutQuoteToken({
        items: [{ product_id: 1, variant_id: 1, qty: 1, price: 1000, name: "Fixture" }],
        subtotal: 1000, payment_methods: [{ id: "qris", account_number: "-" }],
      });
      const request = () => new NextRequest("https://axvara.test/api/orders", {
        method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.74" },
        body: JSON.stringify({ customer_wa: "081234567890", customer_email: "review@example.test",
          items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: "qris", quote_token: token }),
      });
      if (scenario === "limiter-write-error") {
        fx.control.fail = (sql) => sql.includes("INSERT INTO checkout_attempts");
        const response = await POST(request());
        expect(response.status).toBe(503);
        expect(response.headers.get("Retry-After")).toBe("60");
        expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
        expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
        expect(invoice).not.toHaveBeenCalled();
      } else {
        const responses = await Promise.all(Array.from({ length: 6 }, () => POST(request())));
        expect(responses.map((r) => r.status).sort()).toEqual([200,200,200,200,200,201]);
        expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);
        expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(99);
        expect(fx.sql.prepare("SELECT orders_created FROM checkout_attempts").all()).toEqual(Array(3).fill({ orders_created: 1 }));
      }
    } finally { fx.close(); }
  });

  it("order WEB ke-6 dari IP sama (WA/email diputar) → 429, order tersimpan tetap 5, retry order lama tetap 200", async () => {
    const fx = createD1Fixture();
    try {
      const { insertTestProduct } = await import("./helpers/d1-fixture");
      await insertTestProduct(fx.sql, "manual", 1);
      fx.sql.prepare("UPDATE product_variants SET price=1000,stock=100,fulfillment_mode='manual' WHERE id=1").run();
      fx.sql.prepare("UPDATE products SET is_active=1 WHERE id=1").run();
      vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
      vi.stubEnv("QRIS_ACTIVE_PROVIDER", "klikqris");
      vi.stubEnv("KLIKQRIS_ENABLED", "false");
      vi.stubEnv("ADMIN_JWT_SECRET", "checkout-guard-test-secret");
      const { clearRateLimitBucketsForTest } = await import("@/lib/rateLimit");
      clearRateLimitBucketsForTest();
      const { createCheckoutQuoteToken } = await import("@/lib/auth");
      const { POST } = await import("@/app/api/orders/route");
      const { NextRequest } = await import("next/server");

      const makeRequest = async (n: number, token: string) => new NextRequest("https://axvara.tech/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.44" },
        body: JSON.stringify({
          customer_wa: `0811111127${String(10 + n).padStart(2, "0")}`,
          customer_email: `flood${n}@example.test`,
          items: [{ product_id: 1, variant_id: 1, qty: 1 }],
          payment_method: "qris",
          quote_token: token,
        }),
      });
      const tokens: string[] = [];
      for (let n = 1; n <= CHECKOUT_LIMITS.ip; n++) {
        const { token } = await createCheckoutQuoteToken({
          items: [{ product_id: 1, variant_id: 1, qty: 1, price: 1000, name: "Fixture" }],
          subtotal: 1000,
          payment_methods: [{ id: "qris", account_number: "-" }],
        });
        tokens.push(token);
        const res = await POST(await makeRequest(n, token));
        // Invoice provider nonaktif di fixture → 503 sesudah order dibuat,
        // yang penting guard mengizinkan pembuatan order baru ini.
        expect(res.status).not.toBe(429);
      }
      expect(Number(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()!.n)).toBe(CHECKOUT_LIMITS.ip);

      const { token: token6 } = await createCheckoutQuoteToken({
        items: [{ product_id: 1, variant_id: 1, qty: 1, price: 1000, name: "Fixture" }],
        subtotal: 1000,
        payment_methods: [{ id: "qris", account_number: "-" }],
      });
      const blocked = await POST(await makeRequest(6, token6));
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBeTruthy();
      expect(Number(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()!.n)).toBe(CHECKOUT_LIMITS.ip);

      // Retry checkout yang sama (quote pertama) tidak diblokir limiter.
      const retry = await POST(await makeRequest(1, tokens[0]));
      expect(retry.status).toBe(200);
      expect((await retry.json()).reused).toBe(true);
      expect(Number(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()!.n)).toBe(CHECKOUT_LIMITS.ip);
    } finally { fx.close(); }
  });
});
