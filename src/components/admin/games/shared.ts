import type { GamesCategory } from "@/lib/games/variant-kind";

export type Pricing = { markup_percent: number; rounding: 1 | 100 | 500 | 1000 };
export type Game = {
  slug: string; name: string; publisher: string; icon: string | null; banner: string | null;
  description: string; id_guide: string; featured_rank: number | null; hidden: boolean;
  markup_percent: number | null; effective_markup_percent: number;
  variants_total: number; sellable_count: number; supplier_off_count: number; min_price: number | null;
};
export type Item = {
  buyer_sku_code: string; product_name: string; game_brand: string; sk_product_name: string | null;
  product_type_name: string | null; description: string; supplier_active: number; stock: number;
  unlimited_stock?: number; min_order: number; cost: number; sell_price: number; enabled: number;
  display_group: GamesCategory | null; display_order: number | null; contract_supported: boolean;
  availability: { available: boolean; reason: string | null }; sellable: boolean;
  markup_percent: number | null; effective_markup_percent: number; markup_fixed: number;
  markup_source: "global" | "game" | "variant"; region: string | null;
};
export type List = {
  items: Item[]; total: number; brands: string[]; limit: number; offset: number;
  sync: { last_sync_at: string | null; counts: { total: number; sellable: number; supplier_off: number } };
  games: Game[]; pricing: Pricing;
};
export const markupValid = (value: string, optional = false) => value.trim() === "" ? optional : /^\d+(?:\.\d{1,2})?$/.test(value) && Number(value) <= 100;
export const fixedValid = (value: string) => value.trim() === "" || /^\d+$/.test(value) && Number(value) <= 1_000_000;
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.message || ({ unauthorized: "Sesi admin berakhir. Masuk kembali.", not_sellable: "Varian belum bisa diaktifkan: periksa supplier, modal, dan kontraknya.", legacy_parked: "Varian lama tidak dapat diubah di sini." } as Record<string, string>)[data?.error] || "Permintaan belum berhasil. Coba lagi.");
  return data as T;
}
export const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
