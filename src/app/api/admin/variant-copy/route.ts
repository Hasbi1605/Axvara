// /api/admin/variant-copy — S&K + cara aktivasi versi admin per varian (migrasi 0041).
//
// GET ?product_id= : status salinan tiap varian + teks untuk editor.
// PUT              : simpan suntingan satu varian (teks kosong = kembali otomatis).
//
// Disimpan lewat endpoint sendiri, bukan PUT /api/products/:id: menyimpan
// form produk (foto, badge) tidak boleh ikut mencap ulang sidik jari suntingan
// yang dijeda karena supplier mengubah teks; cap hanya lewat tombol simpan S&K,
// yaitu setelah admin melihat teks supplier terbaru.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { execRun, isD1Mode, queryAll, queryFirst } from "@/lib/db";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import {
  VARIANT_COPY_MAX_CHARS,
  parseAdminVariantCopy,
  serializeVariantCopy,
} from "@/lib/product-copy/format";
import { resolveVariantCopyDetailed } from "@/lib/product-copy/resolve";
import { VARIANT_COPY_SQL, text, toEntry } from "@/lib/product-copy/admin-entry";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

type Row = Record<string, unknown>;

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isD1Mode()) return NextResponse.json({ variants: [] }, { headers: NO_STORE });
  const productId = Number(new URL(req.url).searchParams.get("product_id"));
  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ error: "product_id tidak valid" }, { status: 400 });
  }
  const rows = await queryAll(`${VARIANT_COPY_SQL} WHERE pv.product_id=? ORDER BY pv.sort_order ASC, pv.id ASC`, productId);
  return NextResponse.json({ variants: rows.map(toEntry) }, { headers: NO_STORE });
}

const actionSchema = z.object({
  variant_id: z.coerce.number().int().positive(),
  supplier_key: z.string().max(32),
  action: z.enum(["acknowledge", "unacknowledge"]),
});

const editSchema = z.object({
  variant_id: z.coerce.number().int().positive(),
  terms: z.string().max(VARIANT_COPY_MAX_CHARS, "S&K terlalu panjang"),
  activation: z.string().max(VARIANT_COPY_MAX_CHARS, "Cara aktivasi terlalu panjang"),
  terms_en: z.string().max(VARIANT_COPY_MAX_CHARS, "English terms too long").optional().default(""),
  activation_en: z.string().max(VARIANT_COPY_MAX_CHARS, "English activation too long").optional().default(""),
  supplier_key: z.string().max(32),
});

const putSchema = z.union([actionSchema, editSchema]);

const normalize = (value: string) => value.replace(/\r\n?/g, "\n").trim();

export async function PUT(req: NextRequest) {
  if (!rateLimit(rateLimitKey(req, "variant-copy:write"), 30)) {
    return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isD1Mode()) return NextResponse.json({ error: "Butuh database D1" }, { status: 503 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body tidak valid" }, { status: 400 }); }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });

  const row = await queryFirst(`${VARIANT_COPY_SQL} WHERE pv.id=?`, parsed.data.variant_id) as Row | undefined;
  if (!row) return NextResponse.json({ error: "Varian tidak ditemukan" }, { status: 404 });

  const data = parsed.data;
  const variantId = Number(row.id);
  const supplierTerms = text(row.wr_terms) ?? text(row.sk_description);
  const supplierActivation = text(row.wr_delivery_terms) ?? text(row.sk_seller_note);
  const supplier = resolveVariantCopyDetailed(supplierTerms, supplierActivation);
  if (data.supplier_key !== supplier.supplierKey) {
    return NextResponse.json({ error: "Teks supplier berubah. Muat sumber terbaru lalu tinjau kembali; draft tetap tersedia.", variant: toEntry(row) }, { status: 409, headers: NO_STORE });
  }

  // Tanda "teks supplier sudah oke" (16 November 2026): acknowledge menyimpan
  // sidik jari supplier saat ini tanpa mengubah teks admin/EN; unacknowledge
  // menghapus tanda itu. Tidak ada teks admin yang ditulis di jalur ini.
  if ("action" in data) {
    const adminTerms = text(row.admin_terms);
    const adminActivation = text(row.admin_activation);
    if (adminTerms !== null || adminActivation !== null) {
      return NextResponse.json({ error: "has_override" }, { status: 409, headers: NO_STORE });
    }
    const current = resolveVariantCopyDetailed(supplierTerms, supplierActivation, {
      terms: adminTerms,
      activation: adminActivation,
      fingerprint: row.admin_copy_fingerprint == null ? null : String(row.admin_copy_fingerprint),
    });
    if (data.action === "acknowledge" && current.status !== "pemasok") {
      return NextResponse.json({ error: "not_pemasok" }, { status: 400, headers: NO_STORE });
    }
    const nextFingerprint = data.action === "acknowledge" ? supplier.supplierKey : null;
    // CAS sama: kolom admin + teks sumber tidak boleh berubah sejak dibaca.
    const savedResult = await execRun(
      `UPDATE product_variants SET admin_copy_fingerprint=?, updated_at=datetime('now') WHERE id=?
        AND admin_terms IS ? AND admin_activation IS ? AND admin_terms_en IS ? AND admin_activation_en IS ? AND admin_copy_fingerprint IS ?
        AND EXISTS (${VARIANT_COPY_SQL} WHERE pv.id=?
          AND pv.wr_variant_id IS ? AND pv.sk_variant_id IS ?
          AND wv.wr_terms IS ? AND wv.wr_delivery_terms IS ?
          AND sp.sk_description IS ? AND sp.sk_seller_note IS ?)`,
      nextFingerprint, variantId,
      row.admin_terms ?? null, row.admin_activation ?? null, row.admin_terms_en ?? null, row.admin_activation_en ?? null, row.admin_copy_fingerprint ?? null,
      variantId, row.wr_variant_id ?? null, row.sk_variant_id ?? null,
      row.wr_terms ?? null, row.wr_delivery_terms ?? null, row.sk_description ?? null, row.sk_seller_note ?? null,
    );
    if (!savedResult.changes) {
      return NextResponse.json({ error: "Sumber atau suntingan berubah saat menyimpan. Muat ulang sumber dan tinjau draft sebelum mencoba lagi." }, { status: 409, headers: NO_STORE });
    }
    const saved = await queryFirst(`${VARIANT_COPY_SQL} WHERE pv.id=?`, variantId) as Row;
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("market");
    return NextResponse.json({ ok: true, variant: toEntry(saved) }, { headers: NO_STORE });
  }

  const terms = normalize(data.terms);
  const activation = normalize(data.activation);
  const termsEn = normalize(data.terms_en);
  const activationEn = normalize(data.activation_en);
  const incoming = parseAdminVariantCopy(terms, activation);
  // Teks yang isinya sama dengan salinan otomatis tidak dibekukan ke DB, agar
  // perbaikan kurasi berikutnya dan perubahan supplier tetap mengalir.
  const sameAsAuto = incoming !== null
    && JSON.stringify(serializeVariantCopy(incoming)) === JSON.stringify(serializeVariantCopy(supplier.auto));
  const clear = incoming === null || sameAsAuto;
  // Compare sumber dan suntingan dalam UPDATE yang sama, bukan hanya sebelum tulis.
  const result = await execRun(
    `UPDATE product_variants SET admin_terms=?, admin_activation=?, admin_terms_en=?, admin_activation_en=?, admin_copy_fingerprint=?,
            updated_at=datetime('now') WHERE id=?
      AND admin_terms IS ? AND admin_activation IS ? AND admin_terms_en IS ? AND admin_activation_en IS ? AND admin_copy_fingerprint IS ?
      AND EXISTS (${VARIANT_COPY_SQL} WHERE pv.id=?
        AND pv.wr_variant_id IS ? AND pv.sk_variant_id IS ?
        AND wv.wr_terms IS ? AND wv.wr_delivery_terms IS ?
        AND sp.sk_description IS ? AND sp.sk_seller_note IS ?)`,
    clear ? null : terms || null, clear ? null : activation || null,
    clear ? null : termsEn || null, clear ? null : activationEn || null, clear ? null : supplier.supplierKey,
    variantId, row.admin_terms ?? null, row.admin_activation ?? null, row.admin_terms_en ?? null, row.admin_activation_en ?? null, row.admin_copy_fingerprint ?? null,
    variantId, row.wr_variant_id ?? null, row.sk_variant_id ?? null,
    row.wr_terms ?? null, row.wr_delivery_terms ?? null, row.sk_description ?? null, row.sk_seller_note ?? null,
  );
  if (!result.changes) {
    return NextResponse.json({ error: "Sumber atau suntingan berubah saat menyimpan. Muat ulang sumber dan tinjau draft sebelum mencoba lagi." }, { status: 409, headers: NO_STORE });
  }
  const saved = await queryFirst(`${VARIANT_COPY_SQL} WHERE pv.id=?`, variantId) as Row;
  const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
  await bumpCatalogRevision("market");
  return NextResponse.json({ ok: true, variant: toEntry(saved) }, { headers: NO_STORE });
}
