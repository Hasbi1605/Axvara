import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { queryAll } from "@/lib/db";
import { BannerOrderConflict, reorderBanners } from "@/lib/banner-order";
export const runtime = "edge";
export const dynamic = "force-dynamic";
const ids = z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).max(1000);
const schema = z.object({ ids, expected_ids: ids }).strict();
export async function POST(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Urutan banner tidak valid." }, { status: 400 });
  const { ids: next, expected_ids: before } = parsed.data;
  if (new Set(next).size !== next.length || new Set(before).size !== before.length || next.length !== before.length || next.some(id => !before.includes(id))) return NextResponse.json({ error: "Kirim seluruh ID banner tepat satu kali." }, { status: 400 });
  try {
    await reorderBanners(parsed.data.ids, parsed.data.expected_ids);
    return NextResponse.json({ ok: true, banners: await queryAll("SELECT * FROM banners ORDER BY sort_order,id DESC") }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof BannerOrderConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
