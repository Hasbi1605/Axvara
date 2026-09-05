import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OrderTransitionError, queryFirst, transitionPendingOrder } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.enum(["pending", "lunas", "dibatalkan", "kadaluarsa"]),
  admin_note: z.string().trim().max(500).optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { code } = await params;
  if (!code || !/^AXV-\d{8}-[A-Z0-9]{8}$/.test(code)) return NextResponse.json({ error: "Kode tidak valid" }, { status: 400 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  const row = (await queryFirst("SELECT code, status, sales_channel, items FROM orders WHERE code=?", code)) as Record<string, unknown> | undefined;
  if (!row) return NextResponse.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });

  // Simple state machine: pending -> lunas/dibatalkan/kadaluarsa, lunas/dibatalkan final
  const cur = String(row.status);
  const nxt = parsed.data.status;
  if (cur !== "pending" && nxt !== cur) {
    return NextResponse.json({ error: `Status sudah ${cur}, tidak bisa diubah ke ${nxt}` }, { status: 400 });
  }
  if (nxt === cur || nxt === "pending") {
    return NextResponse.json({ ok: true, code, status: cur, unchanged: true });
  }
  if (nxt === "lunas" && String(row.sales_channel) === "whatsapp") {
    return NextResponse.json(
      { error: "review_bukti_whatsapp_required", message: "Tinjau bukti WhatsApp langsung dari tab Pesanan." },
      { status: 409 },
    );
  }

  let items: { product_id: number; variant_id?: number; qty: number }[];
  try {
    items = JSON.parse(String(row.items || "[]"));
  } catch {
    return NextResponse.json({ error: "Snapshot item pesanan rusak; status tidak diubah." }, { status: 500 });
  }
  try {
    await transitionPendingOrder(code, nxt, parsed.data.admin_note ?? null, items);
  } catch (error) {
    if (error instanceof OrderTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("PATCH /api/admin/orders transition failed:", error);
    return NextResponse.json({ error: "Status pesanan gagal diperbarui." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, code, status: nxt });
}
