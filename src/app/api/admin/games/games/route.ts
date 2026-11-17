// GET/PATCH /api/admin/games/games — kelola metadata per GAME (bukan varian):
// nama tampil, publisher, ikon/banner, deskripsi, panduan ID, urutan populer,
// sembunyikan dari publik, dan markup khusus game (docs/GAMES.md §14).
// PATCH menulis `games_meta`; perubahan markup menghitung ulang varian game itu.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { gamesAdminGames, GAMES_META_UPSERT_SQL } from "@/lib/games/admin-games";
import { recomputeGamesSkPrices } from "@/lib/games/markup";
import { GAMES_MARKUP_MAX_PERCENT } from "@/lib/games/pricing";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/** URL gambar: https absolut atau path media R2 hasil `/api/upload`. */
const imageUrlSchema = z.string().trim().max(500).nullable().optional()
  .refine((value) => value === null || value === undefined || value === ""
    || /^https:\/\/[^\s]+$/i.test(value)
    || /^\/r2\/[A-Za-z0-9/_.-]{1,200}$/.test(value),
    { message: "URL harus https:// atau hasil unggah /r2/." });

const patchSchema = z.object({
  slug: z.string({ error: "Slug wajib diisi." }).trim().toLowerCase()
    .regex(/^[a-z0-9-]{1,64}$/, "Slug tidak valid."),
  display_name: z.string().trim().max(120, "Nama maksimal 120 karakter.").nullable().optional(),
  publisher: z.string().trim().max(120, "Publisher maksimal 120 karakter.").nullable().optional(),
  icon_url: imageUrlSchema,
  banner_url: imageUrlSchema,
  description: z.string().trim().max(600, "Deskripsi maksimal 600 karakter.").nullable().optional(),
  id_guide: z.string().trim().max(600, "Panduan ID maksimal 600 karakter.").nullable().optional(),
  featured_rank: z.number({ error: "Urutan populer harus berupa angka." }).int("Urutan populer harus bilangan bulat.")
    .min(1, "Urutan populer 1–99.").max(99, "Urutan populer 1–99.").nullable().optional(),
  hidden: z.boolean({ error: "hidden harus boolean." }).optional(),
  markup_percent: z.number({ error: "Markup khusus harus berupa angka." })
    .min(0, "Markup minimal 0%.").max(GAMES_MARKUP_MAX_PERCENT, "Markup maksimal 100%.")
    .refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, { message: "Markup maksimal 2 desimal." })
    .nullable().optional(),
}).strict().refine(
  (value) => ["display_name", "publisher", "icon_url", "banner_url", "description", "id_guide",
    "featured_rank", "hidden", "markup_percent"].some((key) => value[key as keyof typeof value] !== undefined),
  { message: "Tidak ada perubahan." },
);

const cleanText = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { games, settings, count } = await gamesAdminGames(createDatabaseAccess());
    return NextResponse.json({ ok: true, games, count, pricing: settings });
  } catch { return NextResponse.json({ error: "load_failed" }, { status: 500 }); }
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJsonBody(request, 8_000);
  if (!body.ok) return body.response;
  const parsed = patchSchema.safeParse(body.data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const error = issue?.code === "unrecognized_keys" ? "invalid_body" : issue?.message ?? "invalid_body";
    return NextResponse.json({ error, message: issue?.message ?? "Body tidak valid." }, { status: 400 });
  }
  const patch = parsed.data;
  const db = createDatabaseAccess();
  if (!db.d1) return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  try {
    const existing = await db.queryFirst("SELECT * FROM games_meta WHERE slug=?", patch.slug);
    if (!existing) {
      // Slug harus dikenal katalog SK (mencegah baris games_meta yatim).
      const known = await db.queryFirst(
        "SELECT 1 AS ok FROM games_products WHERE supplier='sekalipay' AND game_slug=? LIMIT 1",
        patch.slug,
      );
      if (!known) return NextResponse.json({ error: "not_found", message: "Game tidak ditemukan." }, { status: 404 });
    }
    const previousMarkup = existing?.markup_percent === null || existing?.markup_percent === undefined
      ? null : Number(existing.markup_percent);
    const nextMarkup = patch.markup_percent !== undefined
      ? patch.markup_percent
      : previousMarkup;
    const row = {
      slug: patch.slug,
      display_name: patch.display_name !== undefined ? cleanText(patch.display_name) : existing?.display_name ?? null,
      publisher: patch.publisher !== undefined ? cleanText(patch.publisher) : existing?.publisher ?? null,
      icon_url: patch.icon_url !== undefined ? cleanText(patch.icon_url) : existing?.icon_url ?? null,
      banner_url: patch.banner_url !== undefined ? cleanText(patch.banner_url) : existing?.banner_url ?? null,
      description: patch.description !== undefined ? cleanText(patch.description) : existing?.description ?? null,
      id_guide: patch.id_guide !== undefined ? cleanText(patch.id_guide) : existing?.id_guide ?? null,
      featured_rank: patch.featured_rank !== undefined
        ? patch.featured_rank
        : (existing?.featured_rank === null || existing?.featured_rank === undefined ? null : Number(existing.featured_rank)),
      hidden: patch.hidden !== undefined ? (patch.hidden ? 1 : 0) : Number(existing?.hidden ?? 0) === 1 ? 1 : 0,
      markup_percent: nextMarkup,
      updated_at: new Date().toISOString(),
      updated_by: admin.email ?? null,
    };
    await db.execRun(GAMES_META_UPSERT_SQL, row.slug, row.display_name, row.publisher, row.icon_url,
      row.banner_url, row.description, row.id_guide, row.featured_rank, row.hidden, row.markup_percent,
      row.updated_at, row.updated_by);
    const markupChanged = patch.markup_percent !== undefined && patch.markup_percent !== previousMarkup;
    const updated = markupChanged ? (await recomputeGamesSkPrices(db, { slug: patch.slug })).updated : 0;
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("games", db);
    return NextResponse.json({ ok: true, slug: patch.slug, markup_changed: markupChanged, updated });
  } catch { return NextResponse.json({ error: "save_failed" }, { status: 500 }); }
}
