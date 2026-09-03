import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { execRun, queryFirst } from "@/lib/db";
import { isCategoryIconName } from "@/lib/category-icons";

export const runtime = "edge";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  icon: z.string().trim().refine(isCategoryIconName, "Ikon kategori tidak valid").optional(),
  sort_order: z.coerce.number().int().min(0).max(999).optional(),
}).strict();

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!(await queryFirst("SELECT id FROM categories WHERE id=?", id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Validasi gagal" }, { status: 400 });

  const fields: string[] = [];
  const values: unknown[] = [];
  if (parsed.data.name) {
    // Slug sengaja stabil saat label diganti agar link/filter lama tidak putus.
    fields.push("name=?");
    values.push(parsed.data.name);
  }
  if (parsed.data.icon !== undefined) {
    fields.push("icon=?");
    values.push(parsed.data.icon);
  }
  if (parsed.data.sort_order !== undefined) {
    fields.push("sort_order=?");
    values.push(parsed.data.sort_order);
  }
  if (!fields.length) return NextResponse.json({ ok: true });

  values.push(id);
  await execRun(`UPDATE categories SET ${fields.join(",")} WHERE id=?`, ...values);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (await queryFirst("SELECT id FROM products WHERE category_id=? LIMIT 1", id)) {
    return NextResponse.json(
      { error: "Kategori yang memiliki produk tidak dapat dihapus" },
      { status: 409 },
    );
  }
  const result = await execRun("DELETE FROM categories WHERE id=?", id);
  if (!result.changes) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
