// tests/qris-reissue.integration.test.ts — Bukti bahwa reissue QRIS adalah
// fitur nyata yang berpengaruh ke state, bukan hanya kode yang ada.
//
// Latar: sebelum ini masa hidup ORDER disamakan dengan masa hidup QR (15
// menit) karena `createDanaQrisInvoice` menimpa `orders.expires_at`, dan tidak
// ada jalur reissue sama sekali:
//   - `createDanaQrisInvoice` mengembalikan baris lama (`isExisting: true`)
//     begitu `payment_transactions` ada — termasuk yang sudah kedaluwarsa.
//   - `src/lib/telegram/invoice-retry.ts` hanya mengirim ULANG FOTO invoice
//     yang sama, bukan menerbitkan nominal/expiry baru.
// Jadi pembeli yang telat bayar wajib mengulang seluruh alur dari nol.
//
// Test ini mengeksekusi SQL sungguhan lewat fixture SQLite (schema.sql), lalu
// memeriksa baris DB — bukan mencocokkan string source.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { NextRequest } from "next/server";

let fixture: ReturnType<typeof createD1Fixture>;

beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  const { calculateCrc16 } = await import("@/lib/payments/dana-qris");
  const qr = "00020101021153033605802ID6304";
  vi.stubEnv("DANA_QRIS_ENABLED", "true");
  vi.stubEnv("DANA_STATIC_QRIS", qr + calculateCrc16(qr));
  vi.stubEnv("DANA_WEBHOOK_SECRET", "secret-dana");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled"); }));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const CODE = "AXV-20260909-AAAAAAA1";

/** Order pending + invoice DANA aktif, seperti setelah checkout QRIS. */
async function seedPendingQrisOrder(options: { invoiceExpiresAt?: string; orderExpiresAt?: string; reissues?: number } = {}) {
  await insertTestProduct(fixture.sql, "manual", 1);
  const invoiceExpiresAt = options.invoiceExpiresAt ?? new Date(Date.now() + 10 * 60_000).toISOString();
  const orderExpiresAt = options.orderExpiresAt ?? new Date(Date.now() + 55 * 60_000).toISOString();
  fixture.sql.prepare(
    `INSERT INTO orders (code, customer_name, customer_wa, items, subtotal, payment_method,
       payment_account, status, sales_channel, payment_status, fulfillment_status,
       variant_id, expires_at, qris_reissue_count)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    CODE, "Budi", "0812", JSON.stringify([{ product_id: 1, variant_id: 1, name: "Fixture — Variant 1", price: 10_000, qty: 1 }]),
    10_000, "qris", "DANA Business", "pending", "web", "pending", "not_required", 1,
    orderExpiresAt, options.reissues ?? 0,
  );
  fixture.sql.prepare(
    `INSERT INTO payment_transactions (order_code, provider, provider_mode, provider_order_id,
       merchant_id, requested_amount, payable_amount, unique_code, status, qris_payload, qris_url, expires_at)
     VALUES (?,'dana','dynamic-qris',?,'dana-business',?,?,?,'pending','PAYLOAD',?,?)`,
  ).run(CODE, CODE, 10_000, 10_042, 42, `/api/payments/qris/${CODE}/image`, invoiceExpiresAt);
}

function orderRow() {
  return fixture.sql.prepare(`SELECT status, expires_at, qris_reissue_count FROM orders WHERE code=?`).get(CODE) as Record<string, unknown>;
}
function txRow() {
  return fixture.sql.prepare(`SELECT payable_amount, unique_code, qris_payload, expires_at, status FROM payment_transactions WHERE order_code=?`).get(CODE) as Record<string, unknown>;
}

describe("expiry order dipisah dari expiry invoice QRIS", () => {
  it("pembuatan invoice memberi order jendela 60 menit, bukan 15 menit milik QR", async () => {
    await insertTestProduct(fixture.sql, "manual", 1);
    fixture.sql.prepare(
      `INSERT INTO orders (code, customer_name, customer_wa, items, subtotal, payment_method, payment_account,
         status, sales_channel, payment_status, fulfillment_status, variant_id, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(CODE, "Budi", "0812", "[]", 10_000, "pending", "", "pending", "web", "unpaid", "not_required", 1,
      new Date(Date.now() + 60 * 60_000).toISOString());

    const { createDanaQrisInvoice, DANA_QRIS_EXPIRY_MINUTES, QRIS_ORDER_WINDOW_MINUTES } = await import("@/lib/payments/dana-qris");
    const invoice = await createDanaQrisInvoice(CODE, 10_000);

    const invoiceMs = Date.parse(invoice.expiresAt) - Date.now();
    const orderMs = Date.parse(String(orderRow().expires_at)) - Date.now();
    // Dua nilai yang BERBEDA — inilah inti perbaikannya.
    expect(Math.round(invoiceMs / 60_000)).toBe(DANA_QRIS_EXPIRY_MINUTES);
    expect(Math.round(orderMs / 60_000)).toBe(QRIS_ORDER_WINDOW_MINUTES);
    expect(orderMs).toBeGreaterThan(invoiceMs);
  });

  it("expires_at ditulis ISO UTC agar pembacaan JS tidak bergeser zona waktu", async () => {
    await insertTestProduct(fixture.sql, "manual", 1);
    fixture.sql.prepare(
      `INSERT INTO orders (code, customer_name, customer_wa, items, subtotal, payment_method, payment_account,
         status, sales_channel, payment_status, fulfillment_status, variant_id, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(CODE, "Budi", "0812", "[]", 10_000, "pending", "", "pending", "web", "unpaid", "not_required", 1,
      new Date(Date.now() + 60 * 60_000).toISOString());
    const { createDanaQrisInvoice } = await import("@/lib/payments/dana-qris");
    await createDanaQrisInvoice(CODE, 10_000);
    // Format spasi "YYYY-MM-DD HH:MM:SS" ditafsirkan Date.parse sebagai waktu
    // LOKAL; di WIB itu menggeser expiry 7 jam lebih awal.
    expect(String(orderRow().expires_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe("reissue QRIS mengubah state, bukan mengembalikan invoice lama", () => {
  it("QR kedaluwarsa + order hidup: nominal dan expiry benar-benar berganti di DB", async () => {
    await seedPendingQrisOrder({ invoiceExpiresAt: new Date(Date.now() - 60_000).toISOString() });
    const before = txRow();

    const { reissueDanaQrisInvoice } = await import("@/lib/payments/dana-qris");
    const result = await reissueDanaQrisInvoice(CODE);

    expect(result.ok).toBe(true);
    const after = txRow();
    expect(Number(after.payable_amount)).not.toBe(Number(before.payable_amount));
    expect(Number(after.unique_code)).not.toBe(Number(before.unique_code));
    expect(String(after.qris_payload)).not.toBe(String(before.qris_payload));
    expect(Date.parse(String(after.expires_at))).toBeGreaterThan(Date.now());
    // Nominal tetap integer rupiah = harga dasar + kode unik.
    expect(Number(after.payable_amount) - 10_000).toBe(Number(after.unique_code));
    expect(Number.isInteger(Number(after.payable_amount))).toBe(true);
  });

  it("createDanaQrisInvoice SENDIRI tidak bisa memperbarui QR mati (kenapa reissue perlu ada)", async () => {
    const deadExpiry = new Date(Date.now() - 60_000).toISOString();
    await seedPendingQrisOrder({ invoiceExpiresAt: deadExpiry });
    const { createDanaQrisInvoice } = await import("@/lib/payments/dana-qris");
    const invoice = await createDanaQrisInvoice(CODE, 10_000);
    expect(invoice.isExisting).toBe(true);
    expect(Date.parse(invoice.expiresAt)).toBeLessThan(Date.now()); // masih mati
    expect(Number(txRow().payable_amount)).toBe(10_042); // tak tersentuh
  });

  it("UNIQUE(order_code) dihormati: reissue meng-UPDATE baris yang sama, tidak menambah baris", async () => {
    await seedPendingQrisOrder({ invoiceExpiresAt: new Date(Date.now() - 60_000).toISOString() });
    const { reissueDanaQrisInvoice } = await import("@/lib/payments/dana-qris");
    await reissueDanaQrisInvoice(CODE);
    const count = fixture.sql.prepare(`SELECT COUNT(*) AS n FROM payment_transactions WHERE order_code=?`).get(CODE) as { n: number };
    expect(Number(count.n)).toBe(1);
  });

  it("penghitung reissue bertambah dan sisa kuota dilaporkan ke pemanggil", async () => {
    await seedPendingQrisOrder({ invoiceExpiresAt: new Date(Date.now() - 60_000).toISOString() });
    const { reissueDanaQrisInvoice, MAX_QRIS_REISSUES } = await import("@/lib/payments/dana-qris");
    const result = await reissueDanaQrisInvoice(CODE);
    expect(result.ok && result.remaining).toBe(MAX_QRIS_REISSUES - 1);
    expect(Number(orderRow().qris_reissue_count)).toBe(1);
  });

  it("nominal lama tidak dipakai ulang langsung pada reissue berikutnya", async () => {
    await seedPendingQrisOrder({ invoiceExpiresAt: new Date(Date.now() - 60_000).toISOString() });
    const { reissueDanaQrisInvoice } = await import("@/lib/payments/dana-qris");
    const seen = new Set<number>([10_042]);
    for (let round = 0; round < 3; round++) {
      // Matikan invoice terbaru agar syarat reissue terpenuhi lagi.
      fixture.sql.prepare(`UPDATE payment_transactions SET expires_at=? WHERE order_code=?`)
        .run(new Date(Date.now() - 60_000).toISOString(), CODE);
      const result = await reissueDanaQrisInvoice(CODE);
      expect(result.ok, `round ${round}`).toBe(true);
      const amount = Number(txRow().payable_amount);
      expect(seen.has(amount), `nominal ${amount} terulang di round ${round}`).toBe(false);
      seen.add(amount);
    }
  });
});

describe("reissue menolak kondisi yang tidak boleh", () => {
  it("QR yang MASIH berlaku tidak bisa diganti (melindungi QR aktif pembeli)", async () => {
    await seedPendingQrisOrder({ invoiceExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString() });
    const { reissueDanaQrisInvoice } = await import("@/lib/payments/dana-qris");
    const result = await reissueDanaQrisInvoice(CODE);
    expect(result).toEqual({ ok: false, reason: "invoice_still_active" });
    expect(Number(txRow().payable_amount)).toBe(10_042);
    expect(Number(orderRow().qris_reissue_count)).toBe(0);
  });

  it("order yang sudah lunas tidak bisa diperpanjang", async () => {
    await seedPendingQrisOrder({ invoiceExpiresAt: new Date(Date.now() - 60_000).toISOString() });
    fixture.sql.prepare(`UPDATE orders SET status='lunas', payment_status='paid' WHERE code=?`).run(CODE);
    const { reissueDanaQrisInvoice } = await import("@/lib/payments/dana-qris");
    expect(await reissueDanaQrisInvoice(CODE)).toEqual({ ok: false, reason: "order_not_reissuable" });
  });

  it("order yang jendela 60 menitnya habis tidak bisa diperpanjang", async () => {
    await seedPendingQrisOrder({
      invoiceExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      orderExpiresAt: new Date(Date.now() - 30_000).toISOString(),
    });
    const { reissueDanaQrisInvoice } = await import("@/lib/payments/dana-qris");
    expect(await reissueDanaQrisInvoice(CODE)).toEqual({ ok: false, reason: "order_not_reissuable" });
  });

  it("batas reissue ditegakkan", async () => {
    const { MAX_QRIS_REISSUES, reissueDanaQrisInvoice } = await import("@/lib/payments/dana-qris");
    await seedPendingQrisOrder({
      invoiceExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      reissues: MAX_QRIS_REISSUES,
    });
    expect(await reissueDanaQrisInvoice(CODE)).toEqual({ ok: false, reason: "reissue_limit_reached" });
    expect(Number(txRow().payable_amount)).toBe(10_042);
  });

  it("order tanpa ledger DANA ditolak, bukan melempar", async () => {
    await insertTestProduct(fixture.sql, "manual", 1);
    fixture.sql.prepare(
      `INSERT INTO orders (code, customer_name, customer_wa, items, subtotal, payment_method, payment_account,
         status, sales_channel, payment_status, fulfillment_status, variant_id, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(CODE, "Budi", "0812", "[]", 10_000, "seabank", "", "pending", "web", "unpaid", "not_required", 1,
      new Date(Date.now() + 60 * 60_000).toISOString());
    const { reissueDanaQrisInvoice } = await import("@/lib/payments/dana-qris");
    expect(await reissueDanaQrisInvoice(CODE)).toEqual({ ok: false, reason: "order_not_reissuable" });
  });
});

describe("webhook DANA setelah reissue: gagal-tertutup, bukan salah cocok", () => {
  async function postWebhook(amount: number) {
    const { POST } = await import("@/app/api/webhook/dana/route");
    return POST(new NextRequest("http://localhost/api/webhook/dana", {
      method: "POST",
      headers: { "content-type": "application/json", "x-webhook-secret": "secret-dana" },
      body: JSON.stringify({
        payment: { amount, currency: "IDR", reference: `ref-${amount}` },
        merchant: "DANA",
      }),
    }) as unknown as import("next/server").NextRequest);
  }

  it("pembayaran pada nominal BARU melunasi order", async () => {
    await seedPendingQrisOrder({ invoiceExpiresAt: new Date(Date.now() - 60_000).toISOString() });
    const { reissueDanaQrisInvoice } = await import("@/lib/payments/dana-qris");
    const result = await reissueDanaQrisInvoice(CODE);
    expect(result.ok).toBe(true);
    const newAmount = Number(txRow().payable_amount);

    const response = await postWebhook(newAmount);
    expect(response.status).toBe(200);
    expect(String(orderRow().status)).toBe("lunas");
  });

  it("pembayaran pada nominal LAMA tidak melunasi apa pun (masuk rekonsiliasi)", async () => {
    await seedPendingQrisOrder({ invoiceExpiresAt: new Date(Date.now() - 60_000).toISOString() });
    const { reissueDanaQrisInvoice } = await import("@/lib/payments/dana-qris");
    await reissueDanaQrisInvoice(CODE);

    const response = await postWebhook(10_042); // nominal sebelum reissue
    expect(response.status).toBe(200);
    // Tetap pending: uang pada nominal usang TIDAK boleh melunasi order.
    expect(String(orderRow().status)).toBe("pending");
    const event = fixture.sql.prepare(
      `SELECT status, last_error FROM dana_webhook_events ORDER BY id DESC LIMIT 1`,
    ).get() as Record<string, unknown>;
    expect(String(event.status)).toBe("ignored");
  });
});
