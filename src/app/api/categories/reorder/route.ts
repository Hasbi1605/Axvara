import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { execRun, getD1, queryAll } from "@/lib/db";
import { sortCategoriesForDisplay, type OrderableCategory } from "@/lib/product-order";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const input = z.object({ categoryId: z.number().int().positive(), direction: z.union([z.literal(-1), z.literal(1)]) }).strict();

export async function POST(request: NextRequest) {
  if (!checkRateLimit(request, "categories:reorder")) return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Permintaan reorder tidak valid." }, { status: 400 });
  const rows = await queryAll("SELECT id, name, slug, sort_order FROM categories ORDER BY sort_order, name, id") as OrderableCategory[];
  const ordered = sortCategoriesForDisplay(rows);
  const index = ordered.findIndex(category => Number(category.id) === parsed.data.categoryId);
  if (index < 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const next = index + parsed.data.direction;
  if (!ordered[next]) return NextResponse.json({ error: "Kategori sudah berada di batas daftar." }, { status: 409 });
  [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
  const categories = ordered.map((category, i) => ({ ...category, sort_order: (i + 1) * 10 }));
  const changed = categories.filter(category => Number(rows.find(row => row.id === category.id)?.sort_order ?? 0) !== category.sort_order);
  try {
    const db = getD1();
    if (db && changed.length) await db.batch(changed.map(category => db.prepare("UPDATE categories SET sort_order=? WHERE id=?").bind(category.sort_order, category.id)));
    else for (const category of changed) await execRun("UPDATE categories SET sort_order=? WHERE id=?", category.sort_order, category.id);
  } catch {
    return NextResponse.json({ error: "Gagal menyimpan urutan kategori." }, { status: 500 });
  }
  // Sama seperti PUT kategori: cache publik kedaluwarsa setelah 60 detik.
  return NextResponse.json({ ok: true, categories }, { headers: { "Cache-Control": "private, no-store" } });
}
