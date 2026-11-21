// POST /api/cron/lite?job=payments|expiry|fulfillment|wr_orders|sk_orders|pedia_orders|promo|notify_a|notify_b|notify|tg_webhook|cleanup|games_catalog|games_orders — langkah
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
// sebagai alias gabungan (kompat pemanggil lama + heavy tick) — Worker
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
//   promo       — Promo otomatis Telegram 09.00/17.00 WIB (enqueue idempoten
//                 ke broadcast_campaigns/broadcast_deliveries) + ringkasan harian
//                 admin + worker siaran bounded
//   notify_a    — retry kabar order Telegram + invoice tertunda (separuh notify)
//   notify_b    — kabar QRIS kedaluwarsa + pengingat pending + outbox WA
//   notify      — alias gabungan notify_b lalu notify_a (kompat lama)
// Kontrak: header `authorization: Bearer <CRON_SECRET>`; 200 {ok,job,...};
// 400 job tak dikenal; 401 secret salah. Worker: `mcp-worker/src/cron.ts`.

import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/security";
import { createBudgetedDatabase, QueryBudgetExceeded } from "@/lib/db-access";
import { drainDirtyGroupsIfBudget, monitorRecovery, parseItems, saveServiceHealth, type LiteContext } from "@/lib/cron/lite/context";
import { LITE_JOBS, type LiteJob } from "@/lib/cron/lite/jobs";

export const runtime = "edge";

const EXPIRY_PER_RUN = 30;
const ORPHAN_LEDGER_PER_RUN = 30;
const FULFILLMENT_PER_RUN = 20;
const FULFILLMENT_ITEMS_PER_JOB = 10;
const WR_SK_BALANCE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
/** Plafon produk Jaspay per tick; budget 400 menjadi batas pengaman. */
const JASPAY_PRODUCTS_PER_TICK = 10;

export async function POST(request: NextRequest) {
  const deadline = Date.now() + 45_000;
  const secret = process.env.CRON_SECRET;
  if (!secret || !constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const job = request.nextUrl.searchParams.get("job") as LiteJob | null;
  if (!job || !LITE_JOBS.includes(job)) return NextResponse.json({ error: "invalid_job" }, { status: 400 });

  // Paid plan: runaway guard 300 statement untuk job lite umum, 400 untuk
  // fulfillment & jaspay_catalog (tidak lagi dibatasi plafon Free 50 statement).
  const db = createBudgetedDatabase(job === "fulfillment" || job === "jaspay_catalog" ? 400 : 300).access;
  const result: Record<string, unknown> = { ok: true, job };
  const failedCore: string[] = [];
  try {
    if (job === "payments") {
      const { run } = await import("@/lib/cron/lite/jobs/payments");
      const { paymentsFailed } = await run({ job, db, deadline, result, failedCore });
      if (paymentsFailed) {
        return NextResponse.json(
          { ...result, ok: false, ...(failedCore.length ? { failed_subjobs: failedCore } : {}) },
          { status: 503 },
        );
      }
    }
    else if (job === "expiry") Object.assign(result, await runExpiry(db));
    else if (job === "fulfillment") Object.assign(result, await runFulfillment(db, deadline));
    else if (job === "wr_orders") Object.assign(result, await runWrOrders(db, failedCore));
    else if (job === "sk_orders") Object.assign(result, await runSkOrders(db, failedCore));
    else if (job === "tunvn_orders" || job === "aivault_orders" || job === "storebat_orders" || job === "mirai_orders") {
      const { run } = await import("@/lib/cron/lite/jobs/small-suppliers");
      Object.assign(result, await run({ job, db, deadline, result, failedCore }, job));
    }
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
    else if (job === "storebat_catalog") {
      const { isStorebatConfigured,isStorebatSyncEnabled }=await import("@/lib/storebat/client");
      if (!isStorebatConfigured() || !isStorebatSyncEnabled()) result.skipped="not_configured";
      else {
        const { loadCurrentFxSnapshot }=await import("@/lib/payments/market-snapshot");
        const { parseRateRational }=await import("@/lib/payments/fx");
        const fx=await loadCurrentFxSnapshot(db.d1), rate=fx ? parseRateRational(fx.rateText) : null;
        if (!rate) {
          const { recordSyncError } = await import("@/lib/sync-status");
          await recordSyncError(db, "storebat_catalog", "fx_unavailable");
          return NextResponse.json({...result,ok:false,error:"fx_unavailable"},{status:503});
        }
        const { publishStorebatCatalog }=await import("@/lib/storebat/catalog");
        const synced=await publishStorebatCatalog(db,Number(rate.num)/Number(rate.den),{force:false});
        Object.assign(result,synced);
        if ("ok" in synced && !synced.ok) return NextResponse.json(result,{status:503});
        if ("ok" in synced && synced.ok && !("unchanged" in synced)) await drainDirtyGroupsIfBudget(db, result);
      }
    }
    else if (job === "mirai_catalog") {
      const { isMiraiConfigured, isMiraiSyncEnabled } = await import("@/lib/mirai/client");
      if (!isMiraiConfigured() || !isMiraiSyncEnabled()) result.skipped = "not_configured";
      else {
        const { loadCurrentFxSnapshot } = await import("@/lib/payments/market-snapshot");
        const { parseRateRational } = await import("@/lib/payments/fx");
        const fx = await loadCurrentFxSnapshot(db.d1), rate = fx ? parseRateRational(fx.rateText) : null;
        if (!rate) {
          const { recordSyncError } = await import("@/lib/sync-status");
          await recordSyncError(db, "mirai_catalog", "fx_unavailable");
          return NextResponse.json({ ...result, ok: false, error: "fx_unavailable" }, { status: 503 });
        }
        const { publishMiraiCatalog } = await import("@/lib/mirai/catalog");
        const synced = await publishMiraiCatalog(db, Number(rate.num) / Number(rate.den), { force: false });
        Object.assign(result, synced);
        if ("ok" in synced && !synced.ok) return NextResponse.json(result, { status: 503 });
        if ("ok" in synced && synced.ok) await drainDirtyGroupsIfBudget(db, result);
      }
    }
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
    else if (job === "pedia_orders") {
      const { run } = await import("@/lib/cron/lite/jobs/pedia");
      Object.assign(result, await run({ job, db, deadline, result, failedCore }));
    }
    else if (job === "notify_a" || job === "notify_b" || job === "notify") {
      const { run } = await import("@/lib/cron/lite/jobs/notify");
      Object.assign(result, await run({ job, db, deadline, result, failedCore }, job));
    }
    else if (job === "cleanup") {
      const { run } = await import("@/lib/cron/lite/jobs/cleanup");
      Object.assign(result, await run({ job, db, deadline, result, failedCore }));
      await sampleWhatsAppGateway(db, deadline);
    }
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
    else if (job === "tg_webhook") {
      const { guardTelegramWebhook } = await import("@/lib/telegram/webhook-guard");
      const { TG_WEBHOOK_HEALTH_KEY } = await import("@/lib/service-health");
      const guard = await guardTelegramWebhook(db);
      Object.assign(result, guard);
      // A successful reinstall is not proof of recovery. Let the next
      // getWebhookInfo confirm the URL/backlog before resetting the soft alarm.
      const failed = guard.status !== "skipped" && guard.status !== "healthy" && guard.status !== "recovered";
      if (guard.status !== "skipped" && db.canSpend(1)) {
        await saveServiceHealth(db, TG_WEBHOOK_HEALTH_KEY, JSON.stringify({
          error: failed ? guard.status : null,
          pending: guard.pending_update_count ?? null,
        }));
      }
      if (failed) return NextResponse.json({ ...result, ok: false, error: guard.error || guard.status }, { status: 503 });
    }
    else {
      const { run } = await import("@/lib/cron/lite/jobs/promo");
      Object.assign(result, await run({ job, db, deadline, result, failedCore }));
    }
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

type Db = LiteContext["db"];

async function sampleWhatsAppGateway(db: Db, deadline: number) {
  const url = process.env.WHATSAPP_GATEWAY_URL?.trim().replace(/\/+$/, "");
  if (process.env.WHATSAPP_ENABLED !== "true" || !url || !db.canSpend(2) || Date.now() + 4_000 > deadline) return;
  const { WA_GATEWAY_HEALTH_KEY } = await import("@/lib/service-health");
  try {
    if (await db.queryFirst(`SELECT 1 FROM store_settings WHERE key=? AND updated_at > datetime('now','-5 minutes')`, WA_GATEWAY_HEALTH_KEY)) return;
    if (Date.now() + 4_000 > deadline) return;
    // /health reads session state without taking the notification-group lock.
    // The main session handles welcomes; a configured second session handles promo.
    const sample = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(3_000), redirect: "error", cache: "no-store",
    }).then(async (res) => {
      if (!res.ok) return "false";
      const health = await res.json().catch(() => null) as {
        connected?: boolean; blocked?: boolean;
        promoBot?: { configured?: boolean; connected?: boolean; blocked?: boolean };
      } | null;
      const promo = health?.promoBot?.configured === true ? health.promoBot : null;
      if (health?.blocked === true || promo?.blocked === true) return "blocked";
      if (health?.connected === false || promo?.connected === false) return "false";
      return health?.connected === true && (!promo || promo.connected === true) ? "true" : "unknown";
    }).catch(() => "false");
    await saveServiceHealth(db, WA_GATEWAY_HEALTH_KEY, sample);
  } catch { console.warn("[cron-health] whatsapp_sample_failed"); }
}

async function runExpiry(db: Db) {
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
      items: parseItems(tx.items), lastError: "stale_initializing",
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
      paymentStatus: "expired", items: parseItems(tx.items),
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
          items: parseItems(tx.items),
          lastError: tx.last_error ? String(tx.last_error) : "gateway_expired",
        }, db.d1, expiryOpts);
        if (changed) expired++;
      } else {
        await transitionPendingOrder(String(tx.order_code), "kadaluarsa", "gateway_expired", parseItems(tx.items), db.d1, expiryOpts);
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

async function runFulfillment(db: Db, deadline: number) {
  if (process.env.AUTO_FULFILLMENT_ENABLED !== "true") return { skipped: "auto_fulfillment_disabled" };
  const { getDueJobs, processJobItems, releaseStaleJobs } = await import("@/lib/fulfillment/deliver");
  const released = await releaseStaleJobs(db).catch(() => 0);
  const jobs = await getDueJobs(FULFILLMENT_PER_RUN, db);
  let processed = 0;
  for (const job of jobs) {
    if (Date.now() >= deadline) break;
    const order = await db.queryFirst(`SELECT * FROM orders WHERE code=?`, String(job.order_code));
    if (!order) continue;
    try {
      const unit = await processJobItems(Number(job.id), order, {}, FULFILLMENT_ITEMS_PER_JOB, () => Date.now() < deadline, db);
      if (unit.done || unit.attempted > 0) processed++;
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
    }
  }
  return { stale_locks_released: released, due_jobs_processed: processed };
}

async function runWrOrders(db: Db, failedCore: string[]) {
  const { isWrEnabled } = await import("@/lib/warung-rebahan/client");
  if (!isWrEnabled()) return { skipped: "disabled" };
  const order = await import("@/lib/warung-rebahan/order");
  const out: Record<string, unknown> = {};
  const recover = monitorRecovery(db, "wr_orders", out, failedCore);
  await recover("stale_claims", () => order.recoverStaleClaims(db), 0);
  await recover("blocked_balance", () => order.reconcileBlockedBalance(db, { reportLookupFailure: true }), 0);
  if (process.env.WARUNG_REBAHAN_AUTO_ORDER_ENABLED === "true") {
    // 2026-10-09 (kasus AXV-20261009-DA1A****): link WR tidak pernah dibuat
    // webhook + COUNT due = 0 → `processWrPendingOrders` tidak dipanggil →
    // `reconcileMissingWrLinks` di dalamnya tidak pernah jalan → yatim
    // selamanya. Probe yatim WAJIB jalan duluan tanpa gate due (murah: 1
    // SELECT indeks lunas + INSERT OR IGNORE idempoten), hasilnya ikut
    // menentukan gate proses di bawah.
    const orphanHealed = await recover("missing_links", () => order.reconcileMissingWrLinks(db), { orders: 0, links: 0 });
    if (orphanHealed.links > 0) out.orphan_links_healed = orphanHealed.links;
    const due = await recover("due_lookup", () => db.queryFirst(
      `SELECT COUNT(*) AS n FROM wr_order_links
        WHERE status IN ('pending','retry') AND attempt_count < max_attempts
          AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))`,
    ), null);
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
    await recover("supplier_refresh", async () => {
      const { refreshDueSupplierOrders } = await import("@/lib/orders/supplier-refresh");
      const fresh = await refreshDueSupplierOrders(db, { limit: 12 });
      if (fresh.refreshed > 0) out.supplier_refreshed = fresh.refreshed;
    }, undefined);
    // 2 menit, bukan 1 jam (2026-10-10): webhook WR yang hilang/terputus
    // tidak lagi menahan kredensial varian instan sampai route besar jalan.
    out.reconciled = await recover("stuck_links", () => order.reconcileStuckWrOrders(db, { minAgeMinutes: 2, reportLookupFailure: true }), 0);
    // WR3 Jaspay (bounded, di job wr_orders yang sama — bukan cron baru):
    // link Jaspay ambigu => exact-ref identik / poll invoice dikenal.
    // Premium tak tersentuh; lease existing tetap.
    await recover("jaspay_recovery", async () => {
      const healed = await order.reconcileJaspayAmbiguous(db, 12);
      if (healed.exactRef > 0) out.jaspay_exact_ref = healed.exactRef;
      if (healed.polled > 0) out.jaspay_polled = healed.polled;
    }, undefined);
  }
  const { processDueCredentialDeliveries, requeueOrphanCredentialDeliveries } = await import("@/lib/warung-rebahan/deliver");
  // Kredensial completed yang tidak pernah diantrekan (completion terputus).
  const requeued = await requeueOrphanCredentialDeliveries(db);
  if (requeued > 0) out.credentials_requeued = requeued;
  const delivery = await processDueCredentialDeliveries(db);
  out.credentials_delivered = delivery.delivered;
  // Paid plan: cek saldo WR maks tiap 10 menit (sebelumnya 60 menit hanya di cron/operations :00).
  if (db.canSpend(5)) {
    try {
      const lastCheck = await db.queryFirst(
        `SELECT created_at FROM wr_saldo_log WHERE source='api_check' ORDER BY created_at DESC LIMIT 1`,
      ).catch(() => null);
      const { parseExpiry } = await import("@/lib/expiry");
      const lastTs = parseExpiry(lastCheck?.created_at);
      if (lastTs == null || lastTs < Date.now() - WR_SK_BALANCE_CHECK_INTERVAL_MS) {
        const { checkAndLogSaldo } = await import("@/lib/warung-rebahan/saldo");
        const saldo = await checkAndLogSaldo(db);
        out.wr_saldo_balance = saldo.balance;
        out.wr_saldo_low = saldo.isLow;
      }
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
    }
  }
  return out;
}

async function runSkOrders(db: Db, failedCore: string[]) {
  const { isSkEnabled } = await import("@/lib/sekalipay/client");
  if (!isSkEnabled()) return { skipped: "disabled" };
  const order = await import("@/lib/sekalipay/order");
  const out: Record<string, unknown> = {};
  const recover = monitorRecovery(db, "sk_orders", out, failedCore);
  // Read-only watchdog is independent of the purchase flag or saturated queue.
  const aging = await recover("aging_alert", () => order.alertAgingSkOrders(db), 0);
  if (aging) out.aging_alerted = aging;
  await recover("stale_claims", () => order.recoverStaleSkClaims(db, { reportLookupFailure: true }), 0);
  await recover("blocked_balance", () => order.reconcileBlockedSkBalance(db, { reportLookupFailure: true }), 0);
  if (process.env.SEKALIPAY_AUTO_ORDER_ENABLED === "true") {
    // Existing due purchases get first use of the budget. Probe orphans once,
    // independently of queue size. If no buys ran, dispatch healed links now;
    // otherwise leave them due for the next tick.
    const processed = await order.processSkPendingOrders(db, { skipOrphanProbe: true });
    out.processed = processed.processed;
    out.succeeded = processed.succeeded;
    const exhausted = await recover("exhausted_retries", () => order.settleExhaustedSkRetries(db), 0);
    if (exhausted) out.exhausted_settled = exhausted;
    const orphanHealed = await recover("missing_links", () => order.reconcileMissingSkLinks(db), { orders: 0, links: 0 });
    if (orphanHealed.links > 0) out.orphan_links_healed = orphanHealed.links;
    if (orphanHealed.links > 0 && processed.processed === 0) {
      const healed = await order.processSkPendingOrders(db, { skipOrphanProbe: true });
      out.processed = processed.processed + healed.processed;
      out.succeeded = processed.succeeded + healed.succeeded;
    }
    // Penjamin status segar bersama (cermin WR di atas): SK yang webhook-nya
    // terlambat ikut tertarik di sini, bukan hanya di route besar.
    await recover("supplier_refresh", async () => {
      const { refreshDueSupplierOrders } = await import("@/lib/orders/supplier-refresh");
      const fresh = await refreshDueSupplierOrders(db, { limit: 12 });
      if (fresh.refreshed > 0) out.supplier_refreshed = fresh.refreshed;
    }, undefined);
    out.reconciled = await recover("stuck_links", () => order.reconcileStuckSkOrders(db, { reportLookupFailure: true }), 0);
  }
  // Paid plan: cek saldo SK maks tiap 10 menit (sebelumnya 60 menit hanya di cron/operations :00).
  if (db.canSpend(5)) {
    try {
      const lastCheck = await db.queryFirst(
        `SELECT created_at FROM sk_saldo_log WHERE source='api_check' ORDER BY created_at DESC LIMIT 1`,
      ).catch(() => null);
      const { parseExpiry } = await import("@/lib/expiry");
      const lastTs = parseExpiry(lastCheck?.created_at);
      if (lastTs == null || lastTs < Date.now() - WR_SK_BALANCE_CHECK_INTERVAL_MS) {
        const { checkAndLogSkSaldo } = await import("@/lib/sekalipay/saldo");
        const saldo = await checkAndLogSkSaldo(db);
        out.sk_saldo_balance = saldo.balance;
        out.sk_saldo_low = saldo.isLow;
      }
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
    }
  }
  return out;
}

// promo body moved to src/lib/cron/lite/jobs/promo.ts (3A-2 diff 1).

// notify a/b/combined bodies moved to src/lib/cron/lite/jobs/notify.ts
// (3A-3). The route dispatches via dynamic import; `notify` runs B then A
// via Object.assign exactly as before.

// cleanup + market-refresh bodies moved to src/lib/cron/lite/jobs/cleanup.ts
// (3A-2 diff 2). The route dispatches via dynamic import; notify bodies stay
// here until their own 3A commit.
