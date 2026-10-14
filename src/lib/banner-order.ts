import { queryAll } from "@/lib/db";

export class BannerOrderConflict extends Error {}

// The unique index arbitrates concurrent writers; only order collisions are retried.
export async function writeBannerOrder<T>(requested: number, id: string | null, write: (order: number) => Promise<T>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await queryAll("SELECT id,sort_order FROM banners");
    const occupied = new Set(rows.filter((row) => id === null || Number(row.id) !== Number(id)).map((row) => Number(row.sort_order)));
    let order = requested;
    while (order <= 999 && occupied.has(order)) order++;
    if (order > 999) throw new BannerOrderConflict("Tidak ada urutan kosong hingga 999. Pilih urutan lebih kecil.");
    try {
      return { result: await write(order), sort_order: order };
    } catch (error) {
      if (!/UNIQUE constraint failed:\s*banners\.sort_order/i.test(String(error))) throw error;
    }
  }
  throw new BannerOrderConflict("Urutan sedang diubah admin lain. Coba simpan lagi.");
}
