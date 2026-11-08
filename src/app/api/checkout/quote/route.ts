import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryAll, queryFirst, isD1Mode } from "@/lib/db";
import { isVariantsReadEnabled } from "@/lib/catalog";
import { createCheckoutQuoteToken, requireAdmin } from "@/lib/auth";
import { isPaymentAdminTestEnabled } from "@/lib/payments/rails";
import { buildMethodCatalog } from "@/lib/payments/method-options";
import { resolveBuyerPreferences } from "@/lib/i18n/locale";
import { readTrustedCountry } from "@/lib/i18n/server-country";
import { displayUsdCents } from "@/lib/i18n/format";
import { loadCurrentFxSnapshot } from "@/lib/payments/market-snapshot";
import { isQueuedFulfillment } from "@/lib/warung-rebahan/delivery-class";
import { checkRateLimit } from "@/lib/rateLimit";
import { MAX_UNIQUE_UNITS_PER_ORDER } from "@/lib/fulfillment/units";
import { readJsonBody } from "@/lib/http-body";
import { bulkOwnerFromProductRow, bulkUnitPrice, isManualProductForBulk, validateBulkPricing } from "@/lib/bulk-pricing";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const itemSchema = z.object({
  product_id: z.coerce.number().int().safe().min(1).optional(),
  variant_id: z.coerce.number().int().safe().min(1).optional(),
  slug: z.string().trim().min(1).max(100).optional(),
  qty: z.coerce.number().int().min(1).max(100),
  expected_price: z.coerce.number().int().safe().min(0).optional(),
}).refine((item) => item.product_id || item.slug, "Produk tidak valid");

const schema = z.object({ items: z.array(itemSchema).min(1).max(20) });

type QuoteIssue = {
  product_id?: number;
  slug?: string;
  variant_id?: number;
  min_qty?: number;
  type: "missing" | "inactive" | "out_of_stock" | "insufficient_stock" | "invalid_quantity" | "below_minimum" | "variant_required";
  message: string;
};

type PriceChange = {
  product_id: number;
  variant_id?: number;
  name: string;
  previous_price: number;
  current_price: number;
  message: string;
};

export async function POST(req: NextRequest) {
  const adminTest = req.nextUrl.pathname === "/api/admin/payments/test/quote";
  if (adminTest) {
    if (!await requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isPaymentAdminTestEnabled()) return NextResponse.json({ error: "Tes pembayaran nonaktif." }, { status: 503 });
  }
  // Quote tanpa limit = enumerasi harga/stok gratis (issue #14): 20/mnt/IP
  // sebagai lapis kedua setelah 1 rule WAF Free (lihat ARCHITECTURE §9).
  if (!checkRateLimit(req, "checkout:quote")) {
    return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  }

  const aggregate = new Map<string, z.infer<typeof itemSchema>>();
  for (const item of parsed.data.items) {
    const key = item.variant_id
      ? `${item.slug ? `slug:${item.slug}` : `id:${item.product_id}`}:var:${item.variant_id}`
      : item.slug ? `slug:${item.slug}` : `id:${item.product_id}`;
    const current = aggregate.get(key);
    aggregate.set(key, current ? { ...current, qty: current.qty + item.qty } : item);
  }

  let subtotal = 0;
  const quotedItems: { product_id: number; variant_id?: number; name: string; price: number; base_price?: number; applied_tier_min_qty?: number; qty: number; stock: number; image: string; queued_delivery: boolean; automatic_processing?: true }[] = [];
  let uniqueUnits = 0;
  const issues: QuoteIssue[] = [];
  const changes: PriceChange[] = [];
  const variantsRequired = isD1Mode() && isVariantsReadEnabled();

  // N+1 guard (issue #14): D1 Free hanya 50 query/invocation. Quote 20
  // item × (1 produk + 1 varian) = 40 query berurutan sudah mendekati batas
  // sebelum menghitung payment_methods. Kumpulkan dulu semua id/slug unik,
  // lalu ambil produk + varian dalam 2 query IN — total tetap 3 query untuk
  // berapa pun jumlah item.
  // D1 membatasi 100 bound parameter per query (issue #14): 20 slug × ~50
  // byte masih aman, tapi potong batch agar pola IN (...) tidak pernah
  // melewati batas saat item bertambah.
  const productIds = new Set<number>();
  const productSlugs = new Set<string>();
  const variantIds = new Set<number>();
  for (const item of aggregate.values()) {
    if (item.variant_id) variantIds.add(item.variant_id);
    if (item.slug) productSlugs.add(item.slug.slice(0, 100));
    else if (item.product_id) productIds.add(item.product_id);
  }
  const productById = new Map<number, Record<string, unknown>>();
  const productBySlug = new Map<string, Record<string, unknown>>();
  if (productIds.size > 0) {
    const rows = await queryAll(
      `SELECT p.*, c.slug as cat_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id IN (${[...productIds].map(() => "?").join(",")})`,
      ...[...productIds],
    );
    for (const row of rows) {
      productById.set(Number(row.id), row);
      productBySlug.set(String(row.slug), row);
    }
  }
  if (productSlugs.size > 0) {
    const rows = await queryAll(
      `SELECT p.*, c.slug as cat_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.slug IN (${[...productSlugs].map(() => "?").join(",")})`,
      ...[...productSlugs],
    );
    for (const row of rows) {
      productById.set(Number(row.id), row);
      productBySlug.set(String(row.slug), row);
    }
  }
  const variantById = new Map<number, Record<string, unknown>>();
  if (variantIds.size > 0) {
    const rows = await queryAll(
      `SELECT pv.*, wv.wr_type AS wr_type, wv.wr_delivery_class AS wr_delivery_class,
              wv.wr_max_quantity AS wr_max_quantity,
              sp.sk_order_process AS sk_order_process, p.require_email AS require_email,
              -- Unit kredensial tersisa khusus unique (2026-10-02, insiden Head
              -- 18 Bulan): tanpa ini varian stock=2 + available=1 lolos quote
              -- lalu gagal di guard atomik. Subquery per varian (quote ≤20
              -- item), bukan JOIN + GROUP BY yang mengubah bentuk baris.
              (SELECT COUNT(*) FROM fulfillment_inventory fi
                WHERE fi.product_id = pv.product_id
                  AND fi.variant_id = pv.id
                  AND fi.status = 'available'
                  AND pv.fulfillment_mode = 'unique') AS inventory_available
       FROM product_variants pv
       LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
       LEFT JOIN sk_products sp ON sp.sk_variant_id = pv.sk_variant_id
       LEFT JOIN products p ON p.id = pv.product_id
       WHERE pv.id IN (${[...variantIds].map(() => "?").join(",")})`,
      ...[...variantIds],
    );
    for (const row of rows) variantById.set(Number(row.id), row);
  }
  // Resolve aliases before aggregation; a foreign product/variant pair never contributes to a tier.
  const canonical = new Map<string, z.infer<typeof itemSchema>>();
  for (const item of aggregate.values()) {
    const product = item.slug ? productBySlug.get(item.slug) : productById.get(Number(item.product_id));
    if (!product || (item.product_id && Number(product.id) !== item.product_id) || (item.variant_id && Number(variantById.get(item.variant_id)?.product_id) !== Number(product.id))) {
      issues.push({ product_id: item.product_id, slug: item.slug, variant_id: item.variant_id, type: "missing", message: "Produk atau varian tidak cocok." });
      continue;
    }
    const key = `${product.id}:${item.variant_id ?? 0}`;
    const previous = canonical.get(key);
    canonical.set(key, previous ? { ...previous, qty: previous.qty + item.qty } : { ...item, product_id: Number(product.id) });
  }
  aggregate.clear(); for (const [key, value] of canonical) aggregate.set(key, value);
  // Cache min_qty per varian (migrasi 0034): baris fixture lama tanpa kolom
  // tetap aman (fallback 1) karena akses memakai ?? di bawah.
  const minQtyOf = (variantId: number): number => {
    const row = variantById.get(variantId);
    return Math.max(1, Number(row?.min_qty ?? 1) || 1);
  };
  // Email wajib? (migrasi 0033): true bila ada item varian Invite/Link WR
  // atau produk require_email=1. Dibawa di respons agar form checkout
  // mengubah label + validasi SEBELUM bayar; API orders menegakkan lagi.
  let emailRequired = false;

  // Batas atas web = 100/baris (paritas Telegram TELEGRAM_MAX_QTY) agar
  // produk min-besar (mis. GSuite min 50) tetap bisa dibeli dari web.
  // Sebelumnya 20 — varian min_qty > 20 mustahil lolos web.
  for (const item of aggregate.values()) {
    if (item.qty > 100) {
      issues.push({ product_id: item.product_id, slug: item.slug, variant_id: item.variant_id, type: "invalid_quantity", message: "Maksimal 100 unit per produk." });
      continue;
    }
    const row = item.slug ? productBySlug.get(item.slug) : item.product_id ? productById.get(item.product_id) : undefined;

    if (!row) {
      issues.push({ product_id: item.product_id, slug: item.slug, variant_id: item.variant_id, type: "missing", message: "Produk tidak ditemukan." });
      continue;
    }
    const productId = Number(row.id);
    if (Number(row.is_active) === 0) {
      issues.push({ product_id: productId, slug: item.slug, variant_id: item.variant_id, type: "inactive", message: `${row.name} sedang nonaktif.` });
      continue;
    }

    if (variantsRequired && !item.variant_id) {
      issues.push({
        product_id: productId,
        slug: item.slug,
        type: "variant_required",
        message: `Pilih varian ${row.name} dari halaman detail produk.`,
      });
      continue;
    }

    let effectivePrice = Number(row.price);
    let effectiveStock = row.stock == null ? -1 : Number(row.stock);
    let displayName = String(row.name);

    // If variant_id is provided, validate variant against product
    if (item.variant_id) {
      const variantRow = variantById.get(item.variant_id);
      if (!variantRow || Number(variantRow.product_id) !== productId) {
        issues.push({ product_id: productId, slug: item.slug, variant_id: item.variant_id, type: "missing", message: `Varian tidak ditemukan untuk ${row.name}.` });
        continue;
      }
      if (Number(variantRow.is_active) === 0) {
        issues.push({ product_id: productId, slug: item.slug, variant_id: item.variant_id, type: "inactive", message: `${row.name} — ${variantRow.label} sedang nonaktif.` });
        continue;
      }
      effectivePrice = Number(variantRow.price);
      effectiveStock = variantRow.stock == null ? -1 : Number(variantRow.stock);
      // Stok efektif unique (2026-10-02): min(kolom, inventory available).
      // effectiveVariantStock dihitung inline (bukan impor catalog.ts — route
      // ini edge-safe dan catalog membawa query D1 yang tak perlu di sini).
      if (String(variantRow.fulfillment_mode ?? "") === "unique" && variantRow.inventory_available != null) {
        const inv = Number(variantRow.inventory_available);
        if (Number.isFinite(inv)) {
          effectiveStock = effectiveStock === -1
            ? Math.max(0, inv)
            : Math.min(Math.max(0, effectiveStock), Math.max(0, inv));
        }
      }
      // Label + durasi anti-duplikasi (audit 2026-09-19: 88/97 varian aktif
      // kehilangan durasi karena sync WR menulis label = nama verbatim;
      // web WR menggabung "Meitu VIP - 7 Hari"). formatVariantLabel hanya
      // append bila durasi belum ada di label — "GSuite 1 Hari" tidak ganda.
      try {
        const { formatVariantLabel } = await import("@/lib/catalog");
        displayName = `${row.name} — ${formatVariantLabel({
          label: String(variantRow.label ?? ""),
          duration_label: variantRow.duration_label != null ? String(variantRow.duration_label) : null,
          duration_value: variantRow.duration_value != null ? Number(variantRow.duration_value) : null,
          duration_unit: variantRow.duration_unit != null ? String(variantRow.duration_unit) : null,
        })}`;
      } catch {
        displayName = `${row.name} — ${variantRow.label}`;
      }
      if (String(variantRow.fulfillment_mode) === "unique") {
        uniqueUnits += item.qty;
        if (uniqueUnits > MAX_UNIQUE_UNITS_PER_ORDER) {
          issues.push({ product_id: productId, slug: item.slug, variant_id: item.variant_id, type: "invalid_quantity", message: `Maksimal ${MAX_UNIQUE_UNITS_PER_ORDER} akun stok unik per pesanan, termasuk varian lainnya.` });
          continue;
        }
      }
    }

    if (effectiveStock !== -1 && effectiveStock <= 0) {
      issues.push({ product_id: productId, slug: item.slug, variant_id: item.variant_id, type: "out_of_stock", message: `${displayName} stok habis.` });
      continue;
    }
    if (effectiveStock !== -1 && item.qty > effectiveStock) {
      issues.push({ product_id: productId, slug: item.slug, variant_id: item.variant_id, type: "insufficient_stock", message: `${displayName} stok tersisa ${effectiveStock} (diminta ${item.qty}).` });
      continue;
    }
    // Minimum pembelian per varian (migrasi 0034, generik — GSuite min 50).
    // Dicek setelah stok agar pesan "habis" tetap menang atas pesan "kurang".
    // Qty agregat per baris (bukan per item mentah) yang dinilai.
    if (item.variant_id) {
      const minQty = minQtyOf(item.variant_id);
      if (minQty > 1 && item.qty < minQty) {
        issues.push({ product_id: productId, slug: item.slug, variant_id: item.variant_id, min_qty: minQty, type: "below_minimum", message: `${displayName} minimal pembelian ${minQty} (kamu pilih ${item.qty}).` });
        continue;
      }
      // WR3 Jaspay: maksimum qty dari mirror durable (fail-closed bila
      // invalid/missing — bukan unlimited). Agregat qty lintas baris ganda
      // varian sama yang dinilai (paritas min_qty di orders route).
      const vrow = variantById.get(item.variant_id);
      const wrIdForCap = vrow?.wr_variant_id == null ? "" : String(vrow.wr_variant_id).trim();
      if (wrIdForCap.startsWith("jaspay:")) {
        const capRaw = vrow?.wr_max_quantity;
        const cap = capRaw == null ? null : Math.floor(Number(capRaw));
        if (cap == null || !Number.isFinite(cap) || cap < 1) {
          issues.push({ product_id: productId, slug: item.slug, variant_id: item.variant_id, type: "inactive", message: `${displayName} sedang tidak tersedia.` });
          continue;
        }
        const totalForVariant = [...aggregate.values()]
          .filter((a) => Number(a.variant_id || 0) === Number(item.variant_id))
          .reduce((sum, a) => sum + Number(a.qty || 0), 0);
        if (totalForVariant > cap) {
          issues.push({ product_id: productId, slug: item.slug, variant_id: item.variant_id, type: "invalid_quantity", message: `${displayName} maksimal pembelian ${cap} (kamu pilih ${totalForVariant}).` });
          continue;
        }
      }
    }

    const basePrice = effectivePrice;
    let tierMin: number | undefined;
    if (item.variant_id) {
      const variant = variantById.get(item.variant_id)!;
      // Harga grosir hanya untuk produk manual (keputusan owner 2026-11-08):
      // data tersimpan pada produk supplier (WR/SK) tidak pernah dipakai.
      if (Number(variant.bulk_pricing_enabled ?? 0) === 1 && isManualProductForBulk(bulkOwnerFromProductRow(row))) {
        try {
          const config = validateBulkPricing({ enabled: true, tiers: JSON.parse(String(variant.bulk_pricing_tiers)) }, basePrice);
          if (!config) throw new Error("invalid");
          effectivePrice = bulkUnitPrice(basePrice, item.qty, config);
          tierMin = config.tiers.filter((tier) => tier.min_qty <= item.qty).at(-1)?.min_qty;
        } catch {
          issues.push({ product_id: productId, variant_id: item.variant_id, type: "inactive", message: "Harga varian tidak tersedia." });
          continue;
        }
      }
    }
    if (item.expected_price != null && item.expected_price !== basePrice) {
      changes.push({
        product_id: productId,
        variant_id: item.variant_id,
        name: displayName,
        previous_price: item.expected_price,
        current_price: basePrice,
        message: `Harga ${displayName} berubah.`,
      });
    }
    if (!Number.isSafeInteger(effectivePrice) || effectivePrice < 0 || !Number.isSafeInteger(subtotal + effectivePrice * item.qty)) {
      issues.push({ product_id: productId, variant_id: item.variant_id, type: "inactive", message: "Harga varian tidak tersedia." });
      continue;
    }
    subtotal += effectivePrice * item.qty;
    // Penentu email wajib per item (lihat needsEmailForVariant): wr_type
    // Invite/Link dari JOIN di atas + toggle produk require_email.
    try {
      const { needsEmailForVariant } = await import("@/lib/warung-rebahan/delivery-class");
      const itemVariant = item.variant_id ? variantById.get(item.variant_id) : null;
      if (itemVariant && needsEmailForVariant({
        wrType: itemVariant.wr_type != null ? String(itemVariant.wr_type) : null,
        requireEmail: Number(itemVariant.require_email ?? row.require_email ?? 0),
      })) emailRequired = true;
      else if (!item.variant_id && Number(row.require_email ?? 0) === 1) emailRequired = true;
    } catch {
      /* helper murni — gagal impor = anggap tidak wajib, API orders tetap jaga */
    }
    quotedItems.push({
      product_id: productId,
      variant_id: item.variant_id,
      name: displayName,
      price: effectivePrice,
      ...(tierMin ? { base_price: basePrice, applied_tier_min_qty: tierMin } : {}),
      qty: item.qty,
      stock: effectiveStock,
      image: String(row.image_url ?? ""),
      // Kelas pengiriman per baris: checkout WAJIB memberi tahu pembeli
      // sebelum bayar kalau ada varian antrean (bukan kirim otomatis).
      // SK auto ikut instan walau fulfillment_mode lokalnya 'manual'.
      queued_delivery: item.variant_id
        ? isQueuedFulfillment({
            wrVariantId: variantById.get(item.variant_id)?.wr_variant_id,
            wrClass: variantById.get(item.variant_id)?.wr_delivery_class,
            skVariantId: variantById.get(item.variant_id)?.sk_variant_id,
            skOrderProcess: variantById.get(item.variant_id)?.sk_order_process,
            fulfillmentMode: variantById.get(item.variant_id)?.fulfillment_mode,
          })
        : false,
      // WR3 Jaspay: server-derived (dari wr_variant_id mirror, BUKAN input
      // client). queued_delivery TETAP true; flag ini hanya memisahkan
      // notice otomatis vs manual di UI (tanpa nama/id supplier).
      ...(item.variant_id
        && String(variantById.get(item.variant_id)?.wr_variant_id ?? "").trim().startsWith("jaspay:")
        ? { automatic_processing: true as const }
        : {}),
    });
  }

  // Method assembly shared verbatim with TG R1 (same helper, same order,
  // same failure isolation). No web-only tail here anymore.
  // `catalog` = tampilan (termasuk kanal gateway di luar batas sebagai nonaktif); `paymentMethods` = HANYA yang bisa dipilih dan
  // menjadi satu-satunya yang ditandatangani/diterima create. Nonaktif tidak punya biaya/total dan tidak masuk token.
  const catalog = await buildMethodCatalog(subtotal, adminTest);
  const paymentMethods = catalog.filter((method): method is Exclude<typeof method, { available: false }> => method.available);
  // Locale: cookie axv_locale (server read) + Accept-Language hint; client
  // body ignored. Signed into token; verified at create, persisted to orders.
  const preferences = resolveBuyerPreferences(req.headers.get("cookie"), req.headers.get("accept-language"), await readTrustedCountry());
  const locale = preferences.locale;
  const displayUsd = displayUsdCents(subtotal, await loadCurrentFxSnapshot());

  if (issues.length > 0) {
    return NextResponse.json({ ok: false, issues, items: quotedItems, subtotal, paymentMethods }, { status: 409 });
  }
  if (paymentMethods.length === 0) {
    return NextResponse.json({ error: "Metode pembayaran sedang tidak tersedia." }, { status: 503 });
  }

  const signed = await createCheckoutQuoteToken({
    ...(adminTest ? { admin_payment_test: true as const } : {}),
    items: quotedItems.map(({ product_id, variant_id, name, price, qty, base_price, applied_tier_min_qty }) => ({ product_id, variant_id, name, price, qty, base_price, applied_tier_min_qty })),
    subtotal,
    payment_methods: paymentMethods.map((method) => ({
      id: method.id,
      account_number: method.account_number,
      kind: method.kind,
      ...(method.kind === "gateway" ? { currency: method.currency, sublabel: method.sublabel, available: true, gateway: method.gateway } : {}),
      ...(method.kind === "crypto" && "usd" in method
        ? {
            // HANYA koin tersedia yang ditandatangani; label/group/logo tampilan tidak ikut token.
            sublabel: method.sublabel ?? undefined,
            available: true,
            currency: "USD" as const,
            amount_text: method.amount_text,
            pay_currency: method.pay_currency,
            network: method.network,
            fee_payer: method.fee_payer,
            fixed_rate: method.fixed_rate,
            base_cents: method.base_cents,
            surcharge_cents: method.surcharge_cents,
            total_cents: method.total_cents,
            surcharge_bps: method.surcharge_bps,
            sender_gas_extra: method.sender_gas_extra,
            usd: method.usd,
          }
        : {}),
    })),
    locale,
  });

  return NextResponse.json({
    ok: true,
    items: quotedItems,
    subtotal,
    paymentMethods: catalog,
    changes,
    quoteToken: signed.token,
    quoteExpiresAt: new Date(signed.expiresAt * 1000).toISOString(),
    emailRequired,
    locale,
    displayPreferences: { ...preferences, usdAvailable: displayUsd !== null, usdCents: displayUsd?.toString() ?? null },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
