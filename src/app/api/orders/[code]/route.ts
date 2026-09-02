import { NextRequest, NextResponse } from "next/server";
import { queryFirst } from "@/lib/db";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const hits = new Map<string, { c: number; t: number }>();
function rateLimit(ip: string, max = 20) {
  const now = Date.now();
  const e = hits.get(ip);
  if (!e || now - e.t > 60_000) { hits.set(ip, { c: 1, t: now }); return true; }
  e.c++;
  return e.c <= max;
}
function clientIp(req: NextRequest) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!rateLimit(clientIp(req), 20)) return NextResponse.json({ error: "Terlalu sering, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  const { code } = await params;
  if (!code || !/^AXV-\d{8}-[A-Z0-9]{4,8}$/.test(code)) return NextResponse.json({ error: "Kode tidak valid" }, { status: 400 });
  const row = (await queryFirst("SELECT * FROM orders WHERE code=?", code)) as Record<string, unknown> | undefined;
  if (!row) return NextResponse.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });
  const waFull = String(row.customer_wa ?? "");
  const waMasked = waFull.length >= 7 ? waFull.slice(0, 5) + "****" + waFull.slice(-4) : waFull ? waFull.slice(0, 3) + "****" : "";
  const emailFull = String(row.customer_email ?? "");
  const emailMasked = emailFull.includes("@") ? emailFull.replace(/(^.).+(@.*)/, (_, a, b) => `${a}***${b}`) : emailFull ? "***" : null;
  return NextResponse.json({
    order: {
      code: row.code,
      customer_name: row.customer_name,
      customer_wa: waMasked,
      customer_email: emailMasked,
      items: JSON.parse(String(row.items || "[]")),
      subtotal: row.subtotal,
      payment_method: row.payment_method,
      payment_account: row.payment_account,
      proof_url: row.proof_url,
      status: row.status,
      created_at: row.created_at,
    },
  });
}
