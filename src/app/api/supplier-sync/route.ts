// POST /api/supplier-sync — penerima DIFF katalog dari VPS proxy (2026-10-04).
//
// Latar: cron `/api/cron/operations` berjalan di Workers FREE (~10 ms CPU per
// request). Penanda langkah 4 Okt membuktikan route cron raksasa sudah memakan
// sebagian besar jatah CPU hanya untuk menyala, sehingga sweep katalog 10
// produk tetap dibunuh `exceededResources` saat platform ketat. VPS kini
// membandingkan katalog WR/SK tiap 3 menit dan mengirim HANYA produk/varian
// yang berubah ke route RAMPING ini (impor minimal, tanpa budget/fase cron).
//
// Kontrak (sinkron dengan `axvara-wr-proxy/src/diff-sync.ts`):
//   Header  x-supplier-sync-token: <SUPPLIER_SYNC_TOKEN>  (konstan-waktu)
//   Body    { supplier: "wr", products: WrProduct[], removed_variant_ids: string[] }
//         | { supplier: "sk", rows: SkFlatVariant[], removed_variant_ids: string[] }
//         | { supplier: "sk", action: "pairs" }   (hitung ulang pemenang WR vs SK)
//   2xx = TERSIMPAN (VPS baru memajukan snapshot-nya); selain itu VPS
//   mengirim ulang (penerapan idempoten).
// Batas per request: 10 produk WR / 30 baris SK / 200 id dihapus.

import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/security";
import { createDatabaseAccess } from "@/lib/db-access";

export const runtime = "edge";

const MAX_WR_PRODUCTS = 10;
const MAX_SK_ROWS = 30;
const MAX_REMOVED = 200;

export async function POST(request: NextRequest) {
  const expected = process.env.SUPPLIER_SYNC_TOKEN || "";
  if (!expected) return NextResponse.json({ error: "supplier_sync_not_configured" }, { status: 503 });
  if (!constantTimeEqual(request.headers.get("x-supplier-sync-token") ?? "", expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || (body.supplier !== "wr" && body.supplier !== "sk")) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const removed = Array.isArray(body.removed_variant_ids) ? body.removed_variant_ids.map(String) : [];
  if (removed.length > MAX_REMOVED) return NextResponse.json({ error: "too_many_removed" }, { status: 413 });
  const db = createDatabaseAccess();

  if (body.supplier === "wr") {
    const { isWrEnabled } = await import("@/lib/warung-rebahan/client");
    if (!isWrEnabled()) return NextResponse.json({ error: "warung_rebahan_disabled" }, { status: 503 });
    const products = Array.isArray(body.products) ? body.products : null;
    if (!products) return NextResponse.json({ error: "invalid_products" }, { status: 400 });
    if (products.length > MAX_WR_PRODUCTS) return NextResponse.json({ error: "too_many_products" }, { status: 413 });
    const { syncProducts } = await import("@/lib/warung-rebahan/sync");
    const result = await syncProducts(db, undefined, {
      trigger: "cron",
      applyOnly: { products: products as never, removedVariantIds: removed },
    });
    if (result.errors.length && result.synced === 0 && result.stockChanges === 0) {
      return NextResponse.json({ ok: false, errors: result.errors.slice(0, 3) }, { status: 500 });
    }
    return NextResponse.json({
      ok: true, synced: result.synced, variants: result.variantsSynced,
      stock_changes: result.stockChanges, price_changes: result.priceChanges,
      errors: result.errors.slice(0, 3),
    });
  }

  const { isSkEnabled } = await import("@/lib/sekalipay/client");
  if (!isSkEnabled()) return NextResponse.json({ error: "sekalipay_disabled" }, { status: 503 });
  if (body.action === "pairs") {
    // Request terpisah agar biaya CPU-nya tidak menumpuk dengan penerapan diff.
    const { decideAllWinners } = await import("@/lib/supplier-pairs");
    const pairs = await decideAllWinners(db);
    return NextResponse.json({ ok: true, pairs_decided: pairs.decided, pairs_changed: pairs.changed });
  }
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows) return NextResponse.json({ error: "invalid_rows" }, { status: 400 });
  if (rows.length > MAX_SK_ROWS) return NextResponse.json({ error: "too_many_rows" }, { status: 413 });
  const { syncSkProducts } = await import("@/lib/sekalipay/sync");
  const result = await syncSkProducts(db, undefined, {
    trigger: "cron",
    applyOnly: { rows: rows as never, removedVariantIds: removed },
  });
  if (result.errors.length && result.synced === 0 && result.stockChanges === 0) {
    return NextResponse.json({ ok: false, errors: result.errors.slice(0, 3) }, { status: 500 });
  }
  return NextResponse.json({
    ok: true, synced: result.synced, variants: result.variantsSynced,
    stock_changes: result.stockChanges, price_changes: result.priceChanges,
    errors: result.errors.slice(0, 3),
  });
}
