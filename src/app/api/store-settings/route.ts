import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { execRun, queryAll } from "@/lib/db";
import { DEFAULT_STORE_SETTINGS, storeSettingsFromRows } from "@/lib/site";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  name: z.string().trim().min(2, "Nama toko minimal 2 karakter").max(40),
  tagline: z.string().trim().min(10, "Tagline minimal 10 karakter").max(160),
  whatsappNumber: z.string().trim().regex(/^\+?[0-9\s()-]{9,22}$/, "Nomor WhatsApp tidak valid"),
  supportHours: z.string().trim().min(5, "Jam layanan wajib diisi").max(60),
  footerText: z.string().trim().min(10, "Keterangan footer minimal 10 karakter").max(300),
  logoUrl: z.string().trim().max(600).refine(
    (value) => value === "" || value.startsWith("/") || /^https:\/\//i.test(value),
    "Logo harus berupa path situs atau URL HTTPS",
  ),
});

const keyMap = {
  store_name: "name",
  tagline: "tagline",
  whatsapp_number: "whatsappNumber",
  support_hours: "supportHours",
  footer_text: "footerText",
  logo_url: "logoUrl",
} as const;

export async function GET() {
  try {
    const rows = await queryAll("SELECT key,value FROM store_settings ORDER BY key ASC");
    return NextResponse.json(
      { settings: storeSettingsFromRows(rows) },
      { headers: { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (error) {
    console.error("GET /api/store-settings failed:", error);
    return NextResponse.json({ settings: DEFAULT_STORE_SETTINGS }, { headers: { "Cache-Control": "no-store" } });
  }
}

export async function PUT(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  }

  try {
    for (const [key, property] of Object.entries(keyMap)) {
      await execRun(
        `INSERT INTO store_settings (key,value,updated_at) VALUES (?,?,datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
        key,
        parsed.data[property],
      );
    }
    return NextResponse.json({ ok: true, settings: parsed.data });
  } catch (error) {
    console.error("PUT /api/store-settings failed:", error);
    return NextResponse.json({ error: "Pengaturan toko gagal disimpan" }, { status: 500 });
  }
}
