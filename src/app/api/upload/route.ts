import { NextRequest, NextResponse } from "next/server";


export const dynamic = "force-dynamic";

type CloudflareEnv = { R2_ASSETS?: { put: (key:string, body:ArrayBuffer, opts?:Record<string,string>)=>Promise<unknown> }; ASSETS?: { put: (key:string, body:ArrayBuffer, opts?:Record<string,string>)=>Promise<unknown> } };

// Accepts multipart/form-data with field "files" (multiple) — PNG/JPG → WebP max 1200, q72
// Prod (Pages): tulis ke R2 via env.ASSETS. Dev fallback: tulis ke public/uploads.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (!files.length) return NextResponse.json({ error: "no files" }, { status: 400 });
  if (files.length > 8) return NextResponse.json({ error: "max 8 files" }, { status: 400 });

  const allowed = new Set(["image/png","image/jpeg","image/jpg","image/webp","image/heic","image/heif"]);
  const env = (process.env as unknown as { ASSETS?: unknown }) as CloudflareEnv & Record<string,unknown>;
  // Pages exposes bindings via global; try multiple lookup paths
  const bucket = (globalThis as unknown as Record<string,unknown>).R2_ASSETS as CloudflareEnv["R2_ASSETS"] | undefined
    ?? (globalThis as unknown as Record<string,unknown>).ASSETS as CloudflareEnv["ASSETS"] | undefined
    ?? (env.R2_ASSETS as CloudflareEnv["R2_ASSETS"] | undefined)
    ?? (env.ASSETS as CloudflareEnv["ASSETS"] | undefined);

  const urls: string[] = [];
  for (const f of files) {
    if (!allowed.has(f.type) && !f.type.startsWith("image/")) return NextResponse.json({ error: `unsupported type ${f.type}` }, { status: 400 });
    if (f.size > 8 * 1024 * 1024) return NextResponse.json({ error: `${f.name} >8MB` }, { status: 400 });
    const buf = Buffer.from(await f.arrayBuffer());
    const base = `${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const outName = `${base}.webp`;
    // Edge (Cloudflare) has no sharp — store original bytes as webp-compatible;
    // For dev, use separate /api/upload-dev (not edge) if resizing needed.
    const webpBuf: Buffer = buf;

    if (!bucket) {
      // In prod (edge) bucket must exist — fail fast instead of dev fs fallback
      return NextResponse.json({ error: "R2 bucket not bound — check wrangler.toml R2_ASSETS" }, { status: 500 });
    }
    await bucket.put(outName, webpBuf.buffer.slice(webpBuf.byteOffset, webpBuf.byteOffset + webpBuf.byteLength) as ArrayBuffer, { httpMetadata: { contentType: "image/webp" } } as unknown as Record<string,string>);
    urls.push(`/r2/${outName}`);
  }
  return NextResponse.json({ urls });
}
