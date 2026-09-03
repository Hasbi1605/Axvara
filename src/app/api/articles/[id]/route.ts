import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { execRun, queryFirst } from "@/lib/db";
import {
  ARTICLE_STATUSES,
  excerptFromMarkdown,
  isSafeMarkdown,
  normalizeArticle,
} from "@/lib/articles";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().trim().min(6).max(140).optional(),
  content: z.string().trim().min(50).max(50_000).optional(),
  cover_url: z.string().trim().max(600).nullable().optional(),
  source_urls: z.array(z.string().url().max(600)).max(20).optional(),
  status: z.enum(ARTICLE_STATUSES).optional(),
  scheduled_at: z.string().datetime().nullable().optional(),
}).strict();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const row = await queryFirst("SELECT * FROM articles WHERE id=? OR slug=?", id, id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const article = normalizeArticle(row);
  if (article.status !== "published" && !(await requireAdmin(request))) {
    return NextResponse.json({ error: "Artikel belum publish" }, { status: 404 });
  }
  return NextResponse.json(
    { article },
    { headers: { "Cache-Control": article.status === "published" ? "public, max-age=60" : "private, no-store" } },
  );
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal" },
      { status: 400 },
    );
  }

  const existing = await queryFirst("SELECT * FROM articles WHERE id=?", id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data = parsed.data;
  if (data.content && !isSafeMarkdown(data.content)) {
    return NextResponse.json({ error: "Markdown berisi HTML atau URL tidak aman" }, { status: 400 });
  }
  if (data.cover_url && !data.cover_url.startsWith("/r2/articles/covers/")) {
    return NextResponse.json({ error: "Cover harus berasal dari uploader artikel AXVARA" }, { status: 400 });
  }

  const current = normalizeArticle(existing);
  const nextStatus = data.status ?? current.status;
  const scheduledAt = data.scheduled_at ?? (existing.scheduled_at ? String(existing.scheduled_at) : null);
  if (nextStatus === "scheduled" && (!scheduledAt || Date.parse(scheduledAt) <= Date.now())) {
    return NextResponse.json({ error: "Jadwal publish harus berupa waktu di masa depan" }, { status: 400 });
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    fields.push(`${column}=?`);
    values.push(value);
  };

  if (data.title !== undefined) assign("title", data.title);
  if (data.cover_url !== undefined) assign("cover_url", data.cover_url);
  if (data.content !== undefined) {
    assign("content", data.content);
    assign("excerpt", excerptFromMarkdown(data.content));
  }
  if (data.source_urls !== undefined) assign("source_urls", JSON.stringify(data.source_urls));
  if (data.status !== undefined) {
    assign("status", nextStatus);
    assign("is_published", nextStatus === "published" ? 1 : 0);
    assign(
      "published_at",
      nextStatus === "published"
        ? (existing.published_at ?? new Date().toISOString())
        : null,
    );
    assign("scheduled_at", nextStatus === "scheduled" ? scheduledAt : null);
    if (nextStatus === "published") {
      assign("reviewed_at", new Date().toISOString());
      assign("reviewed_by", admin.email);
    }
  } else if (data.scheduled_at !== undefined) {
    assign("scheduled_at", data.scheduled_at);
  }

  if (!fields.length) return NextResponse.json({ ok: true, article: current });
  fields.push("updated_at=datetime('now')");
  values.push(id);

  await execRun(`UPDATE articles SET ${fields.join(",")} WHERE id=?`, ...values);
  const updated = await queryFirst("SELECT * FROM articles WHERE id=?", id);
  return NextResponse.json({ ok: true, article: updated ? normalizeArticle(updated) : current });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const result = await execRun("DELETE FROM articles WHERE id=?", id);
  if (!result.changes) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
