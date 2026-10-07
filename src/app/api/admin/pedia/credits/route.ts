// /api/admin/pedia/credits — Daftar kode + terbit manual (§10 Kredit, PD-40).
// GET: hint 4 char, email tersamar, sisa, asal, kedaluwarsa.
// POST {email, amount, reason}: terbit manual (source_kind='admin', alasan wajib).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const manualSchema = z.object({
  email: z.string().trim().email().max(160),
  amount: z.coerce.number().int().min(100).max(100_000_000),
  reason: z.string().trim().min(5).max(300),
});

function maskEmail(email: string): string {
  const [user = "", domain = ""] = String(email).split("@");
  if (!domain) return "***";
  const head = user.slice(0, 2);
  return `${head}***@${domain}`;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createDatabaseAccess();
  const rows = await db.queryAll(
    `SELECT id, code_hint, email, amount, remaining, source_order_code,
            source_kind, expires_at, created_at
       FROM pedia_credits ORDER BY id DESC LIMIT 100`,
  ).catch(() => []);
  return NextResponse.json({
    ok: true,
    rows: rows.map((r) => ({ ...r, email: maskEmail(String(r.email ?? "")) })),
  });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = manualSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  }
  const db = createDatabaseAccess();
  const { issuePediaCredit } = await import("@/lib/pedia/credits");
  try {
    // Kredit manual tidak terikat order: kunci idempoten = alasan+email+amount
    // per menit tidak ada — admin sadar penuh via ConfirmDialog.
    const credit = await issuePediaCredit(db, {
      email: parsed.data.email,
      amount: parsed.data.amount,
      sourceOrderCode: `admin:${Date.now()}:${parsed.data.reason.slice(0, 20)}`,
      sourceKind: "admin",
    });
    return NextResponse.json({ ok: true, credit_code: credit.code });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "issue_failed" }, { status: 500 });
  }
}
