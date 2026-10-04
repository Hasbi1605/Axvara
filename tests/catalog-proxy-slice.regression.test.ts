// tests/catalog-proxy-slice.regression.test.ts
//
// Tahap 2 tanpa state (2026-10-04): cron berpotongan mengambil HANYA potongan
// katalog dari proxy VPS (`/wr/products-slice`, `/sk/catalog-slice`) agar
// Pages (Workers Free ~10 ms CPU) tidak mem-parse seluruh katalog tiap
// potongan. Dikunci: (1) sweep berpotongan lintas request mencakup seluruh
// katalog dan cursor kembali 0, (2) zero-missing berjalan HANYA di potongan
// terakhir memakai daftar id otoritatif dari proxy, (3) proxy lama (404)
// jatuh ke fetch penuh tanpa error.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { syncProducts } from "@/lib/warung-rebahan/sync";
import { syncSkProducts } from "@/lib/sekalipay/sync";
import type { WrProduct } from "@/lib/warung-rebahan/client";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function wrCatalog(n: number): WrProduct[] {
  return Array.from({ length: n }, (_, p) => ({
    id: `prod-${String(p).padStart(2, "0")}`,
    name: `Produk ${p}`,
    category: "Productivity",
    description: "desc",
    variants: [{
      id: `var-${p}`, name: "Paket", price: 5000, duration: "30 Hari", type: "Private",
      warranty: "7 Hari", stock: 10, terms: null, delivery_terms: null,
    }],
  })) as WrProduct[];
}

/** Simulasi proxy VPS: urutkan, potong, sertakan all_variant_ids di potongan terakhir. */
function wrProxyFetch(catalog: () => WrProduct[], calls: string[]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    const body = JSON.parse(String(init?.body ?? "{}")) as { offset?: number; limit?: number };
    if (!String(url).endsWith("/wr/products-slice")) {
      return new Response(JSON.stringify({ success: true, data: catalog() }), { status: 200 });
    }
    const all = [...catalog()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const total = all.length;
    const start = (body.offset ?? 0) >= total ? 0 : body.offset ?? 0;
    const limit = body.limit ?? 10;
    const last = start + limit >= total;
    return new Response(JSON.stringify({
      success: true,
      data: all.slice(start, start + limit),
      meta: {
        total, first_id: String(catalog()[0]?.id ?? ""), offset: start, limit,
        ...(last ? { all_variant_ids: all.flatMap((p) => p.variants.map((v) => String(v.id))) } : {}),
      },
    }), { status: 200 });
  });
}

describe("WR syncProducts — potongan proxy", () => {
  it("sweep 25 produk dalam 3 potongan; zero-missing hanya di potongan terakhir", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://wr-proxy.axvara.test");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "t");
      const calls: string[] = [];
      // Sweep awal penuh (mode lama) untuk 25 produk.
      vi.stubGlobal("fetch", wrProxyFetch(() => wrCatalog(25), calls));
      const seed = await syncProducts(createDatabaseAccess(fx.db), undefined, { trigger: "manual" });
      expect(seed.synced).toBe(25);

      // Upstream kini hanya 24 produk (prod-24 hilang) → varian itu harus 0
      // SETELAH sweep berpotongan tuntas, bukan sebelumnya.
      calls.length = 0;
      vi.stubGlobal("fetch", wrProxyFetch(() => wrCatalog(24), calls));
      const stockOf = () => Number((fx.sql.prepare("SELECT wr_stock FROM wr_variants WHERE wr_variant_id='var-24'").get() as { wr_stock: number }).wr_stock);
      const run = () => syncProducts(createDatabaseAccess(fx.db), undefined, { trigger: "cron", maxProducts: 10, useProxySlices: true });

      const r1 = await run();
      expect(r1.synced).toBe(10);
      expect(r1.budgetYielded).toBe(true);
      expect(stockOf()).toBe(10);
      const r2 = await run();
      expect(r2.budgetYielded).toBe(true);
      expect(stockOf()).toBe(10);
      const r3 = await run();
      expect(r3.synced).toBe(4);
      expect(r3.budgetYielded).toBe(false);
      expect(r3.snapshotComplete).toBe(true);
      expect(stockOf()).toBe(0);
      expect(calls.every((u) => u.endsWith("/wr/products-slice"))).toBe(true);
      expect(String((fx.sql.prepare("SELECT value FROM wr_sync_state WHERE key='products_cursor'").get() as { value: string }).value)).toBe("0");
    } finally {
      fx.close();
    }
  });

  it("proxy lama (404) → fallback fetch katalog penuh", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://wr-proxy.axvara.test");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "t");
      const calls: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        calls.push(String(url));
        if (String(url).endsWith("/wr/products-slice")) {
          return new Response(JSON.stringify({ status: false, reason: "unknown_wr_endpoint" }), { status: 404 });
        }
        return new Response(JSON.stringify({ success: true, data: wrCatalog(5) }), { status: 200 });
      }));
      const r = await syncProducts(createDatabaseAccess(fx.db), undefined, { trigger: "cron", maxProducts: 10, useProxySlices: true });
      expect(r.errors).toEqual([]);
      expect(r.synced).toBe(5);
      expect(calls.map((u) => u.split("/wr/")[1])).toEqual(["products-slice", "products"]);
    } finally {
      fx.close();
    }
  });
});

function skVariant(id: number, stock = 5) {
  return {
    id, sku: `S-${id}`, name: `Paket ${id}`, price: 10000, stock, order_process: "auto" as const,
    h2h_provider: null, provider_meta: null, required_fields: null, validation: null, updated_at: null,
  };
}

function skRows(ids: number[]) {
  return ids.map((id) => ({
    categoryName: "Aplikasi Premium", productId: 900 + id, productName: `Produk ${id}`,
    productImage: null, variant: skVariant(id),
  }));
}

function skProxyFetch(ids: () => number[], calls: string[]) {
  return vi.fn(async (url: string) => {
    calls.push(String(url));
    const u = new URL(String(url));
    if (u.pathname.endsWith("/sk/catalog-slice")) {
      const all = [...ids()].sort((a, b) => a - b);
      const offset = Number(u.searchParams.get("offset") ?? 0);
      const limit = Number(u.searchParams.get("limit") ?? 25);
      const start = offset >= all.length ? 0 : offset;
      const last = start + limit >= all.length;
      return new Response(JSON.stringify({
        message: "ok", server_time: "2026-10-04T06:00:00+07:00",
        rows: skRows(all.slice(start, start + limit)),
        meta: {
          total_items: all.length, is_delta: false, fetched_n: all.length, in_scope_n: all.length, offset: start, limit,
          ...(last ? { all_variant_ids: all.map(String) } : {}),
        },
      }), { status: 200 });
    }
    // fetch penuh (seed): satu kategori, satu produk per varian
    return new Response(JSON.stringify({
      message: "ok", server_time: "2026-10-04T05:00:00+07:00",
      meta: { total_items: ids().length, is_delta: false },
      data: [{ id: 1, name: "Aplikasi Premium", icon: null,
        products: ids().map((id) => ({ id: 900 + id, name: `Produk ${id}`, image: null, variants: [skVariant(id)] })) }],
    }), { status: 200 });
  });
}

describe("SK syncSkProducts — potongan proxy", () => {
  it("sweep berpotongan; varian hilang di-nol-kan hanya setelah potongan terakhir", async () => {
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      vi.stubEnv("SEKALIPAY_PROXY_URL", "https://wr-proxy.axvara.test");
      vi.stubEnv("SEKALIPAY_PROXY_TOKEN", "t");
      const calls: string[] = [];
      const all = Array.from({ length: 12 }, (_, i) => 101 + i);
      vi.stubGlobal("fetch", skProxyFetch(() => all, calls));
      const seed = await syncSkProducts(createDatabaseAccess(fx.db), undefined, { trigger: "manual", full: true, maxProducts: 48 });
      expect(seed.errors).toEqual([]);

      const without = all.filter((id) => id !== 112);
      vi.stubGlobal("fetch", skProxyFetch(() => without, calls));
      const stockOf = () => Number((fx.sql.prepare("SELECT sk_stock FROM sk_products WHERE sk_variant_id='112'").get() as { sk_stock: number }).sk_stock);
      const run = () => syncSkProducts(createDatabaseAccess(fx.db), undefined, { trigger: "cron", maxProducts: 5, useProxySlices: true });
      expect((await run()).budgetYielded).toBe(true);
      expect((await run()).budgetYielded).toBe(true);
      expect(stockOf()).toBe(5);
      const last = await run();
      expect(last.budgetYielded).toBe(false);
      expect(last.snapshotComplete).toBe(true);
      expect(stockOf()).toBe(0);
      expect(last.stockChanges).toBe(1);
      // Putaran berikut: varian yang sudah 0 TIDAK dihitung/ditulis ulang.
      await run(); await run();
      const again = await run();
      expect(again.snapshotComplete).toBe(true);
      expect(again.stockChanges).toBe(0);
      expect(String((fx.sql.prepare("SELECT value FROM sk_sync_state WHERE key='products_cursor'").get() as { value: string }).value)).toBe("0");
      expect(calls.slice(-3).every((u) => u.includes("/sk/catalog-slice") && u.includes("category=Aplikasi"))).toBe(true);
    } finally {
      fx.close();
    }
  });
});
