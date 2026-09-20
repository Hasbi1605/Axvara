// tests/warung-rebahan/sync-time-budget.regression.test.ts
//
// AKAR "sync WR tersendat berminggu-minggu, rusak di tengah jalan tanpa sebab".
//
// Bukti produksi (wr_sync_log, D1 axvara-db, 20 Sep 2026):
//   - Sweep penuh = 48 produk / 87 varian = ~366 query D1 BERURUTAN.
//   - Beban IDENTIK, durasi TIDAK identik: 12.184 ms saat D1 sehat
//     (~33 ms/query) vs 115.448 ms saat D1 lambat (~314 ms/query).
//   - 68 dari 391 sweep (17%) melewati deadline cron 45 dtk; 35 di antaranya
//     >100 dtk (maksimum 122.473 ms).
//   - Akibatnya run dibunuh platform SEBELUM ekor handler menulis wr_sync_log
//     dan penanda fase → sweep tak tercatat, fase terkunci, dan jeda sync
//     melonjak dari normal 39-40 mnt menjadi 163 dan 305 mnt.
//
// Penyebabnya struktural, bukan kebetulan: loop sync hanya punya gerbang
// BUDGET QUERY (`canSpend`) dan TIDAK PERNAH punya gerbang WAKTU, padahal
// biaya sebenarnya ditentukan latensi D1 yang tidak kita kendalikan. Itulah
// sebabnya perbaikan-perbaikan sebelumnya (yang menyetel interval, fase, dan
// anti-starvation) tidak pernah menyelesaikannya — semuanya mengatur KAPAN
// sweep dimulai, bukan memastikan sweep BERHENTI sebelum invocation mati.
//
// Test ini memakai D1 lambat tiruan supaya kondisi "D1 buruk" bisa diuji
// deterministik tanpa menunggu insiden nyata.
import { describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "../helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { syncProducts, WR_SYNC_PRODUCTS_PER_RUN } from "@/lib/warung-rebahan/sync";
import type { WrProduct } from "@/lib/warung-rebahan/client";

vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");

/** Katalog seukuran produksi: 48 produk, masing-masing 2 varian. */
function bigCatalog(): WrProduct[] {
  return Array.from({ length: WR_SYNC_PRODUCTS_PER_RUN }, (_, i) => ({
    id: `prod-${String(i).padStart(3, "0")}`,
    name: `Produk Uji ${i}`,
    category: "Productivity",
    description: "katalog uji",
    variants: [0, 1].map((v) => ({
      id: `var-${i}-${v}`,
      name: `Varian ${v}`,
      price: 5000,
      duration: "7 Hari",
      type: "Private",
      warranty: "7 Hari",
      stock: 10,
      terms: null,
      delivery_terms: null,
    })),
  })) as WrProduct[];
}

/**
 * Bungkus D1 fixture supaya SETIAP statement memakan waktu — meniru D1 yang
 * lambat. Waktu dimajukan lewat fake timer agar test tetap cepat.
 */
function slowD1(base: ReturnType<typeof createD1Fixture>["db"], msPerQuery: number) {
  const tick = () => vi.advanceTimersByTime(msPerQuery);
  const wrap = (stmt: Record<string, unknown>): Record<string, unknown> => ({
    bind: (...args: unknown[]) => wrap((stmt.bind as (...a: unknown[]) => Record<string, unknown>)(...args)),
    first: async () => { tick(); return (stmt.first as () => Promise<unknown>)(); },
    all: async () => { tick(); return (stmt.all as () => Promise<unknown>)(); },
    run: async () => { tick(); return (stmt.run as () => Promise<unknown>)(); },
  });
  return {
    prepare: (q: string) => wrap((base as unknown as { prepare: (q: string) => Record<string, unknown> }).prepare(q)),
    batch: async (stmts: unknown[]) => {
      for (let i = 0; i < stmts.length; i++) tick();
      return [];
    },
  };
}

describe("WR sync — sweep wajib berhenti sebelum invocation dibunuh platform", () => {
  it("menghormati timeBudgetMs saat D1 lambat, dan melanjutkan lewat cursor", async () => {
    vi.useFakeTimers();
    const fx = createD1Fixture();
    try {
      // 300 ms/query ≈ kondisi D1 buruk yang terukur di produksi (314 ms).
      const db = createDatabaseAccess(slowD1(fx.db, 300) as never);
      const budget = 30_000; // sisa deadline realistis untuk fase WR

      const result = await syncProducts(db, async () => bigCatalog(), {
        maxProducts: WR_SYNC_PRODUCTS_PER_RUN,
        trigger: "cron",
        timeBudgetMs: budget,
      });

      // Inti perbaikan: sweep BERHENTI SENDIRI di dalam anggaran waktunya.
      // Tanpa gerbang waktu, durasi membengkak jauh melewati budget dan run
      // nyata akan dibunuh platform sebelum hasilnya sempat dicatat.
      expect(result.durationMs).toBeLessThanOrEqual(budget * 1.5);
      expect(result.budgetYielded).toBe(true);
      // Berhenti lebih awal BUKAN berarti gagal: yang sempat diproses tetap
      // tersimpan, dan sweep belum dinyatakan penuh.
      expect(result.snapshotComplete).toBe(false);
      expect(result.errors).toEqual([]);
    } finally {
      vi.useRealTimers();
      fx.close();
    }
  });

  it("tanpa timeBudgetMs perilaku lama dipertahankan (Force Sync admin)", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      // D1 cepat + tanpa budget waktu → sweep tuntas seperti sebelumnya.
      const result = await syncProducts(db, async () => bigCatalog(), {
        maxProducts: WR_SYNC_PRODUCTS_PER_RUN,
        trigger: "manual",
      });
      expect(result.synced).toBe(WR_SYNC_PRODUCTS_PER_RUN);
      expect(result.snapshotComplete).toBe(true);
      expect(result.errors).toEqual([]);
    } finally {
      fx.close();
    }
  });

  it("sweep parsial menurunkan products_snapshot_complete ke '0' (sinyal lanjutkan)", async () => {
    vi.useFakeTimers();
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(slowD1(fx.db, 300) as never);
      // Seed '1' dulu — meniru kondisi nyata setelah sweep penuh terakhir.
      // Tanpa ini migrasi 0029 sudah menyeed '0' dan test lolos PALSU walau
      // kode tidak pernah me-reset penanda (terbukti lewat mutation-test).
      fx.sql
        .prepare("UPDATE wr_sync_state SET value='1' WHERE key='products_snapshot_complete'")
        .run();
      const res = await syncProducts(db, async () => bigCatalog(), {
        maxProducts: WR_SYNC_PRODUCTS_PER_RUN,
        trigger: "cron",
        timeBudgetMs: 30_000,
      });
      expect(res.snapshotComplete).toBe(false);
      // Penanda durable WAJIB '0' — inilah yang dibaca cron untuk melanjutkan
      // segera. Bila tetap '1' (nilai dari sweep penuh terakhir), sisa katalog
      // baru tersentuh 30 menit kemudian.
      const row = fx.sql
        .prepare("SELECT value FROM wr_sync_state WHERE key='products_snapshot_complete'")
        .get() as { value?: string } | undefined;
      expect(String(row?.value)).toBe("0");
    } finally {
      vi.useRealTimers();
      fx.close();
    }
  });

  it("sweep tuntas menaikkan penanda kembali ke '1'", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const res = await syncProducts(db, async () => bigCatalog(), {
        maxProducts: WR_SYNC_PRODUCTS_PER_RUN,
        trigger: "cron",
      });
      expect(res.snapshotComplete).toBe(true);
      const row = fx.sql
        .prepare("SELECT value FROM wr_sync_state WHERE key='products_snapshot_complete'")
        .get() as { value?: string } | undefined;
      expect(String(row?.value)).toBe("1");
    } finally {
      fx.close();
    }
  });

  it("cron melanjutkan sweep yang belum tuntas tanpa menunggu interval 30 menit", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const cron = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/cron/operations/route.ts"),
      "utf8",
    );
    // Saat D1 lambat, sweep berhenti karena WAKTU dengan errors kosong →
    // tercatat 'success'. Tanpa jalur resume, gerbang interval membacanya
    // sebagai "baru sukses" dan menahan lanjutannya 30 menit: katalog 48
    // produk butuh ~90 menit padahal kerjanya ~2 menit CPU.
    // Sinyalnya products_cursor (tidak ambigu), bukan snapshot_complete
    // yang di-seed '0' oleh migrasi 0029 untuk DB yang belum pernah sync.
    expect(cron).toContain("products_cursor");
    expect(cron).toMatch(/resumeNow\s*\|\|\s*lastTs == null/);
    expect(cron).toMatch(/Number\(cursorRow\?\.value \?\? 0\) > 0/);
  });

  it("cron mengoper sisa deadline ke sweep, bukan membiarkannya tanpa batas", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const cron = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/cron/operations/route.ts"),
      "utf8",
    );
    // Sweep harus menerima anggaran waktu yang diturunkan dari deadline run,
    // dengan cadangan untuk ekor yang menulis log + penanda fase.
    expect(cron).toContain("timeBudgetMs");
    expect(cron).toContain("TIME_WR_SWEEP_RESERVE");
    expect(cron).toMatch(/timeBudgetMs:\s*Math\.max\(0,\s*timeLeftMs\(\)\s*-\s*TIME_WR_SWEEP_RESERVE\)/);
  });
});
