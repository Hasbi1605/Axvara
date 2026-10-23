import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryFirst } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { BannerOrderConflict, saveBanner, deleteBanner } from "@/lib/banner-order";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().trim().min(4).max(80).optional(),
  body: z.string().trim().max(500).nullable().optional(),
  image_url: z.string().trim().max(600).nullable().optional(),
  cta_label: z.string().trim().max(24).nullable().optional(),
  cta_href: z.string().trim().max(300).nullable().optional(),
  is_active: z.boolean().optional(),
  delay_ms: z.coerce.number().int().min(0).max(10000).optional(),
  max_show_per_session: z.coerce.number().int().min(1).max(10).optional(),
  sort_order: z.coerce.number().int().min(0).max(999).optional(),
}).strict();

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body tidak valid" }, { status: 400 }); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  const existing = (await queryFirst("SELECT id FROM banners WHERE id=?", id)) as Record<string, unknown> | undefined;
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const data = parsed.data as Record<string, unknown>;
  if (data.image_url && typeof data.image_url === "string" && !data.image_url.startsWith("/r2/banners/")) return NextResponse.json({ error: "Gambar harus berasal dari uploader banner AXVARA" }, { status: 400 });
  if (data.cta_href && typeof data.cta_href === "string" && !/^(\/[^/]|https:\/\/)/.test(data.cta_href)) return NextResponse.json({ error: "CTA href harus /... atau https://" }, { status: 400 });
  try {
    const result = await saveBanner({ ...data, ...(data.is_active !== undefined ? { is_active: data.is_active ? 1 : 0 } : {}) }, Number(id));
    if (!result.changes) return NextResponse.json({ error: "not found" }, { status: 404 });
    const banner = await queryFirst("SELECT * FROM banners WHERE id=?", id);
    return NextResponse.json({ ok: true, sort_order: banner?.sort_order, banner });
  } catch (error) {
    if (error instanceof BannerOrderConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try { await deleteBanner(Number(id)); }
  catch (error) {
    if (error instanceof BannerOrderConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ ok: true });
}
