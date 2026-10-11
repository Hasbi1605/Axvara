// GET /api/admin/pedia/overview — Ringkasan tab Pedia (§10 Pengaturan + header):
// saldo ProviderSMM live (best-effort + fallback cache, pola saldo WR/SK),
// hitung produk/tingkat/pesanan, status diff terakhir, antrean needs_check.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { callPediaProxy, PEDIA_PROVIDERS } from "@/lib/pedia/proxy";

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
       (SELECT COUNT(*) FROM pedia_tiers) AS tiers,
       (SELECT COUNT(*) FROM pedia_tiers WHERE is_active=1) AS tiers_active,
       (SELECT COUNT(*) FROM pedia_tiers WHERE is_active=0 AND auto_disabled_reason IS NOT NULL) AS tiers_auto_disabled,
       (SELECT COUNT(*) FROM pedia_order_items WHERE status='needs_check') AS needs_check,
       (SELECT COUNT(*) FROM pedia_supplier_services) AS services`,
  );
  const settingsRows = await db.queryAll(
    `SELECT key, value FROM store_settings
      WHERE key IN ('pedia_diff_last_at','pedia_diff_last_change_at','pedia_balance_alert_at',
        'pedia_indosmm_diff_last_at','pedia_indosmm_diff_last_change_at','pedia_indosmm_balance_alert_at')`,
  );
  const settings: Record<string, string> = {};
  for (const r of settingsRows) settings[String(r.key)] = String(r.value ?? "");

  const providers = await Promise.all(PEDIA_PROVIDERS.map(async (supplier) => {
    const balance: { value: number | null; stale: boolean; history: { balance: number; created_at: string }[] } = { value: null, stale: true, history: [] };
    let error: string | null = null;
    let pricingVerified = false;
    try {
      const res = await callPediaProxy<{ balance?: unknown; currency?: unknown }>(supplier, "balance", {}, 15_000);
      if (!res.ok) error = res.kind;
      else if ((supplier === "indosmm" && res.data.currency !== "IDR") || (res.data.currency != null && res.data.currency !== "IDR") || res.data.balance == null || !Number.isFinite(Number(res.data.balance)) || Number(res.data.balance) < 0) error = "unsupported_currency";
      else {
        balance.value = Number(res.data.balance); balance.stale = false;
        if (supplier === "providersmm") pricingVerified = true;
        else {
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
  return NextResponse.json({ ok: true, counts, settings, providers, balance: providers[0].balance });
  } catch { return NextResponse.json({ error: "load_failed" }, { status: 500 }); }
}
