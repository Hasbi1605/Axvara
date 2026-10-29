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
  type VariantCopyEntry,
} from "@/lib/product-copy/format";
import { needsCopyReview, resolveVariantCopyDetailed } from "@/lib/product-copy/resolve";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const VARIANT_COPY_SQL = `SELECT pv.id, pv.product_id, pv.label, pv.is_active, pv.wr_variant_id,
       pv.admin_terms, pv.admin_activation, pv.admin_copy_fingerprint,
        pv.sk_variant_id, sp.sk_description, sp.sk_seller_note,
        wv.wr_terms, wv.wr_delivery_terms
  FROM product_variants pv
  LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
  LEFT JOIN sk_products sp ON sp.sk_variant_id = pv.sk_variant_id`;

type Row = Record<string, unknown>;

const text = (value: unknown): string | null => {
  const s = value == null ? "" : String(value);
  return s.trim() ? s : null;
};

function toEntry(row: Row): VariantCopyEntry {
  const supplierTerms = text(row.wr_terms) ?? text(row.sk_description);
  const supplierActivation = text(row.wr_delivery_terms) ?? text(row.sk_seller_note);
  const adminTerms = text(row.admin_terms);
  const adminActivation = text(row.admin_activation);
  const resolution = resolveVariantCopyDetailed(supplierTerms, supplierActivation, {
    terms: adminTerms,
    activation: adminActivation,
    fingerprint: row.admin_copy_fingerprint == null ? null : String(row.admin_copy_fingerprint),
  });
  const auto = serializeVariantCopy(resolution.auto);
  const effective = serializeVariantCopy(resolution.copy);
  return {
    variantId: Number(row.id),
    label: String(row.label ?? ""),
    isActive: Number(row.is_active ?? 1) === 1,
    wrManaged: text(row.wr_variant_id) !== null,
    supplier: text(row.wr_variant_id) !== null ? "WR" : text(row.sk_variant_id) !== null ? "SK" : null,
    supplierKey: resolution.supplierKey,
    effectiveTerms: effective.terms,
    effectiveActivation: effective.activation,
    status: resolution.status,
    adminStale: resolution.adminStale,
    needsReview: needsCopyReview(resolution),
    hasOverride: adminTerms !== null || adminActivation !== null,
    adminTerms: adminTerms ?? "",
    adminActivation: adminActivation ?? "",
    autoTerms: auto.terms,
    autoActivation: auto.activation,
    supplierTerms: supplierTerms ?? "",
    supplierActivation: supplierActivation ?? "",
  };
}

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

const putSchema = z.object({
  variant_id: z.coerce.number().int().positive(),
  terms: z.string().max(VARIANT_COPY_MAX_CHARS, "S&K terlalu panjang"),
  activation: z.string().max(VARIANT_COPY_MAX_CHARS, "Cara aktivasi terlalu panjang"),
  supplier_key: z.string().max(32),
});

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

  const terms = normalize(parsed.data.terms);
  const activation = normalize(parsed.data.activation);
  const variantId = Number(row.id);
  const supplier = resolveVariantCopyDetailed(text(row.wr_terms) ?? text(row.sk_description), text(row.wr_delivery_terms) ?? text(row.sk_seller_note));
  if (parsed.data.supplier_key !== supplier.supplierKey) {
    return NextResponse.json({ error: "Teks supplier berubah. Muat sumber terbaru lalu tinjau kembali; draft tetap tersedia.", variant: toEntry(row) }, { status: 409, headers: NO_STORE });
  }
  const incoming = parseAdminVariantCopy(terms, activation);
  // Teks yang isinya sama dengan salinan otomatis tidak dibekukan ke DB, agar
  // perbaikan kurasi berikutnya dan perubahan supplier tetap mengalir.
  const sameAsAuto = incoming !== null
    && JSON.stringify(serializeVariantCopy(incoming)) === JSON.stringify(serializeVariantCopy(supplier.auto));
  const clear = incoming === null || sameAsAuto;
  // Compare sumber dan suntingan dalam UPDATE yang sama, bukan hanya sebelum tulis.
  const result = await execRun(
    `UPDATE product_variants SET admin_terms=?, admin_activation=?, admin_copy_fingerprint=?,
            updated_at=datetime('now') WHERE id=?
      AND admin_terms IS ? AND admin_activation IS ? AND admin_copy_fingerprint IS ?
      AND EXISTS (${VARIANT_COPY_SQL} WHERE pv.id=?
        AND pv.wr_variant_id IS ? AND pv.sk_variant_id IS ?
        AND wv.wr_terms IS ? AND wv.wr_delivery_terms IS ?
        AND sp.sk_description IS ? AND sp.sk_seller_note IS ?)`,
    clear ? null : terms || null, clear ? null : activation || null, clear ? null : supplier.supplierKey,
    variantId, row.admin_terms ?? null, row.admin_activation ?? null, row.admin_copy_fingerprint ?? null,
    variantId, row.wr_variant_id ?? null, row.sk_variant_id ?? null,
    row.wr_terms ?? null, row.wr_delivery_terms ?? null, row.sk_description ?? null, row.sk_seller_note ?? null,
  );
  if (!result.changes) {
    return NextResponse.json({ error: "Sumber atau suntingan berubah saat menyimpan. Muat ulang sumber dan tinjau draft sebelum mencoba lagi." }, { status: 409, headers: NO_STORE });
  }
  const saved = await queryFirst(`${VARIANT_COPY_SQL} WHERE pv.id=?`, variantId) as Row;
  return NextResponse.json({ ok: true, variant: toEntry(saved) }, { headers: NO_STORE });
}
