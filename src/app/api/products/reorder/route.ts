import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getD1, isD1Mode, queryAll, execRun } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { adjacentReorderProduct, productOrderBucket, sortProductsForDisplay } from "@/lib/product-order";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const input = z.object({
  productId: z.coerce.number().int().positive(),
  // Langkah: ↑↓ satu posisi (legacy), atau lompat langsung ke posisi 1..N
  // lewat badge yang bisa diketik. Salah satu wajib ada.
  direction: z.union([z.literal(-1), z.literal(1)]).optional(),
  targetPosition: z.coerce.number().int().min(1).max(9999).optional(),
}).strict().refine((v) => v.direction !== undefined || v.targetPosition !== undefined, {
  message: "direction atau targetPosition wajib diisi.",
});

type ProductOrderRow = {
  id: number;
  is_active: number;
  stock: number;
  sort_order: number;
};

/**
 * POST /api/products/reorder
 *
 * Satu-satunya jalur UI untuk reorder. Dua mode:
 * - { productId, direction } — geser tepat satu posisi (tombol ↑↓).
 * - { productId, targetPosition } — lompat langsung ke posisi 1..N
 *   (badge posisi yang bisa diketik; 30 → 1 dalam SATU request, bukan 29× klik).
 *
 * Server membaca urutan kanonis, memindahkan target, lalu menormalisasi
 * SELURUH kunci menjadi 10,20,30… dalam satu D1 batch transaksional.
 * Normalisasi sengaja ikut tiap aksi: data lama/tab lama/API manual yang
 * membuat key kembar tidak dapat menyebabkan klik berikutnya melompat.
 *
 * Batas bucket status: target tidak bisa melewati batas aktif-ready /
 * aktif-habis / nonaktif (sort_order memang tidak bisa melewatinya) —
 * targetPosition yang keluar bucket dijepit ke ujung bucket + 409 jujur.
 * Hanya baris yang key-nya berubah yang ditulis ulang (hemat write D1,
 * bukan full-rewrite buta tiap klik).
 */
export async function POST(request: NextRequest) {
  if (!checkRateLimit(request, "products:reorder")) {
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
  const target = ordered[targetIndex];
  const bucket = productOrderBucket(target);
  // Index global tetangga se-bucket: inilah "satu posisi" yang sebenarnya.
  const bucketMembers = ordered.filter((row) => productOrderBucket(row) === bucket);
  const bucketIndex = bucketMembers.findIndex((row) => Number(row.id) === parsed.data.productId);

  let clamped = false;
  if (parsed.data.targetPosition !== undefined) {
    // Lompat: keluarkan target, jepit posisi ke dalam bucket, sisipkan lagi.
    const clampedPosition = Math.max(1, Math.min(bucketMembers.length, parsed.data.targetPosition));
    clamped = clampedPosition !== parsed.data.targetPosition;
    const rest = bucketMembers.filter((row) => Number(row.id) !== parsed.data.productId);
    rest.splice(clampedPosition - 1, 0, target);
    // Rakit ulang urutan global: bucket lain tidak tersentuh.
    let cursor = 0;
    for (let i = 0; i < ordered.length; i++) {
      if (productOrderBucket(ordered[i]) === bucket) ordered[i] = rest[cursor++];
    }
  } else {
    const neighbor = adjacentReorderProduct(rows, parsed.data.productId, parsed.data.direction!);
    if (!neighbor) {
      return NextResponse.json({ error: "Produk sudah berada di batas kelompoknya." }, { status: 409 });
    }
    const neighborIndex = ordered.findIndex((row) => Number(row.id) === Number(neighbor.id));
    [ordered[targetIndex], ordered[neighborIndex]] = [ordered[neighborIndex], ordered[targetIndex]];
  }
  void bucketIndex;

  const desired = ordered.map((row, index) => ({ id: Number(row.id), sortOrder: (index + 1) * 10 }));
  // Hemat write D1: hanya baris yang key-nya benar-benar berubah.
  const changed = desired.filter((row) => {
    const current = rows.find((r) => Number(r.id) === row.id);
    return !current || Number(current.sort_order ?? 0) !== row.sortOrder;
  });
  const d1 = getD1();
  try {
    if (changed.length > 0) {
      if (d1) {
        // D1 batch = transaksi: pembaca tidak pernah melihat setengah urutan.
        await d1.batch(changed.map((row) =>
          d1.prepare("UPDATE products SET sort_order=?, updated_at=datetime('now') WHERE id=?")
            .bind(row.sortOrder, row.id),
        ));
      } else {
        // Dev tanpa D1: fallback berurutan. Produksi selalu memakai batch D1.
        for (const row of changed) {
          await execRun("UPDATE products SET sort_order=?, updated_at=datetime('now') WHERE id=?", row.sortOrder, row.id);
        }
      }
    }
  } catch (error) {
    console.error("product_reorder_failed", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Gagal menyimpan urutan produk." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    moved: parsed.data.productId,
    clamped,
    products: desired,
    d1: isD1Mode(),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
