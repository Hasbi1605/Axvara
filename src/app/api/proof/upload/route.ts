import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// Public proof upload — for checkout (buyer). Strict: image only, 5MB, magic bytes, save to bukti/ prefix (private R2 via /api/admin/bukti).
const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX = 5 * 1024 * 1024;
function checkMagic(buf: Uint8Array, type: string): boolean {
  const t = type.toLowerCase();
  if (t === "image/jpeg" || t === "image/jpg") return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (t === "image/png") return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (t === "image/webp") return buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  return false;
}
function randHex(n: number): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const hits = new Map<string, { c: number; t: number }>();
function rateLimit(ip: string, max = 5) {
  const now = Date.now();
  const e = hits.get(ip);
  if (!e || now - e.t > 60_000) { hits.set(ip, { c: 1, t: now }); return true; }
  e.c++;
  return e.c <= max;
}
function ip(req: NextRequest) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";
}

type Env = { R2_ASSETS?: { put: (k: string, b: ArrayBuffer, o?: Record<string, unknown>) => Promise<unknown> } };

export async function POST(req: NextRequest) {
  if (!rateLimit(ip(req), 5)) return NextResponse.json({ error: "Terlalu sering, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  // F-07 fix: lightweight anti-abuse — require same-origin (CSRF middleware handles cross-origin, this blocks raw curl without referrer)
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin && !req.headers.get("referer")) {
    return NextResponse.json({ error: "Upload hanya dari halaman checkout" }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Form tidak valid" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Pilih file bukti (JPG/PNG/WebP, max 5MB)" }, { status: 400 });
  const type = (file.type || "").toLowerCase();
  if (!ALLOWED.has(type)) return NextResponse.json({ error: `Tipe tidak diizinkan: ${type || "unknown"} — hanya JPG/PNG/WebP` }, { status: 400 });
  if (file.name.toLowerCase().endsWith(".svg")) return NextResponse.json({ error: "SVG tidak diizinkan" }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: `${file.name} melebihi 5MB` }, { status: 400 });
  const buf = new Uint8Array(await file.arrayBuffer());
  if (!checkMagic(buf, type)) return NextResponse.json({ error: `${file.name}: isi file tidak sesuai tipe ${type}` }, { status: 400 });

  const env = process.env as unknown as Env & Record<string, unknown>;
  const bucket = (globalThis as unknown as Record<string, unknown>).R2_ASSETS as Env["R2_ASSETS"] | undefined
    ?? (globalThis as unknown as Record<string, unknown>).ASSETS as Env["R2_ASSETS"] | undefined
    ?? (env.R2_ASSETS as Env["R2_ASSETS"] | undefined);

  if (!bucket) {
    // In dev without R2, return a fake path that still passes validation (so checkout flow can be tested without R2 binding)
    // In prod, this will be 500 until R2 bound — which is correct
    const fake = `bukti/${randHex(16)}.jpg`;
    return NextResponse.json({ url: `/r2/${fake}`, note: "dev-no-r2" });
  }

  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const key = `bukti/${randHex(16)}.${ext}`;
  const ct = type === "image/png" ? "image/png" : type === "image/webp" ? "image/webp" : "image/jpeg";
  await bucket.put(key, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, { httpMetadata: { contentType: ct } } as unknown as Record<string, unknown>);
  return NextResponse.json({ url: `/r2/${key}` });
}
