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

import { createDatabaseAccess, QueryBudgetExceeded, type DatabaseAccess } from "@/lib/db-access";
import {
  claimFreshPurchase,
  claimStalePurchase,
  fencePurchaseSend,
  isPaidForSupplierPurchase,
  nextPurchaseAttemptIso,
  PURCHASE_PAID_SQL,
  PURCHASE_PAID_SQL_ALIASED,
} from "@/lib/suppliers/purchase-state";
import {
  createOrder,
  fetchTransactions,
  isWrAutoOrderEnabled,
  isWrAutoOrderQueuedEnabled,
  isWrEnabled,
  WrInsufficientBalanceError,
  WrOutOfStockError,
  WrApiError,
  WrNetworkError,
  type WrTransaction,
} from "./client";
import { decodeJaspayVariantId, isJaspayVariantId } from "./jaspay";
import { WR_QUEUED_ALERT_HOURS, WR_QUEUED_MAX_HOURS } from "./delivery-class";

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
// Umur maksimum link blocked_balance yang boleh auto-revive (jam).
// Link yang diblokir lebih lama dari ini dianggap basi (niat beli pembeli
// sudah kedaluwarsa) dan TIDAK dibangunkan otomatis oleh
// reconcileBlockedBalance — hanya admin yang boleh retry/void manual.
// Kasus nyata: order lama hidup lagi saat top-up WR dan saldo terpotong
// tanpa sengaja (zombie order, 2026-09-28).
export const WR_BLOCKED_MAX_AGE_HOURS = 24;

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
  const createdLinkIds: number[] = [];
  for (const [wrVariantId, { qty, wrCost }] of need) {
    const key = wrIdempotencyKey(orderCode, wrVariantId, qty);
    try {
      const res = await db.execRun(
        `INSERT OR IGNORE INTO wr_order_links
          (order_code, wr_variant_id, quantity, wr_cost, status, attempt_count,
           max_attempts, next_attempt_at, idempotency_key)
          SELECT code, ?,?,?, 'pending', 0, ?, datetime('now'), ?
          FROM orders
          WHERE code=? AND ${PURCHASE_PAID_SQL}`,
        wrVariantId,
        qty,
        wrCost * qty,
        WR_MAX_ATTEMPTS,
        key,
        orderCode,
      );
      if (Number(res.changes ?? 0) > 0) {
        created++;
        const newId = Number((res as { lastInsertRowid?: number }).lastInsertRowid ?? 0);
        if (newId > 0) createdLinkIds.push(newId);
      }
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
        const res = await db.execRun(
          `INSERT INTO wr_order_links
            (order_code, wr_variant_id, quantity, wr_cost, status, attempt_count,
             max_attempts, next_attempt_at)
            SELECT code, ?,?,?, 'pending', 0, ?, datetime('now')
            FROM orders
            WHERE code=? AND ${PURCHASE_PAID_SQL}`,
          wrVariantId,
          qty,
          wrCost * qty,
          WR_MAX_ATTEMPTS,
          orderCode,
        );
        if (Number(res.changes ?? 0) > 0) {
          created++;
          const newId = Number((res as { lastInsertRowid?: number }).lastInsertRowid ?? 0);
          if (newId > 0) createdLinkIds.push(newId);
        }
      } catch {
        /* concurrent loser: baris sudah ada */
      }
    }
  }
  // Bind SAAT link dibuat (bukan saat completed): fulfillment_items yang
  // sudah termaterialisasi langsung ditandai wr_link_id sehingga pipeline
  // fulfillment generik melewatinya sejak detik pertama (pola kepemilikan
  // P0-5) — item supplier tidak pernah divonis pekerjaan manual palsu.
  // Item yang belum termaterialisasi di-bind oleh penyelesaian berikutnya
  // (handleWrOrderCompleted / processCredentialDelivery), tetap idempoten.
  if (createdLinkIds.length) {
    try {
      const { bindWrLinkToFulfillmentItem } = await import("./deliver");
      for (const linkId of createdLinkIds) {
        await bindWrLinkToFulfillmentItem(linkId, db).catch(() => 0);
      }
    } catch { /* bind menyusul di penyelesaian; link tetap sah */ }
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
    .queryFirst(`SELECT items, status, payment_status, supplier_purchase_disabled FROM orders WHERE code=?`, orderCode)
    .catch(() => null);
  if (!order || !isPaidForSupplierPurchase(order)) return 0;
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
  // INSIDEN 2026-10-10: versi lama mengambil 12 order lunas terbaru lalu
  // menjalankan 1 SELECT per item + 1 SELECT link per order DI JS — di hari
  // ramai ±25 statement, dipanggil DUA KALI per tick, sehingga budget 40
  // habis sebelum SELECT antrean due. Link yang sudah pulih dari saldo habis
  // diam berjam-jam tanpa request ke WR dan tanpa last_error.
  // Sekarang deteksi yatim = SATU statement (json_each + NOT EXISTS),
  // biayanya tetap berapa pun jumlah order lunas.
  const candidates = await db
    .queryAll(
      `SELECT o.code, o.items FROM orders o
       WHERE ${PURCHASE_PAID_SQL_ALIASED}
         AND datetime(COALESCE(o.paid_at, o.created_at)) > datetime('now','-7 days')
         AND json_valid(o.items)
         AND EXISTS (
           SELECT 1 FROM json_each(o.items) je
           JOIN product_variants pv
             ON pv.id = CAST(json_extract(je.value, '$.variant_id') AS INTEGER)
           WHERE pv.wr_variant_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM wr_order_links l
               WHERE l.order_code = o.code AND l.wr_variant_id = pv.wr_variant_id))
       ORDER BY o.id DESC LIMIT ?`,
      Math.max(1, Math.min(limit, 8)),
    );
  for (const candidate of candidates) {
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
    out.orders++;
    const made = await createWrOrderLink(code, items, db);
    out.links += made;
  }
  return out;
}

export async function processWrPendingOrders(
  database?: DatabaseAccess,
  options: { skipOrphanProbe?: boolean; orderCode?: string; limit?: number } = {},
): Promise<ProcessResult> {
  const db = database ?? createDatabaseAccess();
  const result: ProcessResult = { processed: 0, succeeded: 0, retried: 0, failed: 0, blocked: 0, reconciled: 0 };
  if (!isWrEnabled() || !isWrAutoOrderEnabled()) return result;
  // P0-3: tutup jendela crash payment-tanpa-link SEBELUM memproses antrean.
  // Cron yang sudah menjalankan probe yatim sendiri melewatinya di sini
  // (2026-10-10: probe ganda ikut menghabiskan budget statement).
  if (!options.skipOrphanProbe) {
    try {
      const missing = await reconcileMissingWrLinks(db);
      result.reconciled = missing.links;
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      /* reconciler best-effort; antrean tetap diproses */
    }
  }
  const due = await db
    .queryAll(
      `SELECT l.* FROM wr_order_links l
       LEFT JOIN wr_variants wv ON wv.wr_variant_id = l.wr_variant_id
       WHERE l.status IN ('pending','retry')
         AND l.attempt_count < l.max_attempts
          AND (l.next_attempt_at IS NULL OR datetime(l.next_attempt_at) <= datetime('now'))
          AND EXISTS (SELECT 1 FROM orders o WHERE o.code=l.order_code AND ${PURCHASE_PAID_SQL_ALIASED})
          AND NOT EXISTS (SELECT 1 FROM fulfillment_items fi LEFT JOIN product_variants pv ON pv.id=fi.variant_id
            WHERE fi.order_code=l.order_code AND (fi.wr_link_id=l.id OR fi.id=l.fulfillment_item_id OR pv.wr_variant_id=l.wr_variant_id)
              AND (COALESCE(fi.last_error,'') LIKE 'manual_handover:%' OR fi.delivered_message_id='manual'))
          ${options.orderCode ? "AND l.order_code=?" : ""}
         -- 2026-09-18: gate kelas DIBUKA (keputusan owner). Sebelumnya hanya
         -- 'restock' yang auto-order sehingga link made_by_order/NULL diam di
         -- 'pending' selamanya: tidak ada request keluar, pembeli menunggu
         -- tanpa ada yang mengerjakan sampai admin sadar. Sekarang seluruh
         -- kelas diteruskan otomatis; ekspektasi waktunya yang dijujurkan di
         -- storefront (maks 12 jam, lihat delivery-class.ts).
         -- Saklar mundur: WARUNG_REBAHAN_AUTO_ORDER_MBO='false' mengembalikan
         -- perilaku lama tanpa deploy (kelas antrean kembali ditahan).
         ${isWrAutoOrderQueuedEnabled() ? "" : "AND (l.wr_variant_id LIKE 'jaspay:%' OR COALESCE(wv.wr_delivery_class, 'made_by_order') = 'restock')"}
       ORDER BY l.next_attempt_at ASC, l.id ASC LIMIT ?`,
      ...(options.orderCode ? [options.orderCode] : []),
      Math.max(1, Math.min(20, Math.floor(options.limit ?? 20))),
    )
    // Budget habis WAJIB naik ke pemanggil (insiden 2026-10-10): dulu
    // `.catch(() => [])` membuatnya terbaca "antrean kosong" — link due diam
    // tanpa jejak. Error lain (DB pra-migrasi) tetap aman sebagai kosong.
    .catch((error) => {
      if (error instanceof QueryBudgetExceeded) throw error;
      return [] as Row[];
    });
  let transactions: Promise<WrTransaction[]> | undefined;
  const getTransactions = () => transactions ??= fetchTransactions();
  let marketZeroed = false;
  const onMarketZeroed = () => { marketZeroed = true; };
  for (const link of due) {
    if (!db.canSpend(6)) break;
    result.processed++;
    const outcome = await processOneLink(link, db, getTransactions, onMarketZeroed);
    if (outcome === "succeeded") result.succeeded++;
    else if (outcome === "retried") result.retried++;
    else if (outcome === "blocked") result.blocked++;
    else result.failed++;
  }
  if (marketZeroed && db.canSpend(1)) {
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("market", db, { metered: true }).catch(() => undefined);
  }
  return result;
}

/**
 * Reconcile Jaspay ambigu (WR3, bounded): link Jaspay submitted/ordering
 * tanpa invoice => coba exact-ref POST identik SEKALI (tanpa debit ganda);
 * link Jaspay ber-invoice (processing/submitted/ordering/claimed+sent) =>
 * poll /jaspay/status per-invoice. Premium TIDAK tersentuh. Maks `limit`
 * link per run; read-only kecuali bind invoice eksak yang sah.
 */
export async function reconcileJaspayAmbiguous(
  database?: DatabaseAccess,
  limit = 12,
): Promise<{ exactRef: number; polled: number }> {
  const db = database ?? createDatabaseAccess();
  const out = { exactRef: 0, polled: 0 };
  if (!isWrEnabled() || !isWrAutoOrderEnabled()) return out;
  // Antrean adil: urut jatuh tempo (next_attempt_at) lalu id, bukan "4 id
  // tertua" yang membuat link lain kelaparan. Setiap link yang disentuh
  // menggeser next_attempt_at-nya (backoff), sehingga putaran berikutnya
  // memproses link lain.
  // - Tanpa invoice (ambigu): hanya submitted/ordering, umur >=2 menit,
  //   jendela 24 jam (di luar itu admin memilih invoice manual).
  // - Invoice dikenal: dipoll terus (tanpa batas 24 jam) dengan backoff.
  const rows = await db
    .queryAll(
      `SELECT id, wr_order_id FROM wr_order_links
        WHERE wr_variant_id LIKE 'jaspay:%'
          AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))
          AND (((status IN ('submitted','ordering') OR (status='claimed' AND request_sent_at IS NOT NULL
                    AND lease_expires_at IS NOT NULL AND datetime(lease_expires_at) <= datetime('now')))
                AND COALESCE(wr_order_id,'')=''
                AND datetime(COALESCE(request_sent_at, updated_at)) <= datetime('now','-2 minutes')
                AND datetime(COALESCE(request_sent_at, updated_at)) > datetime('now','-24 hours'))
            OR (status IN ('processing','submitted','ordering','claimed') AND COALESCE(wr_order_id,'')!=''))
        ORDER BY COALESCE(next_attempt_at, '') ASC, id ASC LIMIT ?`,
      Math.max(1, Math.min(limit, 8)),
    )
    .catch((error) => {
      if (error instanceof QueryBudgetExceeded) throw error;
      return [] as Row[];
    });
  for (const row of rows) {
    if (!db.canSpend(8)) break;
    const id = Number(row.id);
    if (String(row.wr_order_id || "").trim()) {
      if (await pollKnownJaspayInvoice(id, db).catch(() => false)) out.polled++;
    } else {
      if (await recoverJaspayByExactRef(id, db).catch(() => false)) out.exactRef++;
    }
  }
  return out;
}

/** Backoff poll Jaspay: 2 menit (<1 jam), 10 menit (<24 jam), 60 menit. */
function jaspayNextPollSql(): string {
  return `CASE
    WHEN datetime(COALESCE(request_sent_at, created_at)) > datetime('now','-1 hours') THEN datetime('now','+2 minutes')
    WHEN datetime(COALESCE(request_sent_at, created_at)) > datetime('now','-24 hours') THEN datetime('now','+10 minutes')
    ELSE datetime('now','+60 minutes') END`;
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
): Promise<{ outcome: "claimed"; owner: string } | { outcome: "ambiguous" } | { outcome: "lost" }> {
  const id = Number(link.id);
  const attempt = Number(link.attempt_count || 0) + 1;
  const leaseOwner = `cron-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const leaseUntil = new Date(Date.now() + WR_CLAIM_LEASE_SECONDS * 1000).toISOString();
  // Jalur 1: klaim fresh (belum ada yang pegang).
  const fresh = await claimFreshPurchase(db, "wr", id, attempt, leaseOwner, leaseUntil);
  if (Number(fresh.changes ?? 0) > 0) return { outcome: "claimed", owner: leaseOwner };
  // Jalur 2: ambil alih lease basi — HANYA bila request belum keluar.
  const stale = await claimStalePurchase(db, "wr", id, attempt, leaseOwner, leaseUntil);
  if (Number(stale.changes ?? 0) > 0) return { outcome: "claimed", owner: leaseOwner };
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

async function processOneLink(link: Row, db: DatabaseAccess, getTransactions: () => Promise<WrTransaction[]>, onMarketZeroed?: () => void): Promise<"succeeded" | "retried" | "failed" | "blocked"> {
  const { execRun } = db;
  const id = Number(link.id);
  const attempt = Number(link.attempt_count || 0) + 1;
  const claim = await claimLink(link, db);
  if (claim.outcome === "lost") return "retried";
  if (claim.outcome === "ambiguous") {
    // TIDAK beli ulang buta: serahkan ke reconciler via /transactions.
    await reconcileWrLinksByTransactions([{ id, wr_order_id: "", order_code: "" }], db, getTransactions).catch(() => undefined);
    return "retried";
  }
  // Persist before POST; a timeout must retain this evidence, never repurchase.
  const sent = await fencePurchaseSend(execRun, "wr", id, claim.owner);
  if (!Number(sent.changes ?? 0)) return "retried";
  // WR3 Jaspay: keluarga `jaspay:` TIDAK PERNAH lewat POST premium.
  // Salah famili = order salah produk + invoice tak terkorelasi.
  if (isJaspayVariantId(String(link.wr_variant_id || ""))) {
    return processOneJaspayLink(id, link, db, onMarketZeroed);
  }
  let receivedOrder = false;
  try {
    // 2026-09-16 (uji live #1): upstream WR 422 "email_invite is required
    // for invite-based products" (Apple Music tipe Invite). Link hanya bawa
    // variant_id+qty — email pembeli tidak ikut. Ambil customer_email dari
    // order Axvara; bila ada, teruskan sebagai email_invite. Bila kosong
    // untuk produk Invite, WR tetap 422 — retry tidak akan sembuh, admin
    // harus minta email pembeli (lihat last_error).
    //
    // 2026-10-07 (temuan admin WR, 1-field smart): email_invite HANYA
    // dikirim untuk varian bertipe Invite/Link (lihat wrTypeUsesEmailInvite:
    // Link dipertahankan karena tipe nyata di API WR — menghilangkan-nya
    // berisiko order 422 tak sembuh). Produk Private/Sharing/dll yang
    // dikirimi email_invite ikut muncul TARGET ACCOUNT INVITATION di
    // dashboard WR (kasus RBHN-20261005-0127B5). Untuk non-invite, key
    // email_invite di-omit total (bukan string kosong) — customer_email
    // tetap dipakai Axvara untuk notif/kredensial seperti biasa.
    let emailInvite: string | undefined;
    try {
      const linkRow = await db.queryFirst(
        `SELECT l.order_code AS order_code, wv.wr_type AS wr_type
         FROM wr_order_links l
         LEFT JOIN wr_variants wv ON wv.wr_variant_id = l.wr_variant_id
         WHERE l.id=?`,
        id,
      ).catch(() => null) as { order_code?: unknown; wr_type?: unknown } | null;
      const { wrTypeUsesEmailInvite } = await import("./delivery-class");
      if (wrTypeUsesEmailInvite(linkRow?.wr_type != null ? String(linkRow.wr_type) : null)) {
        const orderRow = await db.queryFirst(
          `SELECT customer_email FROM orders WHERE code=?`,
          String(link.order_code ?? linkRow?.order_code ?? ""),
        ).catch(() => null) as { customer_email?: unknown } | null;
        const rawEmail = String(orderRow?.customer_email || "").trim();
        if (rawEmail && rawEmail.includes("@")) emailInvite = rawEmail;
      }
    } catch {
      /* email opsional — lanjut tanpa invite */
    }
    const order = await createOrder({
      variant_id: String(link.wr_variant_id),
      quantity: Math.max(1, Number(link.quantity || 1)),
      ...(emailInvite ? { email_invite: emailInvite } : {}),
    });
    receivedOrder = true;
    const assigned = await execRun(
      `UPDATE wr_order_links SET status='processing', wr_order_id=?,
        last_error=NULL, lease_owner=NULL, lease_expires_at=NULL,
         updated_at=datetime('now') WHERE id=? AND status='claimed'
         AND (wr_order_id IS NULL OR wr_order_id=?)
         AND NOT EXISTS (SELECT 1 FROM wr_order_links used WHERE used.wr_order_id=? AND used.id!=?)`,
      String(order.order_id),
      id,
      String(order.order_id),
      String(order.order_id),
      id,
    );
    if (!Number(assigned.changes ?? 0)) return "retried";
    await db
      .execRun(
        `INSERT INTO wr_saldo_log (balance, source, note) VALUES (?,'order_deduct',?)`,
        Math.floor(Number(order.current_balance ?? 0)),
        `order ${String(link.order_code)} → ${String(order.order_id)}`,
      )
      .catch(() => undefined);
    return "succeeded";
  } catch (error) {
    return handleOrderError(id, link, receivedOrder ? new Error("network_receipt_persist_failed") : error, attempt, db, onMarketZeroed);
  }
}

// ── WR3 Jaspay dispatch (isolated policy, bukan retry global premium) ──
//
// request_sent_at SUDAH durable sebelum POST (ditulis processOneLink).
// ref_id stabil SELALU sama untuk link ini (turunan idempotency_key durable).
// Timeout/network/5xx => submitted ambigu + HANYA pulih via:
//   (a) POST duplikat ref identik (input SAMA PERSIS) — upstream
//       mengembalikan duplikat asli `duplicate:true` tanpa debit ganda; atau
//   (b) bind invoice JSP eksak manual; atau
//   (c) poll /jaspay/status atas invoice JSP yang SUDAH dikenal.
// TIDAK PERNAH: rePOST ref baru, tebak invoice by product/time, scan
// /jaspay/orders latest-50 untuk korelasi.
async function processOneJaspayLink(
  id: number,
  link: Row,
  db: DatabaseAccess,
  onMarketZeroed?: () => void,
): Promise<"succeeded" | "retried" | "failed" | "blocked"> {
  const { execRun } = db;
  const attempt = Number(link.attempt_count || 0);
  const variantId = String(link.wr_variant_id || "");
  const decoded = decodeJaspayVariantId(variantId);
  if (!decoded) {
    await execRun(
      `UPDATE wr_order_links SET status='failed', last_error=?, request_sent_at=NULL,
         lease_owner=NULL, lease_expires_at=NULL, updated_at=datetime('now')
       WHERE id=? AND status='claimed' AND wr_order_id IS NULL`,
      "jaspay_malformed_variant_id",
      id,
    );
    return "failed";
  }
  // Fail-closed max_quantity: baca dari mirror durable (BUKAN dari display).
  // Invalid/missing => JANGAN order; admin followup manual.
  const qty = Math.max(1, Math.floor(Number(link.quantity || 1)));
  try {
    const cap = await db.queryFirst(
      `SELECT wr_max_quantity FROM wr_variants WHERE wr_variant_id=?`,
      variantId,
    ).catch(() => null);
    const maxRaw = cap?.wr_max_quantity;
    const max = maxRaw == null ? null : Math.floor(Number(maxRaw));
    if (max == null || !Number.isFinite(max) || max < 1) {
      await execRun(
        `UPDATE wr_order_links SET status='failed', last_error=?, request_sent_at=NULL,
           lease_owner=NULL, lease_expires_at=NULL, updated_at=datetime('now')
         WHERE id=? AND status='claimed' AND wr_order_id IS NULL`,
        "jaspay_max_quantity_missing",
        id,
      );
      return "failed";
    }
    if (qty > max) {
      await execRun(
        `UPDATE wr_order_links SET status='failed', last_error=?, request_sent_at=NULL,
           lease_owner=NULL, lease_expires_at=NULL, updated_at=datetime('now')
         WHERE id=? AND status='claimed' AND wr_order_id IS NULL`,
        `jaspay_max_quantity_exceeded:${qty}>${max}`,
        id,
      );
      return "failed";
    }
  } catch {
    await execRun(
      `UPDATE wr_order_links SET status='retry', last_error=?, request_sent_at=NULL,
         lease_owner=NULL, lease_expires_at=NULL, next_attempt_at=?, updated_at=datetime('now')
       WHERE id=? AND status='claimed' AND wr_order_id IS NULL`,
      "jaspay_cap_check_db_error",
      nextPurchaseAttemptIso(attempt + 1, WR_RETRY_DELAYS_MINUTES),
      id,
    );
    return "retried";
  }
  const keyRow = await db.queryFirst(
    `SELECT idempotency_key FROM wr_order_links WHERE id=?`,
    id,
  ).catch(() => null);
  const idemKey = String(keyRow?.idempotency_key || wrIdempotencyKey(String(link.order_code || ""), variantId, qty));
  const { createJaspayOrder } = await import("./client");
  const { jaspayRefId } = await import("./jaspay");
  const refId = await jaspayRefId(idemKey);
  let receivedJsp = false;
  try {
    const order = await createJaspayOrder({
      product: decoded.product,
      package: decoded.package,
      quantity: qty,
      ref_id: refId,
    });
    receivedJsp = true;
    const invoice = String(order.invoice || "").trim();
    if (!invoice) throw new Error("jaspay_empty_invoice");
    const assigned = await execRun(
      `UPDATE wr_order_links SET status='processing', wr_order_id=?,
         last_error=NULL, lease_owner=NULL, lease_expires_at=NULL,
         updated_at=datetime('now') WHERE id=? AND status='claimed'
         AND (wr_order_id IS NULL OR wr_order_id=?)
         AND NOT EXISTS (SELECT 1 FROM wr_order_links used WHERE used.wr_order_id=? AND used.id!=?)`,
      invoice,
      id,
      invoice,
      invoice,
      id,
    );
    if (!Number(assigned.changes ?? 0)) return "retried";
    if (typeof order.balance_after === "number" && Number.isFinite(order.balance_after)) {
      await db
        .execRun(
          `INSERT INTO wr_saldo_log (balance, source, note) VALUES (?,'order_deduct',?)`,
          Math.floor(order.balance_after),
          `jaspay order ${String(link.order_code)} → ${invoice}`,
        )
        .catch(() => undefined);
    }
    // Terminal sinkron dari upstream: selesaikan via handler Jaspay yang
    // sama dengan webhook/poll (tanpa duplikasi logika).
    if (["processing", "completed", "partial", "failed"].includes(order.status)) {
      const { handleJaspayTerminal } = await import("./deliver");
      await handleJaspayTerminal(invoice, order, db).catch(() => undefined);
    }
    return "succeeded";
  } catch (error) {
    return handleJaspayOrderError(id, link, receivedJsp ? new Error("network_receipt_persist_failed") : error, attempt + 1, db, onMarketZeroed);
  }
}

/**
 * Recovery ref-eksak Jaspay (WR3): POST duplikat dengan input IDENTIK
 * (product/package/qty/ref SAMA) untuk memulihkan receipt yang hilang.
 * Upstream terdokumentasi mengembalikan duplikat asli tanpa debit ganda.
 * BUKAN retry global: hanya dipanggil untuk link Jaspay ambigu (submitted,
 * tanpa invoice) dan TIDAK PERNAH dengan ref baru.
 */
export async function recoverJaspayByExactRef(
  linkId: number,
  database?: DatabaseAccess,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled() || !isWrAutoOrderEnabled()) return false;
  const link = await db.queryFirst(`SELECT * FROM wr_order_links WHERE id=?`, linkId).catch(() => null);
  if (!link) return false;
  const variantId = String(link.wr_variant_id || "");
  if (!isJaspayVariantId(variantId)) return false;
  if (String(link.wr_order_id || "").trim()) return false;
  const decoded = decodeJaspayVariantId(variantId);
  if (!decoded) return false;
  // Klaim lease recovery: claimed hanya bila request sudah tercatat dan lease basi.
  const owner = `jsp-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const leaseUntil = new Date(Date.now() + WR_CLAIM_LEASE_SECONDS * 1000).toISOString();
  const claimed = await db.execRun(
    `UPDATE wr_order_links SET status='submitted', lease_owner=?, lease_expires_at=?, updated_at=datetime('now')
     WHERE id=? AND status IN ('submitted','ordering','claimed') AND request_sent_at IS NOT NULL AND COALESCE(wr_order_id,'')=''
       AND (lease_expires_at IS NULL OR datetime(lease_expires_at) <= datetime('now'))
       AND (status!='claimed' OR lease_expires_at IS NOT NULL)
       AND EXISTS (SELECT 1 FROM orders o WHERE o.code=wr_order_links.order_code AND ${PURCHASE_PAID_SQL_ALIASED})
       AND NOT EXISTS (SELECT 1 FROM fulfillment_items fi LEFT JOIN product_variants pv ON pv.id=fi.variant_id
         WHERE fi.order_code=wr_order_links.order_code AND (fi.wr_link_id=wr_order_links.id OR fi.id=wr_order_links.fulfillment_item_id OR pv.wr_variant_id=wr_order_links.wr_variant_id)
           AND (COALESCE(fi.last_error,'') LIKE 'manual_handover:%' OR fi.delivered_message_id='manual'))`,
    owner,
    leaseUntil,
    linkId,
  ).catch(() => ({ changes: 0 as number | undefined }));
  if (!Number(claimed.changes ?? 0)) return false;
  const release = async (error: string | null) => {
    await db.execRun(
      `UPDATE wr_order_links SET lease_owner=NULL, lease_expires_at=NULL,
         last_error=COALESCE(?, last_error),
         next_attempt_at=datetime('now','+${WR_SUBMITTED_STALE_MINUTES} minutes'), updated_at=datetime('now')
       WHERE id=? AND lease_owner=?`,
      error,
      linkId,
      owner,
    ).catch(() => undefined);
  };
  const qty = Math.max(1, Math.floor(Number(link.quantity || 1)));
  const idemKey = String(link.idempotency_key || wrIdempotencyKey(String(link.order_code || ""), variantId, qty));
  const { createJaspayOrder } = await import("./client");
  const { jaspayRefId } = await import("./jaspay");
  const refId = await jaspayRefId(idemKey);
  let order;
  try {
    // Input IDENTIK dengan POST asli (product/package/qty/ref sama).
    order = await createJaspayOrder({ product: decoded.product, package: decoded.package, quantity: qty, ref_id: refId });
  } catch (error) {
    await release(`jaspay_exact_ref_retry: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}`);
    return false;
  }
  const invoice = String(order?.invoice || "").trim();
  if (!invoice) {
    await release("jaspay_exact_ref_empty_invoice");
    return false;
  }
  // Bind dengan CAS pemilik lease + status ambigu; hasil telat tidak boleh
  // menurunkan link yang sudah bergerak.
  const bound = await db.execRun(
    `UPDATE wr_order_links SET status='processing', wr_order_id=?, last_error=NULL,
       lease_owner=NULL, lease_expires_at=NULL, next_attempt_at=NULL, updated_at=datetime('now')
     WHERE id=? AND lease_owner=? AND status IN ('submitted','ordering') AND COALESCE(wr_order_id,'')=''
       AND NOT EXISTS (SELECT 1 FROM wr_order_links used WHERE used.wr_order_id=? AND used.id!=?)`,
    invoice,
    linkId,
    owner,
    invoice,
    linkId,
  ).catch(() => ({ changes: 0 as number | undefined }));
  if (!Number(bound.changes ?? 0)) {
    await release(`jaspay_exact_ref_bind_conflict:${invoice.slice(0, 60)}`);
    return false;
  }
  // Baca ulang terminal lewat handler monotonik yang sama.
  if (["processing", "completed", "partial", "failed"].includes(order.status)) {
    const { handleJaspayTerminal } = await import("./deliver");
    await handleJaspayTerminal(invoice, order, db).catch(() => undefined);
  }
  return true;
}

/** Poll SATU invoice JSP yang sudah dikenal (bukan scan latest-50). */
export async function pollKnownJaspayInvoice(
  linkId: number,
  database?: DatabaseAccess,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const link = await db.queryFirst(`SELECT * FROM wr_order_links WHERE id=?`, linkId).catch(() => null);
  if (!link) return false;
  if (!isJaspayVariantId(String(link.wr_variant_id || ""))) return false;
  const invoice = String(link.wr_order_id || "").trim();
  if (!invoice) return false;
  if (["completed", "failed"].includes(String(link.status || ""))) return false;
  // Geser jatuh tempo SEBELUM jaringan: kegagalan/timeout tidak membuat
  // link ini terus menyerobot giliran link lain.
  await db.execRun(
    `UPDATE wr_order_links SET next_attempt_at=${jaspayNextPollSql()} WHERE id=?`,
    linkId,
  ).catch(() => undefined);
  const { fetchJaspayStatus } = await import("./client");
  let status;
  try {
    status = await fetchJaspayStatus(invoice);
  } catch {
    return false;
  }
  if (String(status.invoice || "").trim() !== invoice) return false;
  if (status.status === "processing") {
    const { handleJaspayTerminal } = await import("./deliver");
    await handleJaspayTerminal(invoice, status, db);
    return false;
  }
  const { handleJaspayTerminal } = await import("./deliver");
  return handleJaspayTerminal(invoice, status, db).catch(() => false);
}

async function handleJaspayOrderError(
  id: number,
  link: Row,
  error: unknown,
  attempt: number,
  db: DatabaseAccess,
  onMarketZeroed?: () => void,
): Promise<"retried" | "failed" | "blocked"> {
  const { execRun } = db;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const { WrInsufficientBalanceError, WrOutOfStockError, WrApiError } = await import("./client");
  const isTimeout = /timeout|abort|network|fetch failed|504|wr_proxy_unreadable_response/i.test(message)
    || (error instanceof WrApiError && error.status >= 500)
    || (error instanceof WrNetworkError && !error.preSend);
  if (isTimeout) {
    // Ambigu Jaspay: submitted + lease dilepas. Pulih HANYA via exact-ref
    // POST identik / invoice eksak / poll invoice dikenal — jangan beli ulang.
    await execRun(
      `UPDATE wr_order_links SET status='submitted',
         last_error=?, lease_owner=NULL, lease_expires_at=NULL,
         next_attempt_at=datetime('now','+${WR_SUBMITTED_STALE_MINUTES} minutes'),
         updated_at=datetime('now') WHERE id=? AND status='claimed' AND wr_order_id IS NULL`,
      `ambiguous_timeout: ${message}`,
      id,
    );
    return "retried";
  }
  if (error instanceof WrInsufficientBalanceError) {
    return handleInsufficientBalance(id, link, message, db);
  }
  if (error instanceof WrOutOfStockError) {
    // Jaspay: availability upstream mati => mirror stok 0 (jujur, bukan
    // retry buta). request_sent_at dihapus (pre-kirim pasti).
    const zeroRes = await execRun(
      `UPDATE product_variants SET stock=0, updated_at=datetime('now')
       WHERE wr_variant_id=? AND stock!=0`,
      String(link.wr_variant_id),
    ).catch(() => ({ changes: 0 }));
    await execRun(
      `UPDATE wr_variants SET wr_stock=0, updated_at=? WHERE wr_variant_id=?`,
      new Date().toISOString(),
      String(link.wr_variant_id),
    ).catch(() => undefined);
    if (Number(zeroRes?.changes ?? 0) > 0) {
      if (onMarketZeroed) {
        onMarketZeroed();
      } else {
        const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
        await bumpCatalogRevision("market", db).catch(() => undefined);
      }
    }
  }
  if (attempt >= Number(link.max_attempts || WR_MAX_ATTEMPTS)) {
    const failed = await execRun(
      `UPDATE wr_order_links SET status='failed', last_error=?, request_sent_at=NULL,
         lease_owner=NULL, lease_expires_at=NULL, updated_at=datetime('now') WHERE id=? AND status='claimed' AND wr_order_id IS NULL`,
      message,
      id,
    );
    if (!Number(failed.changes ?? 0)) return "retried";
    await notifyAdmin(`⚠️ <b>Order Jaspay gagal</b> <code>${String(link.order_code)}</code>\n${escapeHtml(message)}`);
    await execRun(
      `UPDATE orders SET fulfillment_status='failed', updated_at=datetime('now')
       WHERE code=? AND status='lunas'`,
      String(link.order_code),
    ).catch(() => undefined);
    try {
      const { notifyBuyerDeliveryFailed } = await import("@/lib/notify-buyer");
      await notifyBuyerDeliveryFailed(String(link.order_code), db);
    } catch { /* kabar pembeli best-effort */ }
    return "failed";
  }
  await execRun(
    `UPDATE wr_order_links SET status='retry', last_error=?, request_sent_at=NULL,
       lease_owner=NULL, lease_expires_at=NULL,
       next_attempt_at=?, updated_at=datetime('now') WHERE id=? AND status='claimed' AND wr_order_id IS NULL`,
    message,
    nextPurchaseAttemptIso(attempt, WR_RETRY_DELAYS_MINUTES),
    id,
  );
  return "retried";
}

async function handleOrderError(
  id: number,
  link: Row,
  error: unknown,
  attempt: number,
  db: DatabaseAccess,
  onMarketZeroed?: () => void,
): Promise<"retried" | "failed" | "blocked"> {
  const { execRun } = db;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const isTimeout = /timeout|abort|network|fetch failed|504|wr_proxy_unreadable_response/i.test(message)
    || (error instanceof WrApiError && error.status >= 500)
    || (error instanceof WrNetworkError && !error.preSend);
  if (isTimeout) {
    // Timeout = vendor MUNGKIN sudah menerima. Tandai submitted (ambigu),
    // HAPUS lease agar reconciler bisa verifikasi — tetapi JANGAN beli ulang.
    await execRun(
      `UPDATE wr_order_links SET status='submitted',
         last_error=?, lease_owner=NULL, lease_expires_at=NULL,
         next_attempt_at=datetime('now','+${WR_SUBMITTED_STALE_MINUTES} minutes'),
          updated_at=datetime('now') WHERE id=? AND status='claimed' AND wr_order_id IS NULL`,
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
    const zeroRes = await execRun(
      `UPDATE product_variants SET stock=0, updated_at=datetime('now')
       WHERE wr_variant_id=? AND stock!=0`,
      String(link.wr_variant_id),
    ).catch(() => ({ changes: 0 }));
    await execRun(
      `UPDATE wr_variants SET wr_stock=0, updated_at=? WHERE wr_variant_id=?`,
      new Date().toISOString(),
      String(link.wr_variant_id),
    ).catch(() => undefined);
    if (Number(zeroRes?.changes ?? 0) > 0) {
      if (onMarketZeroed) {
        onMarketZeroed();
      } else {
        const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
        await bumpCatalogRevision("market", db).catch(() => undefined);
      }
    }
  }
  if (attempt >= Number(link.max_attempts || WR_MAX_ATTEMPTS)) {
    const failed = await execRun(
      `UPDATE wr_order_links SET status='failed', last_error=?, request_sent_at=NULL,
          lease_owner=NULL, lease_expires_at=NULL, updated_at=datetime('now') WHERE id=? AND status='claimed' AND wr_order_id IS NULL`,
      message,
      id,
    );
    if (!Number(failed.changes ?? 0)) return "retried";
    await notifyAdmin(
      `⚠️ <b>Order WR gagal</b> <code>${String(link.order_code)}</code>\n${escapeHtml(message)}`,
    );
    // Tandai order Axvara agar admin tahu perlu penanganan manual.
    await execRun(
      `UPDATE orders SET fulfillment_status='failed', updated_at=datetime('now')
       WHERE code=? AND status='lunas'`,
      String(link.order_code),
    ).catch(() => undefined);
    // Pembeli juga dikabari (audit ronde 4, T-H1): jalur ini menulis
    // `failed` langsung tanpa lewat refreshOrderAggregate.
    try {
      const { notifyBuyerDeliveryFailed } = await import("@/lib/notify-buyer");
      await notifyBuyerDeliveryFailed(String(link.order_code), db);
    } catch { /* kabar pembeli best-effort */ }
    return "failed";
  }
  await execRun(
    `UPDATE wr_order_links SET status='retry', last_error=?, request_sent_at=NULL,
       lease_owner=NULL, lease_expires_at=NULL,
        next_attempt_at=?, updated_at=datetime('now') WHERE id=? AND status='claimed' AND wr_order_id IS NULL`,
    message,
    nextPurchaseAttemptIso(attempt, WR_RETRY_DELAYS_MINUTES),
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
  const blocked = await execRun(
    `UPDATE wr_order_links SET status='blocked_balance',
       last_error=?, request_sent_at=NULL, lease_owner=NULL, lease_expires_at=NULL,
       attempt_count=attempt_count-1,
       next_attempt_at=datetime('now','+60 minutes'), updated_at=datetime('now')
      WHERE id=? AND status='claimed' AND wr_order_id IS NULL`,
    `saldo_wr_habis: ${message}`,
    id,
  );
  if (!Number(blocked.changes ?? 0)) return "blocked";
  await notifyAdmin(
    `💰 <b>Saldo Warung Rebahan habis</b>\nOrder <code>${String(link.order_code)}</code> diblokir sementara (tidak makan retry). Top up untuk memulihkan otomatis.`,
  );
  // Kabar pembeli (2026-09-28): order lunas tapi tertahan karena saldo WR
  // habis — pembeli tidak boleh menunggu buta. Idempoten per order lewat
  // kunci `wr-blocked:<kode>` (buyer_notice_log utk email/Telegram,
  // whatsapp_outbox utk WA). Best-effort.
  try {
    const { notifyBuyerWrBlocked } = await import("@/lib/notify-buyer");
    await notifyBuyerWrBlocked(String(link.order_code), db);
  } catch { /* kabar pembeli best-effort */ }
  return "blocked";
}

/**
 * Pulihkan link blocked_balance setelah top-up: cek saldo aktual, bila cukup
 * untuk biaya link → kembalikan ke pending. Dipanggil cron sebelum memproses
 * antrean. Tanpa reset manual berbahaya (CAS pada status).
 *
 * Dua pagar anti-zombie (2026-09-28):
 * 1. TTL — link yang diblokir lebih dari WR_BLOCKED_MAX_AGE_HOURS jam
 *    (cek updated_at) TIDAK auto-revive; niat beli dianggap kedaluwarsa,
 *    hanya admin yang boleh retry/void manual.
 * 2. Order harus masih `lunas` — order yang sudah dibatalkan/direfund
 *    tidak boleh dibangunkan diam-diam.
 */
export async function reconcileBlockedBalance(
  database?: DatabaseAccess,
  options: { reportLookupFailure?: boolean } = {},
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled() || !isWrAutoOrderEnabled()) return 0;
  const blocked = await db
    .queryAll(
      `SELECT l.id, l.wr_cost
       FROM wr_order_links l WHERE l.status='blocked_balance'
         AND datetime(l.updated_at) >= datetime('now','-${WR_BLOCKED_MAX_AGE_HOURS} hours')
         AND l.request_sent_at IS NULL AND COALESCE(l.wr_order_id,'')=''
         AND EXISTS (SELECT 1 FROM orders o WHERE o.code=l.order_code AND ${PURCHASE_PAID_SQL_ALIASED})
         AND NOT EXISTS (SELECT 1 FROM fulfillment_items fi LEFT JOIN product_variants pv ON pv.id=fi.variant_id
           WHERE fi.order_code=l.order_code AND (fi.wr_link_id=l.id OR fi.id=l.fulfillment_item_id OR pv.wr_variant_id=l.wr_variant_id)
             AND (COALESCE(fi.last_error,'') LIKE 'manual_handover:%' OR fi.delivered_message_id='manual'))
       ORDER BY l.id ASC LIMIT 8`,
    );
  if (!blocked.length) return 0;
  const { fetchBalance } = await import("./client");
  let balance: number;
  try {
    const raw = (await fetchBalance()).balance;
    const numeric = Number(raw);
    if ((typeof raw !== 'number' && typeof raw !== 'string') || String(raw).trim() === '' || !Number.isFinite(numeric) || numeric < 0) {
      throw new Error("invalid_wr_balance");
    }
    balance = Math.floor(numeric);
  } catch (error) {
    if (options.reportLookupFailure) throw error;
    return 0;
  }
  let revived = 0;
  for (const row of blocked) {
    if (!isWrAutoOrderEnabled()) break;
    if (balance < Number(row.wr_cost || 0)) continue;
    const res = await db
      .execRun(
        `UPDATE wr_order_links SET status='pending', last_error=NULL,
           next_attempt_at=datetime('now'), updated_at=datetime('now')
         WHERE id=? AND status='blocked_balance' AND request_sent_at IS NULL AND COALESCE(wr_order_id,'')=''
           AND datetime(updated_at) >= datetime('now','-${WR_BLOCKED_MAX_AGE_HOURS} hours') AND COALESCE(wr_cost,0) <= ?
           AND EXISTS (SELECT 1 FROM orders o WHERE o.code=wr_order_links.order_code AND ${PURCHASE_PAID_SQL_ALIASED})
           AND NOT EXISTS (SELECT 1 FROM fulfillment_items fi LEFT JOIN product_variants pv ON pv.id=fi.variant_id
             WHERE fi.order_code=wr_order_links.order_code AND (fi.wr_link_id=wr_order_links.id OR fi.id=wr_order_links.fulfillment_item_id OR pv.wr_variant_id=wr_order_links.wr_variant_id)
               AND (COALESCE(fi.last_error,'') LIKE 'manual_handover:%' OR fi.delivered_message_id='manual'))`,
         Number(row.id),
         balance,
      );
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
         AND datetime(next_attempt_at) <= datetime('now')
         AND EXISTS (SELECT 1 FROM orders o WHERE o.code=wr_order_links.order_code AND ${PURCHASE_PAID_SQL_ALIASED})`,
    )
    .catch(() => ({ changes: 0 as number | undefined }));
  return Number(res.changes ?? 0);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 300);
}

export async function notifyAdmin(html: string) {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId || process.env.TELEGRAM_BOT_ENABLED !== "true") return;
  try {
    const { sendMessage } = await import("@/lib/telegram/api");
    return await sendMessage({ chat_id: adminChatId, text: html, parse_mode: "HTML" });
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
// Urutan ACAK (2026-10-04): antrean Made By Order bisa berisi belasan link
// yang dikerjakan berjam-jam. Tanpa ORDER, SQLite selalu mengembalikan 8 baris
// yang sama sehingga link MBO lain yang sudah selesai di upstream (webhook
// hilang) tidak pernah tersentuh. /transactions dibaca SEKALI per run, jadi
// menambah kandidat tidak menambah panggilan upstream.
export async function reconcileStuckWrOrders(
  database?: DatabaseAccess,
  options: { minAgeMinutes?: number; reportLookupFailure?: boolean } = {},
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled()) return 0;
  // minAgeMinutes (2026-10-10): cron lite memakai 2 menit — webhook WR yang
  // hilang/terputus tidak lagi membuat pembeli varian instan menunggu 1 jam.
  // /transactions tetap dibaca SEKALI per run (read-only, tidak beli ulang).
  const minAge = Math.max(1, Math.floor(Number(options.minAgeMinutes ?? 60)));
  const stuck = await db
    .queryAll(
      `SELECT wr_order_id, order_code, id FROM wr_order_links
        WHERE (status IN ('processing','submitted','ordering')
          OR (status='claimed' AND request_sent_at IS NOT NULL))
         AND COALESCE(wr_variant_id,'') NOT LIKE 'jaspay:%'
         AND datetime(COALESCE(request_sent_at, updated_at)) <= datetime('now','-${minAge} minutes')
       ORDER BY RANDOM() LIMIT 12`,
    );
  if (!stuck.length) return 0;
  return reconcileWrLinksByTransactions(
    stuck.map((row) => ({
      id: Number(row.id),
      wr_order_id: String(row.wr_order_id || ""),
      order_code: String(row.order_code || ""),
    })),
    db,
    fetchTransactions,
    options.reportLookupFailure,
  );
}

/**
 * Reconcile link WR via /transactions TANPA ambang 1 jam (2026-10-03).
 *
 * Kasus order F111FD64: dashboard WR sudah COMPLETED + kredensial terbit
 * hitungan menit setelah lunas, tetapi webhook order.completed TIDAK PERNAH
 * sampai ke Axvara (wr_webhook_events terakhir 28 Sep — 5 hari sebelum order).
 * Reconcile lama baru menyentuh link >1 jam, sehingga buyer menunggu 1 jam
 * untuk kredensial yang sebenarnya sudah ada.
 *
 * Dipanggil untuk link processing FRESH (umur menit, bukan jam) — aman karena
 * READ-ONLY terhadap upstream: hanya membaca /transactions lalu memanggil
 * handleWrOrderCompleted yang idempoten + monotonik. TIDAK pernah beli ulang.
 * SK tidak tersentuh (modul + tabel terpisah).
 */
export async function reconcileFreshWrLinks(
  links: { id: number; wr_order_id: string; order_code: string }[],
  database?: DatabaseAccess,
  getTransactions?: () => Promise<WrTransaction[]>,
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled() || !links.length) return 0;
  return reconcileWrLinksByTransactions(links, db, getTransactions);
}

/**
 * Self-heal link WR `completed` yang BELUM terikat ke baris item (2026-10-04,
 * kasus F111FD64). Link yang selesai sebelum fix bind/formatter menyimpan
 * kredensial yang diformat formatter lama ("[object Object]" untuk payload
 * `details` berbentuk array objek) dan item-nya tanpa ciphertext — panel
 * pembeli + tombol Ambil Detail Produk menampilkan teks rusak/kosong.
 * Ditarik ulang dari /transactions (read-only, TIDAK beli ulang) lalu
 * `handleWrOrderCompleted` menulis ulang dengan formatter baru + bind + settle.
 * Pengiriman tidak diulang: delivery_status `delivered` dilewati queue/process.
 * Hanya link yang PUNYA item cocok (bind pasti berhasil → tidak dipungut lagi),
 * umur ≤14 hari, maks `limit` per run.
 */
export async function repairUnboundCompletedWrLinks(database?: DatabaseAccess, limit = 2): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled()) return 0;
  const rows = await db
    .queryAll(
      `SELECT l.id, l.wr_order_id, l.order_code FROM wr_order_links l
       WHERE l.status='completed' AND l.fulfillment_item_id IS NULL
         AND COALESCE(l.wr_order_id,'')!=''
         AND COALESCE(l.last_error,'')!='repair_tx_missing'
         AND datetime(COALESCE(l.completed_at, l.updated_at)) > datetime('now','-14 days')
         AND EXISTS(
           SELECT 1 FROM fulfillment_items fi JOIN product_variants pv ON pv.id=fi.variant_id
           WHERE fi.order_code=l.order_code AND pv.wr_variant_id=l.wr_variant_id)
       ORDER BY l.id ASC LIMIT ?`,
      Math.max(1, Math.min(limit, 4)),
    )
    .catch(() => [] as Row[]);
  if (!rows.length) return 0;
  const repaired = await reconcileWrLinksByTransactions(
    rows.map((row) => ({
      id: Number(row.id),
      wr_order_id: String(row.wr_order_id || ""),
      order_code: String(row.order_code || ""),
    })),
    db,
  );
  // Transaksi yang tidak ada lagi di /transactions upstream ditandai agar
  // tidak dipungut tiap run (slot LIMIT tidak tersumbat selamanya).
  for (const row of rows) {
    if (!db.canSpend(1)) break;
    await db.execRun(
      `UPDATE wr_order_links SET last_error='repair_tx_missing', updated_at=datetime('now')
       WHERE id=? AND fulfillment_item_id IS NULL AND status='completed'`,
      Number(row.id),
    ).catch(() => undefined);
  }
  return repaired;
}

async function reconcileWrLinksByTransactions(
  links: { id: number; wr_order_id: string; order_code: string }[],
  db: DatabaseAccess,
  getTransactions: () => Promise<WrTransaction[]> = fetchTransactions,
  reportLookupFailure = false,
): Promise<number> {
  if (!links.length || !db.canSpend(1)) return 0;
  let loaded = false;
  const byId = new Map<string, WrTransaction[]>();
  let reconciled = 0;
  // Diimpor lazy dari deliver.ts (hindari siklus: deliver tidak impor order).
  const { handleWrOrderCompleted, handleWrOrderFailed } = await import("./deliver");
  for (const row of links) {
    if (!db.canSpend(1)) break;
    // Reload authoritative evidence, including links omitted by the caller's LIMIT.
    const link = await db.queryFirst(`SELECT * FROM wr_order_links WHERE id=?`, row.id);
    if (!link) continue;
    const orderId = String(link.wr_order_id || "");
    if (!orderId) continue; // Correlation requires an admin-selected invoice, never time/name guesses.
    if (!loaded) {
      let transactions: WrTransaction[];
      try { transactions = await getTransactions(); } catch (error) {
        if (reportLookupFailure) throw error;
        return reconciled;
      }
      for (const tx of transactions) {
        if (!tx || typeof tx.order_id !== "string" || !tx.order_id.trim()) continue;
        const group = byId.get(tx.order_id) ?? [];
        group.push(tx);
        byId.set(tx.order_id, group);
      }
      loaded = true;
    }
    const matches = byId.get(orderId) ?? [];
    if (matches.length !== 1) continue;
    const tx = matches[0];
    const status = wrTransactionStatus(tx.status);
    if (!db.canSpend(status === "completed" ? 24 : status === "failed" ? 12 : 0)) break;
    if (status === "completed") {
      if (await handleWrOrderCompleted(orderId, tx.account_details ?? tx, db, { deferDelivery: true })) reconciled++;
    } else if (status === "failed") {
      if (await handleWrOrderFailed(orderId, String(tx.status), db)) reconciled++;
    }
  }
  return reconciled;
}

function wrTransactionStatus(value: unknown): "completed" | "failed" | "processing" | null {
  if (typeof value !== "string") return null;
  const status = value.toLowerCase();
  if (["completed", "success", "done"].includes(status)) return "completed";
  if (["failed", "cancelled", "canceled", "refunded"].includes(status)) return "failed";
  return status === "processing" ? "processing" : null;
}

/**
 * Peringatan umur antrean (2026-09-18). Upstream mengerjakan kelas antrean
 * secara manual (estimasi 6–12 jam) dan TIDAK mengirim apa pun saat lambat;
 * `reconcileStuckWrOrders` juga hanya bertindak bila upstream sudah melaporkan
 * status terminal. Tanpa ini, link yang tetap `processing` 15 jam diam total
 * dan pembeli yang sudah dijanjikan plafon 12 jam tidak ada yang mengurus.
 * Ambangnya sengaja DI ATAS plafon publik supaya notifikasi hanya menyala
 * untuk anomali, bukan untuk setiap order normal (alert fatigue).
 * Idempoten via kolom `aging_alerted_at` (migrasi 0037).
 */
export async function alertAgingWrOrders(database?: DatabaseAccess): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled()) return 0;
  const rows = await db
    .queryAll(
      `SELECT l.id, l.order_code, l.wr_order_id, l.status, l.wr_cost,
              COALESCE(l.request_sent_at, l.updated_at, l.created_at) AS since
       FROM wr_order_links l
       WHERE l.status IN ('processing','submitted','ordering','claimed')
         AND l.aging_alerted_at IS NULL
         AND datetime(COALESCE(l.request_sent_at, l.updated_at, l.created_at))
             <= datetime('now', '-${WR_QUEUED_ALERT_HOURS} hours')
       ORDER BY l.id ASC LIMIT 3`,
    )
    .catch(() => [] as Row[]);
  if (!rows.length) return 0;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  let alerted = 0;
  for (const row of rows) {
    // Tandai LEBIH DULU: kalau notifikasi gagal, lebih baik kehilangan satu
    // ping daripada mengirim ulang tiap 5 menit selamanya.
    const marked = await db
      .execRun(
        `UPDATE wr_order_links SET aging_alerted_at=datetime('now'), updated_at=datetime('now')
         WHERE id=? AND aging_alerted_at IS NULL`,
        Number(row.id),
      )
      .catch(() => ({ changes: 0 as number | undefined }));
    if (Number(marked.changes ?? 0) === 0) continue;
    alerted++;
    if (!chatId || process.env.TELEGRAM_BOT_ENABLED !== "true") continue;
    try {
      const { sendMessage } = await import("@/lib/telegram/api");
      await sendMessage({
        chat_id: chatId,
        text:
          `⏳ <b>Order antrean lewat batas</b> <code>${String(row.order_code)}</code>\n`
          + `Status: ${String(row.status)} · sejak ${String(row.since)}\n`
          + `Upstream: <code>${String(row.wr_order_id || "-")}</code> · modal Rp${Number(row.wr_cost || 0).toLocaleString("id-ID")}\n`
          + `Sudah melewati ${WR_QUEUED_ALERT_HOURS} jam (plafon janji pembeli ${WR_QUEUED_MAX_HOURS} jam). Cek manual sekarang.`,
        parse_mode: "HTML",
      });
    } catch {
      /* penanda sudah tertulis; ping berikutnya tidak diulang */
    }
  }
  return alerted;
}

/**
 * Watchdog sync basi (2026-09-19, anti-macet struktural). Empat insiden sync
 * mati berulang (poison-pill 16 jam, guard veto 2,5 jam, env mati 8 jam,
 * gap misterius ~3 jam) semuanya butuh forensik manual 1–3 jam karena tidak
 * ada yang memberi tahu pemilik. Watchdog ini ping Telegram admin MAKSIMAL
 * 1x per episode basi (3x interval normal = 90 menit) dengan konteks sebab
 * terakhir, lalu diam sampai sweep sukses me-reset-nya.
 * Idempoten via wr_sync_state(sync_stale_alerted_at) — pola yang sama dengan
 * alertAgingWrOrders: tandai DULU, kirim kemudian; ping hilang lebih baik
 * daripada spam tiap 5 menit. Best-effort: Telegram down tak menggagalkan run.
 */
export const WR_SYNC_STALE_ALERT_MINUTES = 90;

export async function alertStaleWrSync(
  lastSyncAt: string | null,
  context: string | null,
  database?: DatabaseAccess,
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled()) return 0;
  if (lastSyncAt == null) return 0;
  const { parseExpiry } = await import("@/lib/expiry");
  const lastTs = parseExpiry(lastSyncAt);
  if (lastTs == null) return 0;
  if (lastTs >= Date.now() - WR_SYNC_STALE_ALERT_MINUTES * 60 * 1000) return 0;
  // Sudah alert untuk kebasian ini? State menyimpan `lastSyncAt` yang sudah
  // dialert — sweep sukses baru (lastSyncAt berubah) me-reset otomatis.
  const prior = await db
    .queryFirst(`SELECT value FROM wr_sync_state WHERE key='sync_stale_alerted_at'`)
    .catch(() => null);
  if (String(prior?.value || "") === String(lastSyncAt)) return 0;
  // Tandai DULU sebelum kirim (anti-spam bila sendMessage gagal). Konteks
  // awal ikut dicatat agar refresh berikutnya tahu sudah/boleh koreksi.
  await db
    .execRun(
      `INSERT INTO wr_sync_state (key, value) VALUES ('sync_stale_alerted_at',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      String(lastSyncAt),
    )
    .catch(() => undefined);
  await db
    .execRun(
      `INSERT INTO wr_sync_state (key, value) VALUES ('sync_stale_alert_context',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      String(context || "pre_phase"),
    )
    .catch(() => undefined);
  const ageMin = Math.max(1, Math.round((Date.now() - lastTs) / 60000));
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId || process.env.TELEGRAM_BOT_ENABLED !== "true") return 1;
  try {
    const { sendMessage } = await import("@/lib/telegram/api");
    await sendMessage({
      chat_id: chatId,
      text:
        `⚠️ <b>Sync Warung Rebahan basi ${ageMin} mnt</b>\n`
        + `Sweep terakhir: <code>${escapeHtml(String(lastSyncAt))}</code>\n`
        + `Sebab terakhir: <code>${escapeHtml(String(context || "-"))}</code>\n`
        + `Cek /api/cron/operations (wr_sync_skipped) atau tekan Force Sync di admin → Warung Rebahan.`,
      parse_mode: "HTML",
    });
  } catch {
    /* penanda sudah tertulis; ping berikutnya tidak diulang */
  }
  return 1;
}

/**
 * Refresh konteks episode basi (pendamping alertStaleWrSync, permanen
 * 2026-09-19 malam, disederhanakan 2026-09-20 pagi). Watchdog utama berjalan
 * di DEPAN handler setiap run dengan konteks seadanya ("pre_phase" bila fase
 * WR tak aktif). Bukti prod 20 Sep 06:32 (ping "Sebab terakhir: -"): blok 3c
 * refresh tak pernah menyala karena fase WR tak aktif di run-run basi —
 * syarat lama (fase WR aktif + skipped presisi) terlalu ketat. Kini refresh
 * menerima konteks apa pun yang non-null KECUALI "pre_phase" sudah tercatat:
 * setiap run yang mengetahui sebab presisi (interval/disabled/deadline/dll,
 * dari fase WR aktif ATAU tembakan manual) boleh mengoreksi 1x per episode.
 * Tanpa refresh ini, satu-satunya ping episode membawa konteks buta.
 * Idempoten: tak ada ping ulang untuk konteks yang sama — murni koreksi.
 */
export async function refreshStaleWrSyncContext(
  lastSyncAt: string,
  context: string | null,
  database?: DatabaseAccess,
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled()) return 0;
  if (!context) return 0;
  const prior = await db
    .queryFirst(`SELECT value FROM wr_sync_state WHERE key='sync_stale_alerted_at'`)
    .catch(() => null);
  if (String(prior?.value || "") !== String(lastSyncAt)) return 0;
  const corrected = await db
    .queryFirst(`SELECT value FROM wr_sync_state WHERE key='sync_stale_alert_context'`)
    .catch(() => null);
  // "pre_phase" bukan konteks presisi — selalu boleh ditimpa oleh sebab nyata.
  // Sebab nyata yang sama tak dikirim ulang.
  if (String(corrected?.value || "") === String(context)) return 0;
  if (String(context) === "pre_phase" && String(corrected?.value || "") !== "") return 0;
  await db
    .execRun(
      `INSERT INTO wr_sync_state (key, value) VALUES ('sync_stale_alert_context',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      String(context),
    )
    .catch(() => undefined);
  // Koreksi "pre_phase" tak perlu ping (bukan informasi baru).
  if (String(context) === "pre_phase") return 1;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId || process.env.TELEGRAM_BOT_ENABLED !== "true") return 1;
  try {
    const { sendMessage } = await import("@/lib/telegram/api");
    await sendMessage({
      chat_id: chatId,
      text:
        `🔍 <b>Konteks sync basi</b> <code>${escapeHtml(String(lastSyncAt))}</code>\n`
        + `Sebab presisi: <code>${escapeHtml(String(context))}</code>\n`
        + `Cek /api/cron/operations atau tekan Force Sync di admin → Warung Rebahan.`,
      parse_mode: "HTML",
    });
  } catch {
    /* konteks sudah tertulis; koreksi tak diulang */
  }
  return 1;
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
         attempt_count=MAX(0, attempt_count-1),
         lease_expires_at=NULL, last_error='stale_claim_recovered',
         updated_at=datetime('now')
       WHERE status='claimed' AND request_sent_at IS NULL
         AND COALESCE(wr_order_id,'')=''
         AND lease_expires_at IS NOT NULL
         AND datetime(lease_expires_at) <= datetime('now')`,
    );
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
