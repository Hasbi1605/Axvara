import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type R2Object = {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
};

type R2Bucket = {
  get: (key: string) => Promise<R2Object | null>;
};

function isPrivateProofKey(key: string): boolean {
  return key.startsWith("bukti/") || key.includes("/bukti/");
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key: parts } = await params;
  const key = parts.map(decodeURIComponent).join("/");

  if (!key || key.includes("..") || key.includes("//") || key.startsWith("/")) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }
  if (isPrivateProofKey(key)) {
    return NextResponse.json(
      { error: "Bukti pembayaran hanya tersedia melalui panel admin" },
      { status: 403 },
    );
  }

  const bucket = (
    (globalThis as unknown as Record<string, unknown>).R2_ASSETS
    ?? (process.env as unknown as Record<string, unknown>).R2_ASSETS
  ) as R2Bucket | undefined;

  if (!bucket) return NextResponse.json({ error: "R2 not bound" }, { status: 500 });

  const object = await bucket.get(key);
  if (!object) return NextResponse.json({ error: "not found" }, { status: 404 });

  const contentType = object.httpMetadata?.contentType ?? "image/webp";
  if (!/^image\/(?:jpeg|png|webp|gif)$/.test(contentType)) {
    return NextResponse.json({ error: "Unsupported content type" }, { status: 403 });
  }

  return new NextResponse(object.body as unknown as BodyInit, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
