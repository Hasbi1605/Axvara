import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryFirst, execRun } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

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
  if (data.image_url && typeof data.image_url === "string" && !/^(\/r2\/|https:\/\/)/.test(data.image_url)) return NextResponse.json({ error: "Image URL tidak valid" }, { status: 400 });
  const fields: string[] = [];
  const vals: unknown[] = [];
  const map: Record<string, string> = { title: "title", body: "body", image_url: "image_url", cta_label: "cta_label", cta_href: "cta_href", delay_ms: "delay_ms", max_show_per_session: "max_show_per_session", sort_order: "sort_order" };
  for (const [k, col] of Object.entries(map)) if (data[k] !== undefined) { fields.push(`${col}=?`); vals.push(data[k]); }
  if (data.is_active !== undefined) { fields.push("is_active=?"); vals.push(data.is_active ? 1 : 0); }
  if (!fields.length) return NextResponse.json({ ok: true });
  fields.push("updated_at=datetime('now')");
  vals.push(id);
  await execRun(`UPDATE banners SET ${fields.join(",")} WHERE id=?`, ...vals);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await execRun("DELETE FROM banners WHERE id=?", id);
  return NextResponse.json({ ok: true });
}
