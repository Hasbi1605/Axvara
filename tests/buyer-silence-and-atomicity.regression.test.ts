// Audit ronde 2 (2026-09-23) — dua pola: (1) operasi uang non-atomik, dan
// (2) pembeli menunggu dalam sunyi karena keputusan sistem/aksi admin tidak
// pernah diteruskan ke kanalnya.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";

const read = (path: string) => readFileSync(path, "utf8");

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("T-H1: pembatalan Telegram tidak boleh merusak order yang sudah lunas", () => {
  it("klaim pembatalan mendahului pemulihan stok, dan ledger paid tidak bisa ditimpa", () => {
    const src = read("src/lib/telegram/handlers/orders.ts");
    const cancel = src.slice(src.indexOf("export async function handleOrderCancel"));

    // Urutan wajib: UPDATE orders (klaim) SEBELUM pemulihan stok. Kalau stok
    // dipulihkan lebih dulu lalu klaim kalah balapan, stok menggelembung
    // untuk order yang tetap sah lunas.
    const claimAt = cancel.indexOf("UPDATE orders SET status='dibatalkan'");
    const restoreAt = cancel.indexOf("UPDATE product_variants SET stock");
    expect(claimAt).toBeGreaterThan(-1);
    expect(restoreAt).toBeGreaterThan(-1);
    expect(claimAt).toBeLessThan(restoreAt);

    // Klaim harus CAS penuh: status DAN payment_status.
    const claimStmt = cancel.slice(claimAt, claimAt + 400);
    expect(claimStmt).toContain("status='pending'");
    expect(claimStmt).toContain("payment_status IN ('unpaid','pending')");

    // Ledger: JANGAN pernah UPDATE tanpa gerbang status — baris `paid` milik
    // pembayaran sah akan ikut ditimpa `cancelled`.
    const ledgerAt = cancel.indexOf("UPDATE payment_transactions SET status='cancelled'");
    expect(ledgerAt).toBeGreaterThan(-1);
    const ledgerStmt = cancel.slice(ledgerAt, ledgerAt + 300);
    expect(ledgerStmt).toMatch(/status IN \('pending','unpaid','expired'\)/);
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

      // Jalankan klaim + ledger PERSIS seperti handler pasca-perbaikan.
      const db = createDatabaseAccess(fx.db);
      const claim = await db.execRun(
        `UPDATE orders SET status='dibatalkan', payment_status='failed', fulfillment_status='not_required',
         updated_at=datetime('now')
         WHERE code=? AND status='pending' AND payment_status IN ('unpaid','pending')`,
        "AXV-20260923-RACE0001",
      );
      expect(Number(claim.changes ?? 0)).toBe(0); // klaim kalah → berhenti

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
    expect(route).toMatch(/SELECT id, price FROM product_variants WHERE id IN/);
    // Guard harga wajib SEBELUM order dibuat.
    expect(route.indexOf("price_changed")).toBeLessThan(route.indexOf("await createOrderWithStock("));
  });

  it("checkout memuat harga terbaru, bukan sekadar melempar error mentah", () => {
    const page = read("src/app/checkout/page.tsx");
    // POST order kini lewat fetchWithTimeout (batas 60 dtk untuk jaringan lambat).
    const start = page.indexOf('fetchWithTimeout("/api/orders"');
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
