import { NextRequest, NextResponse } from "next/server";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export async function GET(_: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const bucket = (globalThis as unknown as Record<string, unknown>).R2_ASSETS as { get: (k:string)=>Promise<{ body: ReadableStream; httpMetadata?:{contentType?:string}}|null> } | undefined;
  if (!bucket) return NextResponse.json({ error: "R2 not bound" }, { status: 500 });
  const obj = await bucket.get(key);
  if (!obj) return NextResponse.json({ error: "not found" }, { status: 404 });
  const headers = new Headers();
  headers.set("Content-Type", obj.httpMetadata?.contentType ?? "image/webp");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new NextResponse(obj.body as unknown as BodyInit, { headers });
}
