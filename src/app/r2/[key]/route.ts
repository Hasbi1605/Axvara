import { NextRequest, NextResponse } from "next/server";
export const runtime = "edge";
export const dynamic = "force-dynamic";
function isBuktiKey(key: string): boolean {
  return key.startsWith("bukti/") || key.includes("/bukti/");
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  // Block private paths — bukti must go via admin-only route
  if (isBuktiKey(key)) {
    return NextResponse.json({ error: "Use /api/admin/bukti/[key] with auth for private files" }, { status: 403 });
  }
  // Basic path traversal guard
  if (key.includes("..") || key.includes("//") || key.startsWith("/")) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }
  const bucket = ((globalThis as unknown as Record<string, unknown>).R2_ASSETS
    ?? (process.env as unknown as Record<string, unknown>).R2_ASSETS) as { get: (k:string)=>Promise<{ body: ReadableStream; httpMetadata?:{contentType?:string}}|null> } | undefined;
  if (!bucket) return NextResponse.json({ error: "R2 not bound" }, { status: 500 });
  const obj = await bucket.get(key);
  if (!obj) return NextResponse.json({ error: "not found" }, { status: 404 });
  const headers = new Headers();
  // Validate content type — only allow images for public path
  const ct = obj.httpMetadata?.contentType ?? "image/webp";
  if (!/^image\/(jpeg|png|webp|gif)$/.test(ct)) {
    return NextResponse.json({ error: "Unsupported content type" }, { status: 403 });
  }
  headers.set("Content-Type", ct);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  // Extra hardening for public assets
  headers.set("X-Content-Type-Options", "nosniff");
  return new NextResponse(obj.body as unknown as BodyInit, { headers });
}
