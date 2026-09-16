// src/lib/warung-rebahan/order.ts — Auto-order H2H: Axvara lunas → order ke WR.
//
// EXACTLY-ONCE STATE MACHINE (migrasi 0029):
//   pending ──claim──▶ claimed ──kirim──▶ submitted ──confirm──▶ processing ──▶ completed
//      │                  │                  │                        │
//      │                  │                  │                        └────▶ failed (terminal)
//      │                  │                  │
//      │                  └─lease lewat──▶ pending (diambil alih, BELUM kirim = aman)
//      │
//      └─gagal pre-kirim──▶ retry ──▶ pending (dijadwalkan ulang)
//                                                          ▲
//   submitted ──timeout/crash──▶ TETAP submitted (DILARANG beli ulang buta)
//      │
//      └─reconcile via /transactions atau webhook──▶ processing/completed/failed
//
//   blocked_balance: saldo habis — tidak makan retry transport; pulih
//   otomatis setelah top-up via reconcileBlockedBalance().
//
// Kunci anti-double-purchase:
// 1. idempotency_key stabil `wr:<order_code>:<wr_variant_id>:<qty>` +
//    UNIQUE partial index → dua worker concurrent = satu baris (P0-2).
// 2. request_sent_at: NULL = request BELUM keluar (aman retry); non-NULL =
//    ambigu (hanya reconcile, tidak pernah beli ulang buta) (P0-1).
// 3. lease_owner/lease_expires_at: worker crash → lease kedaluwarsa →
//    worker lain boleh klaim selama request_sent_at NULL (P0-1).
// 4. Upstream WR/proxy TIDAK mendukung idempotency/reference key
//    (diaudit dari source proxy axvara-wa-gateway/src/wr-proxy.ts:
//    body diteruskan {variant_id, quantity, ...api_key} tanpa field
//    idempotency) — jadi fencing dilakukan SEPENUHNYA di sisi Axvara.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import {
  createOrder,
  fetchTransactions,
  isWrAutoOrderEnabled,
  isWrEnabled,
  WrInsufficientBalanceError,
  WrOutOfStockError,
  type WrTransaction,
} from "./client";

export type OrderItemLike = {
  product_id?: number;
  variant_id?: number | null;
  qty?: number;
  price?: number;
  name?: string;
  [key: string]: unknown;
};

export type ProcessResult = {
  processed: number;
  succeeded: number;
  retried: number;
  failed: number;
  blocked: number;
  reconciled: number;
};

export const WR_RETRY_DELAYS_MINUTES = [1, 5, 15];
export const WR_MAX_ATTEMPTS = 3;
// Lease klaim order: pagar worker crash. Lebih pendek dari interval cron
// (5 menit) agar worker mati tidak menahan link terlalu lama, cukup lama
// agar POST WR 30 dtk + tulis hasil tidak tabrakan antar worker sehat.
export const WR_CLAIM_LEASE_SECONDS = 120;
// Ambang stale submitted/ordering: hanya reconcile (bukan beli ulang).
export const WR_SUBMITTED_STALE_MINUTES = 10;

type Row = Record<string, unknown>;

/** Status link yang dianggap terminal — tidak disentuh worker kecuali admin. */
export const WR_TERMINAL_STATUSES = ["completed", "failed"] as const;
/** Status legacy pra-0029 yang diperlakukan sebagai submitted (ambigu). */
export const WR_AMBIGUOUS_STATUSES = ["submitted", "ordering"] as const;
/** Daftar putih status untuk validasi (SQLite tak bisa ALTER CHECK). */
export const WR_LINK_STATUSES = [
  "pending",
  "claimed",
  "submitted",
  "ordering",
  "processing",
  "completed",
  "failed",
  "retry",
  "blocked_balance",
] as const;

export function isWrLinkStatus(status: unknown): status is (typeof WR_LINK_STATUSES)[number] {
  return (WR_LINK_STATUSES as readonly string[]).includes(String(status));
}

function nextAttemptIso(attempt: number): string {
  const minutes =
    WR_RETRY_DELAYS_MINUTES[Math.min(Math.max(attempt - 1, 0), WR_RETRY_DELAYS_MINUTES.length - 1)];
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/**
 * Correlation key stabil per kebutuhan pembelian canonical.
 * Agregasi qty: duplicate cart lines dengan (order, varian) sama digabung
 * menjadi satu kebutuhan dengan qty total (P0-2).
 */
export function wrIdempotencyKey(orderCode: string, wrVariantId: string, qty: number): string {
  return `wr:${orderCode}:${wrVariantId}:${Math.max(1, Math.floor(Number(qty) || 1))}`;
}

/** Ambil wr_variant_id untuk varian Axvara (null bila bukan produk WR). */
export async function resolveWrVariantId(
  axvaraVariantId: number,
  db: DatabaseAccess,
): Promise<{ wrVariantId: string; wrCost: number } | null> {
  const row = await db
    .queryFirst(
      `SELECT pv.wr_variant_id, wv.wr_price
       FROM product_variants pv
       LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
       WHERE pv.id=? AND pv.wr_variant_id IS NOT NULL`,
      axvaraVariantId,
    )
    .catch(() => null);
  if (!row || !row.wr_variant_id) return null;
  return { wrVariantId: String(row.wr_variant_id), wrCost: Number(row.wr_price || 0) };
}

/**
 * Dipanggil setelah payment confirmed (QRIS hook / retry admin / approve bukti /
 * konfirmasi admin). Membuat link pending untuk tiap kebutuhan WR — atomik via
 * INSERT OR IGNORE atas idempotency_key (P0-2): dua pemanggil concurrent
 * menghasilkan SATU baris, bukan SELECT-lalu-INSERT yang balapan.
 *
 * Duplicate cart lines (order.items punya 2 baris varian sama) diagregasi
 * qty-nya menjadi satu kebutuhan canonical.
 */
export async function createWrOrderLink(
  orderCode: string,
  items: OrderItemLike[],
  database?: DatabaseAccess,
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled()) return 0;
  // Agregasi qty per wr_variant_id (P0-2): cart boleh punya 2 baris varian
  // sama; kebutuhan pembelian canonical tetap satu.
  const need = new Map<string, { qty: number; wrCost: number }>();
  for (const item of items) {
    const variantId = Number(item.variant_id || 0);
    if (!variantId) continue;
    const resolved = await resolveWrVariantId(variantId, db);
    if (!resolved) continue;
    const qty = Math.max(1, Math.floor(Number(item.qty || 1)));
    const prev = need.get(resolved.wrVariantId);
    if (prev) {
      prev.qty += qty;
    } else {
      need.set(resolved.wrVariantId, { qty, wrCost: resolved.wrCost });
    }
  }
  let created = 0;
  for (const [wrVariantId, { qty, wrCost }] of need) {
    const key = wrIdempotencyKey(orderCode, wrVariantId, qty);
    try {
      const res = await db.execRun(
        `INSERT OR IGNORE INTO wr_order_links
          (order_code, wr_variant_id, quantity, wr_cost, status, attempt_count,
           max_attempts, next_attempt_at, idempotency_key)
         VALUES (?,?,?,?, 'pending', 0, ?, datetime('now'), ?)`,
        orderCode,
        wrVariantId,
        qty,
        wrCost * qty,
        WR_MAX_ATTEMPTS,
        key,
      );
      if (Number(res.changes ?? 0) > 0) created++;
    } catch {
      // DB pre-0029 (tanpa kolom idempotency_key): fallback ke perilaku lama
      // sekali — SELECT lalu INSERT — agar tidak meruntuhkan payment hook.
      // Setelah migrasi 0029 jalan, cabang ini tidak pernah tersentuh.
      const existing = await db
        .queryFirst(
          `SELECT id FROM wr_order_links WHERE order_code=? AND wr_variant_id=?`,
          orderCode,
          wrVariantId,
        )
        .catch(() => null);
      if (existing) continue;
      try {
        await db.execRun(
          `INSERT INTO wr_order_links
            (order_code, wr_variant_id, quantity, wr_cost, status, attempt_count,
             max_attempts, next_attempt_at)
           VALUES (?,?,?,?, 'pending', 0, ?, datetime('now'))`,
          orderCode,
          wrVariantId,
          qty,
          wrCost * qty,
          WR_MAX_ATTEMPTS,
        );
        created++;
      } catch {
        /* concurrent loser: baris sudah ada */
      }
    }
  }
  return created;
}

/** Cek cepat apakah order mengandung item WR (untuk hook payment). */
export function hasWrItems(items: OrderItemLike[]): boolean {
  return items.some((item) => Number(item.variant_id || 0) > 0 && (item as { source?: string }).source === "warung_rebahan");
}

/**
 * Deteksi item WR dari DB (lebih akurat dari snapshot: cek wr_variant_id).
 * Dipakai hook payment yang hanya punya orderCode.
 */
export async function createWrOrderLinksForOrder(
  orderCode: string,
  database?: DatabaseAccess,
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled()) return 0;
  const order = await db
    .queryFirst(`SELECT items FROM orders WHERE code=?`, orderCode)
    .catch(() => null);
  if (!order) return 0;
  let items: OrderItemLike[] = [];
  try {
    const parsed = JSON.parse(String(order.items || "[]"));
    if (Array.isArray(parsed)) items = parsed;
  } catch {
    return 0;
  }
  // Perkaya: tandai item yang variannya punya wr_variant_id.
  const enriched: OrderItemLike[] = [];
  for (const item of items) {
    const variantId = Number(item.variant_id || 0);
    if (!variantId) continue;
    const resolved = await resolveWrVariantId(variantId, db);
    if (resolved) enriched.push(item);
  }
  return createWrOrderLink(orderCode, enriched, db);
}

/**
 * Reconciler P0-3: temukan order lunas/paid dengan varian WR tetapi BELUM
 * memiliki kebutuhan WR lengkap, lalu materialisasi link yang hilang.
 * Dipanggil cron tiap fase warung_rebahan — menutup jendela crash antara
 * "payment durable" dan "link dibuat", untuk SEMUA jalur pembayaran
 * (DANA webhook, konfirmasi admin, reconciliation, approve bukti) karena
 * semuanya bermuara di status lunas/paid yang sama.
 *
 * Batasan budget: maks `limit` order per run, 2 query per order.
 */
export async function reconcileMissingWrLinks(
  database?: DatabaseAccess,
  limit = 4,
): Promise<{ orders: number; links: number }> {
  const db = database ?? createDatabaseAccess();
  const out = { orders: 0, links: 0 };
  if (!isWrEnabled()) return out;
  // Order lunas yang punya varian WR di items tetapi link-nya belum lengkap.
  // Deteksi murah: order lunas + ada product_variants.wr_variant_id yang
  // cocok dengan variant_id di items, MINUS yang sudah punya link.
  // SQLite tidak bisa JOIN atas JSON secara murah — jadi ambil kandidat
  // lunas terbaru, periksa di JS (bounded), buat link yang hilang.
  const candidates = await db
    .queryAll(
      `SELECT code, items FROM orders
       WHERE status='lunas' AND payment_status='paid'
         AND datetime(COALESCE(paid_at, created_at)) > datetime('now','-7 days')
       ORDER BY id DESC LIMIT ?`,
      Math.max(1, Math.min(limit * 3, 24)),
    )
    .catch(() => [] as Row[]);
  for (const candidate of candidates) {
    if (out.orders >= limit) break;
    if (!db.canSpend(4)) break;
    const code = String(candidate.code || "");
    if (!code) continue;
    let items: OrderItemLike[] = [];
    try {
      const parsed = JSON.parse(String(candidate.items || "[]"));
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      continue;
    }
    const wrVariantIds = new Set<string>();
    for (const item of items) {
      const variantId = Number(item.variant_id || 0);
      if (!variantId) continue;
      const resolved = await resolveWrVariantId(variantId, db).catch(() => null);
      if (resolved) wrVariantIds.add(resolved.wrVariantId);
    }
    if (!wrVariantIds.size) continue;
    const existing = await db
      .queryAll(`SELECT wr_variant_id FROM wr_order_links WHERE order_code=?`, code)
      .catch(() => [] as Row[]);
    const have = new Set(existing.map((r) => String(r.wr_variant_id || "")));
    const missing = [...wrVariantIds].filter((v) => !have.has(v));
    if (!missing.length) continue;
    out.orders++;
    const made = await createWrOrderLink(code, items, db).catch(() => 0);
    out.links += made;
  }
  return out;
}

export async function processWrPendingOrders(
  database?: DatabaseAccess,
): Promise<ProcessResult> {
  const db = database ?? createDatabaseAccess();
  const result: ProcessResult = { processed: 0, succeeded: 0, retried: 0, failed: 0, blocked: 0, reconciled: 0 };
  if (!isWrEnabled() || !isWrAutoOrderEnabled()) return result;
  // P0-3: tutup jendela crash payment-tanpa-link SEBELUM memproses antrean.
  try {
    const missing = await reconcileMissingWrLinks(db);
    result.reconciled = missing.links;
  } catch {
    /* reconciler best-effort; antrean tetap diproses */
  }
  const due = await db
    .queryAll(
      `SELECT l.* FROM wr_order_links l
       LEFT JOIN wr_variants wv ON wv.wr_variant_id = l.wr_variant_id
       WHERE l.status IN ('pending','retry')
         AND l.attempt_count < l.max_attempts
         AND (l.next_attempt_at IS NULL OR datetime(l.next_attempt_at) <= datetime('now'))
         -- 2026-09-16: gate per kelas — HANYA restock yang auto-order.
         -- made_by_order (slow, antrean manusia WR) + NULL (belum dikunci)
         -- tetap antre manual: link dibiarkan pending, bukan failed.
         AND COALESCE(wv.wr_delivery_class, 'made_by_order') = 'restock'
       ORDER BY l.next_attempt_at ASC, l.id ASC LIMIT 4`,
    )
    .catch(() => [] as Row[]);
  for (const link of due) {
    if (!db.canSpend(6)) break;
    result.processed++;
    const outcome = await processOneLink(link, db);
    if (outcome === "succeeded") result.succeeded++;
    else if (outcome === "retried") result.retried++;
    else if (outcome === "blocked") result.blocked++;
    else result.failed++;
  }
  return result;
}

/**
 * Klaim lease dengan fencing (P0-1):
 * - pending/retry yang belum diklaim → claimed + lease baru.
 * - claimed yang lease-nya kedaluwarsa DAN request BELUM dikirim
 *   (request_sent_at NULL) → diambil alih (worker lama dianggap crash).
 * - claimed/submitted/ordering yang request SUDAH dikirim → JANGAN PERNAH
 *   diklaim untuk beli ulang; kembalikan "ambiguous".
 */
async function claimLink(
  link: Row,
  db: DatabaseAccess,
): Promise<{ outcome: "claimed" } | { outcome: "ambiguous" } | { outcome: "lost" }> {
  const id = Number(link.id);
  const attempt = Number(link.attempt_count || 0) + 1;
  const leaseOwner = `cron-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const leaseUntil = new Date(Date.now() + WR_CLAIM_LEASE_SECONDS * 1000).toISOString();
  // Jalur 1: klaim fresh (belum ada yang pegang).
  const fresh = await db
    .execRun(
      `UPDATE wr_order_links SET status='claimed', attempt_count=?,
         lease_owner=?, lease_expires_at=?, last_claim_at=datetime('now'),
         updated_at=datetime('now')
       WHERE id=? AND status IN ('pending','retry')`,
      attempt,
      leaseOwner,
      leaseUntil,
      id,
    )
    .catch(() => ({ changes: 0 as number | undefined }));
  if (Number(fresh.changes ?? 0) > 0) return { outcome: "claimed" };
  // Jalur 2: ambil alih lease basi — HANYA bila request belum keluar.
  const stale = await db
    .execRun(
      `UPDATE wr_order_links SET status='claimed', attempt_count=?,
         lease_owner=?, lease_expires_at=?, last_claim_at=datetime('now'),
         updated_at=datetime('now')
       WHERE id=? AND status='claimed' AND request_sent_at IS NULL
         AND (lease_expires_at IS NULL OR datetime(lease_expires_at) <= datetime('now'))`,
      attempt,
      leaseOwner,
      leaseUntil,
      id,
    )
    .catch(() => ({ changes: 0 as number | undefined }));
  if (Number(stale.changes ?? 0) > 0) return { outcome: "claimed" };
  // Selain itu: ambigu (sudah terkirim / diklaim worker sehat) atau kalah race.
  const current = await db
    .queryFirst(`SELECT status, request_sent_at FROM wr_order_links WHERE id=?`, id)
    .catch(() => null);
  if (current && String(current.request_sent_at || "") !== "") return { outcome: "ambiguous" };
  if (current && (WR_AMBIGUOUS_STATUSES as readonly string[]).includes(String(current.status))) {
    return { outcome: "ambiguous" };
  }
  return { outcome: "lost" };
}

async function processOneLink(link: Row, db: DatabaseAccess): Promise<"succeeded" | "retried" | "failed" | "blocked"> {
  const { execRun } = db;
  const id = Number(link.id);
  const attempt = Number(link.attempt_count || 0) + 1;
  const claim = await claimLink(link, db);
  if (claim.outcome === "lost") return "retried";
  if (claim.outcome === "ambiguous") {
    // TIDAK beli ulang buta: serahkan ke reconciler via /transactions.
    await reconcileAmbiguousLink(id, db).catch(() => undefined);
    return "retried";
  }
  // Tandai request_sent_at SEBELUM POST (P0-1): crash setelah titik ini =
  // ambigu, bukan "belum kirim". Bila POST kemudian gagal pre-kirim
  // (network/timeout tanpa respons), flag ini DIHAPUS kembali agar retry
  // berikutnya boleh kirim (aman: vendor belum menerima apa pun).
  await execRun(
    `UPDATE wr_order_links SET request_sent_at=datetime('now'), updated_at=datetime('now')
     WHERE id=? AND status='claimed'`,
    id,
  ).catch(() => undefined);
  try {
    const order = await createOrder({
      variant_id: String(link.wr_variant_id),
      quantity: Math.max(1, Number(link.quantity || 1)),
    });
    await execRun(
      `UPDATE wr_order_links SET status='processing', wr_order_id=?,
        last_error=NULL, lease_owner=NULL, lease_expires_at=NULL,
        updated_at=datetime('now') WHERE id=?`,
      String(order.order_id),
      id,
    );
    await db
      .execRun(
        `INSERT INTO wr_saldo_log (balance, source, note) VALUES (?,'order_deduct',?)`,
        Math.floor(Number(order.current_balance ?? 0)),
        `order ${String(link.order_code)} → ${String(order.order_id)}`,
      )
      .catch(() => undefined);
    return "succeeded";
  } catch (error) {
    return handleOrderError(id, link, error, attempt, db);
  }
}

/**
 * Reconcile satu link ambigu via /transactions (P0-1): cocokkan berdasarkan
 * (wr_variant_id, quantity, created_at ± jendela) karena upstream tidak
 * memberi reference key. Bila cocok → processing/completed/failed sesuai
 * status provider. Bila tidak cocok setelah jendela → biarkan submitted
 * untuk reconcile berikutnya (JANGAN beli ulang).
 */
async function reconcileAmbiguousLink(id: number, db: DatabaseAccess): Promise<boolean> {
  const link = await db
    .queryFirst(`SELECT * FROM wr_order_links WHERE id=?`, id)
    .catch(() => null);
  if (!link) return false;
  const claimedAt = String(link.request_sent_at || link.last_claim_at || link.updated_at || "");
  let transactions: WrTransaction[];
  try {
    transactions = await fetchTransactions();
  } catch {
    return false;
  }
  const windowStart = Date.parse(claimedAt) || 0;
  const { handleWrOrderCompleted, handleWrOrderFailed } = await import("./deliver");
  for (const tx of transactions) {
    const txTime = Date.parse(String(tx.created_at || ""));
    if (!txTime || Math.abs(txTime - windowStart) > 30 * 60_000) continue;
    const products = Array.isArray(tx.products) ? tx.products : [];
    const match = products.some((p) => {
      const o = p as Record<string, unknown>;
      const vid = String(o.variant_id ?? o.id ?? "");
      return vid === String(link.wr_variant_id);
    });
    if (!match && products.length) continue;
    // Kandidat cocok: catat wr_order_id lalu ikut status provider.
    await db
      .execRun(
        `UPDATE wr_order_links SET wr_order_id=?, status='processing',
           last_error=NULL, updated_at=datetime('now') WHERE id=?`,
        String(tx.order_id),
        id,
      )
      .catch(() => undefined);
    const status = String(tx.status || "").toLowerCase();
    if (status.includes("complet") || status.includes("success") || status.includes("done")) {
      await handleWrOrderCompleted(String(tx.order_id), tx.account_details ?? tx, db);
    } else if (status.includes("fail") || status.includes("cancel") || status.includes("refund")) {
      await handleWrOrderFailed(String(tx.order_id), status, db);
    }
    return true;
  }
  return false;
}

async function handleOrderError(
  id: number,
  link: Row,
  error: unknown,
  attempt: number,
  db: DatabaseAccess,
): Promise<"retried" | "failed" | "blocked"> {
  const { execRun } = db;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const isTimeout = /timeout|abort|network|fetch failed|504/i.test(message);
  if (isTimeout) {
    // Timeout = vendor MUNGKIN sudah menerima. Tandai submitted (ambigu),
    // HAPUS lease agar reconciler bisa verifikasi — tetapi JANGAN beli ulang.
    await execRun(
      `UPDATE wr_order_links SET status='submitted',
         last_error=?, lease_owner=NULL, lease_expires_at=NULL,
         next_attempt_at=datetime('now','+${WR_SUBMITTED_STALE_MINUTES} minutes'),
         updated_at=datetime('now') WHERE id=?`,
      `ambiguous_timeout: ${message}`,
      id,
    );
    return "retried";
  }
  if (error instanceof WrInsufficientBalanceError) {
    return handleInsufficientBalance(id, link, message, db);
  }
  if (error instanceof WrOutOfStockError) {
    // Gagal pre-kirim yang pasti (vendor menolak sebelum membuat order):
    // aman untuk retry — hapus request_sent_at kembali.
    await execRun(
      `UPDATE product_variants SET stock=0, updated_at=datetime('now')
       WHERE wr_variant_id=?`,
      String(link.wr_variant_id),
    ).catch(() => undefined);
    await execRun(
      `UPDATE wr_variants SET wr_stock=0, updated_at=? WHERE wr_variant_id=?`,
      new Date().toISOString(),
      String(link.wr_variant_id),
    ).catch(() => undefined);
  }
  if (attempt >= Number(link.max_attempts || WR_MAX_ATTEMPTS)) {
    await execRun(
      `UPDATE wr_order_links SET status='failed', last_error=?, request_sent_at=NULL,
         lease_owner=NULL, lease_expires_at=NULL, updated_at=datetime('now') WHERE id=?`,
      message,
      id,
    );
    await notifyAdmin(
      `⚠️ <b>Order WR gagal</b> <code>${String(link.order_code)}</code>\n${escapeHtml(message)}`,
    );
    // Tandai order Axvara agar admin tahu perlu penanganan manual.
    await execRun(
      `UPDATE orders SET fulfillment_status='failed', updated_at=datetime('now')
       WHERE code=? AND status='lunas'`,
      String(link.order_code),
    ).catch(() => undefined);
    return "failed";
  }
  await execRun(
    `UPDATE wr_order_links SET status='retry', last_error=?, request_sent_at=NULL,
       lease_owner=NULL, lease_expires_at=NULL,
       next_attempt_at=?, updated_at=datetime('now') WHERE id=?`,
    message,
    nextAttemptIso(attempt),
    id,
  );
  return "retried";
}

/**
 * Saldo habis → blocked_balance (P1-8): tidak menghabiskan retry transport
 * biasa, tetap observable, pulih otomatis setelah top-up tanpa reset manual.
 * attempt_count TIDAK dinaikkan di sini (klaim sudah menaikkannya sekali —
 * kami kembalikan agar slot retry tidak terbuang untuk masalah non-transport).
 */
async function handleInsufficientBalance(
  id: number,
  link: Row,
  message: string,
  db: DatabaseAccess,
): Promise<"blocked"> {
  const { execRun } = db;
  await execRun(
    `UPDATE wr_order_links SET status='blocked_balance',
       last_error=?, request_sent_at=NULL, lease_owner=NULL, lease_expires_at=NULL,
       attempt_count=attempt_count-1,
       next_attempt_at=datetime('now','+60 minutes'), updated_at=datetime('now')
     WHERE id=?`,
    `saldo_wr_habis: ${message}`,
    id,
  );
  await notifyAdmin(
    `💰 <b>Saldo Warung Rebahan habis</b>\nOrder <code>${String(link.order_code)}</code> diblokir sementara (tidak makan retry). Top up untuk memulihkan otomatis.`,
  );
  return "blocked";
}

/**
 * Pulihkan link blocked_balance setelah top-up: cek saldo aktual, bila cukup
 * untuk biaya link termurah → kembalikan ke pending. Dipanggil cron sebelum
 * memproses antrean. Tanpa reset manual berbahaya (CAS pada status).
 */
export async function reconcileBlockedBalance(
  database?: DatabaseAccess,
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled()) return 0;
  const blocked = await db
    .queryAll(
      `SELECT id, wr_cost FROM wr_order_links WHERE status='blocked_balance'
       ORDER BY id ASC LIMIT 8`,
    )
    .catch(() => [] as Row[]);
  if (!blocked.length) return 0;
  const { fetchBalance } = await import("./client");
  let balance = 0;
  try {
    balance = Math.floor(Number((await fetchBalance()).balance) || 0);
  } catch {
    return 0;
  }
  let revived = 0;
  for (const row of blocked) {
    if (balance < Number(row.wr_cost || 0)) continue;
    const res = await db
      .execRun(
        `UPDATE wr_order_links SET status='pending', last_error=NULL,
           next_attempt_at=datetime('now'), updated_at=datetime('now')
         WHERE id=? AND status='blocked_balance'`,
        Number(row.id),
      )
      .catch(() => ({ changes: 0 as number | undefined }));
    if (Number(res.changes ?? 0) > 0) revived++;
  }
  return revived;
}

export async function retryFailedWrOrders(database?: DatabaseAccess): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled() || !isWrAutoOrderEnabled()) return 0;
  // Samakan yang jatuh tempo agar ikut diproses di run berikutnya.
  const res = await db
    .execRun(
      `UPDATE wr_order_links SET next_attempt_at=datetime('now'), updated_at=datetime('now')
       WHERE status='retry' AND attempt_count < max_attempts
         AND datetime(next_attempt_at) <= datetime('now')`,
    )
    .catch(() => ({ changes: 0 as number | undefined }));
  return Number(res.changes ?? 0);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 300);
}

async function notifyAdmin(html: string): Promise<void> {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId || process.env.TELEGRAM_BOT_ENABLED !== "true") return;
  try {
    const { sendMessage } = await import("@/lib/telegram/api");
    await sendMessage({ chat_id: adminChatId, text: html, parse_mode: "HTML" });
  } catch {
    /* best-effort */
  }
}

/** Webhook order.processing: tandai link processing (monotonik, lihat deliver.ts). */
export async function handleWrOrderProcessing(
  wrOrderId: string,
  database?: DatabaseAccess,
  eventId?: string,
): Promise<boolean> {
  const { advanceWrLinkMonotonic } = await import("./deliver");
  return advanceWrLinkMonotonic(wrOrderId, "processing", null, database, eventId);
}

/** Sinkronisasi status order processing/ambigu yang menggantung via /transactions. */
export async function reconcileStuckWrOrders(database?: DatabaseAccess): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled()) return 0;
  const stuck = await db
    .queryAll(
      `SELECT wr_order_id, order_code, id FROM wr_order_links
       WHERE status IN ('processing','submitted','ordering')
         AND datetime(COALESCE(request_sent_at, updated_at)) <= datetime('now','-1 hour')
       LIMIT 8`,
    )
    .catch(() => [] as Row[]);
  if (!stuck.length) return 0;
  let transactions: WrTransaction[];
  try {
    transactions = await fetchTransactions();
  } catch {
    return 0;
  }
  const byId = new Map(transactions.map((t) => [String(t.order_id), t]));
  let reconciled = 0;
  // Diimpor lazy dari deliver.ts (hindari siklus: deliver tidak impor order).
  const { handleWrOrderCompleted, handleWrOrderFailed } = await import("./deliver");
  for (const row of stuck) {
    const tx = byId.get(String(row.wr_order_id || ""));
    if (!tx) continue;
    const status = String(tx.status || "").toLowerCase();
    if (status.includes("complet") || status.includes("success") || status.includes("done")) {
      await handleWrOrderCompleted(String(row.wr_order_id), tx.account_details ?? tx, db);
      reconciled++;
    } else if (status.includes("fail") || status.includes("cancel") || status.includes("refund")) {
      await handleWrOrderFailed(String(row.wr_order_id), status, db);
      reconciled++;
    }
  }
  return reconciled;
}

/**
 * Recover link stale: claimed yang lease-nya kedaluwarsa dan request belum
 * keluar → kembalikan ke pending (fenced, hanya bila lease masih milik
 * yang basi). Submitted/ordering stale → serahkan ke reconcile transaksi.
 */
export async function recoverStaleClaims(database?: DatabaseAccess): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled()) return 0;
  const res = await db
    .execRun(
      `UPDATE wr_order_links SET status='pending', lease_owner=NULL,
         lease_expires_at=NULL, last_error='stale_claim_recovered',
         updated_at=datetime('now')
       WHERE status='claimed' AND request_sent_at IS NULL
         AND lease_expires_at IS NOT NULL
         AND datetime(lease_expires_at) <= datetime('now')`,
    )
    .catch(() => ({ changes: 0 as number | undefined }));
  return Number(res.changes ?? 0);
}

// handleWrOrderCompleted / handleWrOrderFailed ada di deliver.ts (butuh crypto +
// channel delivery). Re-export di sini agar cron/webhook cukup impor satu modul
// order; implementasi diimpor lazy untuk hindari siklus.
export type { WrOrderLinkRow } from "./deliver";
export {
  handleWrOrderCompleted,
  handleWrOrderFailed,
} from "./deliver";
