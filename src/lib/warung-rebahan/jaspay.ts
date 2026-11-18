// src/lib/warung-rebahan/jaspay.ts — Identitas + normalisasi Jaspay (made-by-order).
//
// Murni & edge-safe: tanpa impor, tanpa fetch, tanpa env. Proxy (bila kelak
// butuh feed gabungan) boleh menyalin verbatim file ini — kontraknya sama.
// Keluarga Jaspay dibedakan HANYA dari ID stabil ber-namespace `jaspay:`,
// bukan dari nama display (nama bisa berubah di dashboard supplier).
//
// Kontrak otoritatif (api-docs WR, base /api/v1, family /jaspay/*):
//   products[]: {product,name,description,after_note,duration,max_quantity,
//     available,default_package,packages:[{id,name,price,original_price,
//     password,available}]}, stok tak hingga (no finite stock).
//   order: {product,package?,quantity,ref_id}; omit password => server
//     generate (tidak ada field password buyer baru).
//   ref_id 1..64 [A-Za-z0-9._:/-] unik per akun API; ulangi ref identik =>
//     duplikat asli `duplicate:true` tanpa debit ganda.
//   result invoice `JSP-...`, status processing|completed|partial|failed,
//     package = package NAME, progress{done,success}, success_count,
//     accounts[] app-dependent {email,password} dsb.
//   /status butuh invoice; /orders latest-50 saja dan TIDAK dijamin membawa
//   ref_id — JANGAN dipakai untuk korelasi.
//   webhook jaspay.completed|partial|failed|refunded, data.invoice.

/** Whole rupiah only. Missing or malformed fields must never become zero. */
export function jaspayAmount(value: unknown): number | undefined {
  const amount = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0 ? amount : undefined;
}

export const JASPAY_VARIANT_PREFIX = "jaspay:";

/** Batas ref_id upstream: 1..64 char [A-Za-z0-9._:/-]. */
export const JASPAY_REF_ID_RE = /^[A-Za-z0-9._:/-]{1,64}$/;

/** True bila wr_variant_id ini milik keluarga Jaspay (bukan premium). */
export function isJaspayVariantId(id: unknown): boolean {
  return typeof id === "string" && id.startsWith(JASPAY_VARIANT_PREFIX);
}

function encodeSegment(raw: string): string {
  return encodeURIComponent(String(raw ?? "").trim());
}

function decodeSegment(raw: string): string | null {
  try {
    return decodeURIComponent(String(raw ?? ""));
  } catch {
    return null;
  }
}

/** product -> `jaspay:<enc product>` (ID produk mirror, stabil). */
export function jaspayProductId(product: string): string {
  return `${JASPAY_VARIANT_PREFIX}${encodeSegment(product)}`;
}

/**
 * (product, package) -> `jaspay:<enc product>:<enc package>` (ID varian
 * mirror, stabil, collision-free: ':' pemisah tak pernah muncul dari
 * encodeURIComponent sehingga split tepat 3 segmen).
 */
export function jaspayVariantId(product: string, pkg: string): string {
  return `${JASPAY_VARIANT_PREFIX}${encodeSegment(product)}:${encodeSegment(pkg)}`;
}

/** Balikan jaspayVariantId; null bila malformed (jangan ditebak). */
export function decodeJaspayVariantId(wrVariantId: string): { product: string; package: string } | null {
  if (!isJaspayVariantId(wrVariantId)) return null;
  const parts = String(wrVariantId).split(":");
  if (parts.length !== 3 || !parts[1]) return null;
  const product = decodeSegment(parts[1]);
  const pack = decodeSegment(parts[2]);
  // An explicit trailing ':' identifies the supplier's default package.
  // Missing segments and malformed escapes still fail closed.
  if (!product || pack === null) return null;
  return { product, package: pack };
}

/**
 * ref_id deterministik dari idempotency_key durable
 * (`wr:<code>:<variant>:<qty>`), BUKAN dari concat mentah yang bisa
 * panjang/bocor. `axv-` + 32 hex SHA-256 = 36 char, lolos [A-Za-z0-9._:/-].
 * Sinkron: hitung hex lalu potong — tanpa HMAC (Pages tak pegang key;
 * key dipegang proxy/server).
 */
export async function jaspayRefId(idempotencyKey: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`jaspay:${String(idempotencyKey || "")}`),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `axv-${hex.slice(0, 32)}`;
}

/** Bentuk mentah satu package dari api-docs (validasi di boundary). */
export type JaspayApiPackage = {
  id?: unknown;
  name?: unknown;
  price?: unknown;
  original_price?: unknown;
  password?: unknown;
  available?: unknown;
};

/** Bentuk mentah satu product dari api-docs (validasi di boundary). */
export type JaspayApiProduct = {
  product?: unknown;
  name?: unknown;
  description?: unknown;
  after_note?: unknown;
  duration?: unknown;
  max_quantity?: unknown;
  available?: unknown;
  default_package?: unknown;
  packages?: unknown;
};

export type JaspayNormalizedPackage = {
  /** ID package mentah upstream (stabil untuk POST order). */
  packageId: string;
  /** Nama package mentah upstream (stabil untuk POST order). */
  packageName: string;
  price: number;
  available: boolean;
};

export type JaspayNormalizedProduct = {
  /** ID produk mirror `jaspay:<enc product>`. */
  productId: string;
  /** Key produk mentah upstream (untuk POST order). */
  productKey: string;
  name: string;
  description: string | null;
  afterNote: string | null;
  duration: string | null;
  /** null = invalid/missing => fail-closed di sync (bukan unlimited). */
  maxQuantity: number | null;
  available: boolean;
  defaultPackage: string | null;
  packages: JaspayNormalizedPackage[];
};

function toNonNegInt(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const floored = Math.floor(n);
  return floored >= 0 ? floored : null;
}

/**
 * Normalisasi katalog Jaspay -> bentuk mirror (tanpa menyentuh DB).
 * FAIL-CLOSED: produk tanpa key/packages valid => dibuang (bukan dijual
 * tanpa batas). max_quantity invalid/missing => maxQuantity null =>
 * sync menolak varian itu (bukan unlimited).
 */
export function normalizeJaspayCatalog(apiProducts: unknown): JaspayNormalizedProduct[] {
  if (!Array.isArray(apiProducts)) return [];
  const out: JaspayNormalizedProduct[] = [];
  for (const raw of apiProducts) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as JaspayApiProduct;
    const productKey = String(p.product ?? "").trim();
    if (!productKey) continue;
    const pkgs = Array.isArray(p.packages) ? p.packages : [];
    if (!pkgs.length) continue;
    const packages: JaspayNormalizedPackage[] = [];
    for (const rpkg of pkgs) {
      if (!rpkg || typeof rpkg !== "object") continue;
      const pkg = rpkg as JaspayApiPackage;
      const packageId = String(pkg.id ?? "").trim();
      const packageName = String(pkg.name ?? "").trim();
      const price = toNonNegInt(pkg.price);
      // WR uses id:"" for single default packages (Scribd, HMA, etc.).
      // Do not confuse an absent ID or multiple ambiguous defaults with it.
      if (pkg.id == null || (!packageId && pkgs.length !== 1) || !packageName || price == null) continue;
      packages.push({
        packageId,
        packageName,
        price,
        available: pkg.available === true,
      });
    }
    if (!packages.length) continue;
    const maxRaw = p.max_quantity;
    const maxQuantity =
      maxRaw === null || maxRaw === undefined || String(maxRaw).trim() === ""
        ? null
        : (() => {
            const n = Math.floor(Number(maxRaw));
            return Number.isFinite(n) && n >= 1 ? n : null;
          })();
    out.push({
      productId: jaspayProductId(productKey),
      productKey,
      name: String(p.name ?? productKey).trim() || productKey,
      description: p.description == null ? null : String(p.description),
      afterNote: p.after_note == null ? null : String(p.after_note),
      duration: p.duration == null || String(p.duration).trim() === "" ? null : String(p.duration),
      maxQuantity,
      available: p.available === true,
      defaultPackage:
        p.default_package == null || String(p.default_package).trim() === ""
          ? null
          : String(p.default_package),
      packages,
    });
  }
  return out;
}

/**
 * Stok mirror Jaspay: -1 (tak hingga, kuota diatur max_quantity) bila
 * product && package available, else 0. max_quantity TIDAK PERNAH dipetakan
 * ke stok finite.
 */
export function jaspayMirrorStock(productAvailable: boolean, packageAvailable: boolean): number {
  return productAvailable && packageAvailable ? -1 : 0;
}
