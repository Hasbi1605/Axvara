"use client";
import { MAX_UNIQUE_UNITS_PER_ORDER } from "@/lib/fulfillment/units";
import { useParams } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import type { Product } from "@/lib/products";
import { productIsBuyable } from "@/lib/product-order";
import type { VariantSummary } from "@/lib/catalog";
import { effectiveVariantStock, formatVariantLabel } from "@/lib/catalog";
import { buyerDeliveryBadge, buyerDeliveryKind } from "@/lib/catalog";
import { useCart } from "@/stores/cart";
import { ProductCard, productCardAmounts } from "@/components/storefront/ProductCard";
import { QuickVariantModal } from "@/components/storefront/QuickVariantModal";
import { ActivationBody, DescriptionBody, MobileCollapsible, TermsBody, VariantIdentity, activationStepCount } from "@/components/storefront/ProductCopy";
import { isLongDescription, mergeProductCopy, parseProductDescription, type VariantCopy } from "@/lib/product-copy/format";
import { Bone, InlineSpinner, ProductDetailSkeleton } from "@/components/storefront/Skeletons";
import { usePendingNavigation } from "@/hooks/usePendingNavigation";
import { useCatalogRevisionWatcher } from "@/hooks/useCatalogRevision";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { BulkPriceTiers } from "@/components/storefront/BulkPriceTiers";
import { bulkCopy, bulkUnitEstimate, usableBulkTiers, type BulkVariantFields } from "@/lib/bulk-display";
import { useDisplayPrices } from "@/hooks/useDisplayPrices";
import { catalogCopy, catalogDeliveryBadge, catalogDeliveryEta, catalogWarranty, localizedProductDescription } from "@/lib/i18n/catalog-copy";
import { marketCategoryName } from "@/lib/i18n/market-categories";
import { badgeLabel } from "@/lib/i18n/badge-copy";
import { productDisplayName } from "@/lib/i18n/product-name";
import { Price, PriceNote } from "@/components/storefront/Price";

// /api/catalog mengganti teks mentah WR (terms/delivery_terms) dengan `copy`
// siap tampil — versi Axvara atau teks pemasok yang dirapikan.
type VariantItem = VariantSummary & BulkVariantFields & { copy?: VariantCopy | null; copy_en?: VariantCopy | null };

const DESC_FADE = {
  WebkitMaskImage: "linear-gradient(to bottom, #000 55%, transparent)",
  maskImage: "linear-gradient(to bottom, #000 55%, transparent)",
};

const ShieldIcon = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 12l2 2 4-4"/><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
);
const StepsIcon = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>
);

type CatalogDetail = {
  id: number;
  name: string;
  slug: string;
  variants: VariantItem[];
};

/** Respons /api/catalog?slug= yang sudah diambil server untuk slug ini. */
export type InitialCatalog = { slug: string; product: CatalogDetail; variantsEnabled: boolean };

function galleryOf(list: Product[], slug: string): string[] {
  const found = list.find((p) => p.slug === slug) ?? list[0];
  if (!found) return [];
  const imgs: string[] = [];
  if (found.image) imgs.push(found.image);
  if (Array.isArray(found.images)) {
    for (const img of found.images) {
      if (img && !imgs.includes(img)) imgs.push(img);
    }
  }
  return imgs;
}

/** Varian aktif + bisa dibeli satu-satunya dipilih otomatis. Memakai stok
    efektif (unique = min kolom vs inventory) agar varian satu-satunya yang
    kredensialnya habis tidak terpilih otomatis. */
function soleBuyableVariantId(detail: CatalogDetail | null | undefined): number | null {
  const activeVars = (detail?.variants || []).filter((v: VariantItem) => v.is_active && effectiveVariantStock(v) !== 0 && !(effectiveVariantStock(v) !== -1 && effectiveVariantStock(v) < Math.max(1, Number(v.min_qty ?? 1) || 1)));
  return activeVars.length === 1 ? activeVars[0].id : null;
}

// Interaktivitas PDP (varian/keranjang/checkout). Dipisah dari page.tsx
// server component (issue #11) agar metadata + JSON-LD + h1 awal tetap
// server-rendered untuk crawler/preview, tanpa mengubah flow pembelian.
// `initialProducts`/`initialCatalog` diisi page.tsx dari handler API yang
// sama: PDP tampil lengkap dari respons navigasi, tanpa dua round-trip
// tambahan (skeleton kedua) di jaringan lambat. Tanpa prop = fetch di klien.
export default function ProductDetailClient({ slug: slugProp, initialProducts, initialCatalog, initialRevision }: { slug?: string; initialProducts?: Product[]; initialCatalog?: InitialCatalog | null; initialRevision?: string | null }) {
  const params = useParams<{ slug: string }>();
  const slug = slugProp ?? params.slug;
  const add = useCart((s) => s.add);
  const { navigate: goCheckout, pending: checkoutPending } = usePendingNavigation();
  const seededProducts = initialProducts?.some((p) => p.slug === slug) ? initialProducts : undefined;
  const seededCatalog = initialCatalog?.slug === slug ? initialCatalog : undefined;

  const [catalogProducts, setCatalogProducts] = useState<Product[]>(seededProducts ?? []);
  const [galleryImages, setGalleryImages] = useState<string[]>(() => galleryOf(seededProducts ?? [], slug));
  const [activeImg, setActiveImg] = useState(0);
  const [detailLoading, setDetailLoading] = useState(!seededProducts);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [catalogDetail, setCatalogDetail] = useState<CatalogDetail | null>(seededCatalog?.product ?? null);
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(() => soleBuyableVariantId(seededCatalog?.product));
  const [variantsEnabled, setVariantsEnabled] = useState(seededCatalog?.variantsEnabled === true);
  const [variantLoading, setVariantLoading] = useState(!seededCatalog);
  const [variantError, setVariantError] = useState<string | null>(null);
  const [variantAttempt, setVariantAttempt] = useState(0);
  const [descExpanded, setDescExpanded] = useState(false);
  // `select` = panel pilih varian untuk halaman (mobile); cart/checkout = beli cepat.
  const [variantModal, setVariantModal] = useState<"cart" | "checkout" | "select" | null>(null);
  // Qty stepper PDP ala marketplace — state di atas (sebelum early return)
  // agar urutan hooks stabil. Nilai valid (min..max) dihitung di bawah dan
  // dipakai render; effect sinkronisasi ada setelah selectedMinQty dihitung.
  const [pdpQty, setPdpQty] = useState(1);

  useEffect(() => {
    if (initialProducts?.some((p) => p.slug === slug)) {
      setCatalogProducts(initialProducts);
      setGalleryImages(galleryOf(initialProducts, slug));
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    setCatalogProducts([]);
    setGalleryImages([]);
    setActiveImg(0);
    // Exact slug (issue #14): sebelumnya fetch SELURUH katalog
    // (/api/products?active=1 tanpa filter) hanya untuk 1 PDP + galeri.
    // Kini 1 produk via slug — galeri dibangun dari produk itu sendiri.
    // Related di bawah memakai daftar kecil ini (fallback: kosong).
    fetchWithTimeout(`/api/products?active=1&slug=${encodeURIComponent(slug)}`, {}, 25_000)
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        const list: Product[] = Array.isArray(data.products) ? data.products : [];
        setCatalogProducts(list);
        const imgs = galleryOf(list, slug);
        if (imgs.length > 0) setGalleryImages(imgs);
      })
      .catch((e) => setDetailError(e instanceof Error ? e.message : "Gagal memuat produk"))
      .finally(()=> setDetailLoading(false));
  }, [slug, initialProducts]);

  // Fetch variant-aware catalog detail
  useEffect(() => {
    if (variantAttempt === 0 && initialCatalog?.slug === slug) {
      setCatalogDetail(initialCatalog.product);
      setVariantsEnabled(initialCatalog.variantsEnabled === true);
      setSelectedVariantId(soleBuyableVariantId(initialCatalog.product));
      setVariantError(null);
      setVariantLoading(false);
      return;
    }
    setCatalogDetail(null);
    setSelectedVariantId(null);
    setVariantsEnabled(false);
    setVariantError(null);
    setVariantLoading(true);
    fetchWithTimeout(`/api/catalog?slug=${encodeURIComponent(slug)}`, {}, 25_000)
      .then(async (r) => {
        if (!r.ok) throw new Error(`variant_catalog_unavailable:${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!data?.product) throw new Error("variant_catalog_unavailable:not_found");
        setCatalogDetail(data.product);
        setVariantsEnabled(data.variantsEnabled === true);
        const sole = soleBuyableVariantId(data.product);
        if (sole !== null) setSelectedVariantId(sole);
      })
      .catch(() => setVariantError("Pilihan varian gagal dimuat."))
      .finally(() => setVariantLoading(false));
  }, [slug, initialCatalog, variantAttempt]);

  const product = catalogProducts.find((p) => p.slug === slug);
  const currentCategorySlug = product?.categorySlug;
  const slugRef = useRef(slug);
  slugRef.current = slug;

  useCatalogRevisionWatcher({
    scope: "market",
    initialRevision,
    enabled: !detailLoading && !detailError && !variantLoading && !variantError && Boolean(product),
    onChange: async () => {
      const targetSlug = slug;
      const [productsRes, catalogRes] = await Promise.all([
        fetchWithTimeout(`/api/products?active=1&slug=${encodeURIComponent(targetSlug)}`, { cache: "no-cache" }, 25_000),
        fetchWithTimeout(`/api/catalog?slug=${encodeURIComponent(targetSlug)}`, { cache: "no-cache" }, 25_000),
      ]);
      if (slugRef.current !== targetSlug) return;
      if (!productsRes.ok || !catalogRes.ok) {
        throw new Error(`HTTP ${!productsRes.ok ? productsRes.status : catalogRes.status}`);
      }
      const [productsData, catalogData] = await Promise.all([
        productsRes.json() as Promise<{ products?: Product[] }>,
        catalogRes.json() as Promise<{ product?: CatalogDetail; variantsEnabled?: boolean }>,
      ]);
      if (slugRef.current !== targetSlug) return;
      const list: Product[] = Array.isArray(productsData.products) ? productsData.products : [];
      const matched = list.find((p) => p.slug === targetSlug);
      if (!matched || !catalogData?.product) {
        throw new Error("catalog_refresh_incomplete");
      }
      const nextDetail = catalogData.product;
      const imgs = galleryOf(list, targetSlug);
      setCatalogProducts(list);
      setGalleryImages(imgs);
      setActiveImg((prev) => (imgs.length === 0 ? 0 : Math.min(prev, imgs.length - 1)));
      setCatalogDetail(nextDetail);
      setVariantsEnabled(catalogData.variantsEnabled === true);
      setSelectedVariantId((prev) => {
        if (prev !== null && nextDetail.variants.some((v) => v.is_active && v.id === prev)) {
          return prev;
        }
        return soleBuyableVariantId(nextDetail);
      });
    },
  });

  const [related, setRelated] = useState<Product[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(true);

  useEffect(() => {
    if (!currentCategorySlug) { setRelated([]); setRelatedLoading(false); return; }
    // Produk Serupa (kontrak 2026-10-01, keputusan owner):
    // 1. Stok habis TIDAK PERNAH tampil — Serupa = ajakan beli, bukan arsip.
    //    Kartu habis tetap ada di katalog utama (trust), tapi tidak di sini.
    // 2. Kategori sama dulu; bila < 4 BARU fetch katalog penuh sebagai
    //    filler (hemat rows-read D1 — jangan fetch penuh tiap PDP).
    // Abort bila slug berpindah sebelum respons tiba.
    const controller = new AbortController();
    setRelatedLoading(true);
    const buyable = (p: Product) => p.slug !== slug && productIsBuyable(p);
    fetchWithTimeout(`/api/products?active=1&cat=${encodeURIComponent(currentCategorySlug)}`, { signal: controller.signal }, 25_000)
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(async (data) => {
        const same = ((Array.isArray(data.products) ? data.products : []) as Product[]).filter(buyable);
        if (same.length >= 4 || controller.signal.aborted) {
          return same.slice(0, 8);
        }
        // Fallback katalog lain (di luar kategori) bila kategori sama < 4.
        const r2 = await fetchWithTimeout(`/api/products?active=1`, { signal: controller.signal }, 25_000);
        if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
        const full = (await r2.json()) as { products?: Product[] };
        const seen = new Set(same.map((p) => p.slug));
        seen.add(slug);
        const filler = (Array.isArray(full.products) ? full.products : []).filter(
          (p) => !seen.has(p.slug) && productIsBuyable(p),
        );
        return [...same, ...filler].slice(0, 8);
      })
      .then((list) => setRelated(list))
      .catch(() => setRelated([]))
      .finally(() => { if (!controller.signal.aborted) setRelatedLoading(false); });
    return () => controller.abort();
  }, [currentCategorySlug, slug]);

  const goPrev = useCallback(() => {
    setActiveImg((prev) => (prev - 1 + galleryImages.length) % galleryImages.length);
  }, [galleryImages.length]);

  const goNext = useCallback(() => {
    setActiveImg((prev) => (prev + 1) % galleryImages.length);
  }, [galleryImages.length]);

  // Draft ketikan manual ala marketplace (Shopee/Tokopedia): string terpisah
  // agar "5" + ketik "0" (="50") tidak dipaksa jadi min di tiap keystroke.
  // Commit (clamp min..max) hanya saat blur/Enter. Hook di atas (sebelum
  // early return) agar urutan hooks stabil; reset tiap ganti varian.
  const [pdpQtyDraft, setPdpQtyDraft] = useState<string | null>(null);
  useEffect(() => {
    setPdpQtyDraft(null);
  }, [selectedVariantId, slug]);

  const priceVariant = catalogDetail?.variants.find((v) => v.is_active && v.id === selectedVariantId);
  const priceBase = priceVariant?.price ?? product?.price ?? 0;
  const priceMin = Math.max(1, Number(priceVariant?.min_qty ?? 1) || 1);
  const priceStock = priceVariant ? effectiveVariantStock(priceVariant) : -1;
  const priceCap = priceVariant?.fulfillment_mode === "unique" ? MAX_UNIQUE_UNITS_PER_ORDER : 100;
  const priceMax = Math.max(priceMin, priceStock === -1 ? priceCap : Math.min(priceCap, priceStock));
  const priceQty = Math.min(Math.max(pdpQty, priceMin), priceMax);
  const priceTiers = priceVariant ? usableBulkTiers(priceVariant, priceBase) : [];
  const priceUnit = bulkUnitEstimate(priceBase, priceTiers, priceQty);
  const prices = useDisplayPrices([
    priceBase, product?.comparePrice ?? 0, priceUnit, priceUnit * priceQty,
    (priceBase - priceUnit) * priceQty,
    ...priceTiers.map((tier) => tier.unit_price),
    ...(catalogDetail?.variants ?? []).flatMap((variant) => [variant.price, variant.compare_price ?? 0]),
    ...related.flatMap(productCardAmounts),
  ], { secondary: true, debounce: true });
  const t = catalogCopy(prices.locale);
  const displayName = productDisplayName(product ?? { name: "" }, prices.locale);

  // Commit ketikan manual: kosong/non-angka = kembali ke nilai aman;
  // angka di-clamp ke [min, max] (min TIDAK bisa ditembus ke bawah).
  const commitPdpQtyDraft = (raw: string | null) => {
    setPdpQtyDraft(null);
    if (raw == null) return;
    const digits = raw.replace(/[^\d]/g, "");
    const n = Math.floor(Number(digits));
    if (!digits || !Number.isFinite(n)) return;
    setPdpQty(Math.min(Math.max(n, selectedMinQty), selectedMaxQty));
  };

  if (detailLoading) {
    // Bentuk yang sama dengan skeleton overlay navigasi: tidak melompat.
    return <ProductDetailSkeleton />;
  }

  if (detailError) {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16 text-center">
        <p className="text-red-300 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 inline-block">{t.loadFailed(detailError)}</p>
        <div className="mt-4 flex justify-center gap-3">
          <button onClick={()=> location.reload()} className="h-9 px-4 rounded-full bg-white text-[#070a1e] text-sm font-bold">{t.reload}</button>
          <Link prefetch={false} href="/" className="h-9 px-4 rounded-full ax-glass-card text-sm inline-flex items-center">{t.back}</Link>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-16 text-center">
        <p className="text-white/60">{t.productNotFound}</p>
        <Link prefetch={false} href="/" className="text-[#00E5FF] text-sm mt-3 inline-block">
          {t.backToCatalog}
        </Link>
      </div>
    );
  }

  // In variant mode, product.stock is legacy metadata; purchasability is
  // determined exclusively from the selected/active variants below.
  const outOfStock = !variantsEnabled
    && product.stock !== undefined
    && product.stock !== null
    && product.stock !== -1
    && product.stock <= 0;

  // Variant-aware derived values
  const variants = catalogDetail?.variants || [];
  const activeVariants = variants.filter((v: VariantItem) => v.is_active);
  // Varian yang stoknya di bawah minimum (stock < min, stock !== -1) TIDAK
  // BISA dibeli dalam jumlah berapa pun (lihat QuickVariantModal + cart):
  // qty berapa pun pasti gagal di quote. Perlakukan sama dengan habis agar
  // tidak jadi dead-end di checkout.
  //
  // Stok EFEKTIF unique (2026-10-02, insiden Head 18 Bulan): min(kolom stock,
  // inventory available). Tanpa ini PDP bilang "Sisa 2" padahal kredensial
  // tersisa 1 — semua cek di bawah (min, purchasable, max qty) memakai ini.
  // inventory_available hanya dibawa /api/catalog (daftar varian) — jalur
  // add-to-cart di bawah menerima varian DARI daftar yang sama sehingga
  // angka efektifnya konsisten, bukan kolom mentah.
  const effectiveStockOf = (v: VariantItem): number => effectiveVariantStock(v);
  const effectiveStockSnapshotOf = (v: { stock?: number | null; fulfillment_mode?: string; inventory_available?: number | null }): number =>
    effectiveVariantStock({ stock: v.stock ?? -1, fulfillment_mode: v.fulfillment_mode ?? "manual", inventory_available: v.inventory_available ?? null });
  const variantMinQtyOf = (v: VariantItem): number => Math.max(1, Number(v.min_qty ?? 1) || 1);
  const isBelowMinimum = (v: VariantItem): boolean => {
    const eff = effectiveStockOf(v);
    return eff !== -1 && eff < variantMinQtyOf(v);
  };
  const isPurchasable = (v: VariantItem): boolean => effectiveStockOf(v) !== 0 && !isBelowMinimum(v);
  const selectedVariant = selectedVariantId ? activeVariants.find((v: VariantItem) => v.id === selectedVariantId) : null;
  const displayPrice = selectedVariant ? selectedVariant.price : product.price;
  const displayComparePrice = selectedVariant ? selectedVariant.compare_price : product.comparePrice;
  // Minimum pembelian varian terpilih (migrasi 0034): GSuite = 50.
  const selectedMinQty = selectedVariant ? Math.max(1, Number(selectedVariant.min_qty ?? 1) || 1) : 1;
  // Qty terpilih ala marketplace (Shopee/Tokopedia): stepper dibuka di min,
  // tidak turun di bawah min, plafon 100. Direset ke min tiap ganti varian.
  const selectedMaxQty = selectedVariant
    ? (() => { const eff = effectiveStockOf(selectedVariant); const cap = Math.min(selectedVariant.max_qty ?? 100,selectedVariant.fulfillment_mode === "unique" ? MAX_UNIQUE_UNITS_PER_ORDER : 100); return Math.max(selectedMinQty, eff === -1 ? cap : Math.min(cap, eff)); })()
    : 100;
  // Clamp render-time (bukan effect): qty selalu dalam [min, max] varian
  // aktif tanpa useEffect di bawah early-return (Rules of Hooks). Naik bila
  // min varian baru lebih besar, turun bila max menyusut.
  const safePdpQty = Math.min(Math.max(pdpQty, selectedMinQty), selectedMaxQty);
  // Grosir (estimasi tampilan dari tier katalog; server tetap otoritatif).
  // Judul harga tetap harga DASAR; total/CTA memakai satuan efektif × jumlah.
  const selectedTiers = selectedVariant ? usableBulkTiers(selectedVariant, selectedVariant.price) : [];
  const selectedStockMax = selectedVariant ? effectiveStockOf(selectedVariant) : -1;
  const selectedCapMax = selectedVariant?.fulfillment_mode === "unique" ? MAX_UNIQUE_UNITS_PER_ORDER : 100;
  const effectiveUnit = bulkUnitEstimate(displayPrice, selectedTiers, safePdpQty);
  const lineTotal = effectiveUnit * safePdpQty;
  const lineSavings = (displayPrice - effectiveUnit) * safePdpQty;
  const variantOutOfStock = variantsEnabled && activeVariants.length > 0
    ? activeVariants.every((variant) => !isPurchasable(variant))
    : selectedVariant ? !isPurchasable(selectedVariant) : false;
  const needsVariantSelection = variantsEnabled && !selectedVariant;
  const variantCatalogUnavailable = variantLoading || Boolean(variantError) || (variantsEnabled && activeVariants.length === 0);
  // Varian gagal dimuat untuk produk bervarian: jangan checkout tanpa varian
  // (dulu buntu di "Pilih varian dari halaman detail"); modal memuat ulang.
  const mustPickInModal = needsVariantSelection || (Boolean(variantError) && Boolean(product.variantCount));
  const buyUrl = selectedVariantId
    ? `/checkout?buy=${product.slug}&variant=${selectedVariantId}&qty=${safePdpQty}`
    : `/checkout?buy=${product.slug}`;

  // Payload keranjang membawa stok EFEKTIF + inventory + min + mode
  // (temuan audit: add() memakai kolom mentah `stock` — varian unique
  // stock=2/available=1 lolos clamp lalu gagal di quote; metadata basi juga
  // membuat baris lama tidak ikut refresh). Kedua jalur add (desktop CTA +
  // sticky mobile) memakai helper yang sama.
  const cartPayloadOf = (variant: VariantItem | null | undefined) => {
    if (!variant) return product;
    return {
      ...product,
      price: variant.price,
      stock: effectiveStockSnapshotOf(variant),
      variantId: variant.id,
      variantLabel: formatVariantLabel(variant),
      minQty: variantMinQtyOf(variant),
      maxQty: variant.max_qty,
      buyerFieldKey: variant.buyer_field_key,
      fulfillmentMode: variant.fulfillment_mode,
      inventoryAvailable: variant.inventory_available ?? null,
      bulkTiers: usableBulkTiers(variant, variant.price),
    };
  };
  // Determine the display image — from gallery state or product.image fallback
  const displayImage =
    galleryImages.length > 0
      ? galleryImages[activeImg] || galleryImages[0]
      : product.image;
  const hasMultipleImages = galleryImages.length > 1;

  // Satu state pilihan (selectedVariant) mengendalikan harga, keranjang,
  // checkout DAN salinan varian. Tidak ada fallback ke varian aktif pertama:
  // sebelum pembeli memilih, produk multi-varian menampilkan ajakan memilih,
  // bukan S&K milik varian yang tidak sedang dibeli.
  const choosableVariants = variantsEnabled && activeVariants.length > 1;
  // Varian tunggal tidak ambigu → salinannya boleh tampil tanpa memilih.
  const copyVariant = selectedVariant ?? (activeVariants.length === 1 ? activeVariants[0] : null);
  // Sebelum pembeli memilih, ringkasan pengiriman dulu mengikuti varian
  // pertama saja: Canva (Invite 1 Bulan kirim otomatis, dua varian lain Made
  // By Order) tampil "Kirim otomatis" untuk seluruh produk. Varian campuran
  // kini disebut apa adanya sampai satu varian dipilih.
  const deliveryVariant = selectedVariant ?? activeVariants[0] ?? null;
  const mixedDelivery = !selectedVariant
    && new Set(activeVariants.map((v) => buyerDeliveryBadge(v))).size > 1;
  // Deskripsi + S&K + cara aktivasi dalam satu format untuk WR dan non-WR:
  // S&K varian (WR) digabung dengan bagian "Syarat & Ketentuan:" / "Cara
  // Aktivasi:" di deskripsi (produk non-WR); tiap baris tampil sekali.
  const parsedDescription = parseProductDescription(localizedProductDescription(product, prices.locale));
  const hasDescription = parsedDescription.blocks.length > 0 || parsedDescription.sections.length > 0;
  const descCollapsible = isLongDescription(parsedDescription);
  // "Ganti varian" hanya bila isinya memang berbeda antar varian. Salinan yang
  // sama persis (dan ada isinya) berlaku untuk semua varian → tampil tanpa memilih.
  const copyOf = (variant: VariantItem | null | undefined): VariantCopy | null => {
    if (!variant) return null;
    return prices.locale === "en" ? variant.copy_en ?? variant.copy ?? null : variant.copy ?? null;
  };
  const variantCopiesDiffer = activeVariants.length > 1
    && new Set(activeVariants.map((v: VariantItem) => JSON.stringify(copyOf(v)))).size > 1;
  const sharedVariantCopy = choosableVariants && !variantCopiesDiffer && copyOf(activeVariants[0]) != null;
  // Produk multi-varian: satu S&K dan satu cara aktivasi mengikuti varian
  // terpilih (digabung dengan ketentuan/aktivasi tingkat produk dari deskripsi).
  // Produk varian tunggal / tanpa varian: perilaku lama tetap.
  const separated = choosableVariants;
  const variantPending = separated && !selectedVariant && !sharedVariantCopy;
  const variantCopySource = selectedVariant ? copyOf(selectedVariant) : sharedVariantCopy ? copyOf(activeVariants[0]) : null;
  const productCopy = separated
    ? mergeProductCopy(variantPending ? null : variantCopySource, parsedDescription)
    : mergeProductCopy(copyOf(copyVariant), parsedDescription);
  const hasTerms = productCopy.sections.length > 0;
  const activationSteps = activationStepCount(productCopy.activation);
  const hasActivation = activationSteps > 0 || productCopy.notes.length > 0;
  const hasMergedCopy = hasTerms || hasActivation;
  const variantCopyMissing = separated && !variantPending && !productCopy.fromVariant && !hasMergedCopy;
  const appliesAllVariants = separated && !productCopy.fromVariant && hasMergedCopy;
  const termsLabel = !separated && productCopy.fromVariant && copyVariant ? formatVariantLabel(copyVariant, prices.locale) : null;
  const identityLabel = selectedVariant ? formatVariantLabel(selectedVariant, prices.locale) : null;
  const identitySharedLabel = !selectedVariant && sharedVariantCopy ? t.allVariantsSame : null;
  const openVariantPicker = () => setVariantModal("select");
  const identity = (
    <VariantIdentity
      label={identityLabel}
      sharedLabel={identitySharedLabel}
      onChoose={variantCopiesDiffer || variantPending ? openVariantPicker : undefined}
    />
  );
  const descriptionTitle = separated ? t.descGeneral : t.descProduct;
  const hasAnyCopy = separated || hasTerms || hasActivation;

  const mobileDescription = hasDescription ? (
    <div className="mt-6 lg:hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="text-sm font-bold text-white flex items-center justify-between">
        <span>{descriptionTitle}</span>
      </h2>
      <div
        id="pdp-description-mobile"
        className={`mt-2.5 text-xs text-white/70 leading-relaxed ${descCollapsible && !descExpanded ? "max-h-32 overflow-hidden" : ""}`}
        style={descCollapsible && !descExpanded ? DESC_FADE : undefined}
      >
        <DescriptionBody parsed={parsedDescription} size="xs" />
      </div>
      {descCollapsible && (
        <button
          type="button"
          aria-expanded={descExpanded}
          aria-controls="pdp-description-mobile"
          onClick={() => setDescExpanded(!descExpanded)}
          className="mt-2 text-xs font-semibold text-[#00E5FF] hover:underline flex items-center gap-1"
        >
          {descExpanded ? t.descClose : t.descMore}
        </button>
      )}
    </div>
  ) : null;

  // S&K + Cara Aktivasi — Khusus Mobile, terlipat (permintaan owner). Posisi
  // elemen tetap (slot kondisional) agar panel yang sedang terbuka tidak
  // menutup sendiri saat pembeli mengganti varian.
  const mobileCopy = hasAnyCopy ? (
    <div className="mt-4 lg:hidden space-y-3" data-testid="pdp-mobile-copy">
      {separated && identity}
      {separated && variantCopyMissing && (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-relaxed text-white/65">
          {t.variantTermsMissing}
        </p>
      )}
      {separated && appliesAllVariants && !hasTerms && (
        <div>
          <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-semibold text-white">
            {t.appliesAllVariants}
          </span>
        </div>
      )}
      {hasTerms && (
        <MobileCollapsible
          title={t.terms}
          meta={separated ? (appliesAllVariants ? t.appliesAllVariants : identityLabel) : termsLabel}
          icon={<ShieldIcon className="w-4 h-4 shrink-0 text-[#00E5FF]" />}
        >
          <TermsBody sections={productCopy.sections} size="xs" />
        </MobileCollapsible>
      )}
      {hasActivation && (
        <MobileCollapsible
          title={t.activation}
          meta={activationSteps > 0 ? t.steps(activationSteps) : null}
          icon={<StepsIcon className="w-4 h-4 shrink-0 text-[#00E5FF]" />}
        >
          <ActivationBody groups={productCopy.activation} notes={productCopy.notes} size="xs" />
        </MobileCollapsible>
      )}
    </div>
  ) : null;

  const gallery = (
          <div className="min-w-0 ax-glass-card rounded-[24px] p-2 sm:p-3 lg:col-start-1 lg:row-start-1">
            <div className="relative">
              {/* Main image */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={displayImage}
                alt={displayName}
                className={activeImg > 0 ? "w-full h-auto object-contain rounded-2xl" : "w-full aspect-[4/3] object-cover rounded-2xl"}
              />

              {/* Arrows — always rendered when >1 image */}
              {hasMultipleImages && (
                <>
                  <button
                    onClick={goPrev}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition active:scale-90"
                    aria-label={t.prevPhoto}
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                  </button>
                  <button
                    onClick={goNext}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition active:scale-90"
                    aria-label={t.nextPhoto}
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                  </button>
                  <span className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-sm text-white text-xs font-bold px-3 py-1 rounded-full">
                    {activeImg + 1} / {galleryImages.length}
                  </span>
                </>
              )}
            </div>

            {/* Thumbnails — always rendered when >1 image */}
            {hasMultipleImages && (
              <div className="mt-3 flex gap-2 sm:gap-3 px-1 pb-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                {galleryImages.map((img, i) => (
                  <button
                    key={`thumb-${i}-${img.slice(-12)}`}
                    type="button"
                    aria-label={t.photoAlt(displayName, i + 1)}
                    aria-pressed={i === activeImg}
                    onClick={() => setActiveImg(i)}
                    className={`shrink-0 w-[72px] h-[56px] sm:w-[90px] sm:h-[68px] rounded-xl overflow-hidden border-2 transition-all duration-200 ${
                      i === activeImg
                        ? "border-[#00E5FF] shadow-[0_0_12px_rgba(0,229,255,0.35)]"
                        : "border-white/15 opacity-50 hover:opacity-100 hover:border-white/30"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img}
                      alt=""
                      className={`w-full h-full ${i === 0 ? "object-cover" : "object-contain"}`}
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

  );
  const desktopCopy = (
        <div className="hidden lg:flex lg:col-start-1 lg:row-start-2 flex-col gap-6">
          {/* Deskripsi Produk — Kolom Kiri di Desktop (Lega & Rapi) */}
          {hasDescription && (
            <div className="hidden lg:block ax-glass-card rounded-[24px] p-6 sm:p-8">
              <h2 className="font-display font-bold text-[18px] text-white tracking-tight flex items-center gap-2.5">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#00E5FF]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                {descriptionTitle}
              </h2>
              <div className="mt-4 border-t border-white/10 pt-5 text-sm text-white/75 leading-relaxed">
                <DescriptionBody parsed={parsedDescription} />
              </div>
            </div>
          )}

          {/* Produk multi-varian: detail varian (S&K + aktivasi, mengikuti pilihan
              yang sama dengan harga/keranjang) tampil SESUDAH deskripsi umum
              (keputusan owner 2 Nov: kenali produk dulu, lalu ketentuan varian). */}
          {separated && (
            <div className="hidden lg:block ax-glass-card rounded-[24px] p-6 sm:p-8" data-testid="pdp-variant-details">
              <h2 className="font-display font-bold text-[18px] text-white tracking-tight flex items-center gap-2.5">
                <ShieldIcon className="w-5 h-5 shrink-0 text-[#00E5FF]" />
                {t.terms}
              </h2>
              <div className="mt-4">{identity}</div>
              {variantCopyMissing && (
                <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-relaxed text-white/65">
                  {t.variantTermsMissing}
                </p>
              )}
              {appliesAllVariants && (
                <div className="mt-3">
                  <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-semibold text-white">
                    {t.appliesAllVariants}
                  </span>
                </div>
              )}
              {hasTerms && (
                <div className="mt-5 text-sm text-white/75 leading-relaxed">
                  <TermsBody sections={productCopy.sections} />
                </div>
              )}
              {hasActivation && (
                <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/75 leading-relaxed">
                  <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-white">
                    <StepsIcon className="w-4 h-4 text-[#00E5FF]" />
                    {t.activation}
                  </h3>
                  <ActivationBody groups={productCopy.activation} notes={productCopy.notes} />
                </div>
              )}
            </div>
          )}

          {/* Syarat & Ketentuan + Cara Aktivasi (Kolom Kiri Desktop) — produk
              varian tunggal / tanpa varian */}
          {!separated && (hasTerms || hasActivation) && (
            <div className="hidden lg:block ax-glass-card rounded-[24px] p-6 sm:p-8">
              <h2 className="font-display font-bold text-[18px] text-white tracking-tight flex items-center gap-2.5">
                <ShieldIcon className="w-5 h-5 text-[#00E5FF]" />
                {hasTerms ? t.terms : t.activation}
                {termsLabel && <span className="min-w-0 break-words text-xs font-semibold text-[#00E5FF]/80 tracking-normal">{termsLabel}</span>}
              </h2>
              {hasTerms && (
                <div className="mt-4 border-t border-white/10 pt-5 text-sm text-white/75 leading-relaxed">
                  <TermsBody sections={productCopy.sections} />
                </div>
              )}
              {hasActivation && (
                <div className={`${hasTerms ? "mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5" : "mt-4 border-t border-white/10 pt-5"} text-sm text-white/75 leading-relaxed`}>
                  {hasTerms && (
                    <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-white">
                      <StepsIcon className="w-4 h-4 text-[#00E5FF]" />
                      {t.activation}
                    </h3>
                  )}
                  <ActivationBody groups={productCopy.activation} notes={productCopy.notes} />
                </div>
              )}
            </div>
          )}
        </div>

  );
  return (
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <Link
        href="/#katalog"
        prefetch={false}
        className="inline-flex min-h-11 items-center gap-2 text-sm text-white/60 hover:text-white"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/ios11/back-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0 invert opacity-70" draggable={false} /> {t.back}
      </Link>

      <div className="mt-6 grid lg:grid-cols-[minmax(0,1fr)_38%] lg:grid-rows-[auto_1fr] xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] gap-6 lg:gap-8 items-start">
        {gallery}
        <div className="ax-glass-card rounded-[24px] p-6 sm:p-8 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-24 flex flex-col">
          {/* Badge produk (Terlaris / Baru / Bundle / dll) */}
          {product.badge && (
            <span className="self-start rounded-full bg-[#FFB800]/15 text-[#FFB800] text-[11px] font-bold px-3 py-1 tracking-wide uppercase border border-[#FFB800]/25">
              {badgeLabel(product.badge, prices.locale)}
            </span>
          )}

          <p className={`text-xs tracking-[0.08em] text-[#00E5FF]/80 font-semibold uppercase ${product.badge ? "mt-3" : ""}`}>
            {marketCategoryName(product.categorySlug, prices.locale)}
          </p>
          <h1 className="mt-2 font-display font-bold text-[22px] sm:text-[26px] leading-tight text-white">
            {displayName}
          </h1>

          {/* Divider */}
          <div className="mt-4 border-t border-white/8" />

          {/* Price block */}
          <div className="mt-4 flex items-baseline gap-3 flex-wrap">
            <span className="font-display font-bold text-[26px] text-white">
              <Price idr={displayPrice} prices={prices} />
            </span>
            {displayComparePrice != null && displayComparePrice > displayPrice && (
              <>
                <span className="text-sm line-through text-white/65">
                  <Price idr={displayComparePrice} prices={prices} />
                </span>
                <span className="rounded-full bg-[#FFB800] text-[#080C1E] text-xs font-bold px-2 py-1">
                  -{Math.round((1 - displayPrice / displayComparePrice) * 100)}%
                </span>
              </>
            )}
          </div>
          {prices.equivalent(displayPrice) && <p className="mt-1 text-xs text-white/50">{prices.equivalent(displayPrice)}</p>}
          <PriceNote prices={prices} className="mt-1 text-xs text-white/50" />

          {/* Social proof: sold count + stock */}
          {((product.soldCount != null && product.soldCount > 0) || (product.stock != null && product.stock > 0)) && (
            <div className="mt-3 flex items-center gap-3 text-xs text-white/50">
              {product.soldCount != null && product.soldCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 text-[#FFB800]" fill="currentColor"><path d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314z"/></svg>
                  {t.soldCount(product.soldCount.toLocaleString(prices.locale === "en" ? "en-US" : "id-ID"))}
                </span>
              )}
              {product.soldCount && product.stock ? <span className="text-white/20">·</span> : null}
              {product.stock != null && product.stock > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${product.stock > 10 ? "bg-emerald-400" : "bg-[#FFB800]"}`} />
                  {t.stockLabel(product.stock)}
                </span>
              )}
            </div>
          )}

          {/* Variant selector — Desktop: inline picker. Mobile: hint only (Shopee-style). */}
          {variantsEnabled && activeVariants.length > 0 && (
            <>
              {/* Desktop inline variant picker */}
              <div className="mt-4 space-y-2 hidden lg:block">
                <h3 className="text-sm font-medium text-white/60">{t.chooseVariantHeading}</h3>
                <div className="grid gap-2">
                  {activeVariants.map((v: VariantItem) => (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVariantId(v.id)}
                      className={`text-left p-3 rounded-xl border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5FF] ${
                        selectedVariantId === v.id
                          ? "border-[#00E5FF]/50 bg-[#00E5FF]/10"
                          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                      } ${!isPurchasable(v) ? "opacity-50 cursor-not-allowed" : ""}`}
                      disabled={!isPurchasable(v)}
                    >
                      <div className="flex justify-between items-start">
                        <div className="min-w-0">
                          <span className="block text-sm font-medium text-white">{formatVariantLabel(v, prices.locale)}</span>
                          <span className="mt-1.5 inline-flex">
                            {buyerDeliveryKind(v) === "instant" ? (
                              <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">{t.autoDelivery}</span>
                            ) : (
                              <span className="rounded-full border border-[#FFB800]/25 bg-[#FFB800]/10 px-2 py-0.5 text-[10px] font-bold text-[#FFD66B]">{catalogDeliveryBadge(v, prices.locale)}</span>
                            )}
                          </span>
                          {v.warranty_type !== 'none' && catalogWarranty(v, prices.locale) && (
                            <div className="text-xs text-[#00E5FF]/80 font-medium mt-1 flex items-center gap-1">
                              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4"/><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                              {catalogWarranty(v, prices.locale)}
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-bold text-[#00E5FF]">
                            <Price idr={v.price} prices={prices} />
                          </span>
                          {v.compare_price && v.compare_price > v.price && (
                            <div className="flex items-center gap-1.5 justify-end mt-0.5">
                              <span className="text-[11px] text-white/65 line-through"><Price idr={v.compare_price} prices={prices} /></span>
                              <span className="text-[10px] font-bold text-[#FFB800]">-{Math.round((1 - v.price / v.compare_price) * 100)}%</span>
                            </div>
                          )}
                          <div className="mt-0.5">
                            {effectiveStockOf(v) === 0 ? (
                              <span className="text-[11px] font-semibold text-red-400">{t.outLabel}</span>
                            ) : isBelowMinimum(v) ? (
                              <span className="text-[11px] font-semibold text-red-400">{t.belowMinLabel}</span>
                            ) : (
                              <span className="text-[11px] text-white/65">
                                {usableBulkTiers(v, v.price)[0] && <>{bulkCopy(prices.locale).variantHint(usableBulkTiers(v, v.price)[0].min_qty)} · </>}{t.remaining((() => { const eff = effectiveStockOf(v); return eff === -1 ? "∞" : eff; })())}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              {/* Mobile: baris varian menampilkan pilihan aktif; ketuk membuka
                  panel PILIH (bukan checkout). Dulu panel ini langsung ke
                  checkout dan pilihannya hilang saat ditutup, sehingga S&K di
                  mobile selalu milik varian pertama (laporan owner 2026-09-25). */}
              <button
                type="button"
                onClick={() => setVariantModal("select")}
                aria-label={selectedVariant
                  ? t.variantRowAria(formatVariantLabel(selectedVariant, prices.locale), prices.text(selectedVariant.price))
                  : t.chooseVariantAria(activeVariants.length)}
                className="mt-4 lg:hidden w-full flex items-center justify-between gap-3 p-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-medium text-white/50">{t.variantWord}</span>
                  {selectedVariant ? (
                    <>
                      <span className="mt-0.5 block break-words text-sm font-semibold text-white">{formatVariantLabel(selectedVariant, prices.locale)}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-[#00E5FF]"><Price idr={selectedVariant.price} prices={prices} /></span>
                        {buyerDeliveryKind(selectedVariant) === "instant" ? (
                          <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">{t.autoDelivery}</span>
                        ) : (
                          <span className="rounded-full border border-[#FFB800]/25 bg-[#FFB800]/10 px-2 py-0.5 text-[10px] font-bold text-[#FFD66B]">{catalogDeliveryBadge(selectedVariant, prices.locale)}</span>
                        )}
                      </span>
                    </>
                  ) : (
                    <span className="mt-0.5 block text-sm font-semibold text-[#00E5FF]">{t.chooseVariantCount(activeVariants.length)}</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-white/55">
                  {selectedVariant && activeVariants.length > 1 ? t.change : null}
                  <svg viewBox="0 0 24 24" className="w-4 h-4 text-white/40" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 18l6-6-6-6"/></svg>
                </span>
              </button>
            </>
          )}

          {/* Divider */}
          <div className="mt-5 border-t border-white/8" />

          {/* Jumlah pembelian ala marketplace (Shopee/Tokopedia): stepper di
              bawah varian, dibuka di minimum, floor = min. Satu-satunya
              tempat info "Min. N" tampil — tidak di tiap kartu varian agar
              tidak menumpuk. */}
          {variantsEnabled && selectedVariant && (
            <div className="mt-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-white/60">{t.quantity}</h3>
                {selectedMinQty > 1 && (
                  <span className="text-[11px] font-semibold text-[#FFD66B]">{t.minPurchase(selectedMinQty)}</span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.04]">
                  <button
                    type="button"
                    onClick={() => { commitPdpQtyDraft(null); setPdpQty((q) => Math.max(selectedMinQty, Math.min(selectedMaxQty, q) - 1)); }}
                    disabled={safePdpQty <= selectedMinQty}
                    aria-label={t.qtyDec}
                    className="flex h-11 w-11 items-center justify-center rounded-l-xl text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M5 12h14" /></svg>
                  </button>
                  {/* Ketik manual ala marketplace: draft string, commit clamp
                      min..max saat blur/Enter. Tidak bisa di bawah min. */}
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={pdpQtyDraft ?? String(safePdpQty)}
                    onChange={(e) => setPdpQtyDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                    onBlur={(e) => commitPdpQtyDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    id="pdp-qty-input"
                    aria-label={t.qtyAria(selectedMinQty)}
                    className="w-14 bg-transparent text-center text-sm font-bold tabular-nums text-white outline-none [appearance:textfield]"
                  />
                  <button
                    type="button"
                    onClick={() => { commitPdpQtyDraft(null); setPdpQty((q) => Math.min(selectedMaxQty, Math.max(selectedMinQty, q) + 1)); }}
                    disabled={safePdpQty >= selectedMaxQty}
                    aria-label={t.qtyInc}
                    className="flex h-11 w-11 items-center justify-center rounded-r-xl text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                  </button>
                </div>
                <span className="text-xs tabular-nums text-white/40">{(() => { const eff = selectedVariant ? effectiveStockOf(selectedVariant) : -1; return eff === -1 ? t.stockAvailable : t.remaining(eff); })()}</span>
              </div>
              {/* Ringkasan 2 bagian: Total di kiri, Hemat (hijau yang sama dengan checkout) di kanan; USD setara kecil di bawah nilai. */}
              {(selectedMinQty > 1 || selectedTiers.length > 0) && (() => {
                const bc = bulkCopy(prices.locale);
                const totalEquivalent = prices.equivalent(lineTotal);
                return (
                  <div className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-1" data-testid="pdp-qty-summary">
                    <p className="text-sm text-white/60">
                      {bc.totalLabel} <span className="font-semibold tabular-nums text-white">{prices.text(lineTotal)}</span>
                      {totalEquivalent && <span className="block text-[11px] tabular-nums text-white/40">{totalEquivalent}</span>}
                    </p>
                    {lineSavings > 0 && <p className="whitespace-nowrap text-sm tabular-nums text-emerald-300/80">{bc.savedSummary(prices.text(lineSavings))}</p>}
                  </div>
                );
              })()}
              <BulkPriceTiers
                mode="full"
                basePrice={displayPrice}
                tiers={selectedTiers}
                minQty={selectedMinQty}
                qty={safePdpQty}
                maxQty={selectedMaxQty}
                stockMax={selectedStockMax}
                capMax={selectedCapMax}
                qtyInputId="pdp-qty-input"
                locale={prices.locale}
                format={prices.text}
                onSetQty={(n) => { commitPdpQtyDraft(null); setPdpQty(Math.min(Math.max(n, selectedMinQty), selectedMaxQty)); }}
              />
            </div>
          )}

          {/* Badge pengiriman — satu sinyal, tanpa ikon checklist ganda.
              Mengikuti varian terpilih via buyerDeliveryKind: WR ikut
              wr_delivery_class, non-WR ikut fulfillment_mode (shared/unique =
              instan, manual = antrean admin). Non-WR manual memakai kalimat
              ETA admin (tanpa angka supplier 6–12 jam). */}
          <div className="mt-5">
            {mixedDelivery ? (
              <span className="inline-flex rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[11px] font-bold text-white/75">{t.mixedDelivery}</span>
            ) : buyerDeliveryKind(deliveryVariant ?? { fulfillment_mode: "manual" }) === "instant" ? (
              <span className="inline-flex rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-300">{t.autoDelivery}</span>
            ) : (
              <span className="inline-flex rounded-full border border-[#FFB800]/25 bg-[#FFB800]/10 px-3 py-1 text-[11px] font-bold text-[#FFD66B]">{catalogDeliveryBadge(deliveryVariant ?? { fulfillment_mode: "manual" }, prices.locale)}</span>
            )}
            <p className="mt-2 text-[12px] leading-5 text-white/50">
              {(() => {
                if (mixedDelivery) return t.mixedDeliveryNote;
                return catalogDeliveryEta(deliveryVariant, prices.locale);
              })()}
            </p>
          </div>
          <ul className="mt-3 space-y-2.5 text-[13px] text-white/60">
            <li className="flex items-start gap-2">
              <svg viewBox="0 0 16 16" className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400/80" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round"/></svg>
              {t.supportLine}
            </li>
            <li className="flex items-start gap-2">
              <svg viewBox="0 0 16 16" className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400/80" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round"/></svg>
              {t.warrantyLine}
            </li>
          </ul>

          {/* Mobile: deskripsi (umum) dulu, lalu S&K/aktivasi — sama untuk
              produk multi-varian maupun lainnya (keputusan owner 2 Nov). */}
          {mobileDescription}
          {mobileCopy}

          {/* Spacer — pushes buttons down when content is short */}
          <div className="flex-1 min-h-[16px]" />

          {/* CTA buttons — Desktop only. Mobile uses sticky bottom bar. */}
          <div className="hidden lg:block">
          {outOfStock || variantOutOfStock ? (
            <div className="mt-6">
              <span className="w-full h-[52px] rounded-xl bg-white/[0.06] border border-white/10 text-white/40 font-bold flex items-center justify-center gap-2">
                {t.soldOut}
              </span>
            </div>
          ) : (
            <div className="mt-6 flex flex-col gap-3">
              {needsVariantSelection && (
                <p className="text-xs text-[#FFB800]/80 text-center">{t.chooseVariantFirst}</p>
              )}
              {variantLoading && (
                <p role="status" className="text-xs text-white/55 flex items-center justify-center gap-2"><InlineSpinner className="w-3.5 h-3.5" />{t.variantsLoading}</p>
              )}
              {variantError && (
                <p className="text-xs text-red-300/80 text-center">
                  {t.variantsFailed}{" "}
                  <button type="button" onClick={() => setVariantAttempt((n) => n + 1)} className="font-semibold text-[#00E5FF] underline underline-offset-2">{t.retry}</button>
                </p>
              )}
              {!variantLoading && !variantError && variantsEnabled && activeVariants.length === 0 && (
                <p className="text-xs text-white/55 text-center">{t.noVariants}</p>
              )}
              <button
                onClick={() => {
                  // Beli Langsung membawa qty stepper (bukan selalu 1):
                  // varian min>1 (GSuite 50) langsung lolos quote tanpa
                  // dead-end "kembali belanja".
                  goCheckout(buyUrl);
                }}
                disabled={needsVariantSelection || variantCatalogUnavailable || checkoutPending}
                className={`w-full h-[52px] rounded-xl font-bold flex items-center justify-center gap-2 transition active:scale-[0.98] ${
                  needsVariantSelection || variantCatalogUnavailable
                    ? "bg-[#00E5FF]/30 text-[#080C1E]/50 cursor-not-allowed"
                    : "bg-[#00E5FF] text-[#080C1E] hover:bg-[#00D0E8] disabled:opacity-80 disabled:cursor-wait"
                }`}
              >
                {checkoutPending ? (
                  <><InlineSpinner tone="dark" /> {t.openingCheckout}</>
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/icons/ios11/lightning-bolt-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0" style={{ filter: "brightness(0)" }} draggable={false} /> {t.buyNow}
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  add(cartPayloadOf(selectedVariant), safePdpQty);
                }}
                disabled={needsVariantSelection || variantCatalogUnavailable}
                className={`w-full h-[48px] rounded-xl ax-glass-card font-semibold text-sm flex items-center justify-center gap-2 transition ${
                  needsVariantSelection || variantCatalogUnavailable
                    ? "text-white/30 cursor-not-allowed"
                    : "text-white hover:bg-white/10"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/ios11/shopping-bag-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0 invert" draggable={false} /> {t.addToCartFull}
              </button>
            </div>
          )}
          </div>
        </div>
        {desktopCopy}
      </div>

      {/* Floating Sticky Bottom Action Bar — Mobile Shopee-style. Nonaktif +
          spinner selama varian dimuat: dulu tombol aktif sejak awal dan klik
          cepat membawa ke checkout TANPA varian (buntu). */}
      {!outOfStock && !variantOutOfStock && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#080C1E]/90 backdrop-blur-xl border-t border-white/10 px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.5)] flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              if (mustPickInModal) { setVariantModal("cart"); return; }
              add(cartPayloadOf(selectedVariant), safePdpQty);
            }}
            disabled={variantLoading || checkoutPending}
            className="flex-1 h-11 rounded-xl ax-glass-card font-semibold text-xs flex items-center justify-center gap-1.5 transition text-white hover:bg-white/10 active:scale-95 disabled:opacity-40 disabled:cursor-wait"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/ios11/shopping-bag-32.png" alt="" width={15} height={15} className="w-3.5 h-3.5 object-contain brightness-0 invert" draggable={false} /> {t.cart}
          </button>
          <button
            type="button"
            onClick={() => {
              if (mustPickInModal) { setVariantModal("checkout"); return; }
              goCheckout(buyUrl);
            }}
            disabled={variantLoading || checkoutPending}
            className="flex-[1.5] h-11 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-95 bg-[#00E5FF] text-[#080C1E] hover:bg-[#00D0E8] shadow-[0_2px_12px_rgba(0,229,255,0.25)] disabled:opacity-70 disabled:cursor-wait"
          >
            {variantLoading ? (
              <><InlineSpinner className="w-3.5 h-3.5" tone="dark" /> {t.variantsLoadingShort}</>
            ) : checkoutPending ? (
              <><InlineSpinner className="w-3.5 h-3.5" tone="dark" /> {t.openingCheckout}</>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/ios11/lightning-bolt-32.png" alt="" width={15} height={15} className="w-3.5 h-3.5 object-contain brightness-0" style={{ filter: "brightness(0)" }} draggable={false} /> {t.buyNowTotal(prices.text(safePdpQty > 1 ? lineTotal : displayPrice))}
              </>
            )}
          </button>
        </div>
      )}

      {/* QuickVariantModal — baris varian / S&K (mode select) atau sticky bar
          saat belum memilih (beli cepat). Varian dari halaman dipakai langsung
          (tanpa fetch ulang); ketukan pembeli selalu menjadi pilihan halaman. */}
      {variantModal && product && (
        <QuickVariantModal
          product={product}
          mode={variantModal}
          onClose={() => setVariantModal(null)}
          variants={catalogDetail && !variantError && activeVariants.length > 0 ? activeVariants : undefined}
          initialVariantId={selectedVariantId}
          onVariantChange={setSelectedVariantId}
        />
      )}

      {/* Produk Serupa */}
      <div className="mt-10 sm:mt-12 pb-16 lg:pb-0">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display font-bold text-[18px] sm:text-[20px] text-white tracking-[-0.02em]">
            {t.similar}
          </h2>
          <Link prefetch={false} href="/#katalog" className="text-xs text-[#00E5FF] hover:text-white transition shrink-0">
            {t.seeAll}
          </Link>
        </div>
        <div
          className="mt-4 -mx-4 sm:mx-0 px-4 sm:px-0 overflow-x-auto scrollbar-none scroll-smooth snap-x snap-mandatory"
          style={{ scrollbarWidth: "none" }}
        >
          <div className="flex gap-3 sm:gap-5 pb-3 pr-4 sm:pr-0" style={{ minWidth: "min-content" }}>
            {relatedLoading && related.length === 0 ? Array.from({ length: 4 }, (_, i) => (
              <div key={`s${i}`} className="snap-start shrink-0 w-[156px] sm:w-[260px] ax-glass-card rounded-[14px] p-1" aria-hidden>
                <Bone className="aspect-[4/3] rounded-[10px]" />
                <div className="px-1.5 py-2 space-y-1.5"><Bone className="h-2.5 w-14 rounded-full" /><Bone className="h-3 w-[85%] rounded-full" /><Bone className="h-3.5 w-16 rounded-full" /></div>
              </div>
            )) : related.map((p, i) => (
              <div key={p.id} className="snap-start shrink-0 w-[156px] sm:w-[260px]">
                <ProductCard product={p} index={i} compact prices={prices} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
