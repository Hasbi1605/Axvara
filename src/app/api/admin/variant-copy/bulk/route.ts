import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { getD1, queryAll, queryFirst } from "@/lib/db";
import { readJsonBody } from "@/lib/http-body";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { VARIANT_COPY_MAX_CHARS } from "@/lib/product-copy/format";
import { VARIANT_COPY_SQL, toEntry } from "@/lib/product-copy/admin-entry";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const idsSchema = z.array(z.number().int().positive()).min(1).max(20)
  .refine(ids => new Set(ids).size === ids.length);
const copyText = z.string().max(VARIANT_COPY_MAX_CHARS);
const schema = z.object({
  product_id: z.number().int().positive(),
  variant_ids: idsSchema,
  terms: copyText,
  activation: copyText,
  terms_en: copyText,
  activation_en: copyText,
});

export async function POST(req: NextRequest) {
  if (!rateLimit(rateLimitKey(req, "variant-copy:write"), 30)) {
    return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
  }
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const d1 = getD1();
  if (!d1) return NextResponse.json({ error: "Butuh database D1" }, { status: 503, headers: NO_STORE });
  const body = await readJsonBody(req);
  if (!body.ok) {
    body.response.headers.set("Cache-Control", "no-store");
    return body.response;
  }
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    const error = parsed.error.issues.some(issue => issue.path[0] === "variant_ids")
      ? "invalid_ids" : parsed.error.issues[0]?.message ?? "Validasi gagal";
    return NextResponse.json({ error }, { status: 400, headers: NO_STORE });
  }
  const data = parsed.data;
  if (!await queryFirst("SELECT id FROM products WHERE id=?", data.product_id)) {
    return NextResponse.json({ error: "Produk tidak ditemukan" }, { status: 404, headers: NO_STORE });
  }
  const selection = ` WHERE pv.product_id=? AND pv.id IN (${data.variant_ids.map(() => "?").join(",")}) ORDER BY pv.sort_order ASC, pv.id ASC`;
  const rows = await queryAll(`${VARIANT_COPY_SQL}${selection}`, data.product_id, ...data.variant_ids);
  if (rows.length !== data.variant_ids.length) {
    return NextResponse.json({ error: "foreign_variant" }, { status: 400, headers: NO_STORE });
  }
  const values = [data.terms, data.activation, data.terms_en, data.activation_en]
    .map(value => value.replace(/\r\n?/g, "\n").trim() || null);
  await d1.batch(rows.map(row => d1.prepare(
    `UPDATE product_variants SET admin_terms=?, admin_activation=?, admin_terms_en=?, admin_activation_en=?,
       admin_copy_fingerprint=?, updated_at=datetime('now') WHERE id=? AND product_id=?`,
  ).bind(...values, toEntry(row).supplierKey, row.id, data.product_id)));
  const saved = await queryAll(`${VARIANT_COPY_SQL}${selection}`, data.product_id, ...data.variant_ids);
  const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
  await bumpCatalogRevision("market", d1);
  return NextResponse.json({ variants: saved.map(toEntry) }, { headers: NO_STORE });
}
