// src/lib/pedia/dispatch.ts — Job pedia_orders dispatch + poll di cron
// fase "pedia" (PEDIA-PRD PD-30–33 + §9.2/9.4).
//
// Alur per item queued (lunas): guard margin vs rate TERKINI → submit via
// proxy /psmm/order/add (atau /refill, backup) dengan Idempotency-Key =
// order_code (VPS 24 jam) → submitted; poll via /psmm/order/status →
// in_progress / completed (capture start_count+remains) / partial+canceled→
// kredit; api_error → needs_check (MANUAL, bukan auto-refund).
// Lease 5 menit + submit_attempts < 6 (PD-33): crash → cron berikutnya
// mengambil alih; submit idempoten via Idempotency-Key.

import type { createDatabaseAccess } from "@/lib/db-access";

type Db = ReturnType<typeof createDatabaseAccess>;

const LEASE_SECONDS = 5 * 60;
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
};

type TierInfo = {
  markup_pct: number;
  min_profit_rp: number;
  backup_service_id: number | null;
};

/** Satu siklus: ambil item queued yang lease-nya kedaluwarsa, dispatch + poll.
 * `caller` diinjeksi test (default callPsmmProxy asli). */
export async function processPediaPaidOrders(caller?: ProxyCaller): Promise<{ dispatched: number; polled: number; needsCheck: number }> {
  const { createDatabaseAccess } = await import("@/lib/db-access");
  const db = createDatabaseAccess();
  const { callPsmmProxy } = await import("@/lib/pedia/proxy");
  const call = caller ?? callPsmmProxy;
  const out = { dispatched: 0, polled: 0, needsCheck: 0 };
  // Klaim lease atomik untuk item queued (wegen race webhook + cron
  // bersamaan). Bila tidak ada yang terklaim, lanjut ke poll — JANGAN
  // return awal (poll submitted/in_progress tetap harus jalan).
  const claimed = await db.execRun(
    `UPDATE pedia_order_items
        SET lease_until=datetime('now', '+${LEASE_SECONDS} seconds'),
            updated_at=datetime('now')
      WHERE status='queued'
        AND (lease_until IS NULL OR datetime(lease_until) <= datetime('now'))
        AND submit_attempts < ${MAX_ATTEMPTS}`,
  ).catch(() => null);
  const queuedClaimed = Number((claimed as { changes?: number })?.changes ?? 0) > 0;
  const items = queuedClaimed ? await db.queryAll(
    `SELECT * FROM pedia_order_items
      WHERE status='queued' AND datetime(lease_until) > datetime('now', '+${LEASE_SECONDS - 60} seconds')
      LIMIT 20`,
  ).catch(() => []) as unknown as Item[] : [];
  for (const item of items) {
    try {
      const r = await dispatchOne(db, item, call);
      if (r === "dispatched") out.dispatched++;
      else if (r === "polled") out.polled++;
      else if (r === "needs_check") out.needsCheck++;
    } catch { /* satu item gagal tidak menghentikan sisanya */ }
  }
  // Poll item submitted/in_progress yang lease-nya kedaluwarsa.
  const due = await db.queryAll(
    `SELECT * FROM pedia_order_items
      WHERE status IN ('submitted','in_progress')
        AND (lease_until IS NULL OR datetime(lease_until) <= datetime('now'))
      LIMIT 20`,
  ).catch(() => []) as unknown as Item[];
  for (const item of due) {
    try {
      if ((await pollOne(db, item, call)) === "polled") out.polled++;
    } catch { /* lanjut */ }
  }
  return out;
}

async function serviceRate(db: Db, supplier: string, serviceId: number): Promise<number | null> {
  const row = await db.queryFirst(
    `SELECT rate_idr_per_1k FROM pedia_supplier_services WHERE supplier=? AND service_id=? AND present=1`,
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

type ProxyCaller = typeof import("@/lib/pedia/proxy").callPsmmProxy;

/** Dispatch satu item: guard margin → submit → lease poll 5 menit. */
async function dispatchOne(
  db: Db, item: Item, call: ProxyCaller,
): Promise<"dispatched" | "polled" | "needs_check" | "skipped"> {
  const rate = await serviceRate(db, item.supplier || "providersmm", item.supplier_service_id);
  const info = await tierInfo(db, item.tier_id);
  if (rate === null || !info) {
    await toNeedsCheck(db, item.order_code, "layanan supplier tidak tersedia");
    return "needs_check";
  }
  // Guard margin di jalur cron (PD-32): hitung dari harga tersimpan (unit)
  // vs charge baru — bila < min, kunci tier + needs_check manual.
  const charge = rate * item.quantity / 1000;
  const marginLive = item.unit_price * item.quantity - charge;
  if (marginLive < info.min_profit_rp) {
    await db.execRun(
      `UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='margin', updated_at=datetime('now')
        WHERE id=?`,
      item.tier_id,
    ).catch(() => null);
    await toNeedsCheck(db, item.order_code, "margin di bawah minimum (rate naik)");
    return "needs_check";
  }
  // Submit (idempoten via Idempotency-Key = order_code; VPS dedupe 24 jam).
  const res = await call("add", {
    service: item.supplier_service_id,
    link: item.target_normalized,
    quantity: item.quantity,
  }, 30_000, item.order_code);
  await db.execRun(
    `UPDATE pedia_order_items SET submit_attempts=submit_attempts+1, updated_at=datetime('now')
      WHERE order_code=?`,
    item.order_code,
  ).catch(() => null);
  if (!res.ok) {
    const kind = res.kind;
    // api_error (saldo kurang, quantity invalid dari supplier, dsb) →
    // MANUSIA yang menangani. Retry otomatis hanya untuk error jaringan.
    if (kind === "api_error") {
      await toNeedsCheck(db, item.order_code, String(res.supplierMessage || "supplier menolak order").slice(0, 200));
      return "needs_check";
    }
    // Transport/proxy/timeout: biarkan cron retry (lease kedaluwarsa).
    if (Number(item.submit_attempts) + 1 >= MAX_ATTEMPTS) {
      await toNeedsCheck(db, item.order_code, "gagal submit 6× (jaringan)");
      return "needs_check";
    }
    await db.execRun(
      `UPDATE pedia_order_items SET lease_until=NULL WHERE order_code=?`,
      item.order_code,
    ).catch(() => null);
    return "skipped";
  }
  const supplierOrderId = String((res.data as Record<string, unknown>)?.order ?? "");
  if (!supplierOrderId) {
    await toNeedsCheck(db, item.order_code, "supplier tidak mengembalikan ID order");
    return "needs_check";
  }
  await db.execRun(
    `UPDATE pedia_order_items
        SET status='submitted', supplier_order_id=?, supplier_charge=?,
            lease_until=datetime('now', '+${LEASE_SECONDS} seconds'),
            last_error=NULL, updated_at=datetime('now')
      WHERE order_code=?`,
    supplierOrderId, charge, item.order_code,
  ).catch(() => null);
  return "dispatched";
}

/** Poll satu item: status supplier → completed/partial/in_progress/canceled. */
async function pollOne(
  db: Db, item: Item, call: ProxyCaller,
): Promise<"polled" | "skipped"> {
  if (!item || !(item as unknown as Record<string, unknown>).supplier_order_id) return "skipped";
  const row = item as unknown as Record<string, unknown>;
  const res = await call("status", {
    order: String(row.supplier_order_id),
  }, 20_000);
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
  const status = String(d.status ?? "").toLowerCase();
  const startCount = d.start_count != null ? Number(d.start_count) : null;
  const remains = d.remains != null ? Number(d.remains) : null;
  // Snapshot start_count sekali (untuk refund exact PD-24).
  if (Number.isFinite(startCount)) {
    await db.execRun(
      `UPDATE pedia_order_items SET start_count=COALESCE(start_count, ?)
        WHERE order_code=?`,
      Number(startCount), item.order_code,
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
      `UPDATE pedia_order_items SET status='completed', lease_until=NULL, updated_at=datetime('now')
        WHERE order_code=?`,
      item.order_code,
    ).catch(() => null);
    try {
      const { notifyPediaCompleted } = await import("@/lib/pedia/notify");
      await notifyPediaCompleted(db, item.order_code).catch(() => null);
    } catch { /* notif best-effort */ }
    return "polled";
  }
  if (status === "partial" || status === "canceled") {
    await handleShortfall(db, item, startCount, remains);
    return "polled";
  }
  if (status === "in_progress" || status === "processing" || status === "pending") {
    await db.execRun(
      `UPDATE pedia_order_items SET status='in_progress', lease_until=datetime('now', '+${LEASE_SECONDS} seconds'),
         updated_at=datetime('now') WHERE order_code=?`,
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

/** Partial/canceled: refund exact (PD-24) → kredit pembeli, tanpa admin. */
async function handleShortfall(db: Db, item: Item, startCount: number | null, remains: number | null): Promise<void> {
  // delivered = max(0, quantity - remains) bila remains ada; fallback
  // start_count tidak cukup (ia hitungan awal, bukan terkirim).
  let delivered = 0;
  if (remains !== null && Number.isFinite(remains)) {
    delivered = Math.max(0, Math.min(item.quantity, item.quantity - Number(remains)));
  } else if (startCount !== null && Number.isFinite(startCount)) {
    delivered = 0; // tanpa remains, anggap 0 terkirim → refund penuh (aman pembeli).
  }
  const refund = Math.max(0, (item.quantity - delivered) * item.unit_price);
  const newStatus = delivered > 0 ? "partial" : "canceled";
  await db.execRun(
    `UPDATE pedia_order_items SET status=?, lease_until=NULL, updated_at=datetime('now')
      WHERE order_code=?`,
    newStatus, item.order_code,
  ).catch(() => null);
  if (refund <= 0) return;
  const order = await db.queryFirst(`SELECT customer_email FROM orders WHERE code=?`, item.order_code).catch(() => null);
  const email = String(order?.customer_email ?? "");
  if (!email) return;
  const { issuePediaCredit } = await import("@/lib/pedia/credits");
  try {
    const credit = await issuePediaCredit(db, {
      email, amount: Math.round(refund),
      sourceOrderCode: item.order_code,
      sourceKind: newStatus === "partial" ? "partial" : "canceled",
    });
    await db.execRun(
      `UPDATE pedia_order_items SET refund_credit_code=? WHERE order_code=?`,
      credit.code, item.order_code,
    ).catch(() => null);
    try {
      const { notifyPediaCredit } = await import("@/lib/pedia/notify");
      await notifyPediaCredit(db, item.order_code, credit.code, Math.round(refund), newStatus).catch(() => null);
    } catch { /* notif best-effort */ }
  } catch (e) {
    // credit_already_issued = poll diulang → tepat sekali, abaikan.
    if (!(e instanceof Error) || e.message !== "credit_already_issued") {
      await toNeedsCheck(db, item.order_code, "refund gagal diterbitkan").catch(() => null);
    }
  }
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
