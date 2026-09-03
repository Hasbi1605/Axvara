import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { audit, requireAgent } from "@/lib/agent-auth";
import { execRun, queryFirst } from "@/lib/db";

export const runtime = "edge";

const bodySchema = z.object({ scheduled_at: z.string().datetime() }).strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAgent(request, "articles:schedule");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "scheduled_at harus ISO datetime" }, { status: 400 });
  }
  if (Date.parse(parsed.data.scheduled_at) <= Date.now()) {
    return NextResponse.json({ error: "scheduled_at harus di masa depan" }, { status: 400 });
  }

  const { id } = await params;
  const article = await queryFirst("SELECT * FROM articles WHERE id=?", id);
  if (!article) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["draft", "review", "scheduled"].includes(String(article.status ?? "draft"))) {
    return NextResponse.json({ error: "Artikel pada status ini tidak dapat dijadwalkan" }, { status: 409 });
  }

  await execRun(
    "UPDATE articles SET status=?,is_published=?,scheduled_at=?,published_at=?,updated_at=? WHERE id=?",
    "scheduled",
    0,
    parsed.data.scheduled_at,
    null,
    new Date().toISOString(),
    id,
  );
  await audit(Number(id), auth.token.name, "schedule", parsed.data);
  return NextResponse.json({ status: "scheduled", scheduled_at: parsed.data.scheduled_at });
}
