// GET /api/admin/warung/orders — Daftar WR order links.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryAll } from "@/lib/db";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const status = request.nextUrl.searchParams.get("status")?.trim() || "all";
  // Limit lama dipertahankan sebagai fallback bila per_page tak dikirim.
  const legacyLimit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 20)));
  // Cari manual email WR: paste invoice #RBHN-... dari Gmail langsung ketemu
  // order Axvara + buyer. Dipotong 40 char (batas LIKE D1 50 byte).
  const rawQ = request.nextUrl.searchParams.get("q")?.trim().slice(0, 40) || "";
  const q = rawQ.replace(/^#/, "");
  // Harus mencakup SELURUH WR_LINK_STATUSES yang mungkin tersimpan, kalau tidak
  // filter UI dibuang diam-diam menjadi "all" (2026-09-22): `blocked_balance`
  // adalah status order yang benar-benar tertahan di produksi, dan justru itu
  // yang paling perlu bisa disaring admin.
  const allowed = [
    "pending", "claimed", "submitted", "ordering", "processing",
    "completed", "failed", "retry", "blocked_balance",
  ];
  const whereParts: string[] = [];
  const params: unknown[] = [];
  if (allowed.includes(status)) { whereParts.push(`l.status=?`); params.push(status); }
  if (q) {
    whereParts.push(`(l.wr_order_id LIKE ? ESCAPE '\\' OR l.order_code LIKE ? ESCAPE '\\')`);
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like);
  }
  const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  // Pagination antrean (2026-10-01): filter status + search + halaman.
  // per_page default = legacy limit agar pemanggil lama tidak berubah.
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
  const perPage = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get("per_page") || legacyLimit)));
  const offset = (page - 1) * perPage;
  const totalRow = await queryAll(
    `SELECT COUNT(*) AS total FROM wr_order_links l LEFT JOIN orders o ON o.code=l.order_code ${where}`,
    ...params,
  ).catch(() => []);
  const total = Number((totalRow[0] as Record<string, unknown> | undefined)?.total ?? 0);
  const rows = await queryAll(
    `SELECT l.*, o.status AS order_status, o.sales_channel,
      o.customer_name, o.customer_wa, o.customer_email
     FROM wr_order_links l
     LEFT JOIN orders o ON o.code=l.order_code
     ${where} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
    ...params, perPage, offset,
  ).catch(() => []);
  // Jangan kirim ciphertext akun ke client admin list; detail diambil
  // eksplisit per order bila diperlukan.
  const safe = rows.map((r) => ({ ...r, wr_account_details: r.wr_account_details ? "(encrypted)" : null, wr_account_iv: undefined }));
  return NextResponse.json({ orders: safe, total, page, per_page: perPage });
}
