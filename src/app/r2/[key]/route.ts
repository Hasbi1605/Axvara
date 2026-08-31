import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: { key: string } }) {
  const bucket = (globalThis as unknown as Record<string, unknown>).ASSETS as { get: (k:string)=>Promise<{ body: ReadableStream; httpMetadata?:{contentType?:string}; writeHttpMetadata:(h:Headers)=>void }|null> } | undefined;
  if (!bucket) return NextResponse.json({ error: "R2 not bound (dev: use /uploads/...)" }, { status: 500 });
  const obj = await bucket.get(params.key);
  if (!obj) return NextResponse.json({ error: "not found" }, { status: 404 });
  const headers = new Headers();
  headers.set("Content-Type", obj.httpMetadata?.contentType ?? "image/webp");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new NextResponse(obj.body as unknown as BodyInit, { headers });
}
