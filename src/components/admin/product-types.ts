// Tipe bersama dipisah agar page.tsx (pemilik state) dan komponen section/modal yang
// baru bisa mengacu ke bentuk data yang sama tanpa impor melingkar. Tidak ada logika
// di sini — hanya kontrak bentuk data produk, kategori, dan varian form.

export type Prod = { id:string; slug:string; name:string; whatsappAlias?:string; description:string; price:number; minPrice?:number; maxPrice?:number; variantCount?:number; comparePrice?:number; categorySlug:string; image:string; images:string[]; badge?:string; soldCount:number; stock:number; isActive:boolean; sortOrder?:number };

export type Cat = { id:number; slug:string; name:string };

export type FormVariant = {
  id?: number;
  sku: string;
  label: string;
  price: number;
  comparePrice?: number | null;
  stock: number;
  duration_value?: number | null;
  duration_unit?: string | null;
  duration_label?: string | null;
  warranty_type?: string;
  warranty_value?: number | null;
  warranty_unit?: string | null;
  warranty_label?: string | null;
  is_active: number;
};

export type ProductForm = Partial<Prod> & { comparePrice?: number; categorySlug?: string };
