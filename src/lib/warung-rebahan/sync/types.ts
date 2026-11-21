import type { WrProduct } from "../client";

export type SyncResult = {
  total: number;
  synced: number;
  excluded: number;
  newProducts: number;
  newVariants: number;
  variantsSynced: number;
  stockChanges: number;
  priceChanges: number;
  errors: string[];
  durationMs: number;
  /** True bila berhenti karena budget (cursor tersimpan, lanjutkan run berikut). */
  budgetYielded: boolean;
  /** True bila sweep penuh selesai tervalidasi (zero-missing diizinkan). */
  snapshotComplete: boolean;
};

export type Row = Record<string, unknown>;

/**
 * Satu statement tulis yang SUDAH terikat parameternya tapi BELUM dikirim.
 *
 * KENAPA ADA (akar "sweep 32 detik untuk 13 produk"): kerja D1-nya sendiri
 * hampir gratis — `sql_duration_ms` terukur di produksi hanya 0,12–0,19 ms.
 * Yang mahal adalah JUMLAH round-trip: sweep lama mengirim 4 query per
 * produk + 4 per varian + 1 agregat secara BERURUTAN (13 produk/25 varian =
 * 165 round-trip), dan tiap round-trip menyeberang ke D1 primary di SIN.
 * Terukur ~197 ms per query, jadi 99,9% durasi sweep adalah menunggu
 * jaringan, bukan database.
 *
 * Dengan merencanakan tulis lebih dulu, seluruh tulis satu produk dikirim
 * sebagai SATU `batch()`. SQL-nya tetap tinggal di satu tempat (planner di
 * sync.ts) sehingga jalur berurutan lama dan jalur batch tidak bisa berbeda.
 */
export type SqlWrite = {
  sql: string;
  params: unknown[];
  /** Tulis yang boleh gagal diam-diam (dulu `.catch()` di jalur berurutan). */
  optional?: boolean;
  /** True bila tulis mengubah kolom yang tampil di katalog publik. */
  catalogDisplay?: boolean;
  /**
   * Versi pra-migrasi bila kolom `wr_delivery_mode` (0060) BELUM ada di D1
   * prod: statement yang sama TANPA kolom baru. Dipakai fallback per
   * statement — tanpa ini sync gagal total sampai migrasi 0060 diterapkan.
   */
  preMigrationFallback?: { sql: string; params: unknown[] };
};

export type VariantOutcome = { stockChanged: boolean; priceChanged: boolean; isNew: boolean };

export type SyncOptions = {
  /** Batas produk per run (default WR_SYNC_PRODUCTS_PER_RUN). */
  maxProducts?: number;
  /** Izinkan zeroMissingVariants bila sweep penuh (default true). */
  allowZeroMissing?: boolean;
  /** Sumber sync: 'manual' (Force Sync admin) atau 'cron' (terjadwal).
   * Dicatat ke wr_sync_log.trigger agar kartu admin bisa membedakan
   * keduanya (default 'manual' agar pemanggil lama tetap bermakna). */
  trigger?: "manual" | "cron";
  /**
   * Sisa waktu invocation (ms) yang boleh dipakai sweep ini.
   *
   * KENAPA WAJIB ADA (akar \"sync tersendat berminggu-minggu\"): loop di bawah
   * hanya punya gerbang BUDGET QUERY (`canSpend`), tidak pernah gerbang
   * WAKTU. Sweep penuh 48 produk / 87 varian = ~366 query D1 BERURUTAN;
   * biayanya sepenuhnya ditentukan latensi D1 yang tidak kita kendalikan.
   * Terukur di produksi dengan beban identik: 12 dtk saat D1 sehat (~33 ms/
   * query) tetapi 115-122 dtk saat D1 lambat (~314 ms/query) — 68 dari 391
   * sweep (17%) melewati deadline cron 45 dtk.
   *
   * Akibatnya berantai: run dibunuh platform SEBELUM ekor handler menulis
   * `wr_sync_log` dan penanda fase, sehingga sweep tidak pernah tercatat,
   * fase terkunci, dan run 5-menit berikutnya mengulang pekerjaan berat yang
   * sama sampai kebetulan bertemu D1 cepat. Persis gejala \"rusak di tengah
   * jalan tanpa sebab\" — tanpa error, tanpa jejak.
   *
   * Dengan budget waktu, sweep berhenti di batas produk terakhir yang utuh,
   * menyimpan cursor, dan melaporkan `budgetYielded` — sama persis dengan
   * perilaku saat budget query habis, yang sudah terbukti aman dan dilanjut
   * run berikutnya.
   */
  timeBudgetMs?: number;
  /**
   * Ambil HANYA potongan yang dikerjakan run ini dari proxy VPS
   * (`/wr/products-slice`, 2026-10-04) — bukan seluruh katalog. Dipakai cron
   * berpotongan (Workers Free ~10 ms CPU). Proxy lama / mode langsung →
   * otomatis kembali ke `fetchFn()` penuh. Diabaikan bila `fetchFn` kustom.
   */
  useProxySlices?: boolean;
  /**
   * Mode DIFF dari VPS (2026-10-04, `/api/supplier-sync`): terapkan HANYA
   * produk yang berubah + nol-kan varian yang dihapus upstream. Tanpa fetch,
   * tanpa cursor/generasi/zero-missing katalog penuh. Sweep berpotongan
   * tetap menjadi pengaman berkala (lihat cron).
   */
  applyOnly?: { products: WrProduct[]; removedVariantIds: string[] };
};

export type JaspaySyncResult = {
  total: number;
  synced: number;
  rejected: number;
  variantsSynced: number;
  stockChanges: number;
  priceChanges: number;
  errors: string[];
  durationMs: number;
};
