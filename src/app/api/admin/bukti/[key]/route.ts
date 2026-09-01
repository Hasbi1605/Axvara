import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { key } = await params;
  if (!key || key.includes("..") || key.includes("//")) return NextResponse.json({ error: "Invalid key" }, { status: 400 });

  const bucket = ((globalThis as unknown as Record<string, unknown>).R2_ASSETS
    ?? (process.env as unknown as Record<string, unknown>).R2_ASSETS) as { get: (k:string)=>Promise<{ body: ReadableStream; httpMetadata?:{contentType?:string}}|null> } | undefined;
  if (!bucket) return NextResponse.json({ error: "R2 not bound" }, { status: 500 });
  const obj = await bucket.get(key);
  if (!obj) return NextResponse.json({ error: "not found" }, { status: 404 });
  const headers = new Headers();
  headers.set("Content-Type", obj.httpMetadata?.contentType ?? "image/jpeg");
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  return new NextResponse(obj.body as unknown as BodyInit, { headers });
}
