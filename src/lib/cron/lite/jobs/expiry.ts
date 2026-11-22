// src/lib/cron/lite/jobs/expiry.ts — expiry job body (3A-6a, class E:
// pure move, no behavior change).
//
// BEFORE: `runExpiry(db)` lived inline in src/app/api/cron/lite/route.ts.
// AFTER: `run(ctx)` owns the verbatim body; the route dispatches via
// dynamic `await import()` on the expiry branch only. Same DB instance,
// same statement/SQL/bind order, same result keys/order
// (stale_initializing, expired_payments, orphan_ledgers_swept,
// games_items_expired), same QueryBudgetExceeded propagation. All payload
// modules stay behind the original dynamic imports; the shared items parser
// is pure and has no dependencies.

import { QueryBudgetExceeded } from "@/lib/db-access";
import type { LiteContext } from "@/lib/cron/lite/context";
import { parseItems } from "@/lib/orders/items-json";

type StockItem = { product_id: number; variant_id?: number; qty: number };

const EXPIRY_PER_RUN = 30;
const ORPHAN_LEDGER_PER_RUN = 30;

export async function run(ctx: LiteContext): Promise<Record<string, unknown>> {
  const db = ctx.db;

  const { transitionPendingPaymentOrder, transitionPendingOrder } = await import("@/lib/db");
  const { isExpiredIso } = await import("@/lib/expiry");
  const { STALE_INITIALIZING_SQL } = await import("@/lib/payments/stale-initializing");
  let staleInitializing = 0;
  let expired = 0;
  let marketRestocked = false;
  const expiryOpts = { onMarketChanged: () => { marketRestocked = true; } };
  // Ledger yatim (insiden AXV-20261018-AB4D****): order sudah dibatalkan
  // mandiri/admin tetapi payment_transactions tertinggal 'pending' (jalur
  // batal tidak menutup ledger dinamis). Guard transisi expiry mensyaratkan
  // order 'pending', jadi ledger seperti ini no-op selamanya DAN — karena
  // kandidat diurutkan deadline terlama — menyumbat LIMIT teratas setiap
  // tick sehingga pesanan hidup tidak pernah ter-expiry. Tutup yatim lewat
  // deadline menjadi 'expired' TANPA menyentuh stok: stok sudah dilepas
  // saat order dibatalkan, melepasnya lagi = stok dobel.
  const orphanSwept = await db.execRun(
    `UPDATE payment_transactions SET status='expired', last_error=COALESCE(last_error,'orphan_terminal_order'), updated_at=datetime('now')
     WHERE order_code IN (
       SELECT pt.order_code FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code
       WHERE ((pt.status='pending' AND pt.provider IN ('dana','gopay','klikqris')
                 AND julianday(COALESCE(o.expires_at, pt.expires_at)) <= julianday('now'))
              OR (pt.status='initializing' AND pt.provider='sekalipay_gateway' AND pt.provider_payment_id IS NULL AND pt.gateway_checkout_url IS NULL AND pt.gateway_virtual_account IS NULL AND pt.qris_payload IS NULL AND pt.qris_url IS NULL AND pt.direct_url IS NULL AND pt.provider_qris_url IS NULL))
         AND o.status!='pending'
       ORDER BY julianday(COALESCE(o.expires_at, pt.expires_at)) ASC LIMIT ?
     )`,
    ORPHAN_LEDGER_PER_RUN,
  ).then(r => Number(r.changes || 0)).catch(() => 0);
  // nowpayments initializing-with-known-id excluded: real provider charge
  // interrupted mid-finalize stays reconcilable (W1 finalize_failed path);
  // blind cancel at 5m would strand it. Unknown-id rows still fail fast.
  const stale = await db.queryAll(
    `SELECT pt.order_code, o.items FROM payment_transactions pt
       JOIN orders o ON o.code=pt.order_code
      WHERE ${STALE_INITIALIZING_SQL} AND o.status='pending'
      LIMIT ?`,
    EXPIRY_PER_RUN,
  );
  for (const tx of stale) {
    const changed = await transitionPendingPaymentOrder({
      orderCode: String(tx.order_code), expectedTransactionStatus: "initializing",
      staleInitializingOnly: true,
      transactionStatus: "failed", orderStatus: "dibatalkan", paymentStatus: "failed",
      items: parseItems<StockItem>(tx.items), lastError: "stale_initializing",
    }, db.d1, expiryOpts).catch(() => false);
    if (changed) staleInitializing++;
  }
  // QRIS dinamis + nowpayments: cabang provider lain mengirim pesan
  // Telegram dan tetap ditangani route besar. Filter o.status='pending'
  // memastikan hanya pesanan hidup yang melepas stok di sini; ledger yatim
  // sudah ditangani sapuan di atas. Ceiling 15m order tetap (ambiguous
  // crypto => manual review via reconcile, tanpa POST ulang di sini).
  const candidates = await db.queryAll(
    `SELECT pt.order_code, COALESCE(o.expires_at, pt.expires_at) AS expires_at, o.items
       FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code
      WHERE pt.status='pending' AND pt.provider IN ('dana','gopay','klikqris','nowpayments')
        AND o.status='pending'
        AND julianday(COALESCE(o.expires_at, pt.expires_at)) <= julianday('now')
      ORDER BY julianday(COALESCE(o.expires_at, pt.expires_at)) ASC
      LIMIT ?`,
    EXPIRY_PER_RUN,
  );
  for (const tx of candidates) {
    if (!isExpiredIso(tx.expires_at)) continue;
    const changed = await transitionPendingPaymentOrder({
      orderCode: String(tx.order_code), expectedTransactionStatus: "pending",
      transactionStatus: "expired", expiredOnly: true, orderStatus: "kadaluarsa",
      paymentStatus: "expired", items: parseItems<StockItem>(tx.items),
    }, db.d1, expiryOpts).catch(() => false);
    if (changed) expired++;
  }
  const gatewayExpired = await db.queryAll(
    `SELECT pt.order_code, pt.status AS tx_status, pt.provider_payment_id, pt.last_error, o.expires_at AS order_expires_at, o.items,
            (pt.gateway_checkout_url IS NULL AND pt.gateway_virtual_account IS NULL AND pt.qris_payload IS NULL AND pt.qris_url IS NULL AND pt.direct_url IS NULL AND pt.provider_qris_url IS NULL) AS no_instructions
     FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code
     WHERE pt.provider='sekalipay_gateway'
       AND pt.status IN ('initializing','pending','expired','failed')
       AND o.status='pending' AND julianday(o.expires_at)<=julianday('now')
     LIMIT ?`,
    EXPIRY_PER_RUN,
  );
  for (const tx of gatewayExpired) {
    try {
      if (!isExpiredIso(tx.order_expires_at)) continue;
      if (tx.tx_status === "initializing" && !tx.provider_payment_id && Number(tx.no_instructions) === 1) {
        const changed = await transitionPendingPaymentOrder({
          orderCode: String(tx.order_code),
          expectedTransactionStatus: "initializing",
          transactionStatus: "expired",
          orderStatus: "kadaluarsa",
          paymentStatus: "expired",
          items: parseItems<StockItem>(tx.items),
          lastError: tx.last_error ? String(tx.last_error) : "gateway_expired",
        }, db.d1, expiryOpts);
        if (changed) expired++;
      } else {
        await transitionPendingOrder(String(tx.order_code), "kadaluarsa", "gateway_expired", parseItems<StockItem>(tx.items), db.d1, expiryOpts);
        expired++;
      }
    } catch (error) { if (error instanceof QueryBudgetExceeded) throw error; }
  }
  // AXVARA Games (docs/GAMES.md §12): order belum bayar lewat deadline →
  // order kadaluarsa + item expired, tanpa restock Market.
  let gamesItemsExpired = 0;
  try {
    const { expireGamesCheckouts } = await import("@/lib/games/expire");
    gamesItemsExpired = await expireGamesCheckouts(db);
  } catch (error) { if (error instanceof QueryBudgetExceeded) throw error; }
  if (marketRestocked && db.canSpend(1)) {
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("market", db, { metered: true });
  }
  return { stale_initializing: staleInitializing, expired_payments: expired, orphan_ledgers_swept: orphanSwept, games_items_expired: gamesItemsExpired };
}
