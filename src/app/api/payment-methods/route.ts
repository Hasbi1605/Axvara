import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { execRun, queryAll, queryFirst } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  label: z.string().trim().min(2).max(80),
  account_number: z.string().trim().max(40).optional().default(""),
  account_name: z.string().trim().min(2).max(80),
  qris_url: z.string().trim().max(600).nullable().optional(),
  is_active: z.boolean(),
  sort_order: z.coerce.number().int().min(0).max(999),
});
const methodIdSchema = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, "ID metode pembayaran tidak valid");
const createSchema = updateSchema.extend({ id: methodIdSchema });

function validateMethod(id: string, data: z.infer<typeof updateSchema>): string | null {
  if (id !== "qris" && data.is_active && !/^\d{6,40}$/.test(data.account_number)) {
    return "Nomor rekening aktif harus 6–40 digit";
  }
  if (id === "qris" && data.qris_url) return "QRIS statis tidak lagi digunakan";
  return null;
}

export async function GET(req: NextRequest) {
  const wantAll = new URL(req.url).searchParams.get("all") === "1";
  if (wantAll && !(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await queryAll(
    `SELECT * FROM payment_methods${wantAll ? "" : " WHERE is_active=1"} ORDER BY sort_order ASC`,
  );
  return NextResponse.json(
    { payment_methods: rows },
    { headers: { "Cache-Control": wantAll ? "private, no-store" : "public, max-age=30, s-maxage=30" } },
  );
}

export async function PUT(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id || !methodIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "ID metode pembayaran tidak valid" }, { status: 400 });
  }
  if (!(await queryFirst("SELECT * FROM payment_methods WHERE id=?", id))) {
    return NextResponse.json({ error: "Metode pembayaran tidak ditemukan" }, { status: 404 });
  }
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  }
  const data = parsed.data;
  const validationError = validateMethod(id, data);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const result = await execRun(
    "UPDATE payment_methods SET label=?,account_number=?,account_name=?,qris_url=?,is_active=?,sort_order=? WHERE id=?",
    data.label,
    data.account_number,
    data.account_name,
    id === "qris" ? null : data.qris_url ?? null,
    data.is_active ? 1 : 0,
    data.sort_order,
    id,
  );
  return result.changes
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Metode pembayaran gagal diperbarui" }, { status: 500 });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  }
  const { id, ...data } = parsed.data;
  if (id === "qris" || id === "ewallet") {
    return NextResponse.json({ error: "ID qris dan ewallet dicadangkan; edit metode yang sudah ada" }, { status: 400 });
  }
  const validationError = validateMethod(id, data);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  if (await queryFirst("SELECT * FROM payment_methods WHERE id=?", id)) {
    return NextResponse.json({ error: "ID metode pembayaran sudah digunakan" }, { status: 409 });
  }
  try {
    const result = await execRun(
      "INSERT INTO payment_methods (id,label,account_number,account_name,qris_url,is_active,sort_order) VALUES (?,?,?,?,?,?,?)",
      id,
      data.label,
      data.account_number,
      data.account_name,
      null,
      data.is_active ? 1 : 0,
      data.sort_order,
    );
    return NextResponse.json({ id, ok: true }, { status: result.changes ? 201 : 500 });
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      return NextResponse.json({ error: "ID metode pembayaran sudah digunakan" }, { status: 409 });
    }
    console.error("POST /api/payment-methods failed:", error);
    return NextResponse.json({ error: "Metode pembayaran gagal dibuat" }, { status: 500 });
  }
}
