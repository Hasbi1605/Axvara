// src/lib/orders/supplier-refresh.ts — Segarkan status supplier (WR/SK) atas
// permintaan, aman dipanggil dari permukaan publik (halaman pembeli) maupun
// cron, TANPA membakar kuota Workers Free / D1.
//
// Masalah (2026-10-13, order Bstation AXV-20261013-E13AB2A8): WR selesai di
// supplier dalam hitungan detik, tetapi Axvara baru tahu setelah admin klik
// "Cek status" — reconcile segar hanya hidup di route besar 1×/jam dan
// penarik lite 5-menitan berambang 2 menit. SK terasa instan karena webhook
// SK menyelesaikan sinkron.
//
// Prinsip (meniru perilaku SK, bukan mengandalkan webhook WR):
// - Satu-satunya sumber kebenaran status = status supplier saat ini.
// - Pemicu murah MEKANISME APA PUN (poll pembeli berikutnya, cron lite)
//   boleh menarik status SEKARANG — tetapi dithrottle per-order di
//   `store_settings` (`supplier_refresh_at:<kode>`) dengan ATOMISITAS paksa:
//   penanda ditulis sebagai gerbang berbasis waktu (CAS lewat
//   `expires_at` di kolom `value`), jadi dua request bersamaan hanya satu
//   yang boleh meneruskan ke vendor. Tanpa kunci basis-data, throttle
//   baca-lalu-tulis akan balapan pada isolat Edge yang berbeda.
// - TIDAK ADA `setTimeout`/`setInterval` di server: "segera" dicapai dengan
//   menjadikan poll pembeli berikutnya (2 dtk) sebagai pemicunya, cron lite
//   5-menitan sebagai penjamin, dan webhook sebagai jalur tercepat bila ada.
// - Semua langkah idempoten + monotonik; tidak pernah membeli ulang.

import type { DatabaseAccess } from "@/lib/db-access";
import { parseExpiry } from "@/lib/expiry";

export const SUPPLIER_REFRESH_THROTTLE_SECONDS = 20;
/** Jendela layak-segar: link lebih tua dari ini diserahkan ke reconcile macet. */
export const SUPPLIER_REFRESH_MAX_AGE_MINUTES = 24 * 60;

const keyFor = (orderCode: string) => `supplier_refresh_at:${orderCode}`;

/**
 * Terima gerbang refresh untuk order ini. Mengembalikan sisa detik cooldown
 * (>0 = jangan hubungi vendor sekarang).
 *
 * Atomisitas: penanda disimpan di `value` sebagai ISO masa depan (cooldown
 * sampai kapan). Klaim = `INSERT ... ON CONFLICT(key) DO UPDATE ... WHERE
 * value < now` — satu-satunya yang mengubah baris yang menang. Bila nilai
 * tersimpan masih di masa depan, gerbang tertutup dan sisa detiknya dibaca
 * ulang untuk dilaporkan.
 */
export async function claimSupplierRefreshGate(
  orderCode: string,
  db: DatabaseAccess,
  throttleSeconds = SUPPLIER_REFRESH_THROTTLE_SECONDS,
): Promise<{ acquired: boolean; retryAfterSeconds: number }> {
  const code = String(orderCode || "").trim();
  if (!code) return { acquired: false, retryAfterSeconds: throttleSeconds };
  const now = Date.now();
  const untilIso = new Date(now + Math.max(1, throttleSeconds) * 1000).toISOString();
  const key = keyFor(code);
  try {
    // Gembok CAS meniru klime klaim fulfillment yang sudah terbukti di repo
    // ini (claimJob/claimItemLease di fulfillment): satu pernyataan atomik
    // yang memperbarui penanda HANYA bila masa cooldown-nya sudah lewat,
    // lalu `changes` menjadi bukti kepemilikan gerbang (lihat send.ts).
    const res = await db.execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
       WHERE store_settings.value < ?`,
      key,
      untilIso,
      new Date(now).toISOString(),
    );
    if (Number(res.changes ?? 0) > 0) return { acquired: true, retryAfterSeconds: 0 };
  } catch {
    // Gerbang gagal ditegakkan (DB bermasalah) = lewatkan penyegaran kali
    // ini; cron tetap menjadi penjamin dan poll berikutnya mencoba lagi.
    return { acquired: false, retryAfterSeconds: throttleSeconds };
  }
  const current = await db
    .queryFirst(`SELECT value FROM store_settings WHERE key=?`, key)
    .catch(() => null);
  const until = parseExpiry(current?.value);
  const retryAfterSeconds = until === null ? throttleSeconds : Math.max(1, Math.ceil((until - now) / 1000));
  return { acquired: false, retryAfterSeconds };
}

async function writeRefreshMark(orderCode: string, atIso: string, db: DatabaseAccess): Promise<void> {
  await db
    .execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      keyFor(orderCode),
      atIso,
    )
    .catch(() => undefined);
}

export type SupplierLinkCandidate = {
  supplier: "wr" | "sk";
  id: number;
  supplierOrderId: string;
  orderCode: string;
};

/** Kandidat link supplier yang masih berjalan (belum terminal). */
export async function listRunningSupplierLinks(
  orderCode: string,
  db: DatabaseAccess,
): Promise<SupplierLinkCandidate[]> {
  const code = String(orderCode || "").trim();
  if (!code) return [];
  const out: SupplierLinkCandidate[] = [];
  const wr = await db
    .queryAll(
      `SELECT id, wr_order_id FROM wr_order_links
       WHERE order_code=? AND status IN ('processing','submitted','ordering') AND COALESCE(wr_order_id,'')!=''`,
      code,
    )
    .catch(() => [] as Record<string, unknown>[]);
  for (const row of wr) {
    out.push({ supplier: "wr", id: Number(row.id), supplierOrderId: String(row.wr_order_id || ""), orderCode: code });
  }
  const sk = await db
    .queryAll(
      `SELECT id, sk_invoice FROM sk_order_links
       WHERE order_code=? AND status IN ('processing','submitted','ordering') AND COALESCE(sk_invoice,'')!=''`,
      code,
    )
    .catch(() => [] as Record<string, unknown>[]);
  for (const row of sk) {
    out.push({ supplier: "sk", id: Number(row.id), supplierOrderId: String(row.sk_invoice || ""), orderCode: code });
  }
  return out;
}

/**
 * Segarkan SATU order dari status vendor saat ini (read-only ke vendor,
 * idempoten ke D1). Mengembalikan true bila ada link yang maju menjadi
 * terminal pada panggilan ini.
 *
 * Dipakai oleh: permukaan pembeli (setelah gerbang), cron lite (berkala),
 * dan admin (sync-now tetap jalurnya sendiri).
 */
export async function refreshSupplierOrderNow(
  orderCode: string,
  db: DatabaseAccess,
): Promise<boolean> {
  const code = String(orderCode || "").trim();
  if (!code) return false;
  const links = await listRunningSupplierLinks(code, db);
  if (!links.length) return false;
  let advanced = false;
  for (const link of links) {
    try {
      if (link.supplier === "wr") {
        const { reconcileFreshWrLinks } = await import("@/lib/warung-rebahan/order");
        const n = await reconcileFreshWrLinks(
          [{ id: link.id, wr_order_id: link.supplierOrderId, order_code: code }],
          db,
        );
        if (n > 0) advanced = true;
      } else {
        const { reconcileSkInvoiceNow } = await import("@/lib/sekalipay/order");
        const done = await reconcileSkInvoiceNow(link.supplierOrderId, db);
        if (done) advanced = true;
      }
    } catch {
      /* vendor tak terjangkau: gerbang/cooldown pemanggil yang menahan */
    }
  }
  // Kredensial WR yang selesai pada tarikan ini harus langsung terkirim
  // (email/panel), bukan menunggu tick pengiriman berikutnya.
  try {
    const { processDueCredentialDeliveries } = await import("@/lib/warung-rebahan/deliver");
    await processDueCredentialDeliveries(db, 2);
  } catch { /* pengiriman menyusul via cron; status sudah benar */ }
  return advanced;
}

/**
 * Segarkan order bila gerbang mengizinkan. Inilah pintu masuk permukaan
 * publik: poll pembeli yang datang tepat setelah status vendor berubah
 * memicu tarikan dalam hitungan detik, sementara spam poll tetap tertahan.
 */
export async function maybeRefreshSupplierOrder(
  orderCode: string,
  db: DatabaseAccess,
  throttleSeconds = SUPPLIER_REFRESH_THROTTLE_SECONDS,
): Promise<{ refreshed: boolean; skipped: boolean }> {
  const gate = await claimSupplierRefreshGate(orderCode, db, throttleSeconds);
  if (!gate.acquired) return { refreshed: false, skipped: true };
  const refreshed = await refreshSupplierOrderNow(orderCode, db);
  return { refreshed, skipped: false };
}

export type SupplierBatchResult = {
  examined: number;
  refreshed: number;
  cooledDown: number;
};

/**
 * Penjamin massal berbiaya tetap untuk cron lite: pilih maks `limit` order
 * lunas terbaru yang linknya masih berjalan (SATU query per supplier),
 * lewati yang gerbangnya masih dingin (penanda dibaca SATU query batch),
 * lalu segarkan sisanya. Vendor dibaca sekali per tarikan supplier.
 */
export async function refreshDueSupplierOrders(
  db: DatabaseAccess,
  options: { limit?: number; throttleSeconds?: number } = {},
): Promise<SupplierBatchResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 4, 8));
  const throttleSeconds = options.throttleSeconds ?? SUPPLIER_REFRESH_THROTTLE_SECONDS;
  const out: SupplierBatchResult = { examined: 0, refreshed: 0, cooledDown: 0 };
  const candidates: { orderCode: string; since: string }[] = [];
  const seen = new Set<string>();
  const wrRows = await db
    .queryAll(
      `SELECT DISTINCT order_code, MIN(COALESCE(request_sent_at, created_at)) AS since FROM wr_order_links
       WHERE status IN ('processing','submitted','ordering') AND COALESCE(wr_order_id,'')!=''
         AND datetime(COALESCE(request_sent_at, updated_at)) > datetime('now','-${SUPPLIER_REFRESH_MAX_AGE_MINUTES} minutes')
       GROUP BY order_code ORDER BY since ASC LIMIT ?`,
      limit,
    )
    .catch(() => [] as Record<string, unknown>[]);
  for (const row of wrRows) {
    const code = String(row.order_code || "");
    if (code && !seen.has(code)) { seen.add(code); candidates.push({ orderCode: code, since: String(row.since || "") }); }
  }
  const skRows = await db
    .queryAll(
      `SELECT DISTINCT order_code, MIN(COALESCE(request_sent_at, created_at)) AS since FROM sk_order_links
       WHERE status IN ('processing','submitted','ordering') AND COALESCE(sk_invoice,'')!=''
         AND datetime(COALESCE(request_sent_at, updated_at)) > datetime('now','-${SUPPLIER_REFRESH_MAX_AGE_MINUTES} minutes')
       GROUP BY order_code ORDER BY since ASC LIMIT ?`,
      limit,
    )
    .catch(() => [] as Record<string, unknown>[]);
  for (const row of skRows) {
    const code = String(row.order_code || "");
    if (code && !seen.has(code)) { seen.add(code); candidates.push({ orderCode: code, since: String(row.since || "") }); }
  }
  if (!candidates.length) return out;
  // Gerbang dibaca sekaligus (bukan per-order) agar biaya tetap.
  const keys = candidates.map((c) => keyFor(c.orderCode));
  const marks = await db
    .queryAll(
      `SELECT key, value FROM store_settings WHERE key IN (${keys.map(() => "?").join(",")})`,
      ...keys,
    )
    .catch(() => [] as Record<string, unknown>[]);
  const markByCode = new Map<string, number | null>();
  for (const row of marks) markByCode.set(String(row.key).slice("supplier_refresh_at:".length), parseExpiry(row.value));
  const now = Date.now();
  for (const candidate of candidates.slice(0, limit)) {
    out.examined++;
    const until = markByCode.get(candidate.orderCode);
    if (until !== undefined && until !== null && until > now) { out.cooledDown++; continue; }
    // Klaim gerbang SEKARANG (bukan setelah vendor): bila invocation ini
    // dibunuh di tengah panggilan vendor, gerbang tetap menahan tick
    // berikutnya daripada mengulang vendor tanpa jeda.
    await writeRefreshMark(
      candidate.orderCode,
      new Date(now + Math.max(1, throttleSeconds) * 1000).toISOString(),
      db,
    );
    if (await refreshSupplierOrderNow(candidate.orderCode, db).catch(() => false)) out.refreshed++;
  }
  return out;
}
