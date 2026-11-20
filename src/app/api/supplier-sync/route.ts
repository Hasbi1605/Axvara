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
//         | { source: "indosmm", services: PediaService[], removed_service_ids: number[], heartbeat?: true }
//   2xx = TERSIMPAN (VPS baru memajukan snapshot-nya). 409 supplier_disabled
//   = tidak diterapkan; VPS baru harus menunda supplier itu tanpa memajukan snapshot.
// Batas per request: 10 produk WR / 30 baris SK / 200 id dihapus /
// 100 layanan IndoSMM.

import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http-body";
import { constantTimeEqual } from "@/lib/security";
import { createDatabaseAccess } from "@/lib/db-access";
import { isPediaProvider } from "@/lib/pedia/proxy";
import { recordSyncError } from "@/lib/sync-status";

export const runtime = "edge";

const MAX_WR_PRODUCTS = 10;
const MAX_SK_ROWS = 30;
const MAX_REMOVED = 200;
const supplierDisabled = (supplier: "wr" | "sk") => NextResponse.json(
  { ok: false, applied: false, error: "supplier_disabled", supplier },
  { status: 409 },
);

export async function POST(request: NextRequest) {
  const expected = process.env.SUPPLIER_SYNC_TOKEN || "";
  if (!expected) return NextResponse.json({ error: "supplier_sync_not_configured" }, { status: 503 });
  if (!constantTimeEqual(request.headers.get("x-supplier-sync-token") ?? "", expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const bounded = await readJsonBody(request, 2 * 1024 * 1024);
  if (!bounded.ok) return bounded.response;
  const body = bounded.data as Record<string, unknown> | null;
  // Cabang PEDIA: diff VPS memakai `source` agar tidak bentrok dengan
  // `supplier` WR/SK yang existing.
  // 2026-11-13 (owner): supplier lama sudah dipensiunkan, tetapi VPS masih
  // mengirim diff-nya. Balas 200 tanpa MENULIS apa pun ke D1 supaya snapshot
  // VPS maju tanpa retry berulang. Cabang ini sementara sampai VPS berhenti
  // mengirim; diff IndoSMM di bawah tidak berubah.
  if (body && body.source === "providersmm") {
    return NextResponse.json({ ok: true, ignored: true });
  }
  if (body && isPediaProvider(body.source)) {
    const services = Array.isArray(body.services) ? body.services : null;
    if (!services) return NextResponse.json({ error: "invalid_services" }, { status: 400 });
    if (services.length > 100) return NextResponse.json({ error: "too_many_services" }, { status: 413 });
    const removed = Array.isArray(body.removed_service_ids)
      ? body.removed_service_ids
      : [];
    if (removed.length > 100) return NextResponse.json({ error: "too_many_removed" }, { status: 413 });
    const db = createDatabaseAccess();
    const { applyPediaDiff } = await import("@/lib/pedia/sync");
    let result;
    try {
      result = await applyPediaDiff(db, body.source, services as never, removed as number[], typeof body.currency === "string" ? body.currency : undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "sync_failed";
      await recordSyncError(db, "pedia_indosmm_diff", message);
      return NextResponse.json({ error: message }, { status: /^(invalid_|unsupported_currency)/.test(message) ? 400 : 500 });
    }
    if (result.errors.length) {
      await recordSyncError(db, "pedia_indosmm_diff", result.errors[0]);
      return NextResponse.json({ ok: false, errors: result.errors.slice(0, 3) }, { status: 500 });
    }
    // Penanda "terakhir berubah" hanya ditulis setelah cermin tersimpan penuh.
    const prefix = "pedia_indosmm_diff";
    try {
      await db.execRun(
        `INSERT INTO store_settings (key, value, updated_at) VALUES (?, datetime('now'), datetime('now')), (?, '', datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
        `${prefix}_last_at`,
        `${prefix}_last_error`,
      );
      if (result.upserted > 0 || result.markedMissing > 0) {
        await db.execRun(
          `INSERT INTO store_settings (key, value, updated_at) VALUES (?, datetime('now'), datetime('now'))
            ON CONFLICT(key) DO UPDATE SET value=datetime('now'), updated_at=datetime('now')`,
          `${prefix}_last_change_at`,
        );
      }
    } catch { /* penanda best-effort */ }
    return NextResponse.json({
      ok: true, upserted: result.upserted, missing: result.markedMissing,
      repriced: result.tiersRepriced, auto_disabled: result.tiersAutoDisabled,
      errors: result.errors.slice(0, 3),
    });
  }
  if (!body || (body.supplier !== "wr" && body.supplier !== "sk")) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const removed = Array.isArray(body.removed_variant_ids) ? body.removed_variant_ids.map(String) : [];
  if (removed.length > MAX_REMOVED) return NextResponse.json({ error: "too_many_removed" }, { status: 413 });
  const db = createDatabaseAccess();

  if (body.supplier === "wr") {
    const { isWrSyncEnabled } = await import("@/lib/warung-rebahan/client");
    if (!isWrSyncEnabled()) return supplierDisabled("wr");
    const products = Array.isArray(body.products) ? body.products : null;
    if (!products) return NextResponse.json({ error: "invalid_products" }, { status: 400 });
    if (products.length > MAX_WR_PRODUCTS) return NextResponse.json({ error: "too_many_products" }, { status: 413 });
    const { syncProducts } = await import("@/lib/warung-rebahan/sync");
    const result = await syncProducts(db, undefined, {
      trigger: "cron",
      applyOnly: { products: products as never, removedVariantIds: removed },
    });
    if (result.errors.length) {
      return NextResponse.json({ ok: false, errors: result.errors.slice(0, 3) }, { status: 500 });
    }
    return NextResponse.json({
      ok: true, synced: result.synced, variants: result.variantsSynced,
      stock_changes: result.stockChanges, price_changes: result.priceChanges,
      errors: result.errors.slice(0, 3),
    });
  }

  const { isSkEnabled, isSkSyncEnabled } = await import("@/lib/sekalipay/client");
  if (!isSkEnabled()) return supplierDisabled("sk");
  if (body.action === "pairs") {
    // Request terpisah agar biaya CPU-nya tidak menumpuk dengan penerapan diff.
    const { decideDirtyWinners } = await import("@/lib/supplier-pairs");
    try {
      const pairs = await decideDirtyWinners(db);
      return NextResponse.json({ ok: true, pairs_decided: pairs.decided, pairs_changed: pairs.changed });
    } catch {
      return NextResponse.json({ ok: false, error: "pair_update_failed" }, { status: 503 });
    }
  }
  if (!isSkSyncEnabled()) return supplierDisabled("sk");
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows) return NextResponse.json({ error: "invalid_rows" }, { status: 400 });
  if (rows.length > MAX_SK_ROWS) return NextResponse.json({ error: "too_many_rows" }, { status: 413 });
  const { syncSkProducts } = await import("@/lib/sekalipay/sync");
  const result = await syncSkProducts(db, undefined, {
    trigger: "cron",
    applyOnly: { rows: rows as never, removedVariantIds: removed },
  });
  if (result.errors.length) {
    return NextResponse.json({ ok: false, errors: result.errors.slice(0, 3) }, { status: 500 });
  }
  return NextResponse.json({
    ok: true, synced: result.synced, variants: result.variantsSynced,
    stock_changes: result.stockChanges, price_changes: result.priceChanges,
    errors: result.errors.slice(0, 3),
  });
}
