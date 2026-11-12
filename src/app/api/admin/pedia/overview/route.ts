// GET /api/admin/pedia/overview — Ringkasan tab Pedia (§10 Pengaturan + header):
// saldo supplier penjualan aktif (best-effort + fallback cache, pola saldo WR/SK),
// hitung produk/tingkat/pesanan, status diff terakhir, antrean needs_check.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { callPediaProxy } from "@/lib/pedia/proxy";
import { PEDIA_SALE_PROVIDER } from "@/lib/pedia/sales-policy";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createDatabaseAccess();
  try {
  const counts = await db.queryFirst(
    `SELECT
       (SELECT COUNT(*) FROM pedia_products) AS products,
       (SELECT COUNT(*) FROM pedia_products WHERE is_active=1) AS products_active,
       (SELECT COUNT(*) FROM pedia_products WHERE managed='auto') AS managed_products,
       (SELECT COUNT(*) FROM pedia_tiers) AS tiers,
       (SELECT COUNT(*) FROM pedia_tiers WHERE is_active=1) AS tiers_active,
       (SELECT COUNT(*) FROM pedia_tiers WHERE is_active=0 AND auto_disabled_reason IS NOT NULL) AS tiers_auto_disabled,
       (SELECT COUNT(*) FROM pedia_tiers WHERE managed='auto') AS managed_tiers,
       (SELECT COUNT(*) FROM pedia_tiers WHERE managed='auto' AND is_active=1) AS managed_active,
       (SELECT COUNT(*) FROM pedia_tiers WHERE managed='auto' AND is_active=0 AND auto_disabled_reason IS NOT NULL) AS managed_blocked,
       (SELECT COUNT(*) FROM pedia_order_items WHERE status='needs_check') AS needs_check,
       (SELECT COUNT(*) FROM pedia_supplier_services WHERE supplier=? AND present=1) AS services`,
    PEDIA_SALE_PROVIDER,
  );
  // PSMM-P5: diagnostik katalog otomatis — alasan blokir terkelompok,
  // kesegaran deskripsi, dan panjang antrean materialisasi. Nama/ID tetap
  // internal admin; tidak ada kunci/cost supplier.
  const blockedRows = await db.queryAll(
    `SELECT auto_disabled_reason AS reason, COUNT(*) AS n FROM pedia_tiers
      WHERE managed='auto' AND is_active=0 GROUP BY auto_disabled_reason ORDER BY n DESC`,
  ).catch(() => [] as Record<string, unknown>[]);
  const blocked = blockedRows.map((r) => ({ reason: String(r.reason ?? "unknown"), count: Number(r.n) || 0 }));
  const { managedPendingCount } = await import("@/lib/pedia/metadata-refresh");
  const queue_pending = await managedPendingCount(db).catch(() => 0);
  const blocked_total = blocked.reduce((sum, b) => sum + b.count, 0);
  const settingsRows = await db.queryAll(
    `SELECT key, value FROM store_settings
      WHERE key IN ('pedia_diff_last_at','pedia_diff_last_change_at','pedia_balance_alert_at',
        'pedia_indosmm_diff_last_at','pedia_indosmm_diff_last_change_at','pedia_indosmm_balance_alert_at',
        'pedia_psmm_desc_last_at','pedia_managed_pending')`,
  );
  const settings: Record<string, string> = {};
  for (const r of settingsRows) settings[String(r.key)] = String(r.value ?? "");

  // 2026-11-12 (owner): ProviderSMM supplier penjualan aktif; ringkasan
  // mengikuti supplier aktif dan penanda diff milik supplier itu.
  const providers = await Promise.all([PEDIA_SALE_PROVIDER].map(async (supplier) => {
    const balance: { value: number | null; stale: boolean; history: { balance: number; created_at: string }[] } = { value: null, stale: true, history: [] };
    let error: string | null = null;
    let pricingVerified = false;
    try {
      const res = await callPediaProxy<{ balance?: unknown; currency?: unknown }>(supplier, "balance", {}, 15_000);
      if (!res.ok) error = res.kind;
      else if ((res.data.currency != null && res.data.currency !== "IDR") || res.data.balance == null || !Number.isFinite(Number(res.data.balance)) || Number(res.data.balance) < 0) error = "unsupported_currency";
      else {
        balance.value = Number(res.data.balance); balance.stale = false;
        {
          const services = await callPediaProxy<unknown>(supplier, "services", {}, 30_000);
          pricingVerified = services.ok && Array.isArray(services.data) && services.data.length > 0;
          if (!pricingVerified) error = "pricing_unverified";
        }
        await db.execRun(`INSERT INTO pedia_supplier_balance_log (supplier,balance) VALUES (?,?)`, supplier, balance.value);
      }
    } catch { error = "provider_unavailable"; }
    const history = await db.queryAll(`SELECT balance,created_at FROM pedia_supplier_balance_log WHERE supplier=? ORDER BY id DESC LIMIT 10`, supplier);
    balance.history = history.map((h) => ({ balance: Number(h.balance), created_at: String(h.created_at) }));
    if (balance.value === null && history[0]) balance.value = Number(history[0].balance);
    const prefix = supplier === "providersmm" ? "pedia_diff" : "pedia_indosmm_diff";
    return { supplier, balance, error, pricing_verified: pricingVerified, last_sync_at: settings[`${prefix}_last_at`] ?? null, last_change_at: settings[`${prefix}_last_change_at`] ?? null };
  }));
  return NextResponse.json({
    ok: true, counts, settings, providers, balance: providers[0].balance,
    catalog: {
      blocked,
      blocked_total,
      queue_pending,
      /**
       * Sumber nilai di atas: `pedia_psmm_desc_snapshot` (kesegaran via
       * `pedia_psmm_desc_last_at`), `pedia_managed_pending`, dan agregat
       * `pedia_tiers.managed='auto'`. Tidak ada angka yang dikarang.
       */
      description_fresh_at: settings["pedia_psmm_desc_last_at"] ?? null,
    },
  });
  } catch { return NextResponse.json({ error: "load_failed" }, { status: 500 }); }
}
