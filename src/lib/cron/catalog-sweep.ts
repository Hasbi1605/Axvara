import type { DatabaseAccess } from "@/lib/db-access";

// Interval sync katalog WR/SK (2026-10-04: 30 → 15 menit). Sweep dipotong
// kecil per request di mode `?phase=` sehingga satu putaran penuh selesai
// dalam satu tick Worker; gerbang ini menentukan seberapa sering putaran baru
// dimulai = kesegaran katalog maksimum.
// Ambang 14 menit (bukan 15) agar putaran benar-benar tiap 15 menit: tick
// Worker datang tepat tiap 5 menit dan `wr_sync_log.created_at` ditulis
// beberapa detik SETELAH tick dimulai, sehingga pada tick menit ke-15 sync
// terakhir baru berumur ±14:58 → ambang 15 menit menunda putaran ke tick
// menit ke-20 (terukur prod 4 Okt: 05:20 → 05:40 WIB).
export const CATALOG_SYNC_INTERVAL_MS = 14 * 60 * 1000;
// Diff VPS (2026-10-04, `/api/supplier-sync`) menjaga kesegaran tiap ~3 menit.
// Selama diff sehat (penanda `diff_last_at` < 10 mnt), sweep berpotongan di
// cron turun menjadi PENGAMAN berkala: putaran penuh tiap 60 mnt diukur dari
// `products_full_sweep_at` (sejak 4 Okt siang diff tidak menulis *_sync_log;
// gerbang tetap memakai penanda state). Diff mati → kembali 14 mnt otomatis.
const DIFF_FRESH_MS = 10 * 60 * 1000;
const BACKUP_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Gerbang mulai putaran sweep katalog. Mengembalikan true bila putaran baru
 * boleh dimulai (lanjutan cursor ditangani pemanggil).
 */
export async function catalogSweepDue(
  table: "wr_sync_state" | "sk_sync_state",
  lastLogTs: number | null,
  queryAll: DatabaseAccess["queryAll"],
): Promise<boolean> {
  const now = Date.now();
  const rows = await queryAll(
    `SELECT key, value FROM ${table} WHERE key IN ('diff_last_at','products_full_sweep_at')`,
  ).catch(() => [] as Record<string, unknown>[]);
  const read = (k: string) => {
    const v = rows.find((r) => r.key === k)?.value;
    const t = v ? Date.parse(String(v)) : NaN;
    return Number.isFinite(t) ? t : null;
  };
  const diffAt = read("diff_last_at");
  if (diffAt != null && now - diffAt < DIFF_FRESH_MS) {
    const fullAt = read("products_full_sweep_at");
    return fullAt == null || now - fullAt >= BACKUP_SWEEP_INTERVAL_MS;
  }
  return lastLogTs == null || lastLogTs < now - CATALOG_SYNC_INTERVAL_MS;
}
