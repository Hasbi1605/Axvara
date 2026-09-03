import { NextRequest, NextResponse } from "next/server";
import { requireAgent } from "@/lib/agent-auth";
import {
  ArticleMediaError,
  isArticleImageKind,
  MAX_ARTICLE_IMAGE_BYTES,
  storeArticleWebp,
} from "@/lib/article-media";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  const auth = await requireAgent(request, "media:write");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const kind = String(form?.get("kind") ?? "content");
  if (!(file instanceof File)) return NextResponse.json({ error: "file diperlukan" }, { status: 400 });
  if (!isArticleImageKind(kind)) {
    return NextResponse.json({ error: "kind harus cover atau content" }, { status: 400 });
  }
  if (file.size > MAX_ARTICLE_IMAGE_BYTES) return NextResponse.json({ error: "Maksimum 5 MB" }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.type !== "image/webp") {
    return NextResponse.json(
      { error: "Media agent harus WebP valid. Konversikan PNG/JPG sebelum memanggil MCP." },
      { status: 400 },
    );
  }

  try {
    const url = await storeArticleWebp(bytes, kind);
    return NextResponse.json({ url, content_type: "image/webp" }, { status: 201 });
  } catch (error) {
    const status = error instanceof ArticleMediaError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Upload media gagal";
    return NextResponse.json({ error: message }, { status });
  }
}
