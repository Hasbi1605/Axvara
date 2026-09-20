// Tipe bersama dipisah agar page.tsx (pemilik state) dan komponen section/modal yang
// baru bisa mengacu ke bentuk data yang sama tanpa impor melingkar. Tidak ada logika
// di sini — hanya kontrak bentuk data produk, kategori, dan varian form.

/** `lowStockVariants` hanya dikirim untuk permintaan admin (varian aktif berstok 0..5). */
export type Prod = { id:string; slug:string; name:string; whatsappAlias?:string; description:string; adminDescriptionOverride?:string|null; wrManaged?:boolean; price:number; minPrice?:number; maxPrice?:number; variantCount?:number; lowStockVariants?:number; comparePrice?:number; categorySlug:string; image:string; images:string[]; badge?:string; soldCount:number; stock:number; isActive:boolean; sortOrder?:number; requireEmail?:boolean };

export type Cat = { id:number; slug:string; name:string };

export type FormVariant = {
  id?: number;
  sku: string;
  label: string;
  price: number;
  comparePrice?: number | null;
  stock: number;
  /** Minimum pembelian per baris (migrasi 0034, generik — GSuite = 50). */
  min_qty?: number;
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
};

export type ProductForm = Partial<Prod> & { comparePrice?: number; categorySlug?: string };
