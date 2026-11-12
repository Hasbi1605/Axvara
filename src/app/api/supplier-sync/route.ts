// POST /api/supplier-sync — penerima DIFF katalog dari VPS proxy (2026-10-04).
//
// Latar: cron `/api/cron/operations` berjalan di Workers FREE (~10 ms CPU per
// request). Penanda langkah 4 Okt membuktikan route cron raksasa sudah memakan
// sebagian besar jatah CPU hanya untuk menyala, sehingga sweep katalog 10
// produk tetap dibunuh `exceededResources` saat platform ketat. VPS kini
// membandingkan katalog WR/SK tiap 3 menit dan mengirim HANYA produk/varian
// yang berubah ke route RAMPING ini (impor minimal, tanpa budget/fase cron).
//
// Kontrak (sinkron dengan `axvara-wr-proxy/src/diff-sync.ts` + `src/psmm-diff.ts`):
//   Header  x-supplier-sync-token: <SUPPLIER_SYNC_TOKEN>  (konstan-waktu)
//   Body    { supplier: "wr", products: WrProduct[], removed_variant_ids: string[] }
//         | { supplier: "sk", rows: SkFlatVariant[], removed_variant_ids: string[] }
//         | { supplier: "sk", action: "pairs" }   (hitung ulang pemenang WR vs SK)
//         | { source: "providersmm", services: PsmmService[], removed_service_ids: number[], heartbeat?: true }
//   2xx = TERSIMPAN (VPS baru memajukan snapshot-nya); selain itu VPS
//   mengirim ulang (penerapan idempoten).
// Batas per request: 10 produk WR / 30 baris SK / 200 id dihapus /
// 100 layanan ProviderSMM.

import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http-body";
import { constantTimeEqual } from "@/lib/security";
import { createDatabaseAccess } from "@/lib/db-access";
import { isPediaProvider } from "@/lib/pedia/proxy";

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
  const bounded = await readJsonBody(request, 2 * 1024 * 1024);
  if (!bounded.ok) return bounded.response;
  const body = bounded.data as Record<string, unknown> | null;
  // Cabang PEDIA: diff VPS memakai `source` agar tidak bentrok dengan
  // `supplier` WR/SK yang existing.
  if (body && isPediaProvider(body.source)) {
    // 2026-11-12 (owner): ProviderSMM kembali menjadi supplier penjualan baru,
    // jadi diff-nya ditulis ke cermin D1 lewat jalur yang sama dengan IndoSMM
    // (yang tetap menerima diff untuk perawatan order/mirror lama).
    const services = Array.isArray(body.services) ? body.services : null;
    if (!services) return NextResponse.json({ error: "invalid_services" }, { status: 400 });
    if (services.length > 100) return NextResponse.json({ error: "too_many_services" }, { status: 413 });
    const removed = Array.isArray(body.removed_service_ids)
      ? body.removed_service_ids
      : [];
    if (removed.length > 100) return NextResponse.json({ error: "too_many_removed" }, { status: 413 });
    const db = createDatabaseAccess();
    const { applyPediaDiff } = await import("@/lib/pedia/sync");
    const { PEDIA_SALE_PROVIDER } = await import("@/lib/pedia/sales-policy");
    let result;
    try {
      result = await applyPediaDiff(db, body.source, services as never, removed as number[], typeof body.currency === "string" ? body.currency : undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "sync_failed";
      return NextResponse.json({ error: message }, { status: /^(invalid_|unsupported_currency)/.test(message) ? 400 : 500 });
    }
    if (result.errors.length) return NextResponse.json({ ok: false, errors: result.errors.slice(0, 3) }, { status: 500 });
    // PSMM-P2/P3: SELURUH id delta diantrekan durable (bukan slice-then-ack).
    // Pada tick heartbeat (delta kosong) metadata resmi di-refresh bila lewat
    // throttle 6 jam; kegagalan upstream mempertahankan last-good dan TIDAK
    // menggagalkan ack cermin. Satu potongan materialisasi dikuras per request;
    // sisa tetap pending untuk heartbeat berikut (tanpa memutar ulang awalan).
    let managed: { processed: number; remaining: number; errors: string[] } | null = null;
    let managedFailed = false;
    let metadata: { status: string } | null = null;
    if (body.source === PEDIA_SALE_PROVIDER) {
      const isEmptyTick = services.length === 0 && removed.length === 0;
      try {
        const mod = await import("@/lib/pedia/metadata-refresh");
        await mod.enqueueManagedWork(
          db,
          (services as { service_id: number }[]).map((s) => Number(s?.service_id)).filter((n) => Number.isSafeInteger(n) && n > 0),
          (removed as number[]).slice(),
        );
        if (isEmptyTick) {
          const count = Number((await db.queryFirst(
            `SELECT COUNT(*) AS n FROM pedia_supplier_services WHERE supplier=? AND present=1`, PEDIA_SALE_PROVIDER,
          ))?.n ?? 0);
          metadata = { status: (await mod.refreshSupplierDescriptions(db, count)).status };
          // Layanan baru/hilang dari antrean tetap ditemukan otomatis tanpa
          // resync manual: antrekan sebagian yang belum punya tier auto.
          await mod.enqueueUnmaterialized(db);
        }
        managed = await mod.drainManagedWork(db);
        // Hanya kegagalan TULIS yang menahan ack. `remaining>0` bukan kegagalan:
        // antrean durable menjamin kelanjutan tanpa ack palsu.
        if (managed.errors.length > 0) managedFailed = true;
      } catch {
        managed = { processed: 0, remaining: 1, errors: ["managed_failed"] };
        managedFailed = true;
      }
    }
    // Penanda per supplier: ProviderSMM memakai `pedia_diff`, IndoSMM tetap
    // `pedia_indosmm_diff` (dibaca admin overview/services).
    const prefix = body.source === "providersmm" ? "pedia_diff" : "pedia_indosmm_diff";
    // Penanda "terakhir berubah" hanya ketika cermin tersimpan penuh; ack
    // keseluruhan ditahan bila materialisasi belum selesai.
    try {
      if (!managedFailed) {
        await db.execRun(
          `INSERT INTO store_settings (key, value, updated_at) VALUES (?, datetime('now'), datetime('now'))
            ON CONFLICT(key) DO UPDATE SET value=datetime('now'), updated_at=datetime('now')`,
          `${prefix}_last_at`,
        );
      }
      if (!managedFailed && (result.upserted > 0 || result.markedMissing > 0)) {
        await db.execRun(
          `INSERT INTO store_settings (key, value, updated_at) VALUES (?, datetime('now'), datetime('now'))
            ON CONFLICT(key) DO UPDATE SET value=datetime('now'), updated_at=datetime('now')`,
          `${prefix}_last_change_at`,
        );
      }
    } catch { /* penanda best-effort */ }
    if (managedFailed) {
      return NextResponse.json({
        ok: false, upserted: result.upserted, missing: result.markedMissing,
        repriced: result.tiersRepriced, auto_disabled: result.tiersAutoDisabled,
        ...(managed ? { managed } : {}),
        ...(metadata ? { metadata } : {}),
        errors: ["managed_incomplete"],
      }, { status: 503 });
    }
    return NextResponse.json({
      ok: true, upserted: result.upserted, missing: result.markedMissing,
      repriced: result.tiersRepriced, auto_disabled: result.tiersAutoDisabled,
      ...(managed ? { managed } : {}),
      ...(metadata ? { metadata } : {}),
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
    const { decideDirtyWinners } = await import("@/lib/supplier-pairs");
    try {
      const pairs = await decideDirtyWinners(db);
      return NextResponse.json({ ok: true, pairs_decided: pairs.decided, pairs_changed: pairs.changed });
    } catch {
      return NextResponse.json({ ok: false, error: "pair_update_failed" }, { status: 503 });
    }
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
