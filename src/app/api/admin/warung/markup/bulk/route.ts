// POST /api/admin/warung/markup/bulk — Terapkan markup ke banyak varian
// SEKALIGUS (keputusan owner 2026-10-01: ubah 100+ varian satu-per-satu =
// 100+ klik + 100+ request).
//
// Kontrak: { variant_ids: string[] (1–200), markup_percent: 0–500,
// markup_fixed?: int, update_fixed?: boolean }. Bulk hanya ubah % secara
// default; markup_fixed dipertahankan per varian KECUALI update_fixed=true
// (reset Rp). Harga jual dihitung ulang dengan calculateSellPrice yang SAMA
// seperti PUT satuan + product_variants ikut berubah. Kembalikan
// { ok, updated, failed: [{id, error}] } — jujur sebagian, bukan all-or-nothing.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { queryFirst, execRun } from "@/lib/db";
import { calculateSellPrice } from "@/lib/warung-rebahan/sync";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const bulkSchema = z.object({
  variant_ids: z.array(z.string().trim().min(1).max(120)).min(1).max(200),
  markup_percent: z.coerce.number().int().min(0).max(500),
  markup_fixed: z.coerce.number().int().min(0).max(999_999_999).default(0),
  // false = % saja yang berubah, Rp per varian dipertahankan (default aman).
  // true = Rp ikut ditimpa markup_fixed (mis. reset ke 0).
  update_fixed: z.coerce.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = bulkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "validation_failed" }, { status: 400 });
  }
  const { variant_ids, markup_percent, markup_fixed, update_fixed } = parsed.data;
  const now = new Date().toISOString();
  // Dedup ID agar 1 varian tidak dihitung 2x.
  const ids = [...new Set(variant_ids)];
  let updated = 0;
  const failed: { id: string; error: string }[] = [];
  for (const id of ids) {
    try {
      const row = await queryFirst(
        `SELECT wr_price, markup_fixed, axvara_variant_id FROM wr_variants WHERE wr_variant_id=?`,
        id,
      );
      if (!row) {
        failed.push({ id, error: "variant_not_found" });
        continue;
      }
      const fixed = update_fixed ? markup_fixed : Number(row.markup_fixed ?? 0);
      const sellPrice = calculateSellPrice(Number(row.wr_price), markup_percent, fixed);
      await execRun(
        `UPDATE wr_variants SET markup_percent=?, markup_fixed=?, axvara_sell_price=?,
          last_synced_at=?, updated_at=? WHERE wr_variant_id=?`,
        markup_percent,
        fixed,
        sellPrice,
        now,
        now,
        id,
      );
      if (row.axvara_variant_id != null) {
        // Harga coret milik admin: NULL-kan bila tak lagi membentuk diskon
        // valid agar CHECK compare_price > price tidak menolak UPDATE harga
        // (insiden Alight/Viu 2026-10-06).
        await execRun(
          `UPDATE product_variants SET price=?, compare_price=CASE WHEN compare_price IS NOT NULL AND compare_price <= ? THEN NULL ELSE compare_price END, updated_at=datetime('now') WHERE id=?`,
          sellPrice,
          sellPrice,
          Number(row.axvara_variant_id),
        ).catch(() => undefined);
      }
      updated++;
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : "update_failed" });
    }
  }
  return NextResponse.json({ ok: true, updated, failed });
}
