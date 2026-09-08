import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryAll, queryFirst } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { recordManualHandover } from "@/lib/fulfillment/deliver";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const handoverSchema = z.object({
  item_index: z.number().int().min(0).max(100),
  note: z.string().trim().max(500).optional().nullable(),
});

// GET — daftar item fulfillment satu order beserta status handover.
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { code } = await params;
  if (!code || !/^AXV-\d{8}-[A-Z0-9]{8}$/.test(code)) return NextResponse.json({ error: "Kode tidak valid" }, { status: 400 });
  const order = await queryFirst(
    "SELECT code, status, payment_status, fulfillment_status FROM orders WHERE code=?", code,
  );
  if (!order) return NextResponse.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });
  const items = await queryAll(
    `SELECT item_index, product_id, variant_id, qty, fulfillment_mode, status, recipient_channel, last_error, updated_at
     FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`, code,
  );
  return NextResponse.json({ ok: true, code, order, items });
}

// POST — catat penyerahan manual satu item (handover admin yang nyata).
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
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
  const parsed = handoverSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });

  const order = await queryFirst(
    "SELECT code, status, payment_status FROM orders WHERE code=?", code,
  );
  if (!order) return NextResponse.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });
  if (String(order.status) !== "lunas" || String(order.payment_status) !== "paid") {
    return NextResponse.json(
      { error: "handover_requires_paid", message: "Serah terima hanya untuk pesanan lunas." },
      { status: 409 },
    );
  }
  const item = await queryFirst(
    "SELECT item_index, status FROM fulfillment_items WHERE order_code=? AND item_index=?",
    code, parsed.data.item_index,
  );
  if (!item) return NextResponse.json({ error: "Item tidak ditemukan pada pesanan ini" }, { status: 404 });

  let ok = false;
  try {
    ok = await recordManualHandover(code, parsed.data.item_index, admin.email, parsed.data.note ?? null);
  } catch {
    // Gangguan penyimpanan di tengah handover: baca ulang kebenaran —
    // bila item ternyata sudah delivered (race menang), laporkan sukses
    // idempoten; bila tidak, JANGAN pernah klaim selesai palsu.
    const verify = await queryFirst(
      "SELECT status FROM fulfillment_items WHERE order_code=? AND item_index=?",
      code, parsed.data.item_index,
    ).catch(() => null);
    if (verify && String(verify.status) === "delivered") {
      const freshOrder = await queryFirst(
        "SELECT fulfillment_status FROM orders WHERE code=?", code,
      ).catch(() => null);
      return NextResponse.json({
        ok: true, code, item_index: parsed.data.item_index, item_status: "delivered",
        fulfillment_status: String(freshOrder?.fulfillment_status ?? ""),
      });
    }
    return NextResponse.json({ error: "Gagal mencatat serah terima." }, { status: 500 });
  }
  if (!ok) {
    return NextResponse.json(
      { error: "handover_rejected", message: "Item tidak dalam status menunggu serah terima." },
      { status: 409 },
    );
  }
  const freshOrder = await queryFirst(
    "SELECT code, status, payment_status, fulfillment_status FROM orders WHERE code=?", code,
  );
  const freshItem = await queryFirst(
    "SELECT item_index, status FROM fulfillment_items WHERE order_code=? AND item_index=?",
    code, parsed.data.item_index,
  );
  // Idempoten: klik dua kali mengembalikan hasil yang sama tanpa efek ganda.
  return NextResponse.json({
    ok: true, code, item_index: parsed.data.item_index,
    item_status: String(freshItem?.status ?? "delivered"),
    fulfillment_status: String(freshOrder?.fulfillment_status ?? ""),
  });
}
