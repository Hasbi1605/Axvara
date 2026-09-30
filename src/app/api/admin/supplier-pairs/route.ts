// GET /api/admin/supplier-pairs — Daftar 28 pasangan + stok/modal live.
// PUT — {id, prefer, prefer_margin}: simpan preferensi + hitung ulang
// pemenang pasangan itu (stok+modal live saat ini).

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryAll, queryFirst, execRun } from "@/lib/db";
import { z } from "zod";

export const runtime = "edge";
export const dynamic = "force-dynamic";

async function pairDetails(): Promise<Record<string, unknown>[]> {
  const pairs = await queryAll(`SELECT * FROM supplier_pairs ORDER BY id`).catch(() => []);
  const out: Record<string, unknown>[] = [];
  for (const pair of pairs) {
    const wrId = Number(pair.wr_product_id ?? 0);
    const skId = Number(pair.sk_product_id ?? 0);
    const [wr, sk, wrStock, skStock, wrModal, skModal] = await Promise.all([
      queryFirst(`SELECT id, name, is_active FROM products WHERE id=?`, wrId).catch(() => null),
      queryFirst(`SELECT id, name, is_active FROM products WHERE id=?`, skId).catch(() => null),
      queryFirst(
        `SELECT COALESCE(SUM(CASE WHEN stock>0 THEN stock ELSE 0 END),0) AS s FROM product_variants WHERE product_id=? AND is_active=1`,
        wrId,
      ).catch(() => null),
      queryFirst(
        `SELECT COALESCE(SUM(CASE WHEN stock>0 THEN stock ELSE 0 END),0) AS s FROM product_variants WHERE product_id=? AND is_active=1`,
        skId,
      ).catch(() => null),
      queryFirst(
        `SELECT MIN(w.wr_price) AS m FROM wr_variants w JOIN product_variants v ON v.wr_variant_id=w.wr_variant_id WHERE v.product_id=? AND v.is_active=1 AND w.wr_stock>0`,
        wrId,
      ).catch(() => null),
      queryFirst(
        `SELECT MIN(s.sk_price) AS m FROM sk_products s JOIN product_variants v ON v.sk_variant_id=s.sk_variant_id WHERE v.product_id=? AND v.is_active=1 AND s.sk_stock>0`,
        skId,
      ).catch(() => null),
    ]);
    out.push({
      ...pair,
      wr_name: String(wr?.name ?? `#${wrId}?`),
      wr_active: Number(wr?.is_active ?? 0) === 1,
      wr_stock: Number(wrStock?.s ?? 0),
      wr_modal: wrModal?.m != null ? Number(wrModal.m) : null,
      sk_name: String(sk?.name ?? `#${skId}?`),
      sk_active: Number(sk?.is_active ?? 0) === 1,
      sk_stock: Number(skStock?.s ?? 0),
      sk_modal: skModal?.m != null ? Number(skModal.m) : null,
    });
  }
  return out;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ pairs: await pairDetails() });
}

const preferSchema = z.object({
  id: z.coerce.number().int().positive(),
  prefer: z.enum(["auto", "WR", "SK"]),
  prefer_margin: z.coerce.number().int().min(0).max(999_999_999).default(2000),
});

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = preferSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  const { id, prefer, prefer_margin } = parsed.data;
  const now = new Date().toISOString();
  await execRun(
    `UPDATE supplier_pairs SET prefer=?, prefer_margin=?, updated_at=? WHERE id=?`,
    prefer, prefer_margin, now, id,
  );
  // Hitung ulang pemenang pasangan ini dari stok+modal live.
  try {
    const { createDatabaseAccess } = await import("@/lib/db-access");
    const pairsMod = await import("@/lib/supplier-pairs");
    type PairRow = import("@/lib/supplier-pairs").PairRow;
    const db = createDatabaseAccess();
    const row = (await db.queryFirst(`SELECT * FROM supplier_pairs WHERE id=?`, id).catch(() => null)) as unknown as PairRow | null;
    if (row) {
      const { winner, reason } = await pairsMod.decideOneWinner({ ...row, prefer: prefer as PairRow["prefer"], prefer_margin }, db);
      await db.execRun(
        `UPDATE supplier_pairs SET winner=?, decided_at=?, reason=?, updated_at=? WHERE id=?`,
        winner, now, reason.slice(0, 300), now, id,
      ).catch(() => ({ changes: 0 }));
      return NextResponse.json({ ok: true, winner, reason });
    }
  } catch { /* prefer tersimpan; sweep berikut hitung ulang */ }
  return NextResponse.json({ ok: true });
}
