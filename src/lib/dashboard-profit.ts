// src/lib/dashboard-profit.ts — Agregat Untung Produk dashboard (Fase 1).
//
// Dipisah dari route overview agar bisa di-test murni tanpa D1 dan agar route
// hanya mengekspor handler Next (export tambahan merusak type route).

/**
 * Agregat top-5 produk penyumbang untung dari 500 order lunas terbaru.
 * Modal supplier order dialokasikan ke item-nya proporsional terhadap harga
 * (qty x price). Selisih pembulatan < Rp qty baris, dapat diabaikan.
 */
export function topProfitByItems(
  rows: Record<string, unknown>[],
): { name: string; qty: number; revenue: number; cost: number; profit: number }[] {
  const byName = new Map<string, { qty: number; revenue: number; cost: number }>();
  for (const row of rows) {
    let items: { name?: unknown; price?: unknown; qty?: unknown }[] = [];
    try {
      const parsed = JSON.parse(String(row.items || "[]"));
      if (Array.isArray(parsed)) items = parsed;
    } catch { continue; }
    const lines = items
      .map((entry) => ({
        name: String(entry.name || "Produk").slice(0, 80),
        qty: Math.max(1, Math.floor(Number(entry.qty || 1))),
        gross: Math.max(0, Math.floor(Number(entry.price || 0))) * Math.max(1, Math.floor(Number(entry.qty || 1))),
      }))
      .filter((line) => line.gross > 0);
    const orderGross = lines.reduce((sum, line) => sum + line.gross, 0);
    if (!orderGross) continue;
    const orderRevenue = Math.max(0, Math.floor(Number(row.revenue || 0)));
    const orderCost = Math.max(0, Math.floor(Number(row.supplier_cost || 0)));
    for (const line of lines) {
      const share = line.gross / orderGross;
      const prev = byName.get(line.name) ?? { qty: 0, revenue: 0, cost: 0 };
      prev.qty += line.qty;
      prev.revenue += Math.round(orderRevenue * share);
      prev.cost += Math.round(orderCost * share);
      byName.set(line.name, prev);
    }
  }
  return [...byName.entries()]
    .map(([name, agg]) => ({ name, ...agg, profit: agg.revenue - agg.cost }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 5);
}

/**
 * Isi 30 hari kalender WIB terakhir (termasuk hari ini) — tanggal tanpa order
 * = 0 agar garis grafik kontinu.
 */
export function fillDailySeries(
  rows: Record<string, unknown>[],
  now = new Date(),
): { date: string; orders: number; revenue: number; cost: number; profit: number }[] {
  const byDate = new Map<string, { orders: number; revenue: number; cost: number; profit: number }>();
  for (const row of rows) {
    const date = String(row.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    byDate.set(date, {
      orders: Number(row.orders || 0),
      revenue: Number(row.revenue || 0),
      cost: Number(row.cost || 0),
      profit: Number(row.profit || 0),
    });
  }
  const out: { date: string; orders: number; revenue: number; cost: number; profit: number }[] = [];
  const todayWib = new Date(now.getTime() + 7 * 3_600_000);
  for (let back = 29; back >= 0; back--) {
    const date = new Date(Date.UTC(todayWib.getUTCFullYear(), todayWib.getUTCMonth(), todayWib.getUTCDate() - back))
      .toISOString()
      .slice(0, 10);
    out.push({ date, ...(byDate.get(date) ?? { orders: 0, revenue: 0, cost: 0, profit: 0 }) });
  }
  return out;
}
