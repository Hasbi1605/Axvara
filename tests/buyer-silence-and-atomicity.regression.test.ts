// Audit ronde 2 (2026-09-23) — dua pola: (1) operasi uang non-atomik, dan
// (2) pembeli menunggu dalam sunyi karena keputusan sistem/aksi admin tidak
// pernah diteruskan ke kanalnya.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";

const read = (path: string) => readFileSync(path, "utf8");

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("T-H1: pembatalan Telegram tidak boleh merusak order yang sudah lunas", () => {
  it("guard pembatalan dan ledger berada dalam batch transisi stok yang sama", () => {
    const src = read("src/lib/telegram/handlers/orders.ts");
    const cancel = src.slice(src.indexOf("export async function handleOrderCancel"));
    const transition = read("src/lib/db/orders-transition.ts");
    const terminal = transition.slice(transition.indexOf('if (status === "dibatalkan"'), transition.indexOf("// Manual admin confirmation"));

    expect(cancel).toContain('await transitionPendingOrder(orderCode, "dibatalkan", "buyer_cancel", items, {');
    expect(cancel).toContain("batch: statements => d1.batch([");
    const ownerGuardAt = cancel.indexOf("INSERT INTO operation_guards");
    const statementsAt = cancel.indexOf("...statements");
    expect(ownerGuardAt).toBeGreaterThan(-1);
    expect(statementsAt).toBeGreaterThan(ownerGuardAt);
    const ownerGuard = cancel.slice(ownerGuardAt, statementsAt);
    expect(ownerGuard).toContain("sales_channel='telegram' AND telegram_user_id=?");
    expect(ownerGuard).toContain("status='pending' AND payment_status IN ('unpaid','pending')");
    expect(ownerGuard).toContain("AND NOT EXISTS(SELECT 1 FROM payment_transactions");
    expect(ownerGuard).toContain("status NOT IN ('initializing','pending','unpaid','expired','failed','cancelled')");
    expect(ownerGuard).toContain("String(from.id)");

    // The shared CHECK guard precedes stock release; one D1 batch rolls back both.
    const claimAt = terminal.indexOf("INSERT INTO operation_guards");
    const restoreAt = terminal.indexOf("UPDATE product_variants SET stock");
    expect(claimAt).toBeGreaterThan(-1);
    expect(restoreAt).toBeGreaterThan(-1);
    expect(claimAt).toBeLessThan(restoreAt);
    expect(terminal.slice(claimAt, restoreAt)).toContain("status='pending' AND payment_status IN ('unpaid','pending','expired','failed')");
    expect(terminal).toContain("await d1.batch(statements)");
    expect(terminal).not.toContain("await execRun");

    const ledgerAt = cancel.indexOf("UPDATE payment_transactions SET status='cancelled'");
    expect(ledgerAt).toBeGreaterThan(statementsAt);
    const ledgerStmt = cancel.slice(ledgerAt, ledgerAt + 300);
    expect(ledgerStmt).toMatch(/status IN \('initializing','pending','unpaid','expired'\)/);
    expect(ledgerStmt).not.toMatch(/WHERE order_code=\?\s*`/);
  });

  it("kalah balapan dengan webhook: order lunas tetap utuh dan stok tidak dipulihkan", async () => {
    const fx = createD1Fixture();
    try {
      await insertTestProduct(fx.sql, "manual", 1);
      insertTestOrder(fx.sql, "AXV-20260923-RACE0001", { status: "lunas", channel: "telegram" });
      fx.sql.prepare("UPDATE orders SET payment_status='paid', telegram_user_id='777', telegram_chat_id='777' WHERE code=?")
        .run("AXV-20260923-RACE0001");
      fx.sql.prepare(`INSERT INTO payment_transactions (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status)
        VALUES (?,'dana','dynamic','po-race','m',10000,10000,'paid')`).run("AXV-20260923-RACE0001");
      const stockBefore = (fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get() as { stock: number }).stock;

      const api = await import("@/lib/telegram/api");
      vi.spyOn(api, "sendMessage").mockResolvedValue({ ok: true });
      vi.spyOn(api, "safeEditOrSend").mockResolvedValue({ ok: true });
      const { handleOrderCancel } = await import("@/lib/telegram/handlers/orders");
      await handleOrderCancel(777, 1, "AXV-20260923-RACE0001", { id: 777 });
      expect(api.safeEditOrSend).not.toHaveBeenCalled();
      expect(api.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("tidak dapat dibatalkan") }));

      const order = fx.sql.prepare("SELECT status, payment_status FROM orders WHERE code=?").get("AXV-20260923-RACE0001") as { status: string; payment_status: string };
      const ledger = fx.sql.prepare("SELECT status FROM payment_transactions WHERE order_code=?").get("AXV-20260923-RACE0001") as { status: string };
      const stockAfter = (fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get() as { stock: number }).stock;

      expect(order.status).toBe("lunas");
      expect(order.payment_status).toBe("paid");
      expect(ledger.status).toBe("paid"); // ledger TIDAK tertimpa cancelled
      expect(stockAfter).toBe(stockBefore); // stok TIDAK menggelembung
    } finally {
      fx.close();
    }
  });
});

describe("C-H1: harga divalidasi ulang antara quote dan pembuatan order", () => {
  it("order menolak 409 price_changed bila harga DB bergeser dari quote", () => {
    const route = read("src/app/api/orders/route.ts");
    // Token quote berlaku 1 jam (auth.ts), sementara sync WR menulis harga
    // tiap ~5 menit — snapshot subtotal bisa usang saat pembeli menekan bayar.
    expect(route).toContain("price_changed");
    // Bulk foundation: guard atomik kini mengikat base + konfigurasi tier
    // aktif (bukan harga mentah saja). Regex menuntut SELECT id + price
    // dengan klausa bulk agar klaim usang tidak lolos sebagai buku baru.
    // 2026-11-08: query ikut JOIN products (kolom p_*) karena grosir hanya
    // berlaku untuk produk manual.
    expect(route).toMatch(/SELECT pv\.id, pv\.price, pv\.bulk_pricing_enabled, pv\.bulk_pricing_tiers/);
    expect(route).toContain("JOIN products p ON p.id = pv.product_id");
    expect(route).toContain("resolveBulkPriceForProduct");
    // Guard harga wajib SEBELUM order dibuat.
    expect(route.indexOf("price_changed")).toBeLessThan(route.indexOf("await createOrderWithStock("));
  });

  it("checkout memuat harga terbaru, bukan sekadar melempar error mentah", () => {
    const page = read("src/app/(shop)/checkout/page.tsx");
    // POST order kini lewat fetchWithTimeout (batas 60 dtk untuk jaringan lambat).
    const start = page.indexOf('fetchWithTimeout(adminTest ? "/api/admin/payments/test/orders" : "/api/orders"');
    expect(start).toBeGreaterThan(-1);
    const handler = page.slice(start);
    expect(handler).toContain("price_changed");
    expect(handler).toContain("fetchQuote(quoteRequestItems)");
  });
});

describe("T-H2 / C-H3 / C-H4: pembeli dikabari lintas kanal", () => {
  it("modul notifikasi pembeli memilih kanal dari order, dan tidak pernah ke grup", () => {
    const src = read("src/lib/notify-buyer.ts");
    expect(src).toContain("sales_channel");
    // Telegram: hanya chat pribadi terverifikasi.
    expect(src).toContain("telegram_users");
    expect(src).not.toContain("telegram_chat_id }");
    // Web & WA memakai outbox durable (idempoten lewat key).
    expect(src).toContain("waOutboxKey");
    for (const fn of ["notifyBuyerHandover", "notifyBuyerProofRejected", "notifyBuyerProofPendingHook"]) {
      expect(src).toContain(`export async function ${fn}`);
    }
  });

  it("serah terima manual memanggil kabar pembeli saat seluruh item tuntas", () => {
    const route = read("src/app/api/admin/orders/[code]/handover/route.ts");
    expect(route).toContain("notifyBuyerHandover");
    // Hanya saat `complete`, agar order multi-item tidak mengabari prematur.
    expect(route).toMatch(/result\.complete[\s\S]{0,200}notifyBuyerHandover/);
  });

  it("penolakan bukti DAN persetujuan QRIS-menunggu-Hook mengabari pembeli", () => {
    const route = read("src/app/api/admin/proofs/[id]/route.ts");
    expect(route).toContain("notifyBuyerProofRejected");
    expect(route).toContain("notifyBuyerProofPendingHook");
    // Kabar "menunggu Hook" harus menempel pada cabang payment_updated:false.
    expect(route).toMatch(/notifyBuyerProofPendingHook[\s\S]{0,300}payment_updated: false/);
  });
});

describe("T-H3 / T-M4: guard order ganda konsisten dan tidak salah cocok", () => {
  it("semua jalur Telegram menegakkan satu pending per chat", () => {
    // Jalur keranjang sudah per-chat; beli-langsung & katalog dulu hanya
    // mencocokkan varian sehingga satu chat bisa pegang 2 QRIS aktif.
    for (const path of [
      "src/lib/telegram/handlers/invoice.ts",
      "src/lib/telegram/handlers/catalog.ts",
    ]) {
      const src = read(path);
      const guard = src.slice(src.indexOf("SELECT code FROM orders WHERE telegram_chat_id=?"));
      expect(guard.slice(0, 400), path).not.toMatch(/AND variant_id=\?/);
      // Varian sama tetap diprioritaskan agar kirim-ulang invoice tak berubah.
      expect(guard.slice(0, 400), path).toContain("CASE WHEN variant_id=?");
    }
  });

  it("pencocokan produk pending berpembatas — product_id 1 tidak cocok dengan 10", () => {
    const src = read("src/lib/telegram/handlers/discovery.ts");
    expect(src).toMatch(/"product_id":\$\{productId\},%/);
    // Bukti bug lama: JSON tersimpan tanpa spasi.
    const items = '[{"product_id":10,"variant_id":3,"qty":1}]';
    expect(items.includes('"product_id":1')).toBe(true);      // pola lama cocok (salah)
    expect(items.includes('"product_id":1,')).toBe(false);     // pola baru tidak
  });
});
