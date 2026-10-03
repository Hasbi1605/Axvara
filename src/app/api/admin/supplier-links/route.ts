// GET /api/admin/supplier-links — Daftar shortlink internal axvara.tech/go/*.
// POST — {slug, destination, title?}: tambah link baru.
// PUT — {id, destination?, title?, is_active?}: ubah tujuan/judul/toggle.
// DELETE ?id= : hapus link (ada konfirmasi di UI).

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryAll, queryFirst, execRun } from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";
import { z } from "zod";
import {
  isValidSupplierSlug,
  normalizeSupplierDestination,
  normalizeSupplierLink,
} from "@/lib/supplier-links";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let links: ReturnType<typeof normalizeSupplierLink>[] = [];
  try {
    const rows = await queryAll(`SELECT * FROM supplier_links ORDER BY slug ASC`);
    links = rows.map(normalizeSupplierLink);
  } catch {
    links = [];
  }
  return NextResponse.json({ links }, { headers: NO_STORE });
}

const createSchema = z.object({
  slug: z.string().trim().toLowerCase().min(2).max(64),
  destination: z.string().trim().min(1).max(2048),
  title: z.string().trim().max(160).default(""),
});

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!checkRateLimit(request, "products:write")) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  const { slug, destination, title } = parsed.data;
  if (!isValidSupplierSlug(slug)) {
    return NextResponse.json({ error: "slug_tidak_valid_atau_dipesan" }, { status: 400 });
  }
  const dest = normalizeSupplierDestination(destination);
  if (!dest) return NextResponse.json({ error: "tujuan_tidak_valid" }, { status: 400 });
  const exists = await queryFirst(`SELECT id FROM supplier_links WHERE slug=?`, slug).catch(() => null);
  if (exists) return NextResponse.json({ error: "slug_sudah_ada" }, { status: 409 });
  const now = new Date().toISOString();
  const result = await execRun(
    `INSERT INTO supplier_links (slug, destination, title, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    slug, dest, title, 1, now, now,
  ).catch(() => null);
  if (!result) return NextResponse.json({ error: "gagal_menyimpan" }, { status: 500 });
  return NextResponse.json({ ok: true, id: result.lastInsertRowid });
}

const updateSchema = z.object({
  id: z.coerce.number().int().positive(),
  destination: z.string().trim().min(1).max(2048).optional(),
  title: z.string().trim().max(160).optional(),
  is_active: z.coerce.number().int().min(0).max(1).optional(),
});

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!checkRateLimit(request, "products:write")) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  const { id, destination, title, is_active } = parsed.data;
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (destination !== undefined) {
    const dest = normalizeSupplierDestination(destination);
    if (!dest) return NextResponse.json({ error: "tujuan_tidak_valid" }, { status: 400 });
    sets.push("destination=?");
    params.push(dest);
  }
  if (title !== undefined) {
    sets.push("title=?");
    params.push(title);
  }
  if (is_active !== undefined) {
    sets.push("is_active=?");
    params.push(is_active);
  }
  if (!sets.length) return NextResponse.json({ error: "tidak_ada_perubahan" }, { status: 400 });
  sets.push("updated_at=?");
  params.push(new Date().toISOString(), id);
  const result = await execRun(`UPDATE supplier_links SET ${sets.join(", ")} WHERE id=?`, ...params).catch(() => null);
  if (!result || result.changes === 0) return NextResponse.json({ error: "tidak_ditemukan" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!checkRateLimit(request, "products:write")) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id_tidak_valid" }, { status: 400 });
  }
  const result = await execRun(`DELETE FROM supplier_links WHERE id=?`, id).catch(() => null);
  if (!result || result.changes === 0) return NextResponse.json({ error: "tidak_ditemukan" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
