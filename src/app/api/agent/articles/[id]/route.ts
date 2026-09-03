import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { audit, requireAgent } from "@/lib/agent-auth";
import { excerptFromMarkdown, isSafeMarkdown, normalizeArticle } from "@/lib/articles";
import { execRun, queryFirst } from "@/lib/db";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().trim().min(6).max(140).optional(),
  content: z.string().trim().min(50).max(50_000).optional(),
  cover_url: z.string().trim().max(600).nullable().optional(),
  source_urls: z.array(z.string().url().max(600)).min(1).max(20).optional(),
}).strict();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAgent(request, "articles:read");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const row = await queryFirst("SELECT * FROM articles WHERE id=?", id);
  return row
    ? NextResponse.json({ article: normalizeArticle(row) })
    : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAgent(request, "articles:write");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const row = await queryFirst("SELECT * FROM articles WHERE id=?", id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (String(row.status ?? "draft") !== "draft") {
    return NextResponse.json({ error: "Agent hanya boleh mengubah Draft" }, { status: 409 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal" },
      { status: 400 },
    );
  }
  const data = parsed.data;
  if (data.content && !isSafeMarkdown(data.content)) {
    return NextResponse.json({ error: "Markdown tidak aman" }, { status: 400 });
  }
  if (data.cover_url && !data.cover_url.startsWith("/r2/articles/covers/")) {
    return NextResponse.json({ error: "Cover agent harus diunggah ke media AXVARA" }, { status: 400 });
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  if (data.title !== undefined) { fields.push("title=?"); values.push(data.title); }
  if (data.content !== undefined) {
    fields.push("content=?", "excerpt=?");
    values.push(data.content, excerptFromMarkdown(data.content));
  }
  if (data.cover_url !== undefined) { fields.push("cover_url=?"); values.push(data.cover_url); }
  if (data.source_urls !== undefined) {
    fields.push("source_urls=?");
    values.push(JSON.stringify(data.source_urls));
  }
  if (!fields.length) return NextResponse.json({ ok: true });
  fields.push("updated_at=?");
  values.push(new Date().toISOString(), id);

  await execRun(`UPDATE articles SET ${fields.join(",")} WHERE id=?`, ...values);
  await audit(Number(id), auth.token.name, "update_draft", {});
  return NextResponse.json({ ok: true });
}
