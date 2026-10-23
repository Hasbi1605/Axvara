// /api/admin/pedia/credits — Arsip kode lama, baca-saja.
// GET: hint 4 char, email tersamar, sisa, asal, kedaluwarsa.
// POST retired (410); manual buyer settlement takes place outside AXVARA.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";

export const runtime = "edge";
export const dynamic = "force-dynamic";

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
  try {
  const rows = await db.queryAll(
    `SELECT id, code_hint, email, amount, remaining, source_order_code,
            source_kind, expires_at, created_at
       FROM pedia_credits ORDER BY id DESC LIMIT 100`,
  );
  return NextResponse.json({
    ok: true, archived: true,
    rows: rows.map((r) => ({ ...r, email: maskEmail(String(r.email ?? "")) })),
  });
  } catch { return NextResponse.json({ error: "load_failed" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ error: "credits_retired", message: "Penerbitan kredit dihentikan. Selesaikan kendala pembeli secara manual." }, { status: 410 });
}
