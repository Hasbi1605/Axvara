import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getD1, isD1Mode, queryAll, execRun } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { readJsonBody } from "@/lib/http-body";
import { checkRateLimit } from "@/lib/rateLimit";
import { sortCategoriesForDisplay, type OrderableCategory } from "@/lib/product-order";
import { computeProductLiveStatusMap } from "@/lib/product-live-status";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const input = z.object({
  productId: z.coerce.number().int().positive(),
  // Langkah: ↑↓ satu posisi, atau lompat langsung ke posisi 1..N di antara
  // produk live dalam kategori yang sama. Salah satu wajib ada.
  direction: z.union([z.literal(-1), z.literal(1)]).optional(),
  targetPosition: z.coerce.number().int().min(1).max(9999).optional(),
}).strict().refine((v) => v.direction !== undefined || v.targetPosition !== undefined, {
  message: "direction atau targetPosition wajib diisi.",
});

type ProductOrderRow = {
  id: number;
  is_active: number;
  stock: number;
  sort_order: number | null;
  category_id: number | null;
  category_slug: string | null;
  cat_slug?: string | null;
  category_name: string | null;
  category_order: number | null;
  group_id: number | null;
};

type ReorderUnit = {
  unitKey: string;
  members: ProductOrderRow[];
  sortKey: number;
  minId: number;
  hasLive: boolean;
};

/**
 * POST /api/products/reorder
 *
 * Satu-satunya jalur UI untuk reorder. Dua mode:
 * - { productId, direction } — geser ke tetangga live berikutnya (−1 / +1).
 * - { productId, targetPosition } — lompat langsung ke posisi 1..N di antara
 *   produk live dalam kategori (dijepit ke rentang live + clamped:true).
 *
 * `sort_order` adalah KUNCI slot intent yang independen dari stok/status:
 * produk habis, nonaktif, atau pecundang grup mempertahankan slot relatifnya,
 * dan seluruh anggota satu grup berbagi satu unit serta satu `sort_order`.
 * Hanya baris yang key-nya berubah yang ditulis dalam satu D1 batch atomik.
 */
export async function POST(request: NextRequest) {
  if (!checkRateLimit(request, "products:reorder")) {
    return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const bounded = await readJsonBody(request, 64_000);
  if (!bounded.ok && bounded.response.status === 413) return bounded.response;
  const parsed = input.safeParse(bounded.ok ? bounded.data : null);
  if (!parsed.success) return NextResponse.json({ error: "Permintaan reorder tidak valid." }, { status: 400 });

  const rows = await queryAll(
    `SELECT p.id, p.is_active, p.stock, p.sort_order, p.category_id,
            c.slug AS category_slug, c.name AS category_name, c.sort_order AS category_order,
            gm.group_id AS group_id
     FROM products p
     LEFT JOIN categories c ON c.id=p.category_id
     LEFT JOIN product_group_members gm ON gm.product_id=p.id
     WHERE p.archived_at IS NULL`,
  ) as ProductOrderRow[];

  const targetRow = rows.find((row) => Number(row.id) === parsed.data.productId);
  if (!targetRow) return NextResponse.json({ error: "not found" }, { status: 404 });

  const liveStatusMap = await computeProductLiveStatusMap(rows);
  if (liveStatusMap.get(String(parsed.data.productId))?.status !== "live") {
    return NextResponse.json({ error: "Produk tidak tampil di toko; atur urutan dari tab Live." }, { status: 409 });
  }

  const categoryMap = new Map<number, OrderableCategory>();
  const rowsByCategory = new Map<number | null, ProductOrderRow[]>();
  for (const row of rows) {
    const slug = row.category_slug ?? row.cat_slug ?? null;
    const hasKnownCategory = row.category_id != null && slug != null;
    const catKey = hasKnownCategory ? Number(row.category_id) : null;
    if (hasKnownCategory && !categoryMap.has(catKey!)) {
      categoryMap.set(catKey!, {
        id: catKey!,
        slug,
        name: row.category_name ?? slug,
        sort_order: row.category_order ?? 0,
      });
    }
    const list = rowsByCategory.get(catKey) ?? [];
    list.push(row);
    rowsByCategory.set(catKey, list);
  }
  const orderedCategoryKeys: (number | null)[] = [
    ...sortCategoriesForDisplay([...categoryMap.values()]).map((c) => Number(c.id)),
    null,
  ].filter((key) => rowsByCategory.has(key));

  const unitsByCategory = new Map<number | null, ReorderUnit[]>();
  for (const catKey of orderedCategoryKeys) {
    const catRows = rowsByCategory.get(catKey)!;
    const byUnit = new Map<string, ProductOrderRow[]>();
    for (const row of catRows) {
      const unitKey = row.group_id != null ? `g:${Number(row.group_id)}` : `p:${Number(row.id)}`;
      const list = byUnit.get(unitKey) ?? [];
      list.push(row);
      byUnit.set(unitKey, list);
    }
    const units: ReorderUnit[] = [];
    for (const [unitKey, members] of byUnit) {
      members.sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || Number(a.id) - Number(b.id));
      const sortKey = Math.min(...members.map((m) => Number(m.sort_order ?? 0)));
      const minId = Math.min(...members.map((m) => Number(m.id)));
      const hasLive = members.some((m) => liveStatusMap.get(String(m.id))?.status === "live");
      units.push({ unitKey, members, sortKey, minId, hasLive });
    }
    units.sort((a, b) => a.sortKey - b.sortKey || a.minId - b.minId);
    unitsByCategory.set(catKey, units);
  }

  const targetSlug = targetRow.category_slug ?? targetRow.cat_slug ?? null;
  const targetCatKey = targetRow.category_id != null && targetSlug != null ? Number(targetRow.category_id) : null;
  const targetUnitKey = targetRow.group_id != null ? `g:${Number(targetRow.group_id)}` : `p:${Number(targetRow.id)}`;
  let intentUnits = unitsByCategory.get(targetCatKey)!;
  const targetUnit = intentUnits.find((u) => u.unitKey === targetUnitKey)!;
  const visible = intentUnits.filter((u) => u.hasLive);
  const visibleIndex = visible.findIndex((u) => u.unitKey === targetUnitKey);

  let clamped = false;
  if (parsed.data.targetPosition !== undefined) {
    const clampedPosition = Math.max(1, Math.min(visible.length, parsed.data.targetPosition));
    clamped = clampedPosition !== parsed.data.targetPosition;
    const rest = visible.filter((u) => u.unitKey !== targetUnitKey);
    if (rest.length > 0) {
      const withoutTarget = intentUnits.filter((u) => u.unitKey !== targetUnitKey);
      if (clampedPosition <= rest.length) {
        const anchor = rest[clampedPosition - 1];
        const anchorIndex = withoutTarget.findIndex((u) => u.unitKey === anchor.unitKey);
        withoutTarget.splice(anchorIndex, 0, targetUnit);
      } else {
        const lastAnchor = rest[rest.length - 1];
        const anchorIndex = withoutTarget.findIndex((u) => u.unitKey === lastAnchor.unitKey);
        withoutTarget.splice(anchorIndex + 1, 0, targetUnit);
      }
      intentUnits = withoutTarget;
    }
  } else {
    const neighbor = visible[visibleIndex + parsed.data.direction!];
    if (!neighbor) {
      return NextResponse.json({ error: "Produk sudah berada di batas kelompoknya." }, { status: 409 });
    }
    const withoutTarget = intentUnits.filter((u) => u.unitKey !== targetUnitKey);
    const neighborIndex = withoutTarget.findIndex((u) => u.unitKey === neighbor.unitKey);
    const insertAt = parsed.data.direction === -1 ? neighborIndex : neighborIndex + 1;
    withoutTarget.splice(insertAt, 0, targetUnit);
    intentUnits = withoutTarget;
  }
  unitsByCategory.set(targetCatKey, intentUnits);

  const desired: { id: number; sortOrder: number }[] = [];
  let slotIndex = 0;
  for (const catKey of orderedCategoryKeys) {
    for (const unit of unitsByCategory.get(catKey)!) {
      const sortOrder = (slotIndex + 1) * 10;
      slotIndex++;
      for (const member of unit.members) {
        desired.push({ id: Number(member.id), sortOrder });
      }
    }
  }

  const currentById = new Map(rows.map((r) => [Number(r.id), r]));
  // Hemat write D1: hanya baris yang key-nya benar-benar berubah.
  const changed = desired.filter((row) => {
    const current = currentById.get(row.id);
    return !current || current.sort_order == null || Number(current.sort_order) !== row.sortOrder;
  });
  const d1 = getD1();
  try {
    if (changed.length > 0) {
      if (d1) {
        // D1 batch = transaksi: pembaca tidak pernah melihat setengah urutan.
        await d1.batch(changed.map((row) =>
          d1.prepare("UPDATE products SET sort_order=?, updated_at=datetime('now') WHERE id=? AND archived_at IS NULL")
            .bind(row.sortOrder, row.id),
        ));
      } else {
        // Dev tanpa D1: fallback berurutan. Produksi selalu memakai batch D1.
        for (const row of changed) {
          await execRun("UPDATE products SET sort_order=?, updated_at=datetime('now') WHERE id=? AND archived_at IS NULL", row.sortOrder, row.id);
        }
      }
    }
  } catch (error) {
    console.error("product_reorder_failed", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Gagal menyimpan urutan produk." }, { status: 500 });
  }

  if (changed.length > 0) {
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("market", d1);
  }

  return NextResponse.json({
    ok: true,
    moved: parsed.data.productId,
    clamped,
    products: desired,
    d1: isD1Mode(),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
