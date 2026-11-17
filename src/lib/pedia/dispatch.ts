// src/lib/pedia/dispatch.ts — Job pedia_orders dispatch + poll di cron
// fase "pedia" (PEDIA-PRD PD-30–33 + §9.2/9.4).
//
// Alur per item queued (lunas): guard margin vs rate TERKINI → submit via
// proxy /indosmm/order/add (atau /refill, backup) dengan Idempotency-Key =
// order_code (VPS 24 jam) → submitted; poll via /indosmm/order/status →
// in_progress / completed (capture start_count+remains) / partial+canceled→
// tindak lanjut manual; api_error → needs_check (MANUAL, bukan auto-refund).
// Durable submitting + lease: interrupted submissions require reconciliation;
// neither a retry nor another provider is selected automatically. An item of a
// supplier this build no longer knows (historical rows) never dispatches.

import type { createDatabaseAccess } from "@/lib/db-access";
import { callPediaProvider, isPediaProvider, type ProxyCaller } from "@/lib/pedia/proxy";
export type { ProxyCaller } from "@/lib/pedia/proxy";

type Db = ReturnType<typeof createDatabaseAccess>;

const LEASE_SECONDS = 5 * 60;
const POLL_SECONDS = 60;

// Check recent work every minute. Long-running orders progressively back off;
// a faster scheduler must not poll hours-long campaigns every minute forever.
function pollSeconds(item: Item): number {
  const { created_at } = item as unknown as Record<string, unknown>;
  const text = String(created_at ?? "");
  const age = Date.now() - Date.parse(text.includes("T") ? text : text.replace(" ", "T") + "Z");
  return age >= 60 * 60_000 ? 300 : age >= 15 * 60_000 ? 120 : POLL_SECONDS;
}
const MAX_ATTEMPTS = 6;

type Item = {
  order_code: string;
  product_id: number;
  tier_id: number;
  target_normalized: string;
  quantity: number;
  unit_price: number;
  margin_snapshot: number;
  total: number;
  supplier: string;
  supplier_service_id: number;
  submit_attempts: number;
  status: string;
  snapshot_json: string;
};

type TierInfo = {
  markup_pct: number;
  min_profit_rp: number;
  backup_service_id: number | null;
};

/** Satu siklus: ambil item queued yang lease-nya kedaluwarsa, dispatch + poll.
 * `caller` diinjeksi test (default provider router). `sharedDb` opsional:
 * cron lite meneruskan budgeted access-nya agar statement ikut budget 40;
 * bila absen (webhook/admin/test), buat koneksi sendiri seperti dulu. */
export async function processPediaPaidOrders(caller?: ProxyCaller, sharedDb?: Db): Promise<{ dispatched: number; polled: number; needsCheck: number; emails_retried?: number }> {
  let db: Db;
  if (sharedDb) {
    db = sharedDb;
  } else {
    const { createDatabaseAccess } = await import("@/lib/db-access");
    db = createDatabaseAccess();
  }
  const { expirePediaCheckouts } = await import("./expire");
  await expirePediaCheckouts(db);
  const call = caller ?? callPediaProvider;
  const out: { dispatched: number; polled: number; needsCheck: number; emails_retried?: number } = { dispatched: 0, polled: 0, needsCheck: 0 };
  // Klaim lease atomik untuk item queued (wegen race webhook + cron
  // bersamaan). Bila tidak ada yang terklaim, lanjut ke poll — JANGAN
  // return awal (poll submitted/in_progress tetap harus jalan).
  // A crashed add is ambiguous, even after the proxy dedupe window expires.
  const recovered = await db.execRun(
    `UPDATE pedia_order_items SET status='needs_check', last_error='submit interrupted; reconcile before retry', lease_until=NULL
      WHERE status='submitting' AND (lease_until IS NULL OR datetime(lease_until)<=datetime('now'))`,
  );
  out.needsCheck += Number(recovered.changes) || 0;
  // Recent missing paid notices are independent of supplier success; existing
  // ledger rows are retried by the bounded sweep below.
  if (db.canSpend(6)) {
    try {
      const lunasItems = await db.queryAll(
        `SELECT i.order_code FROM pedia_order_items i
          JOIN orders o ON o.code=i.order_code
         WHERE o.status='lunas' AND o.payment_status='paid'
           AND i.status IN ('queued','submitting','submitted','in_progress','completed','partial','canceled','needs_check')
           AND datetime(COALESCE(o.paid_at, o.updated_at)) >= datetime('now','-24 hours')
           AND NOT EXISTS (SELECT 1 FROM buyer_notice_log b
             WHERE b.idempotency_key='email:pedia-paid:' || o.code)
         ORDER BY i.updated_at ASC LIMIT 5`,
      ).catch(() => []);
      for (const sight of lunasItems) {
        if (!db.canSpend(5)) break;
        try {
          const { notifyPediaPaid } = await import("@/lib/pedia/notify");
          await notifyPediaPaid(db, String(sight.order_code)).catch(() => null);
        } catch { /* fenced sender owns retry; next tick recovers */ }
      }
    } catch { /* paid sighting best-effort; dispatch continues */ }
  }
  const items = await db.queryAll(
    `SELECT * FROM pedia_order_items
      WHERE status='queued' AND (lease_until IS NULL OR datetime(lease_until)<=datetime('now'))
        AND submit_attempts < ${MAX_ATTEMPTS}
        AND EXISTS (SELECT 1 FROM orders o WHERE o.code=pedia_order_items.order_code AND o.status='lunas')
      LIMIT 20`,
  ).catch(() => []) as unknown as Item[];
  for (const item of items) {
    try {
      const r = await dispatchOne(db, item, call);
      if (r === "dispatched") out.dispatched++;
      else if (r === "polled") out.polled++;
      else if (r === "needs_check") out.needsCheck++;
    } catch { /* satu item gagal tidak menghentikan sisanya */ }
  }
  // Poll item submitted/in_progress yang lease-nya kedaluwarsa.
  // Prioritas: active poll dulu (batas 20). Recount terminal TIDAK di cron
  // per tick — koreksi historis hanya via script operator satu-kali
  // (scripts/pedia-recount-start-count.mjs, dry-run default), bukan scan
  // terminal abadi yang memindai ulang setiap tick.
  const due = await db.queryAll(
    `SELECT * FROM pedia_order_items
      WHERE status IN ('submitted','in_progress')
        AND (lease_until IS NULL OR datetime(lease_until) <= datetime('now'))
      ORDER BY COALESCE(lease_until,created_at) ASC,order_code ASC LIMIT 20`,
  ).catch(() => []) as unknown as Item[];
  for (const item of due) {
    try {
      if ((await pollOne(db, item, call)) === "polled") out.polled++;
    } catch { /* lanjut */ }
  }
  if (db.canSpend(1 + 2 * 5)) {
    try {
      const { retryPendingPediaEmails } = await import("./notify-retry");
      const retried = await retryPendingPediaEmails(db);
      out.emails_retried = retried;
    } catch { /* email retry best-effort; lifecycle ledger stays durable */ }
  }
  if (db.canSpend(2)) {
    const refills = await db.queryAll(
      `SELECT order_code,supplier,refill_supplier_id FROM pedia_order_items
        WHERE refill_status='submitted' AND refill_supplier_id IS NOT NULL LIMIT 5`,
    );
    for (const refill of refills) {
      if (!db.canSpend(1)) break;
      if (!isPediaProvider(refill.supplier)) continue;
      const res = await call("refill_status", { refill: String(refill.refill_supplier_id) }, 20_000, undefined, refill.supplier);
      const status = res.ok ? String((res.data as Record<string, unknown>)?.status ?? "").toLowerCase() : "";
      if (["completed", "rejected", "canceled", "cancelled"].includes(status)) {
        await db.execRun(`UPDATE pedia_order_items SET refill_status=? WHERE order_code=? AND refill_status='submitted'`, status, refill.order_code);
      }
    }
  }
  if (db.canSpend(2)) {
    const { notifyPendingPediaFollowups } = await import("./followup");
    await notifyPendingPediaFollowups(db);
  }
  return out;
}

async function serviceRate(db: Db, supplier: string, serviceId: number): Promise<number | null> {
  const row = await db.queryFirst(
    `SELECT rate_idr_per_1k FROM pedia_supplier_services WHERE supplier=? AND service_id=? AND present=1 AND type IN ('Default','Custom Comments') AND rate_idr_per_1k>0`,
    supplier, serviceId,
  ).catch(() => null);
  return row ? Number(row.rate_idr_per_1k) : null;
}

async function tierInfo(db: Db, tierId: number): Promise<TierInfo | null> {
  const row = await db.queryFirst(
    `SELECT markup_pct, min_profit_rp, backup_service_id FROM pedia_tiers WHERE id=?`,
    tierId,
  ).catch(() => null);
  if (!row) return null;
  return {
    markup_pct: Number(row.markup_pct) || 0,
    min_profit_rp: Number(row.min_profit_rp) || 0,
    backup_service_id: row.backup_service_id != null ? Number(row.backup_service_id) : null,
  };
}

/** Dispatch satu item: guard margin → submit → poll awal60 detik. */
async function dispatchOne(
  db: Db, item: Item, call: ProxyCaller,
): Promise<"dispatched" | "polled" | "needs_check" | "skipped"> {
  if (!isPediaProvider(item.supplier)) {
    await toNeedsCheck(db, item.order_code, "invalid_provider");
    return "needs_check";
  }
  const rate = await serviceRate(db, item.supplier, item.supplier_service_id);
  const info = await tierInfo(db, item.tier_id);
  if (rate === null || !info) {
    await toNeedsCheck(db, item.order_code, "layanan supplier tidak tersedia");
    return "needs_check";
  }
  // Guard margin di jalur cron (PD-32): hitung dari harga tersimpan (unit)
  // vs charge baru — bila < min, kunci tier + needs_check manual.
  const charge = rate * item.quantity / 1000;
  const marginLive = item.total - charge;
  let snapshot: Record<string, unknown> = {};
  try { snapshot = JSON.parse(item.snapshot_json); } catch { /* legacy snapshot */ }
  const minProfit = Number(snapshot?.min_profit_rp ?? info.min_profit_rp);
  if (!Number.isFinite(rate) || !Number.isFinite(marginLive) || !Number.isFinite(minProfit) || marginLive < minProfit) {
    const disabled = await db.execRun(
      `UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='margin', updated_at=datetime('now')
        WHERE id=? AND is_active=1`,
      item.tier_id,
    ).catch(() => ({ changes: 0 }));
    if (Number(disabled?.changes ?? 0) > 0) {
      const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
      await bumpCatalogRevision("pedia", db);
    }
    await toNeedsCheck(db, item.order_code, "margin di bawah minimum (rate naik)");
    return "needs_check";
  }
  // Persist before network I/O. A competing tick cannot submit this item.
  const claimed = await db.execRun(
    `UPDATE pedia_order_items SET status='submitting', submit_attempts=submit_attempts+1,
       lease_until=datetime('now', '+${LEASE_SECONDS} seconds'), updated_at=datetime('now')
      WHERE order_code=? AND status='queued' AND (lease_until IS NULL OR datetime(lease_until)<=datetime('now'))`,
    item.order_code,
  );
  if (Number(claimed.changes) !== 1) return "skipped";
  // Submit (idempoten via Idempotency-Key = order_code; VPS dedupe 24 jam).
  const res = await call("add", {
    service: item.supplier_service_id,
    link: typeof snapshot.supplier_target === "string" && snapshot.supplier_target ? snapshot.supplier_target : item.target_normalized,
    quantity: item.quantity,
    // Komentar custom (2026-11-01): satu komentar per baris, dari snapshot pesanan.
    ...(Array.isArray(snapshot.custom_comments) && snapshot.custom_comments.length ? { comments: (snapshot.custom_comments as string[]).join("\n") } : {}),
  }, 30_000, item.order_code, item.supplier);
  if (!res.ok) {
    const kind = res.kind;
    // api_error (saldo kurang, quantity invalid dari supplier, dsb) →
    // MANUSIA yang menangani; ambiguous transport failures also stop here.
    if (kind === "api_error") {
      await toNeedsCheck(db, item.order_code, String(res.supplierMessage || "supplier menolak order").slice(0, 200));
      return "needs_check";
    }
    await toNeedsCheck(db, item.order_code, `submit ${kind}; reconcile before retry`);
    return "needs_check";
  }
  const supplierOrderId = String((res.data as Record<string, unknown>)?.order ?? "");
  if (!supplierOrderId) {
    await toNeedsCheck(db, item.order_code, "supplier tidak mengembalikan ID order");
    return "needs_check";
  }
  // Durable successful-submission receipt: status + supplier_order_id persist
  // in ONE guarded write. Check actual write changes: only the winner owns
  // the receipt (no late terminal mutation — WHERE requires status
  // 'submitting', so a concurrent terminal/expired item is never promoted).
  // The mail below must not block polling/submit on failure.
  const receipt = await db.execRun(
    `UPDATE pedia_order_items
        SET status='submitted', supplier_order_id=?, supplier_charge=?,
            lease_until=datetime('now', '+${POLL_SECONDS} seconds'),
            last_error=NULL, updated_at=datetime('now')
      WHERE order_code=? AND status='submitting'`,
    supplierOrderId, charge, item.order_code,
  ).catch(() => null);
  if (Number(receipt?.changes) !== 1) {
    // Lost the receipt race (terminal/expired won): no mail, no repurchase.
    return "skipped";
  }
  // Processing = "Diproses" (accepted, not necessarily running yet): emit on
  // the durable receipt via the SAME fenced email:pedia-processing key.
  // No receipt/ambiguous result never reaches here, so no false mail.
  // Budget-gated so the mail never prevents polling/submit progress.
  if (db.canSpend(5)) {
    try {
      const { notifyPediaProcessing } = await import("@/lib/pedia/notify");
      await notifyPediaProcessing(db, item.order_code).catch(() => null);
    } catch { /* fenced sender owns retry; poll continues */ }
  }
  return "dispatched";
}

/** Poll satu item: status supplier → completed/partial/in_progress/canceled. */
async function pollOne(
  db: Db, item: Item, call: ProxyCaller,
): Promise<"polled" | "skipped"> {
  if (!item || !(item as unknown as Record<string, unknown>).supplier_order_id) return "skipped";
  if (!isPediaProvider(item.supplier)) {
    await toNeedsCheck(db, item.order_code, "invalid_provider");
    return "skipped";
  }
  const row = item as unknown as Record<string, unknown>;
  // Claim before network I/O: simultaneous cron/callback invocations must not
  // duplicate status requests or race terminal completion/credit handling.
  const claimed = await db.execRun(
    `UPDATE pedia_order_items SET lease_until=datetime('now', '+${POLL_SECONDS} seconds')
      WHERE order_code=? AND status IN ('submitted','in_progress') AND supplier_order_id=?
        AND (lease_until IS NULL OR datetime(lease_until)<=datetime('now'))`,
    item.order_code, row.supplier_order_id,
  );
  if (Number(claimed.changes) !== 1) return "skipped";
  const res = await call("status", {
    order: String(row.supplier_order_id),
  }, 20_000, undefined, item.supplier);
  if (!res.ok) {
    // Poll gagal (transport): jadwalkan ulang, bukan needs_check.
    await db.execRun(
      `UPDATE pedia_order_items SET lease_until=datetime('now', '+${LEASE_SECONDS} seconds')
        WHERE order_code=?`,
      item.order_code,
    ).catch(() => null);
    return "skipped";
  }
  const d = (res.data || {}) as Record<string, unknown>;
  const status = String(d.status ?? "").toLowerCase().replace(/\s+/g, "_").replace(/^cancelled$/, "canceled");
  // Trust boundary: supplier JSON is untrusted. Accept ONLY number/string
  // raw values (reject boolean/object/array — Number(true)===1 would lie);
  // blank/whitespace never coerces to 0 (Number("")=0, Number(null)=0).
  // Only a present, non-blank, safe-nonnegative-integer persists:
  // blank/missing/invalid/negative/fractional never write. A reported actual
  // 0 stays a valid 0;
  // a stored NULL/0 is corrected by a later positive, while a confirmed
  // positive is preserved against a conflicting later value (no guessing
  // from target/quantity).
  const startCount = parseStartCount(d.start_count);
  const rawRemains = d.remains != null && String(d.remains).trim() !== "" ? Number(d.remains) : NaN;
  const remains = Number.isSafeInteger(rawRemains) && rawRemains >= 0 && rawRemains <= item.quantity ? rawRemains : null;
  // Simpan hitungan awal untuk riwayat progres supplier. Conditional write:
  // NULL/0 slots accept the validated value; confirmed positives never move.
  // Historical correction is operator-only, never a cron terminal scan.
  if (startCount !== null) {
    await db.execRun(
      `UPDATE pedia_order_items SET start_count=CASE WHEN start_count IS NULL OR start_count=0 THEN ? ELSE start_count END, updated_at=datetime('now')
        WHERE order_code=? AND (start_count IS NULL OR start_count=0 OR start_count=?)`,
      startCount, item.order_code, startCount,
    ).catch(() => null);
  }
  if (remains !== null && Number.isFinite(remains)) {
    await db.execRun(
      `UPDATE pedia_order_items SET remains=? WHERE order_code=?`,
      Number(remains), item.order_code,
    ).catch(() => null);
  }

  if (status === "completed") {
    await db.execRun(
      `UPDATE pedia_order_items SET status='completed', completed_at=COALESCE(completed_at,datetime('now')), lease_until=NULL, updated_at=datetime('now')
        WHERE order_code=?`,
      item.order_code,
    ).catch(() => null);
    try {
      const { notifyPediaCompleted } = await import("@/lib/pedia/notify");
      await notifyPediaCompleted(db, item.order_code).catch(() => null);
    } catch { /* notif best-effort; cron retry sweep recovers failed sends */ }
    return "polled";
  }
  if (status === "partial" || status === "canceled") {
    await handleShortfall(db, item, status);
    return "polled";
  }
  if (status === "in_progress" || status === "processing") {
    const changed = await db.execRun(
      `UPDATE pedia_order_items SET status='in_progress', lease_until=datetime('now', '+${pollSeconds(item)} seconds'),
         updated_at=datetime('now') WHERE order_code=? AND status='submitted'`,
      item.order_code,
    ).catch(() => null);
    // The submitted-receipt mail already owns this phase key; this call is a
    // deduped recovery (fence returns sent) that carries point-in-time
    // counts for orders submitted before the receipt trigger shipped.
    if (Number(changed?.changes) === 1) {
      try {
        const { notifyPediaProcessing } = await import("@/lib/pedia/notify");
        await notifyPediaProcessing(db, item.order_code, { startCount: startCount, remains }).catch(() => null);
      } catch { /* notif best-effort; cron retry sweep recovers failed sends */ }
    }
    await db.execRun(
      `UPDATE pedia_order_items SET lease_until=datetime('now', '+${pollSeconds(item)} seconds'),
         updated_at=datetime('now') WHERE order_code=?`,
      item.order_code,
    ).catch(() => null);
    return "polled";
  }
  if (status === "pending") {
    // Supplier pending = not started. Do NOT promote to in_progress (never
    // tell the buyer "sedang berjalan" on an unconfirmed state) and do NOT
    // regress a previously-running item: refresh the lease, keep status.
    await db.execRun(
      `UPDATE pedia_order_items SET lease_until=datetime('now', '+${pollSeconds(item)} seconds'),
         updated_at=datetime('now') WHERE order_code=? AND status IN ('submitted','in_progress')`,
      item.order_code,
    ).catch(() => null);
    return "polled";
  }
  // Status tak dikenal → jadwalkan ulang.
  await db.execRun(
    `UPDATE pedia_order_items SET lease_until=datetime('now', '+${LEASE_SECONDS} seconds')
      WHERE order_code=?`,
    item.order_code,
  ).catch(() => null);
  return "skipped";
}

/** Supplier terminal status stays truthful even when delivered count is unknown. */
async function handleShortfall(db: Db, item: Item, status: "partial" | "canceled"): Promise<void> {
  const { finishWithFollowup } = await import("./followup");
  await finishWithFollowup(db, item.order_code, status, `supplier_${status}`);
}

/** Trust-boundary parser for supplier start_count: number/string only.
 *  Boolean/object/array are rejected outright (Number(true)===1 must never
 *  become a count). Returns safe-nonnegative-integer or null. */
function parseStartCount(raw: unknown): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  if (typeof raw === "number" && !Number.isFinite(raw)) return null;
  const text = String(raw).trim();
  if (text === "") return null;
  const num = Number(text);
  return Number.isSafeInteger(num) && num >= 0 ? num : null;
}

async function toNeedsCheck(db: Db, orderCode: string, reason: string): Promise<void> {
  await db.execRun(
    `UPDATE pedia_order_items SET status='needs_check', lease_until=NULL,
       last_error=?, updated_at=datetime('now') WHERE order_code=?`,
    reason, orderCode,
  ).catch(() => null);
  try {
    const { notifyPediaNeedsCheck } = await import("@/lib/pedia/notify");
    await notifyPediaNeedsCheck(db, orderCode, reason).catch(() => null);
  } catch { /* notif best-effort */ }
}
