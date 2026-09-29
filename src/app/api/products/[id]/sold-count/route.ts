import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryFirst, execRun, getD1 } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const input = z.object({
  // Angka Terjual final yang diinginkan admin (SET absolut, bukan +=).
  // Increment pembelian asli tetap += qty di jalur order (tidak tersentuh).
  soldCount: z.coerce.number().int().min(0).max(9999999),
}).strict();

/**
 * PATCH /api/products/[id]/sold-count
 *
 * Edit cepat angka Terjual dari kolom tabel admin (tanpa buka modal).
 * SET absolut ke sold_count — pembelian asli tetap menambah via
 * `sold_count += qty` di incrementSoldCountForOrder, jadi angka manual
 * hanya jadi baseline baru dan tidak merusak perilaku sistem.
 * sold_count milik admin untuk SEMUA produk (manual + WR): sync WR dan
 * cron tidak pernah menulis kolom ini.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkRateLimit(request, "products:write")) {
    return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Angka Terjual tidak valid (0–9999999)." }, { status: 400 });

  const existing = await queryFirst("SELECT id, sold_count FROM products WHERE id=?", id) as { id: number; sold_count: number | null } | undefined;
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (Number(existing.sold_count ?? 0) === parsed.data.soldCount) {
    return NextResponse.json({ ok: true, soldCount: Number(existing.sold_count ?? 0), unchanged: true });
  }

  const d1 = getD1();
  try {
    if (d1) {
      await d1.prepare("UPDATE products SET sold_count=?, updated_at=datetime('now') WHERE id=?")
        .bind(parsed.data.soldCount, id).run();
    } else {
      await execRun("UPDATE products SET sold_count=?, updated_at=datetime('now') WHERE id=?", parsed.data.soldCount, id);
    }
  } catch (error) {
    console.error("product_sold_count_failed", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Gagal menyimpan angka Terjual." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, soldCount: parsed.data.soldCount }, { headers: { "Cache-Control": "private, no-store" } });
}
