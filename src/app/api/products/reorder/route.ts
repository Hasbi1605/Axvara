import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getD1, isD1Mode, queryAll, execRun } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { adjacentReorderProduct, sortProductsForDisplay } from "@/lib/product-order";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const input = z.object({
  productId: z.coerce.number().int().positive(),
  direction: z.union([z.literal(-1), z.literal(1)]),
}).strict();

type ProductOrderRow = {
  id: number;
  is_active: number;
  stock: number;
  sort_order: number;
};

/**
 * POST /api/products/reorder
 *
 * Satu-satunya jalur UI untuk reorder. Server membaca urutan kanonis,
 * menukar tepat satu tetangga, lalu menormalisasi SELURUH kunci menjadi
 * 10,20,30… dalam satu D1 batch transaksional. Normalisasi sengaja ikut tiap
 * aksi: data lama/tab lama/API manual yang membuat key kembar tidak dapat
 * menyebabkan klik berikutnya melompat 2–3 posisi lagi.
 */
export async function POST(request: NextRequest) {
  if (!rateLimit(rateLimitKey(request, "products:write"), 20)) {
    return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Permintaan reorder tidak valid." }, { status: 400 });

  const rows = await queryAll(
    "SELECT id, is_active, stock, sort_order FROM products",
  ) as ProductOrderRow[];
  const ordered = sortProductsForDisplay(rows);
  const targetIndex = ordered.findIndex((row) => Number(row.id) === parsed.data.productId);
  if (targetIndex < 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const neighbor = adjacentReorderProduct(rows, parsed.data.productId, parsed.data.direction);
  if (!neighbor) {
    return NextResponse.json({ error: "Produk sudah berada di batas kelompoknya." }, { status: 409 });
  }
  const neighborIndex = ordered.findIndex((row) => Number(row.id) === Number(neighbor.id));
  [ordered[targetIndex], ordered[neighborIndex]] = [ordered[neighborIndex], ordered[targetIndex]];

  const desired = ordered.map((row, index) => ({ id: Number(row.id), sortOrder: (index + 1) * 10 }));
  const d1 = getD1();
  try {
    if (d1) {
      // D1 batch = transaksi: pembaca tidak pernah melihat setengah urutan.
      await d1.batch(desired.map((row) =>
        d1.prepare("UPDATE products SET sort_order=?, updated_at=datetime('now') WHERE id=?")
          .bind(row.sortOrder, row.id),
      ));
    } else {
      // Dev tanpa D1: fallback berurutan. Produksi selalu memakai batch D1.
      for (const row of desired) {
        await execRun("UPDATE products SET sort_order=?, updated_at=datetime('now') WHERE id=?", row.sortOrder, row.id);
      }
    }
  } catch (error) {
    console.error("product_reorder_failed", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Gagal menyimpan urutan produk." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    moved: parsed.data.productId,
    products: desired,
    d1: isD1Mode(),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
