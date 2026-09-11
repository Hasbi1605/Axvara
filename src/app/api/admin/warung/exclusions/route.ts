// /api/admin/warung/exclusions — Kelola exclusion rules WR.
// GET: daftar rules. POST: tambah {pattern, reason}. DELETE?id=: hapus.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { queryAll, execRun } from "@/lib/db";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  pattern: z.string().trim().min(2).max(120),
  reason: z.string().trim().max(300).optional().nullable(),
});

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await queryAll(`SELECT id, pattern, reason, created_at FROM wr_exclusions ORDER BY id ASC`).catch(
    () => [],
  );
  return NextResponse.json({ exclusions: rows });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "validation_failed" }, { status: 400 });
  }
  const { reason } = parsed.data;
  let pattern = parsed.data.pattern;
  // Normalisasi: pola tanpa wildcard dianggap contains.
  if (!pattern.includes("%")) pattern = `%${pattern}%`;
  try {
    const res = await execRun(
      `INSERT INTO wr_exclusions (pattern, reason) VALUES (?,?)`,
      pattern,
      reason || null,
    );
    return NextResponse.json({ ok: true, id: res.lastInsertRowid }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE/i.test(message)) return NextResponse.json({ error: "pattern_exists" }, { status: 409 });
    throw error;
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(request.nextUrl.searchParams.get("id") || 0);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const res = await execRun(`DELETE FROM wr_exclusions WHERE id=?`, id);
  if (!res.changes) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
