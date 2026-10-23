import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryAll, queryFirst } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { BannerOrderConflict, saveBanner, deleteBanner } from "@/lib/banner-order";

import { readBannerSettings } from "@/lib/banner-settings";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const active = searchParams.get("active");
  const wantAll = active !== "1";
  if (wantAll) {
    const a = await requireAdmin(req).catch(() => null);
    if (!a) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let sql = "SELECT * FROM banners WHERE 1=1";
  const params: unknown[] = [];
  if (active === "1") sql += " AND is_active=1";
  sql += " ORDER BY sort_order ASC, id DESC";
  const [rows, settings] = await Promise.all([queryAll(sql, ...params), readBannerSettings()]);
  return NextResponse.json(
    { banners: rows, settings },
    {
      headers: {
        "Cache-Control": active === "1"
          ? "no-store"
          : "private, no-store, max-age=0",
      },
    }
  );
}

const schema = z.object({
  title: z.string().trim().min(4).max(80),
  body: z.string().trim().max(500).optional().nullable(),
  image_url: z.string().trim().max(600).optional().nullable(),
  cta_label: z.string().trim().max(24).optional().nullable(),
  cta_href: z.string().trim().max(300).optional().nullable(),
  is_active: z.boolean().optional().default(false),
  delay_ms: z.coerce.number().int().min(0).max(10000).optional().default(1500),
  max_show_per_session: z.coerce.number().int().min(1).max(10).optional().default(1),
  sort_order: z.coerce.number().int().min(0).max(999).optional().default(0),
});

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body tidak valid" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  const d = parsed.data;
  if (d.image_url && !d.image_url.startsWith("/r2/banners/")) return NextResponse.json({ error: "Gambar harus berasal dari uploader banner AXVARA" }, { status: 400 });
  if (d.cta_href && !/^(\/[^/]|https:\/\/)/.test(d.cta_href)) return NextResponse.json({ error: "CTA href harus /... atau https:// (// tidak diizinkan)" }, { status: 400 });
  try {
    const saved = await saveBanner({ ...d, is_active: d.is_active ? 1 : 0 }, null);
    return NextResponse.json({ id: saved.id, sort_order: saved.sort_order }, { status: 201 });
  } catch (error) {
    if (error instanceof BannerOrderConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}

export async function PUT(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id diperlukan" }, { status: 400 });
  if (!await queryFirst("SELECT id FROM banners WHERE id=?", id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  const d = parsed.data;
  if (d.image_url && !d.image_url.startsWith("/r2/banners/")) return NextResponse.json({ error: "Gambar harus berasal dari uploader banner AXVARA" }, { status: 400 });
  if (d.cta_href && !/^(\/[^/]|https:\/\/)/.test(d.cta_href)) return NextResponse.json({ error: "CTA href harus /... atau https://" }, { status: 400 });
  try {
    const saved = await saveBanner({ ...d, is_active: d.is_active ? 1 : 0 }, Number(id));
    if (!saved.changes) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, sort_order: saved.sort_order });
  } catch (error) {
    if (error instanceof BannerOrderConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
export async function DELETE(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "id tidak valid" }, { status: 400 });
  try {
    const result = await deleteBanner(id);
    return NextResponse.json({ ok: Boolean(result.changes) }, { status: result.changes ? 200 : 404 });
  } catch (error) {
    if (error instanceof BannerOrderConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
