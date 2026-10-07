// GET /api/admin/pedia/overview — Ringkasan tab Pedia (§10 Pengaturan + header):
// saldo ProviderSMM live (best-effort + fallback cache, pola saldo WR/SK),
// hitung produk/tingkat/pesanan, status diff terakhir, antrean needs_check.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createDatabaseAccess();
  const counts = await db.queryFirst(
    `SELECT
       (SELECT COUNT(*) FROM pedia_products) AS products,
       (SELECT COUNT(*) FROM pedia_products WHERE is_active=1) AS products_active,
       (SELECT COUNT(*) FROM pedia_tiers) AS tiers,
       (SELECT COUNT(*) FROM pedia_tiers WHERE is_active=1) AS tiers_active,
       (SELECT COUNT(*) FROM pedia_tiers WHERE is_active=0 AND auto_disabled_reason IS NOT NULL) AS tiers_auto_disabled,
       (SELECT COUNT(*) FROM pedia_order_items WHERE status='needs_check') AS needs_check,
       (SELECT COUNT(*) FROM pedia_supplier_services) AS services`,
  ).catch(() => null);
  const settingsRows = await db.queryAll(
    `SELECT key, value FROM store_settings
      WHERE key IN ('pedia_diff_last_at','pedia_diff_last_change_at','pedia_balance_alert_at')`,
  ).catch(() => []);
  const settings: Record<string, string> = {};
  for (const r of settingsRows) settings[String(r.key)] = String(r.value ?? "");

  // Saldo supplier live via proxy (best-effort; fallback riwayat D1).
  const balance: { value: number | null; stale: boolean; history: { balance: number; created_at: string }[] } = {
    value: null, stale: true, history: [],
  };
  try {
    const { callPsmmProxy } = await import("@/lib/pedia/proxy");
    const res = await callPsmmProxy<{ balance?: string | number }>("balance", {}, 15_000);
    if (res.ok) {
      const v = Number((res.data as { balance?: unknown })?.balance);
      if (Number.isFinite(v)) {
        balance.value = v;
        balance.stale = false;
        await db.execRun(
          `INSERT INTO pedia_supplier_balance_log (supplier, balance) VALUES ('providersmm', ?)`,
          v,
        ).catch(() => null);
      }
    }
  } catch { /* fallback di bawah */ }
  const history = await db.queryAll(
    `SELECT balance, created_at FROM pedia_supplier_balance_log
      WHERE supplier='providersmm' ORDER BY id DESC LIMIT 10`,
  ).catch(() => []);
  balance.history = history.map((h) => ({ balance: Number(h.balance), created_at: String(h.created_at) }));
  if (balance.value === null && history[0]) balance.value = Number(history[0].balance);

  return NextResponse.json({ ok: true, counts, settings, balance });
}
