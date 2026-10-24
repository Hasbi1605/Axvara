import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { execRun, queryAll, queryFirst } from "@/lib/db";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const subscriberSchema = z.object({ email: z.string().trim().toLowerCase().email("Format email tidak valid").max(254) }).strict();

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const subscribers = await queryAll("SELECT id,email,status,source,created_at FROM newsletter_subscribers ORDER BY created_at DESC");
  return NextResponse.json({ subscribers }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  if (!rateLimit(rateLimitKey(request, "newsletter:subscribe"), 5, 60_000)) {
    return NextResponse.json({ error: "Terlalu banyak percobaan. Coba lagi satu menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const parsed = subscriberSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Email tidak valid" }, { status: 400 });
  const existing = await queryFirst("SELECT id,status FROM newsletter_subscribers WHERE email=?", parsed.data.email);
  if (existing) {
    if(existing.status !== 'active') await execRun("UPDATE newsletter_subscribers SET status='active',unsubscribe_token=?,updated_at=datetime('now') WHERE id=?", newUnsubscribeToken(), existing.id);
    return NextResponse.json({ ok: true, existing: true });
  }
  try {
    const now = new Date().toISOString();
    await execRun("INSERT INTO newsletter_subscribers (email,status,source,created_at,updated_at,unsubscribe_token) VALUES (?,?,?,?,?,?)", parsed.data.email, "active", "footer", now, now, newUnsubscribeToken());
  } catch (error) {
    // Dua request bersamaan dapat lolos dari SELECT; unique index tetap menjadi
    // pengaman akhir dan diperlakukan sebagai subscription yang sudah ada.
    if (String(error).toLowerCase().includes("unique")) return NextResponse.json({ ok: true, existing: true });
    throw error;
  }
  return NextResponse.json({ ok: true, existing: false }, { status: 201 });
}

function newUnsubscribeToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,"0")).join(""); }
