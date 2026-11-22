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
import { saveServiceHealth, type LiteContext } from "@/lib/cron/lite/context";
import { LITE_JOBS, type LiteJob } from "@/lib/cron/lite/jobs";

export const runtime = "edge";

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
    else if (job === "expiry") {
      const { run } = await import("@/lib/cron/lite/jobs/expiry");
      Object.assign(result, await run({ job, db, deadline, result, failedCore }));
    }
    else if (job === "fulfillment") {
      const { run } = await import("@/lib/cron/lite/jobs/fulfillment");
      Object.assign(result, await run({ job, db, deadline, result, failedCore }));
    }
    else if (job === "wr_orders") {
      const { run } = await import("@/lib/cron/lite/jobs/wr-orders");
      Object.assign(result, await run({ job, db, deadline, result, failedCore }));
    }
    else if (job === "sk_orders") {
      const { run } = await import("@/lib/cron/lite/jobs/sk-orders");
      Object.assign(result, await run({ job, db, deadline, result, failedCore }));
    }
    else if (job === "tunvn_orders" || job === "aivault_orders" || job === "storebat_orders" || job === "mirai_orders") {
      const { run } = await import("@/lib/cron/lite/jobs/small-suppliers");
      Object.assign(result, await run({ job, db, deadline, result, failedCore }, job));
    }
    else if (job === "aivault_catalog" || job === "storebat_catalog" || job === "mirai_catalog" || job === "tunvn_catalog") {
      const { run } = await import("@/lib/cron/lite/jobs/catalog");
      const outcome = await run({ job, db, deadline, result, failedCore }, job);
      if (outcome === "fx_unavailable") {
        return NextResponse.json({ ...result, ok: false, error: "fx_unavailable" }, { status: 503 });
      }
      if (outcome === "publish_failed") return NextResponse.json(result, { status: 503 });
    }
    else if (job === "jaspay_catalog") {
      const { run } = await import("@/lib/cron/lite/jobs/jaspay-catalog");
      const { failed } = await run({ job, db, deadline, result, failedCore });
      if (failed) {
        return NextResponse.json({ ...result, ok: false }, { status: 503 });
      }
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
      const { run } = await import("@/lib/cron/lite/jobs/games-catalog");
      const { failed } = await run({ job, db, deadline, result, failedCore });
      if (failed) return NextResponse.json({ ...result, ok: false }, { status: 503 });
    }
    else if (job === "games_orders") {
      const { run } = await import("@/lib/cron/lite/jobs/games-orders");
      const { failed } = await run({ job, db, deadline, result, failedCore });
      if (failed) return NextResponse.json({ ...result, ok: false }, { status: 503 });
    }
    else if (job === "tg_webhook") {
      const { run } = await import("@/lib/cron/lite/jobs/tg-webhook");
      const outcome = await run({ job, db, deadline, result, failedCore });
      if (outcome.kind === "failed") return NextResponse.json({ ...result, ok: false, error: outcome.error }, { status: 503 });
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

// promo body moved to src/lib/cron/lite/jobs/promo.ts (3A-2 diff 1).

// notify a/b/combined bodies moved to src/lib/cron/lite/jobs/notify.ts
// (3A-3). The route dispatches via dynamic import; `notify` runs B then A
// via Object.assign exactly as before.

// cleanup + market-refresh bodies moved to src/lib/cron/lite/jobs/cleanup.ts
// (3A-2 diff 2). The route dispatches via dynamic import; notify bodies stay
// here until their own 3A commit.
