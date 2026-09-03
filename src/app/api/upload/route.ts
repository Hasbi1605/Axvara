import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type CloudflareEnv = { R2_ASSETS?: { put: (key:string, body:ArrayBuffer, opts?:Record<string,string>)=>Promise<unknown> }; ASSETS?: { put: (key:string, body:ArrayBuffer, opts?:Record<string,string>)=>Promise<unknown> } };

// Strict allowlist — only jpeg/png/webp, max 5MB, magic bytes checked (F05)
const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

function isAllowedImageType(t: string): boolean {
  return ALLOWED_TYPES.has(t.toLowerCase());
}

function checkMagicBytes(buf: Uint8Array, claimed: string): boolean {
  const t = claimed.toLowerCase();
  if (t === "image/jpeg" || t === "image/jpg") {
    return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (t === "image/png") {
    return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  }
  if (t === "image/webp") {
    return buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  }
  return false;
}

function cryptoRandomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized — login admin dulu" }, { status: 401 });

  // Rate limit for upload (best-effort in-memory per isolate)
  // Cloudflare WAF rate limit should be added in dashboard for prod

  const form = await req.formData();
  const area = String(form.get("area") ?? "products");
  if (!new Set(["products", "articles/covers", "articles/content", "banners", "qris"]).has(area)) return NextResponse.json({ error: "Area media tidak valid" }, { status: 400 });
  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (!files.length) return NextResponse.json({ error: "Pilih minimal 1 file gambar" }, { status: 400 });
  if (files.length > 8) return NextResponse.json({ error: "Maks 8 file per upload" }, { status: 400 });

  const env = (process.env as unknown as { ASSETS?: unknown }) as CloudflareEnv & Record<string, unknown>;
  const bucket = (globalThis as unknown as Record<string, unknown>).R2_ASSETS as CloudflareEnv["R2_ASSETS"] | undefined
    ?? (globalThis as unknown as Record<string, unknown>).ASSETS as CloudflareEnv["ASSETS"] | undefined
    ?? (env.R2_ASSETS as CloudflareEnv["R2_ASSETS"] | undefined)
    ?? (env.ASSETS as CloudflareEnv["ASSETS"] | undefined);

  if (!bucket) {
    return NextResponse.json({ error: "R2 bucket not bound — check wrangler.toml R2_ASSETS" }, { status: 500 });
  }

  const urls: string[] = [];
  for (const f of files) {
    const type = (f.type || "").toLowerCase();
    if (!isAllowedImageType(type)) return NextResponse.json({ error: `Tipe tidak diizinkan: ${type || "unknown"} — hanya JPG/PNG/WebP` }, { status: 400 });
    if (type !== "image/webp") return NextResponse.json({ error: "Uploader admin harus mengirim byte WebP hasil konversi browser" }, { status: 400 });
    if (f.size > MAX_BYTES) return NextResponse.json({ error: `${f.name} melebihi 5MB` }, { status: 400 });
    // Extra guard: reject svg disguised as image/*
    if (type.includes("svg") || f.name.toLowerCase().endsWith(".svg")) return NextResponse.json({ error: "SVG tidak diizinkan" }, { status: 400 });
    const buf = new Uint8Array(await f.arrayBuffer());
    if (!checkMagicBytes(buf, type)) return NextResponse.json({ error: `${f.name}: isi file tidak sesuai tipe ${type}` }, { status: 400 });

    // Use crypto random key (not Date.now) — F04
    const key = `${area}/${cryptoRandomHex(16)}.webp`;
    await bucket.put(key, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, { httpMetadata: { contentType: "image/webp" } } as unknown as Record<string, string>);
    urls.push(`/r2/${key}`);
  }
  return NextResponse.json({ urls });
}
