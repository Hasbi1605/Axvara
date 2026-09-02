import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryFirst, execRun } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(80).optional(),
  title: z.string().trim().min(6).max(140).optional(),
  excerpt: z.string().trim().max(280).nullable().optional(),
  cover_url: z.string().trim().max(600).nullable().optional(),
  content: z.string().trim().min(50).max(50000).optional(),
  is_published: z.boolean().optional(),
}).strict();

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = (await queryFirst("SELECT * FROM articles WHERE id=? OR slug=?", id, id)) as Record<string, unknown> | undefined;
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if ((row.is_published as number) !== 1) return NextResponse.json({ error: "Artikel belum publish" }, { status: 404 });
  return NextResponse.json({ article: row });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body tidak valid" }, { status: 400 }); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  const existing = (await queryFirst("SELECT id, is_published FROM articles WHERE id=?", id)) as Record<string, unknown> | undefined;
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const data = parsed.data as Record<string, unknown>;
  if (data.cover_url && typeof data.cover_url === "string" && !/^(\/r2\/|https:\/\/)/.test(data.cover_url)) return NextResponse.json({ error: "Cover URL tidak valid" }, { status: 400 });
  const fields: string[] = [];
  const vals: unknown[] = [];
  const map: Record<string, string> = { slug: "slug", title: "title", excerpt: "excerpt", cover_url: "cover_url", content: "content" };
  for (const [k, col] of Object.entries(map)) {
    if (data[k] !== undefined) { fields.push(`${col}=?`); vals.push(data[k]); }
  }
  if (data.is_published !== undefined) {
    fields.push("is_published=?");
    vals.push(data.is_published ? 1 : 0);
    if (data.is_published && (existing.is_published as number) !== 1) {
      fields.push("published_at=?");
      vals.push(new Date().toISOString());
    }
  }
  if (!fields.length) return NextResponse.json({ ok: true });
  fields.push("updated_at=datetime('now')");
  vals.push(id);
  try { await execRun(`UPDATE articles SET ${fields.join(",")} WHERE id=?`, ...vals); } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) return NextResponse.json({ error: "slug sudah dipakai" }, { status: 409 });
    console.error("500 src/app/api/articles/[id]/route.ts :", msg);
    return NextResponse.json({ error: "Terjadi kesalahan pada server. Coba lagi." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await execRun("DELETE FROM articles WHERE id=?", id);
  return NextResponse.json({ ok: true });
}
