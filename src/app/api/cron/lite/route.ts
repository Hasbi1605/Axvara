// POST /api/cron/lite?job=payments|expiry|fulfillment|wr_orders|sk_orders|pedia_orders|promo|notify_a|notify_b|notify|cleanup|games_catalog|games_orders — langkah
// cron INTI yang dipisah dari route raksasa `/api/cron/operations` (2026-10-05).
//
// Latar: Workers Free ~10 ms CPU per request. Malam 4→5 Okt 10–20% request
// `/api/cron/operations` per jam dibunuh `exceededResources` — termasuk fase
// ringan (expiry) — karena biaya MENYALAKAN route itu (impor statis Telegram,
// WhatsApp, QRIS, fulfillment, …) sudah ±7–10 ms. `/api/supplier-sync` yang
// ramping tidak pernah kena. Route ini meniru polanya: impor minimal, satu
// pekerjaan per request, modul dimuat dinamis HANYA untuk job yang diminta.
//
// 2026-10-09: `notify` dipecah jadi `notify_a` (retry kabar order Telegram +
// invoice tertunda) dan `notify_b` (kabar QRIS kedaluwarsa + pengingat order
// pending + outbox WhatsApp). Latar: 09:50 WIB 4 langkah lite 503 bareng;
// `notify` satu-satunya job yang mengipas 5 sub-kerjaan (5 dynamic import)
// dalam 1 request (~1,9 dtk antrean kosong). `job=notify` LAMA tetap hidup
// sebagai alias gabungan A→B (kompat pemanggil lama + heavy tick) — Worker
// memanggil a/b terpisah agar tiap request lebih ringan.
//
// Cakupan sengaja inti (yang menyentuh pembeli); sisanya tetap di route besar
// yang masih dipanggil Worker sebagai pelengkap (idempoten — klaim atomik/
// lease/transisi bersyarat mencegah kerja ganda):
//   payments    — maksimal4 invoice KlikQRIS aktif due + 4 NOWPayments
//                 (incl. known-id initializing), GET status saja
//   expiry      — initializing basi + invoice DANA/GoPay/KlikQRIS lewat deadline
//   fulfillment — lepas lock basi + proses job kirim yang jatuh tempo
//   wr_orders   — pulihkan klaim/saldo, SEMBUHKAN link yatim lunas-tanpa-link
//                 TANPA gate due (2026-10-09), retry, teruskan order lunas,
//                 segarkan status supplier berjalan (2026-10-13), reconcile
//                 macet, kirim kredensial
//   sk_orders   — pola yang sama untuk Sekalipay (termasuk probe yatim)
//   pedia_orders — dispatch + poll order Pedia ke IndoSMM (PD-30–33);
//                 saldo dicek maks 1×/30 mnt (hemat statement)
//   games_orders — AXVARA Games: promosi lunas → queued, dispatch Digiflazz,
//                 pemulihan lease basi, polling dengan ref_id sama (GAMES §12.3)
//   promo       — Daily Promo Digest 09.00/17.00 WIB (guard murah; ledger
//                 `telegram_promo_digests` mencegah kirim ganda dengan notify)
//   notify_a    — retry kabar order Telegram + invoice tertunda (separuh notify)
//   notify_b    — kabar QRIS kedaluwarsa + pengingat pending + outbox WA
//   notify      — alias gabungan notify_a lalu notify_b (kompat lama)
// Kontrak: header `authorization: Bearer <CRON_SECRET>`; 200 {ok,job,...};
// 400 job tak dikenal; 401 secret salah. Worker: `mcp-worker/src/cron.ts`.

import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/security";
import { createBudgetedDatabase, QueryBudgetExceeded, type DatabaseAccess } from "@/lib/db-access";

export const runtime = "edge";

const LITE_JOBS = ["payments", "expiry", "fulfillment", "wr_orders", "sk_orders", "tunvn_orders", "tunvn_catalog", "aivault_orders", "aivault_catalog", "jaspay_catalog", "pedia_orders", "promo", "notify", "notify_a", "notify_b", "cleanup", "games_catalog", "games_orders"] as const;
type LiteJob = (typeof LITE_JOBS)[number];
const EXPIRY_PER_RUN = 10;
const ORPHAN_LEDGER_PER_RUN = 10;
const FULFILLMENT_PER_RUN = 4;
/** Plafon produk Jaspay per tick; budget 96 yang benar-benar membatasi. */
const JASPAY_PRODUCTS_PER_TICK = 10;

type Items = { product_id: number; variant_id?: number; qty: number }[];
const parseItems = (raw: unknown): Items => {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export async function POST(request: NextRequest) {
  const deadline = Date.now() + 45_000;
  const secret = process.env.CRON_SECRET;
  if (!secret || !constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const job = request.nextUrl.searchParams.get("job") as LiteJob | null;
  if (!job || !LITE_JOBS.includes(job)) return NextResponse.json({ error: "invalid_job" }, { status: 400 });

  // Paid: fulfillment mendapat96 statement untuk beberapa unit; Jaspay96
  // (owner 16 Nov 2026: beberapa produk/tick, siklus penuh ±3 menit); job lain40.
  const db = createBudgetedDatabase(job === "fulfillment" || job === "jaspay_catalog" ? 96 : 40).access;
  const result: Record<string, unknown> = { ok: true, job };
  const failedCore: string[] = [];
  try {
    if (job === "payments") {
      // Bounded: KlikQRIS (limit 4, shared 40-budget) + NOWPayments (limit 4,
      // shared budget/CAS, incl. known-id initializing for manual review)
      // + late known-id (limit 4, 6h recheck, no revive/fulfill).
      // NOWPayments passes read key only => run saved-invoice flag-off (key
      // present => readable; key absent => passes quietly return zeros).
      const { reconcileDueKlikQrisPayments } = await import("@/lib/payments/klikqris-reconcile");
      Object.assign(result, await reconcileDueKlikQrisPayments(db));
      try {
        const { reconcileDueNowpaymentsPayments, reconcileLateKnownNowpaymentsPayments } = await import("@/lib/payments/payment-view");
        const now = await reconcileDueNowpaymentsPayments(db);
        (result as Record<string, unknown>).nowpayments_checked = now.payments_checked;
        (result as Record<string, unknown>).nowpayments_confirmed = now.payments_confirmed;
        (result as Record<string, unknown>).nowpayments_manual_review = now.manual_review;
        (result as Record<string, unknown>).payments_checked =
          Number(result.payments_checked ?? 0) + now.payments_checked;
        (result as Record<string, unknown>).payments_confirmed =
          Number(result.payments_confirmed ?? 0) + now.payments_confirmed;
        (result as Record<string, unknown>).payments_failed =
          Number(result.payments_failed ?? 0) + now.payments_failed;
        if (db.canSpend(6)) {
          const late = await reconcileLateKnownNowpaymentsPayments(db);
          (result as Record<string, unknown>).nowpayments_late_checked = late.late_checked;
          (result as Record<string, unknown>).nowpayments_late_manual_review = late.late_manual_review;
        }
      } catch (error) {
        if (error instanceof QueryBudgetExceeded) throw error;
        (result as Record<string, unknown>).nowpayments_error = "pass_failed";
        failedCore.push("nowpayments");
      }
      if (db.canSpend(6)) {
        try {
          const { reconcileDueSekalipayGatewayPayments } = await import("@/lib/payments/payment-view");
          Object.assign(result, await reconcileDueSekalipayGatewayPayments(db));
        } catch (error) {
          if (error instanceof QueryBudgetExceeded) throw error;
          result.gateway_error = "pass_failed";
          failedCore.push("sekalipay_gateway");
        }
      }
      if (db.canSpend(4)) {
        try {
          const { reconcileStaleSekalipayGatewayPayments } = await import("@/lib/payments/sekalipay-gateway");
          Object.assign(result, await reconcileStaleSekalipayGatewayPayments(db));
        } catch (error) {
          if (error instanceof QueryBudgetExceeded) throw error;
          result.gateway_stale_error = "pass_failed";
          failedCore.push("sekalipay_gateway_stale");
        }
      }
      if (Number(result.payments_failed) > 0 || failedCore.length > 0) {
        return NextResponse.json(
          { ...result, ok: false, ...(failedCore.length ? { failed_subjobs: failedCore } : {}) },
          { status: 503 },
        );
      }
    }
    else if (job === "expiry") Object.assign(result, await runExpiry(db));
    else if (job === "fulfillment") Object.assign(result, await runFulfillment(db));
    else if (job === "wr_orders") Object.assign(result, await runWrOrders(db));
    else if (job === "sk_orders") Object.assign(result, await runSkOrders(db));
    else if (job === "aivault_orders") Object.assign(result, await runAivaultOrders(db));
    else if (job === "aivault_catalog") {
      const { isAivaultConfigured,isAivaultSyncEnabled }=await import("@/lib/aivault/client");
      if (!isAivaultConfigured() || !isAivaultSyncEnabled()) result.skipped="not_configured";
      else {
        const { loadCurrentFxSnapshot }=await import("@/lib/payments/market-snapshot");
        const { parseRateRational }=await import("@/lib/payments/fx");
        const fx=await loadCurrentFxSnapshot(db.d1), rate=fx ? parseRateRational(fx.rateText) : null;
        if (!rate) {
          const { recordSyncError } = await import("@/lib/sync-status");
          await recordSyncError(db, "aivault_catalog", "fx_unavailable");
          return NextResponse.json({...result,ok:false,error:"fx_unavailable"},{status:503});
        }
        const { publishAivaultCatalog }=await import("@/lib/aivault/catalog");
        const synced=await publishAivaultCatalog(db,Number(rate.num)/Number(rate.den),{force:false});
        Object.assign(result,synced);
        if ("ok" in synced && !synced.ok) return NextResponse.json(result,{status:503});
        if ("ok" in synced && synced.ok) await drainDirtyGroupsIfBudget(db, result);
      }
    }
    else if (job === "tunvn_orders") Object.assign(result, await runTunvnOrders(db));
    else if (job === "tunvn_catalog") {
      const { isTunvnSyncEnabled, isTunvnConfigured } = await import("@/lib/tunvn/client");
      if (!isTunvnSyncEnabled() || !isTunvnConfigured()) result.skipped = "not_configured";
      else {
        const { loadCurrentFxSnapshot } = await import("@/lib/payments/market-snapshot");
        const { parseRateRational } = await import("@/lib/payments/fx");
        const fx = await loadCurrentFxSnapshot(db.d1);
        const rate = fx ? parseRateRational(fx.rateText) : null;
        if (!rate) {
          const { recordSyncError } = await import("@/lib/sync-status");
          await recordSyncError(db, "tunvn_catalog", "fx_unavailable");
          return NextResponse.json({ ...result, ok: false, error: "fx_unavailable" }, { status: 503 });
        }
        const { publishTunvnCatalog } = await import("@/lib/tunvn/catalog");
        const synced = await publishTunvnCatalog(db, Number(rate.num) / Number(rate.den), { force: false });
        Object.assign(result, synced);
        if ("ok" in synced && !synced.ok) return NextResponse.json(result, { status: 503 });
        if ("ok" in synced && synced.ok) await drainDirtyGroupsIfBudget(db, result);
      }
    }
    else if (job === "jaspay_catalog") {
      const { syncJaspayCatalog } = await import("@/lib/warung-rebahan/sync");
      const synced = await syncJaspayCatalog(db, undefined, { maxProducts: JASPAY_PRODUCTS_PER_TICK });
      Object.assign(result, synced);
      if (synced.errors.length && !synced.errors.includes("warung_rebahan_disabled")) {
        return NextResponse.json({ ...result, ok: false }, { status: 503 });
      }
      if (!synced.errors.length) await drainDirtyGroupsIfBudget(db, result);
    }
    else if (job === "pedia_orders") Object.assign(result, await runPediaOrders(db, failedCore));
    else if (job === "notify_a") Object.assign(result, await runNotifyA(db, failedCore));
    else if (job === "notify_b") Object.assign(result, await runNotifyB(db, deadline, failedCore));
    else if (job === "notify") Object.assign(result, await runNotify(db, deadline, failedCore));
    else if (job === "cleanup") Object.assign(result, await runCleanup(db));
    else if (job === "games_catalog") {
      // docs/GAMES.md §12.5: katalog baru = Sekalipay Game; Digiflazz tidak lagi
      // dipanggil untuk price-list. Throttle/no-op ada di dalam sync.
      const { syncGamesSkCatalog } = await import("@/lib/games/sk-catalog-sync");
      const synced = await syncGamesSkCatalog(db);
      Object.assign(result, synced);
      if ("ok" in synced && synced.ok === false) return NextResponse.json({ ...result, ok: false }, { status: 503 });
    }
    else if (job === "games_orders") {
      // docs/GAMES.md §12.3: promosi lunas, dispatch supplier per item (SK baru,
      // Digiflazz legacy), pemulihan lease, polling. Budget 40 tetap dipakai.
      const { processGamesPaidOrders } = await import("@/lib/games/dispatch");
      const ran = await processGamesPaidOrders(undefined, db);
      Object.assign(result, ran);
      if (ran.error) return NextResponse.json({ ...result, ok: false }, { status: 503 });
    }
    else Object.assign(result, await runPromo(db));
  } catch (error) {
    // Budget habis = sisa kerja dilanjutkan tick berikut, bukan kegagalan.
    if (!(error instanceof QueryBudgetExceeded)) {
      return NextResponse.json({ ok: false, job, error: error instanceof Error ? error.message.slice(0, 160) : "failed" }, { status: 500 });
    }
    result.budget_exhausted = true;
  }
  if (failedCore.length > 0) {
    return NextResponse.json({ ...result, ok: false, failed_subjobs: failedCore }, { status: 503 });
  }
  try {
    await db.execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES (?, datetime('now'), datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=datetime('now'), updated_at=datetime('now')`,
      `cron_lite_${job}_ok_at`,
    );
  } catch { /* penanda best-effort */ }
  return NextResponse.json(result);
}

type Db = DatabaseAccess;

async function drainDirtyGroupsIfBudget(db: Db, result: Record<string, unknown>) {
  if (!db.canSpend(4)) return;
  try {
    const { decideDirtyWinners } = await import("@/lib/supplier-pairs");
    const pairs = await decideDirtyWinners(db);
    result.pairs_decided = pairs.decided;
    result.pairs_changed = pairs.changed;
  } catch (error) {
    if (error instanceof QueryBudgetExceeded) throw error;
  }
}

async function runExpiry(db: Db) {
  const { transitionPendingPaymentOrder, transitionPendingOrder } = await import("@/lib/db");
  const { isExpiredIso } = await import("@/lib/expiry");
  let staleInitializing = 0;
  let expired = 0;
  // Ledger yatim (insiden AXV-20261018-AB4D407F): order sudah dibatalkan
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
      WHERE pt.status='initializing' AND pt.created_at < datetime('now', '-5 minutes')
        AND NOT (pt.provider='nowpayments' AND pt.provider_payment_id IS NOT NULL)
        AND pt.provider!='sekalipay_gateway'
      LIMIT ?`,
    EXPIRY_PER_RUN,
  );
  for (const tx of stale) {
    const changed = await transitionPendingPaymentOrder({
      orderCode: String(tx.order_code), expectedTransactionStatus: "initializing",
      transactionStatus: "failed", orderStatus: "dibatalkan", paymentStatus: "failed",
      items: parseItems(tx.items), lastError: "stale_initializing",
    }, db.d1).catch(() => false);
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
      paymentStatus: "expired", items: parseItems(tx.items),
    }, db.d1).catch(() => false);
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
          items: parseItems(tx.items),
          lastError: tx.last_error ? String(tx.last_error) : "gateway_expired",
        }, db.d1);
        if (changed) expired++;
      } else {
        await transitionPendingOrder(String(tx.order_code), "kadaluarsa", "gateway_expired", parseItems(tx.items), db.d1);
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
  return { stale_initializing: staleInitializing, expired_payments: expired, orphan_ledgers_swept: orphanSwept, games_items_expired: gamesItemsExpired };
}

async function runFulfillment(db: Db) {
  if (process.env.AUTO_FULFILLMENT_ENABLED !== "true") return { skipped: "auto_fulfillment_disabled" };
  const { getDueJobs, processJobItems, releaseStaleJobs } = await import("@/lib/fulfillment/deliver");
  const released = await releaseStaleJobs(db).catch(() => 0);
  const jobs = await getDueJobs(FULFILLMENT_PER_RUN, db);
  let processed = 0;
  for (const job of jobs) {
    const order = await db.queryFirst(`SELECT * FROM orders WHERE code=?`, String(job.order_code));
    if (!order) continue;
    try {
      const unit = await processJobItems(Number(job.id), order, {}, 4, undefined, db);
      if (unit.done || unit.attempted > 0) processed++;
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
    }
  }
  return { stale_locks_released: released, due_jobs_processed: processed };
}

async function runWrOrders(db: Db) {
  const { isWrEnabled } = await import("@/lib/warung-rebahan/client");
  if (!isWrEnabled()) return { skipped: "disabled" };
  const order = await import("@/lib/warung-rebahan/order");
  const out: Record<string, unknown> = {};
  await order.recoverStaleClaims(db).catch(() => 0);
  await order.reconcileBlockedBalance(db).catch(() => 0);
  if (process.env.WARUNG_REBAHAN_AUTO_ORDER_ENABLED === "true") {
    // 2026-10-09 (kasus AXV-20261009-DA1ACF56): link WR tidak pernah dibuat
    // webhook + COUNT due = 0 → `processWrPendingOrders` tidak dipanggil →
    // `reconcileMissingWrLinks` di dalamnya tidak pernah jalan → yatim
    // selamanya. Probe yatim WAJIB jalan duluan tanpa gate due (murah: 1
    // SELECT indeks lunas + INSERT OR IGNORE idempoten), hasilnya ikut
    // menentukan gate proses di bawah.
    const orphanHealed = await order.reconcileMissingWrLinks(db).catch(() => ({ orders: 0, links: 0 }));
    if (orphanHealed.links > 0) out.orphan_links_healed = orphanHealed.links;
    const due = await db.queryFirst(
      `SELECT COUNT(*) AS n FROM wr_order_links
        WHERE status IN ('pending','retry') AND attempt_count < max_attempts
          AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))`,
    ).catch(() => null);
    // Link yatim yang baru dibuat SELALU due (next_attempt_at=now), tapi gate
    // ikut dibuka eksplisit agar tak bergantung pada asumsi itu + hemat 1
    // COUNT berikutnya bila tick ini hanya menyembuhkan.
    if (Number(due?.n ?? 0) > 0 || orphanHealed.links > 0) {
      out.retried = await order.retryFailedWrOrders(db);
      // skipOrphanProbe: probe di atas sudah jalan — probe ganda ikut
      // menghabiskan budget sebelum SELECT antrean (insiden 2026-10-10).
      const processed = await order.processWrPendingOrders(db, { skipOrphanProbe: true });
      out.processed = processed.processed;
      out.succeeded = processed.succeeded;
      if (processed.blocked) out.blocked = processed.blocked;
    }
    // Penjamin status segar bersama (2026-10-13): tarik status vendor untuk
    // link yang masih berjalan (berbagi jatah dengan job sk_orders) agar WR
    // secepat SK terasa tanpa menunggu route besar per jam. Gerbang
    // 20 dtk/order di store_settings menjaga biaya tetap; vendor dibaca
    // sekali per tarikan.
    try {
      const { refreshDueSupplierOrders } = await import("@/lib/orders/supplier-refresh");
      const fresh = await refreshDueSupplierOrders(db, { limit: 4 });
      if (fresh.refreshed > 0) out.supplier_refreshed = fresh.refreshed;
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
    }
    // 2 menit, bukan 1 jam (2026-10-10): webhook WR yang hilang/terputus
    // tidak lagi menahan kredensial varian instan sampai route besar jalan.
    out.reconciled = await order.reconcileStuckWrOrders(db, { minAgeMinutes: 2 }).catch((error) => {
      if (error instanceof QueryBudgetExceeded) throw error;
      return 0;
    });
    // WR3 Jaspay (bounded, di job wr_orders yang sama — bukan cron baru):
    // link Jaspay ambigu => exact-ref identik / poll invoice dikenal.
    // Premium tak tersentuh; budget40/lease existing tetap.
    try {
      const healed = await order.reconcileJaspayAmbiguous(db, 4);
      if (healed.exactRef > 0) out.jaspay_exact_ref = healed.exactRef;
      if (healed.polled > 0) out.jaspay_polled = healed.polled;
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
    }
  }
  const { processDueCredentialDeliveries, requeueOrphanCredentialDeliveries } = await import("@/lib/warung-rebahan/deliver");
  // Kredensial completed yang tidak pernah diantrekan (completion terputus).
  const requeued = await requeueOrphanCredentialDeliveries(db);
  if (requeued > 0) out.credentials_requeued = requeued;
  const delivery = await processDueCredentialDeliveries(db);
  out.credentials_delivered = delivery.delivered;
  return out;
}

async function runSkOrders(db: Db) {
  const { isSkEnabled } = await import("@/lib/sekalipay/client");
  if (!isSkEnabled()) return { skipped: "disabled" };
  const order = await import("@/lib/sekalipay/order");
  const out: Record<string, unknown> = {};
  await order.recoverStaleSkClaims(db).catch(() => 0);
  await order.reconcileBlockedSkBalance(db).catch(() => 0);
  if (process.env.SEKALIPAY_AUTO_ORDER_ENABLED === "true") {
    // Existing due purchases get first use of the budget. Probe orphans once,
    // independently of queue size. If no buys ran, dispatch healed links now;
    // otherwise leave them due for the next tick (at most four buys per run).
    // 2026-10-19: the old double probe used 35/38 statements before buying SK.
    const processed = await order.processSkPendingOrders(db, { skipOrphanProbe: true });
    out.processed = processed.processed;
    out.succeeded = processed.succeeded;
    const orphanHealed = await order.reconcileMissingSkLinks(db).catch((error) => {
      if (error instanceof QueryBudgetExceeded) throw error;
      return { orders: 0, links: 0 };
    });
    if (orphanHealed.links > 0) out.orphan_links_healed = orphanHealed.links;
    if (orphanHealed.links > 0 && processed.processed === 0) {
      const healed = await order.processSkPendingOrders(db, { skipOrphanProbe: true });
      out.processed = processed.processed + healed.processed;
      out.succeeded = processed.succeeded + healed.succeeded;
    }
    // Penjamin status segar bersama (cermin WR di atas): SK yang webhook-nya
    // terlambat ikut tertarik di sini, bukan hanya di route besar.
    try {
      const { refreshDueSupplierOrders } = await import("@/lib/orders/supplier-refresh");
      const fresh = await refreshDueSupplierOrders(db, { limit: 4 });
      if (fresh.refreshed > 0) out.supplier_refreshed = fresh.refreshed;
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
    }
    out.reconciled = await order.reconcileStuckSkOrders(db).catch(() => 0);
  }
  return out;
}

async function runSupplierBalanceCheck(
  db: Db,
  out: Record<string, unknown>,
  prefix: "tunvn" | "aivault",
  loadAndCheck: () => Promise<{ checked: boolean; balance?: number; alerted?: boolean; error?: string }>,
) {
  if (!db.canSpend(5)) return;
  try {
    const bal = await loadAndCheck();
    if (!bal.checked) return;
    if (bal.balance !== undefined) out[`${prefix}_balance`] = bal.balance;
    if (bal.alerted !== undefined) out[`${prefix}_balance_alerted`] = bal.alerted;
    if (bal.error !== undefined) out[`${prefix}_balance_error`] = bal.error;
  } catch (error) {
    if (error instanceof QueryBudgetExceeded) throw error;
    out[`${prefix}_balance_error`] = "balance_failed";
  }
}

async function runTunvnOrders(db: Db) {
  const { processTunvnOrders } = await import("@/lib/tunvn/orders");
  const out: Record<string, unknown> = {
    tunvn_orders_processed: await processTunvnOrders(db),
  };
  await runSupplierBalanceCheck(db, out, "tunvn", async () => {
    const { checkTunvnLowBalance } = await import("@/lib/supplier-balance-alert");
    return checkTunvnLowBalance(db);
  });
  return out;
}

async function runAivaultOrders(db: Db) {
  const { processAivaultOrders } = await import("@/lib/aivault/orders");
  const out: Record<string, unknown> = {
    aivault_orders_processed: await processAivaultOrders(db),
  };
  await runSupplierBalanceCheck(db, out, "aivault", async () => {
    const { checkAivaultLowBalance } = await import("@/lib/supplier-balance-alert");
    return checkAivaultLowBalance(db);
  });
  return out;
}

// pedia_orders (PEDIA M4, PD-30–33): dispatch + poll + alert saldo.
// Budget: klaim atomik + ≤20 item + poll ≤20 + saldo 1×/30mnt + penanda.
// Saldo dicek via proxy /indosmm/balance; bila < ambang (env
// PEDIA_BALANCE_ALERT_RP) → ping admin dengan throttle 1:1 WR/SK (6 jam ATAU
// turun Rp5.000 — `notifyPediaLowBalance`, kunci store_settings
// pedia_indosmm_balance_alert_at format `amount|ms`).
async function runPediaOrders(db: Db, failedCore: string[]) {
  const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
  const out: Record<string, unknown> = {};
  try {
    // Teruskan budgeted access: statement dispatch+poll ikut budget 40
    // (dulu koneksi sendiri → tak terhitung, rawan jebol diam-diam).
    const r = await processPediaPaidOrders(undefined, db);
    Object.assign(out, r);
  } catch (error) {
    if (error instanceof QueryBudgetExceeded) throw error;
    out.dispatch_error = error instanceof Error ? error.message.slice(0, 80) : "failed";
    failedCore.push("dispatch");
  }
  // 2026-11-13 (owner): IndoSMM satu-satunya supplier. Independent checkpoint
  // and currency gate: do not convert undocumented USD account balances.
  if (db.canSpend(5)) {
    try {
      const key = "pedia_indosmm_balance_checked_at";
      const last = await db.queryFirst(`SELECT value FROM store_settings WHERE key=?`, key);
      const { parseExpiry } = await import("@/lib/expiry");
      const ms = parseExpiry(String(last?.value ?? ""));
      if (ms === null || Date.now() - ms > 30 * 60 * 1000) {
        const nowMs = Date.now();
        await db.execRun(`INSERT INTO store_settings (key,value,updated_at) VALUES (?,datetime('now'),datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`, key);
        const { callPediaProxy } = await import("@/lib/pedia/proxy");
        const res = await callPediaProxy<{ balance?: string | number; currency?: string }>("indosmm", "balance", {}, 15_000);
        const v = res.ok ? Number(res.data.balance) : NaN;
        if (res.ok && res.data.currency?.toUpperCase() === "IDR" && Number.isFinite(v) && v >= 0) {
          out.indosmm_balance = v;
          await db.execRun(`INSERT INTO pedia_supplier_balance_log (supplier,balance) VALUES ('indosmm',?)`, v);
          if (db.canSpend(1)) {
            const { recordSyncSuccess } = await import("@/lib/sync-status");
            await recordSyncSuccess(db, "pedia_indosmm_balance", nowMs);
          }
          const { pediaBalanceAlertRp } = await import("@/lib/pedia/ops-config");
          if (v < pediaBalanceAlertRp()) {
            const { notifyPediaLowBalance } = await import("@/lib/pedia/notify");
            out.indosmm_balance_alerted = await notifyPediaLowBalance(v, db, "indosmm");
          }
        } else {
          const err = res.ok ? "unsupported_currency_or_balance" : res.kind;
          out.indosmm_balance_error = err;
          const { recordSyncError } = await import("@/lib/sync-status");
          await recordSyncError(db, "pedia_indosmm_balance", err, nowMs);
        }
      }
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      out.indosmm_balance_error = "balance_failed";
      const { recordSyncError } = await import("@/lib/sync-status");
      await recordSyncError(db, "pedia_indosmm_balance", error);
    }
  }
  // 2026-11-01: kesehatan layanan IndoSMM 7 hari (maks 1×/jam, 3 statement).
  if (db.canSpend(3)) {
    try {
      const { refreshPediaServiceStats } = await import("@/lib/pedia/service-stats");
      out.pedia_stats = await refreshPediaServiceStats(db);
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      out.pedia_stats = "failed";
    }
  }
  return out;
}

async function runPromo(db: Db) {
  const started = Date.now();
  const { sendDueAdminPromoDigest } = await import("@/lib/telegram/promo-digest");
  const promo = await sendDueAdminPromoDigest(db);
  let daily_summary: Record<string, unknown> = {};
  if (db.canSpend(1)) {
    try {
      const { sendDueDailyAdminSummary } = await import("@/lib/telegram/daily-admin-summary");
      const summary = await sendDueDailyAdminSummary(db);
      daily_summary = {
        due: summary.due,
        sent: summary.sent,
        ...(summary.skipped ? { skipped: summary.skipped } : {}),
        ...(summary.date ? { date: summary.date } : {}),
      };
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      daily_summary = { due: false, sent: false, error: "summary_failed" };
    }
  }
  const { processBroadcasts } = await import("@/lib/broadcasts/worker");
  const broadcasts = db.canSpend(8) ? await processBroadcasts(db, 8, Math.min(20000, Math.max(0, 40000 - (Date.now() - started)))) : null;
  return { broadcasts, promo_due: promo.due, promo_full_sent: promo.fullSent, promo_short_sent: promo.shortSent, promo_skipped: promo.skipped ?? null, daily_summary };
}

// notify (2026-10-05 malam, dipecah 2026-10-09): retry kabar order Telegram,
// invoice tertunda, kabar QRIS kedaluwarsa, pengingat order pending, outbox
// WhatsApp. Tiap pekerjaan berdiri sendiri (satu gagal tidak menghentikan
// yang lain) dan masing-masing memilih kandidatnya sendiri dengan klaim
// idempoten.
//
// Pecahan (2026-10-09): `notify_a` = telegram_retry + invoice_retry (2 import);
// `notify_b` = qris_expiry + reminders + whatsapp_outbox (3 import). `notify`
// = alias gabungan A lalu B. Hasil digabung dengan kunci yang sama sehingga
// pemantau lama (alarm Worker, dashboard) tidak berubah bentuk respons.
async function runNotifyA(db: Db, failedCore: string[]) {
  const out: Record<string, unknown> = {};
  const guard = async (key: string, fn: () => Promise<unknown>, core = false) => {
    try { out[key] = await fn(); } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      out[`${key}_error`] = error instanceof Error ? error.message.slice(0, 80) : "failed";
      if (core) failedCore.push(key);
    }
  };
  await guard("telegram_retry", async () => {
    const { retryPendingTelegramNotifications } = await import("@/lib/telegram/order-notifications");
    return retryPendingTelegramNotifications(4, undefined, db);
  }, true);
  await guard("invoice_retry", async () => {
    const { retryInvoicePendingTelegramInvoices } = await import("@/lib/telegram/invoice-retry");
    return retryInvoicePendingTelegramInvoices(2, db);
  });
  return out;
}

async function runNotifyB(db: Db, deadline: number, failedCore: string[]) {
  const out: Record<string, unknown> = {};
  const guard = async (key: string, fn: () => Promise<unknown>, core = false) => {
    try { out[key] = await fn(); } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      out[`${key}_error`] = error instanceof Error ? error.message.slice(0, 80) : "failed";
      if (core) failedCore.push(key);
    }
  };
  await guard("whatsapp_promo", async () => {
    const { enqueueWhatsAppPromo } = await import("@/lib/whatsapp/promo-digest");
    return enqueueWhatsAppPromo(db);
  });
  await guard("whatsapp_promo_bot", async () => {
    const { enqueueWhatsAppPromoBot } = await import("@/lib/whatsapp/promo-bot");
    return enqueueWhatsAppPromoBot(db);
  });
  await guard("qris_expiry_notices", async () => {
    const { sendQrisExpiryNotifications } = await import("@/lib/payments/qris-expiry-notifications");
    return sendQrisExpiryNotifications(2, db);
  });
  await guard("pending_reminders", async () => {
    const { sendPendingOrderReminders } = await import("@/lib/telegram/order-notifications");
    return sendPendingOrderReminders(4, db);
  });
  await guard("whatsapp_outbox", async () => {
    const { processDueWhatsAppOutbox } = await import("@/lib/whatsapp/outbox");
    return processDueWhatsAppOutbox(4, db);
  }, true);
  // Sapu bounded antrean PIN checkout (maks 2/tick) bila budget/waktu
  // tersisa; tanpa job/cron/env/budget baru.
  await guard("checkout_pin_emails", async () => {
    if (!db.canSpend(10)) return { skipped: "query_budget" };
    const { processCredentialAccessEmails } = await import("@/lib/orders/access-email");
    return processCredentialAccessEmails(db, 2, undefined, { hasTime: (needMs) => Date.now() + needMs <= deadline });
  });
  return out;
}

async function runNotify(db: Db, deadline: number, failedCore: string[]) {
  const out: Record<string, unknown> = {};
  try {
    Object.assign(out, await runNotifyA(db, failedCore));
  } catch (error) {
    // Budget habis di paruh A = sisa kerja dilanjutkan tick berikut.
    if (error instanceof QueryBudgetExceeded) throw error;
  }
  try {
    Object.assign(out, await runNotifyB(db, deadline, failedCore));
  } catch (error) {
    if (error instanceof QueryBudgetExceeded) throw error;
  }
  return out;
}

// cleanup: baris kedaluwarsa (sesi WA, inbox WA 7 hari, event DANA 30 hari,
// revokasi sesi admin). Murah dan idempoten.
async function runCleanup(db: Db) {
  const { runMaintenanceCleanup } = await import("@/lib/maintenance-cleanup");
  const cleanup = await runMaintenanceCleanup(db);
  if (db.canSpend(3)) {
    const { materializeRecurring } = await import("@/lib/finance/expenses");
    await materializeRecurring(db);
  }
  if (!db.canSpend(3)) return cleanup;
  // Drain WR-only changes and failed VPS pair requests on the existing cron.
  // Critical order work has its own jobs; this drain is bounded and resumable.
  const { decideDirtyWinners } = await import("@/lib/supplier-pairs");
  const pairs = await decideDirtyWinners(db);
  const copy: Record<string, unknown> = {};
  // Optional admin alert: <=4 statements, 30-minute CAS; never block cleanup.
  if (db.canSpend(4)) {
    try {
      const { checkCopyReviewChanges } = await import("@/lib/product-copy/review-alert");
      copy.copy_review = await checkCopyReviewChanges(db);
    } catch { copy.copy_review = { checked: false, error: "check_failed" }; }
  }
  const market = await runCryptoMarketRefresh(db);
  let staleness: Record<string, unknown> = {};
  if (db.canSpend(6)) {
    try {
      const { checkSyncStaleness } = await import("@/lib/sync-staleness");
      staleness = { staleness: await checkSyncStaleness(db) };
    } catch {
      staleness = { staleness: { checked: false, error: "check_failed" } };
    }
  }
  return { ...cleanup, pairs_decided: pairs.decided, pairs_changed: pairs.changed, ...copy, ...market, ...staleness };
}

/**
 * Refresh kurs USD/IDR + katalog koin NOWPayments (D1 `crypto_market_snapshot`).
 * Dipasang di akhir job `cleanup` (tick 5 menit existing, tanpa trigger baru):
 * kerja ini hanya jatuh tempo tiap 30 menit sehingga pada tick lain ia hanya
 * 1 baca D1 murah; panggilan jaringannya (~25 GET, timeout 8 dtk, total 30 dtk)
 * tidak boleh memengaruhi job payments/expiry/fulfillment yang berjalan di
 * request cron lite TERPISAH dengan budget sendiri. Dijalankan paling akhir
 * setelah maintenance + pair drain, dan setiap kegagalan/timeout ditelan di sini
 * (hanya ditandai di hasil) agar cleanup tidak 500 karena sisi pasar.
 */
async function runCryptoMarketRefresh(db: Db): Promise<Record<string, unknown>> {
  try {
    if (!db.canSpend(4)) return {};
    const { refreshCryptoMarketSnapshot } = await import("@/lib/payments/market-snapshot-refresh");
    const result = await refreshCryptoMarketSnapshot(db);
    return result.status === "not_due" || result.status === "skipped_no_key" ? {} : { crypto_market: result.status, ...(result.errors ? { crypto_market_errors: result.errors } : {}) };
  } catch (error) {
    // Termasuk QueryBudgetExceeded: budget habis di sini tidak boleh membuang
    // hasil cleanup/pair drain yang sudah selesai; tick berikut mencoba lagi.
    return { crypto_market: error instanceof QueryBudgetExceeded ? "budget_exhausted" : "error" };
  }
}
