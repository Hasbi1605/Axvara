import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgent } from "@/lib/agent-auth";
import { ArticleMediaError, storeArticleWebp } from "@/lib/article-media";
import { fetchPublicWebp, RemoteMediaError } from "@/lib/remote-media";

export const runtime = "edge";

const bodySchema = z.object({
  source_url: z.string().trim().url().max(2048),
  kind: z.enum(["cover", "content"]),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireAgent(request, "media:write");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "source_url dan kind diperlukan" },
      { status: 400 },
    );
  }

  try {
    const bytes = await fetchPublicWebp(parsed.data.source_url);
    const url = await storeArticleWebp(bytes, parsed.data.kind);
    return NextResponse.json({ url, content_type: "image/webp" }, { status: 201 });
  } catch (error) {
    const status = error instanceof RemoteMediaError || error instanceof ArticleMediaError
      ? error.status
      : 500;
    const message = error instanceof Error ? error.message : "Impor media gagal";
    return NextResponse.json({ error: message }, { status });
  }
}
