import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryAll, queryFirst, execRun } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim().toLowerCase() ?? "";
  const publishedOnly = searchParams.get("published") === "1" || !searchParams.get("published");
  // Public: only published; admin with token can see all via ?all=1
  const wantAll = searchParams.get("all") === "1";
  let isAdmin = false;
  if (wantAll) {
    const a = await requireAdmin(req).catch(() => null);
    isAdmin = !!a;
    if (!isAdmin) return NextResponse.json({ error: "Unauthorized untuk lihat draft" }, { status: 401 });
  }
  let sql = "SELECT * FROM articles WHERE 1=1";
  const params: unknown[] = [];
  if (!isAdmin || publishedOnly) sql += " AND is_published=1";
  if (q) {
    sql += " AND (lower(title) LIKE ? OR lower(excerpt) LIKE ? OR lower(slug) LIKE ?)";
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  sql += " ORDER BY published_at DESC, updated_at DESC, id DESC";
  const rows = await queryAll(sql, ...params);
  const data = rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    cover_url: r.cover_url,
    content: r.content,
    is_published: r.is_published,
    published_at: r.published_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  return NextResponse.json({ articles: data });
}

const schema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(80),
  title: z.string().trim().min(6).max(140),
  excerpt: z.string().trim().max(280).optional().nullable(),
  cover_url: z.string().trim().max(600).optional().nullable(),
  content: z.string().trim().min(50).max(50000),
  is_published: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body tidak valid" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  const { slug, title, excerpt, cover_url, content, is_published } = parsed.data;
  if (cover_url && !/^(\/r2\/|https:\/\/)/.test(cover_url)) return NextResponse.json({ error: "Cover URL tidak valid" }, { status: 400 });
  const now = new Date().toISOString();
  const published_at = is_published ? now : null;
  try {
    const res = await execRun("INSERT INTO articles (slug,title,excerpt,cover_url,content,is_published,published_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", slug, title, excerpt ?? null, cover_url ?? null, content, is_published ? 1 : 0, published_at, now, now);
    return NextResponse.json({ id: res.lastInsertRowid }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) return NextResponse.json({ error: "slug sudah dipakai" }, { status: 409 });
    console.error("500 src/app/api/articles/route.ts :", msg);
    return NextResponse.json({ error: "Terjadi kesalahan pada server. Coba lagi." }, { status: 500 });
  }
}
