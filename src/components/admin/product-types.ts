// Tipe bersama dipisah agar page.tsx (pemilik state) dan komponen section/modal yang
// baru bisa mengacu ke bentuk data yang sama tanpa impor melingkar. Tidak ada logika
// di sini — hanya kontrak bentuk data produk, kategori, dan varian form.

/** `lowStockVariants` & `copyReview` & `supplier` & `liveStatus`/`liveReason` hanya dikirim untuk admin. */
export type Supplier = keyof typeof import("./supplier-style").SUPPLIER_STYLES;
export type SupplierFilter = "all" | Supplier;
export type MergedGroupVariantSummary = {
  id: number;
  label: string;
  price: number;
  stock: number;
  isBuyable: boolean;
  slotName: string | null;
  slotStatus: "winner" | "loser" | null;
};
export type MergedGroupMemberSummary = {
  productId: number;
  productName: string;
  productSlug: string;
  supplier: Supplier;
  variants: MergedGroupVariantSummary[];
};
export type MergedGroupSummary = {
  groupId: number;
  groupName: string;
  isWinner: boolean;
  members: MergedGroupMemberSummary[];
};
export type Prod = { archivedAt?: string|null; canHardDelete?: boolean; hardDeleteReason?: string|null; id:string; slug:string; name:string; whatsappAlias?:string; description:string; adminDescriptionOverride?:string|null; descriptionEn?:string|null; nameEn?:string|null; wrManaged?:boolean; supplier?: Supplier; mergedSuppliers?: Supplier[]; mergedGroupId?: number; mergedGroupName?: string; mergedMinPrice?: number; mergedStock?: number; mergedVariantCount?: number; aivault_family?: string | null; storebat_family?: string | null; mirai_family?: string | null; pixelverif_family?: string | null; liveStatus?: "live" | "hidden_loser" | "hidden_soldout" | "off"; liveReason?: string; price:number; minPrice?:number; maxPrice?:number; variantCount?:number; lowStockVariants?:number; copyReview?:number; copyReviewChanged?:number; copyReviewRaw?:number; comparePrice?:number; categorySlug:string; categoryName?:string; image:string; images:string[]; badge?:string; soldCount:number; groupSoldCount?:number; stock:number; isActive:boolean; sortOrder?:number; requireEmail?:boolean };

export type Cat = { id:number; slug:string; name:string; sort_order?:number; icon?:string|null };

/** Draft harga grosir (editor admin). Lihat `BulkTierEditor`. */
type BulkDraft = import("./BulkTierEditor").BulkDraft;
type BuyerFieldKey = import("@/lib/buyer-fields").BuyerFieldKey;
type CustomBuyerFieldsConfig = import("@/lib/buyer-fields").CustomBuyerFieldsConfig;

export type FormVariant = {
  buyer_field_key?: BuyerFieldKey | null;
  custom_buyer_fields?: CustomBuyerFieldsConfig | null;
  max_qty?: number | null;
  admin_terms?: string;
  admin_activation?: string;
  id?: number;
  sku: string;
  label: string;
  price: number;
  comparePrice?: number | null;
  stock: number;
  /** Minimum pembelian per baris (migrasi 0034, generik — GSuite = 50). */
  min_qty?: number;
  /**
   * Modal manual per unit dalam rupiah (migrasi 0058, milik admin).
   * Untuk produk manual/stok sendiri yang modalnya tak tercatat di link
   * supplier. Default 0 = murni tanpa modal. Sync WR/SK tak pernah menulis.
   */
  manual_cost?: number;
  supplier_cost?: number | null;
  supplier_cost_source?: Exclude<Supplier, "Manual"> | null;
  duration_value?: number | null;
  duration_unit?: string | null;
  duration_label?: string | null;
  warranty_type?: string;
  warranty_value?: number | null;
  warranty_unit?: string | null;
  warranty_label?: string | null;
  is_active: number;
  /**
   * Cara pengiriman non-WR (milik admin, default "manual"):
   * - "manual" = Made By Order, dikerjakan admin (badge kuning)
   * - "shared" = Kirim otomatis, pesan bersama dari stok sendiri (badge hijau)
   * - "unique" = Kirim otomatis, 1 kredensial unik per pembeli (badge hijau)
   * Sinkron 1:1 dengan kolom `fulfillment_mode` (dipakai engine fulfillment).
   * Varian WR mengabaikan field ini (ikut wr_delivery_class dari sync).
   */
  fulfillment_mode?: string;
  /** Varian milik sync WR: harga/stok/label/durasi/garansi read-only di admin. */
  /** PENGECUALIAN: harga coret (comparePrice) milik admin — tetap bisa diedit. */
  wr_auto_managed?: number;
  /** Draft harga grosir (hanya produk manual). Tidak dikirim bila belum disentuh. */
  bulk?: BulkDraft;
};

export type ProductForm = Partial<Prod> & Pick<FormVariant, "supplier_cost" | "supplier_cost_source"> & {
  mergedGroup?: MergedGroupSummary | null;
  buyer_field_key?: BuyerFieldKey | null;
  custom_buyer_fields?: CustomBuyerFieldsConfig | null;
  max_qty?: number | null;
  admin_terms?: string;
  admin_activation?: string;
  /** Posisi visual 1..N di admin; read-only, bukan kolom DB. */
  displayPosition?: number;
  comparePrice?: number;
  categorySlug?: string;
  /**
   * Field mode single (toggle varian OFF) — paritas 2026-09-28.
   * Disimpan sebagai 1 varian `Default` eksplisit saat save, bukan kolom legacy.
   * Seluruhnya milik admin (bukan WR-owned); produk WR-managed tetap read-only di UI.
   */
  min_qty?: number;
  duration_value?: number | null;
  duration_unit?: string | null;
  duration_label?: string | null;
  warranty_type?: string;
  warranty_value?: number | null;
  warranty_unit?: string | null;
  warranty_label?: string | null;
  fulfillment_mode?: string;
  /** Modal manual per unit (migrasi 0058) — mode single, paritas multi. */
  manual_cost?: number;
  /** Draft harga grosir mode single (hanya produk manual). */
  bulk?: BulkDraft;
};
