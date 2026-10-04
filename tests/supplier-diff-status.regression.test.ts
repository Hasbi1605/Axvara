// tests/supplier-diff-status.regression.test.ts
//
// 2026-10-04: kiriman diff VPS (`/api/supplier-sync`) TIDAK menulis
// *_sync_log — heartbeat 0/0 dan delta 1 varian sempat tampil sebagai
// "Sync terakhir · Otomatis 0p/0v / 1p/1v" di kartu admin. Penanda diff kini
// di state (`diff_last_at`, `diff_last_change*`) dan dibaca readDiffStatus.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { syncProducts } from "@/lib/warung-rebahan/sync";
import { readDiffStatus } from "@/lib/supplier/diff-status";
import { describeDiffChange } from "@/components/admin/SupplierSyncStatus";
import type { WrProduct } from "@/lib/warung-rebahan/client";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function product(stock: number): WrProduct {
  return {
    id: "prod-1", name: "Produk 1", category: "Productivity", description: "desc",
    variants: [{ id: "var-1", name: "Paket", price: 5000, duration: "30 Hari", type: "Private",
      warranty: "7 Hari", stock, terms: null, delivery_terms: null }],
  } as WrProduct;
}

describe("diff VPS tidak menulis wr_sync_log", () => {
  it("heartbeat & delta → state diff, log tetap milik sweep", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: [product(10)] }), { status: 200 })));
      await syncProducts(db, undefined, { trigger: "cron" });
      const before = await db.queryAll(`SELECT id FROM wr_sync_log WHERE sync_type='products'`);
      expect(before.length).toBe(1);

      // Heartbeat (kiriman kosong).
      await syncProducts(db, undefined, { trigger: "cron", applyOnly: { products: [], removedVariantIds: [] } });
      let diff = await readDiffStatus(db.queryAll, "wr_sync_state");
      expect(diff.healthy).toBe(true);
      expect(diff.last_change_at).toBeNull();

      // Delta stok 10 → 3.
      await syncProducts(db, undefined, { trigger: "cron", applyOnly: { products: [product(3)], removedVariantIds: [] } });
      diff = await readDiffStatus(db.queryAll, "wr_sync_state");
      expect(diff.last_change_at).not.toBeNull();
      expect(diff.last_change?.variants).toBe(1);
      expect(diff.last_change?.stock).toBe(1);

      const after = await db.queryAll(`SELECT id FROM wr_sync_log WHERE sync_type='products'`);
      expect(after.length).toBe(1);
    } finally {
      fx.close();
    }
  });

  it("readDiffStatus: diff >10 menit = tidak sehat; tabel kosong aman", async () => {
    const rows = [{ key: "diff_last_at", value: new Date(Date.now() - 11 * 60 * 1000).toISOString() }];
    const stale = await readDiffStatus(async () => rows, "sk_sync_state");
    expect(stale.healthy).toBe(false);
    const none = await readDiffStatus(async () => { throw new Error("no table"); }, "sk_sync_state");
    expect(none).toMatchObject({ last_at: null, healthy: false, last_change: null });
  });

  it("describeDiffChange merangkum perubahan", () => {
    expect(describeDiffChange({ variants: 2, stock: 2, price: 0 })).toBe("2 varian (2 stok)");
    expect(describeDiffChange({ variants: 1, stock: 0, price: 1, removed: 1 })).toBe("1 varian (1 harga, 1 dihapus supplier)");
  });
});
