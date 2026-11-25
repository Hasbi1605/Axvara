// src/lib/pedia/refill-action.ts — Logika inti pengajuan Refill Pedia bersama
// (dipakai oleh POST /api/pedia/orders/[code]/refill DAN Bot Telegram pdrf:).
// Invarian: evaluasi `pediaRefillState`, CAS atomik cooldown 24 jam, cabang
// API (`callPediaProxy`) vs manual (`manual_requested` + notif admin).

import type { DatabaseAccess } from "@/lib/db-access";
import type { Locale } from "@/lib/i18n/locale";
import { isPediaProvider, callPediaProxy } from "@/lib/pedia/proxy";
import { pediaRefillState, refillReasonText } from "@/lib/pedia/refill-policy";
import { pick } from "@/lib/pedia/api-locale";

export type PediaRefillActionResult =
  | { ok: true; mode: "api" | "manual"; message: string }
  | { ok: false; status: 404 | 409; error: string; reason?: string };

export async function executePediaRefill(
  db: DatabaseAccess,
  orderCode: string,
  locale: Locale = "id",
): Promise<PediaRefillActionResult> {
  const clean = String(orderCode || "").trim().toUpperCase();
  const item = await db.queryFirst(
    `SELECT i.*, t.refill_days, COALESCE(s.api_refill,0) AS api_refill FROM pedia_order_items i
       JOIN pedia_tiers t ON t.id=i.tier_id
       LEFT JOIN pedia_supplier_services s ON s.supplier=i.supplier AND s.service_id=i.supplier_service_id
      WHERE i.order_code=?`,
    clean,
  ).catch(() => null);
  if (!item) {
    return { ok: false, status: 404, error: pick(locale, "Pesanan tidak ditemukan.", "Order not found.") };
  }
  let snapshot: Record<string, unknown> = {};
  try { snapshot = JSON.parse(String(item.snapshot_json)); } catch { /* legacy */ }
  if (!isPediaProvider(item.supplier)) {
    return { ok: false, status: 409, error: pick(locale, "Refill tidak tersedia.", "Refill is not available.") };
  }
  const state = pediaRefillState(item, snapshot, Number(item.api_refill) === 1);
  if (!state.eligible) {
    return {
      ok: false,
      status: 409,
      error: refillReasonText(state.reason!, locale),
      reason: state.reason ?? undefined,
    };
  }
  // Only conclusive terminal refills may be replaced. In particular a
  // timed-out/requested refill must retain its ID and original dedupe key.
  const claimed = await db.execRun(
    `UPDATE pedia_order_items SET refill_last_at=datetime('now'), refill_status='requested',
       updated_at=datetime('now')
      WHERE order_code=?
        AND ((refill_status IS NULL AND refill_supplier_id IS NULL AND refill_last_at IS NULL)
          OR refill_status IN ('completed','rejected','canceled','cancelled','supplier_rejected'))
        AND (refill_last_at IS NULL OR datetime(refill_last_at) <= datetime('now', '-24 hours'))`,
    clean,
  ).catch(() => null);
  if (Number((claimed as { changes?: number })?.changes ?? 0) !== 1) {
    return {
      ok: false,
      status: 409,
      error: pick(
        locale,
        "Refill sebelumnya belum selesai atau sudah diajukan dalam 24 jam terakhir.",
        "A previous refill is unfinished or one was requested in the last 24 hours.",
      ),
    };
  }
  if (state.mode === "manual") {
    // Layanan bergaransi tanpa tombol refill API: admin meneruskan ke CS IndoSMM.
    await db.execRun(
      `UPDATE pedia_order_items SET refill_status='manual_requested' WHERE order_code=? AND refill_status='requested'`,
      clean,
    ).catch(() => null);
    const { notifyPediaNeedsCheck } = await import("@/lib/pedia/notify");
    await notifyPediaNeedsCheck(
      db,
      clean,
      `Refill manual diminta pembeli. Ajukan ke CS IndoSMM dengan Order ID ${String(item.supplier_order_id ?? "-")}, lalu tandai hasilnya di Admin → Pedia → Pesanan.`,
    ).catch(() => null);
    return {
      ok: true,
      mode: "manual",
      message: pick(
        locale,
        "Refill diterima dan diproses admin. Biasanya dalam 1×24 jam.",
        "Refill received and processed by admin. Usually within 24 hours.",
      ),
    };
  }
  // Panggil supplier via proxy (idempoten: refill per order 1×/24 jam sudah diklaim).
  try {
    const res = await callPediaProxy(
      item.supplier,
      "refill",
      { order: String(item.supplier_order_id) },
      20_000,
      `${clean}:refill:${Math.floor(Date.now() / 86400000)}`,
    );
    if (res.ok && (res.data as Record<string, unknown>)?.refill) {
      const refillId = String((res.data as Record<string, unknown>)?.refill ?? "");
      await db.execRun(
        `UPDATE pedia_order_items SET refill_supplier_id=?, refill_status='submitted' WHERE order_code=?`,
        refillId,
        clean,
      ).catch(() => null);
    } else {
      await db.execRun(
        `UPDATE pedia_order_items SET refill_status=? WHERE order_code=?`,
        !res.ok && res.kind === "api_error" ? "supplier_rejected" : "needs_check",
        clean,
      ).catch(() => null);
    }
  } catch { /* status tetap requested; cron/admin menyusul */ }
  return {
    ok: true,
    mode: "api",
    message: pick(
      locale,
      "Refill diajukan. Biasanya mulai dalam 24 jam.",
      "Refill requested. It usually starts within 24 hours.",
    ),
  };
}
