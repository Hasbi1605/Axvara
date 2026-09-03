import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { audit, requireAgent } from "@/lib/agent-auth";
import {
  articleInputSchema,
  excerptFromMarkdown,
  isSafeMarkdown,
  normalizeArticle,
  slugify,
} from "@/lib/articles";
import { execRun, queryAll, queryFirst } from "@/lib/db";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const createSchema = articleInputSchema.extend({
  source_urls: z.array(z.string().url().max(600)).min(1).max(20),
  idempotency_key: z.string().trim().min(8).max(160),
  topic: z.string().trim().max(200).optional(),
});

async function uniqueSlug(title: string) {
  const base = slugify(title);
  let slug = base;
  let suffix = 2;
  while (await queryFirst("SELECT id FROM articles WHERE slug=?", slug)) {
    slug = `${base}-${suffix++}`;
  }
  return slug;
}

export async function GET(request: NextRequest) {
  const auth = await requireAgent(request, "articles:read");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const rows = await queryAll("SELECT * FROM articles ORDER BY updated_at DESC,id DESC");
  return NextResponse.json(
    { articles: rows.map(normalizeArticle) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAgent(request, "articles:write");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal" },
      { status: 400 },
    );
  }
  const data = parsed.data;
  if (!isSafeMarkdown(data.content)) {
    return NextResponse.json({ error: "Markdown berisi HTML atau URL tidak aman" }, { status: 400 });
  }
  if (data.cover_url && !data.cover_url.startsWith("/r2/articles/covers/")) {
    return NextResponse.json({ error: "Cover agent harus diunggah ke media AXVARA" }, { status: 400 });
  }

  const existing = await queryFirst(
    "SELECT * FROM articles WHERE idempotency_key=?",
    data.idempotency_key,
  );
  if (existing) {
    return NextResponse.json({ article: normalizeArticle(existing), idempotent: true });
  }

  const now = new Date().toISOString();
  const result = await execRun(
    "INSERT INTO articles (slug,title,excerpt,cover_url,content,is_published,status,author_type,author_name,source_urls,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    await uniqueSlug(data.title),
    data.title,
    excerptFromMarkdown(data.content),
    data.cover_url ?? null,
    data.content,
    0,
    "draft",
    "agent",
    auth.token.name,
    JSON.stringify(data.source_urls),
    data.idempotency_key,
    now,
    now,
  );
  await audit(Number(result.lastInsertRowid), auth.token.name, "create_draft", {
    topic: data.topic,
    source_count: data.source_urls.length,
  });
  return NextResponse.json({ id: result.lastInsertRowid, status: "draft" }, { status: 201 });
}
