// @vitest-environment jsdom
//
// tests/product-reorder.behavior.test.tsx — Kontrol urutan produk di admin
// (issue perbaikan-3in1 2026-09-28, bagian A).
//
// Cakupan:
// 1. `normalizeSortOrder`: clamp 0-999999, NaN/infinit → null.
// 2. `globalProductOrder`: urutan global = aktif dulu, ready dulu, lalu
//    sortOrder, lalu id (identik dengan `filtered` di useProductManager).
// 3. `moveProduct`: tukar sort_order dua produk bertetangga GLOBAL via dua
//    PUT /api/products/[id] — termasuk kasus batas halaman (per halaman 8):
//    produk terakhir hal.1 bertetangga dengan produk pertama hal.2.
// 4. Validasi form menolak sortOrder non-angka; save mengirim sortOrder form
//    (bukan hardcode 0 seperti sebelumnya).
// 5. Kontrak API tidak berubah: GET /api/products ORDER BY sort_order ASC.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  globalProductOrder,
  normalizeSortOrder,
  useProductManager,
} from "@/components/admin/useProductManager";
import type { Prod } from "@/components/admin/product-types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

function prod(id: number, order: number, extra: Partial<Prod> = {}): Prod {
  return {
    id: String(id),
    slug: `produk-${id}`,
    name: `Produk ${id}`,
    description: "Deskripsi",
    price: 10000,
    categorySlug: "akun-premium",
    image: "",
    images: [],
    soldCount: 0,
    stock: -1,
    isActive: true,
    sortOrder: order,
    ...extra,
  } as Prod;
}

// 10 produk, 8 per halaman → hal.1 = id 1..8, hal.2 = id 9..10.
const tenProducts = () => Array.from({ length: 10 }, (_, i) => prod(i + 1, i + 1));

function stubApi(list: Prod[]) {
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  const store = new Map(list.map((p) => [p.id, { ...p }]));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url === "/api/products" && method === "GET") {
      return { ok: true, status: 200, json: async () => ({ products: [...store.values()] }) };
    }
    if (url.startsWith("/api/categories")) {
      return { ok: true, status: 200, json: async () => ({ categories: [] }) };
    }
    const m = url.match(/^\/api\/products\/(\d+)$/);
    if (m && method === "PUT") {
      const row = store.get(m[1]);
      if (!row) return { ok: false, status: 404, json: async () => ({ error: "not found" }) };
      const body = calls[calls.length - 1].body ?? {};
      if (typeof body.sortOrder === "number") row.sortOrder = body.sortOrder;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }));
  return { calls, store };
}

function renderManager() {
  return renderHook(() => useProductManager({ success: vi.fn(), error: vi.fn() }, vi.fn()));
}

describe("normalizeSortOrder: batas 0-999999", () => {
  it("nilai dalam rentang lolos apa adanya (dibulatkan ke bawah)", () => {
    expect(normalizeSortOrder(0)).toBe(0);
    expect(normalizeSortOrder(5)).toBe(5);
    expect(normalizeSortOrder(7.9)).toBe(7);
    expect(normalizeSortOrder("12")).toBe(12);
    expect(normalizeSortOrder(999999)).toBe(999999);
  });
  it("di luar rentang di-clamp", () => {
    expect(normalizeSortOrder(-3)).toBe(0);
    expect(normalizeSortOrder(1000000)).toBe(999999);
  });
  it("bukan angka → null (ditolak validasi)", () => {
    expect(normalizeSortOrder(NaN)).toBeNull();
    expect(normalizeSortOrder(Infinity)).toBeNull();
    expect(normalizeSortOrder("abc")).toBeNull();
    expect(normalizeSortOrder(undefined)).toBeNull();
  });
});

describe("globalProductOrder: tetangga global untuk swap", () => {
  it("urut aktif → ready → sortOrder → id", () => {
    const list = [
      prod(1, 1, { isActive: false }),
      prod(2, 0, { stock: 0 }),
      prod(3, 5),
      prod(4, 2),
    ];
    expect(globalProductOrder(list).map((p) => p.id)).toEqual(["4", "3", "2", "1"]);
  });
  it("tidak memotong: seluruh katalog ikut, bukan satu halaman", () => {
    expect(globalProductOrder(tenProducts())).toHaveLength(10);
  });
});

describe("moveProduct: tukar sort_order tetangga global via PUT", () => {
  it("↓ di tengah menukar dengan tetangga bawah (dua PUT, nilai bertukar)", async () => {
    stubApi(tenProducts());
    const { result } = renderManager();
    await act(async () => { await result.current.load(); });
    expect(result.current.filtered.map((p) => p.id)).toEqual(
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
    );
    const target = result.current.prods.find((p) => p.id === "3")!;
    await act(async () => { await result.current.moveProduct(target, 1); });
    // Daftar terurut ulang: 3 dan 4 bertukar posisi.
    expect(result.current.filtered.map((p) => p.id)).toEqual(
      ["1", "2", "4", "3", "5", "6", "7", "8", "9", "10"],
    );
  });

  it("↑ di puncak dan ↓ di dasar tidak mengirim request apa pun", async () => {
    const { calls } = stubApi(tenProducts());
    const { result } = renderManager();
    await act(async () => { await result.current.load(); });
    const first = result.current.prods.find((p) => p.id === "1")!;
    const last = result.current.prods.find((p) => p.id === "10")!;
    await act(async () => { await result.current.moveProduct(first, -1); });
    await act(async () => { await result.current.moveProduct(last, 1); });
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(result.current.filtered.map((p) => p.id)[0]).toBe("1");
  });

  it("batas halaman: ↓ produk terakhir hal.1 (id 8) bertukar dengan pertama hal.2 (id 9)", async () => {
    const { calls, store } = stubApi(tenProducts());
    const { result } = renderManager();
    await act(async () => { await result.current.load(); });
    // Sanity paginasi: 8 per halaman.
    expect(result.current.paged).toHaveLength(8);
    expect(result.current.totalPages).toBe(2);
    const eighth = result.current.prods.find((p) => p.id === "8")!;
    await act(async () => { await result.current.moveProduct(eighth, 1); });
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(2);
    expect(new Set(puts.map((c) => c.url))).toEqual(new Set(["/api/products/8", "/api/products/9"]));
    // Nilai sort_order bertukar di server.
    expect(store.get("8")!.sortOrder).toBe(9);
    expect(store.get("9")!.sortOrder).toBe(8);
    // Urutan global mencerminkan swap.
    expect(result.current.filtered.map((p) => p.id)).toEqual(
      ["1", "2", "3", "4", "5", "6", "7", "9", "8", "10"],
    );
  });

  it("PUT gagal → state dikembalikan (rollback optimistic)", async () => {
    stubApi(tenProducts());
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/api/products" && method === "GET") {
        return { ok: true, status: 200, json: async () => ({ products: tenProducts() }) };
      }
      if (url.startsWith("/api/categories")) {
        return { ok: true, status: 200, json: async () => ({ categories: [] }) };
      }
      return { ok: false, status: 500, json: async () => ({ error: "boom" }) };
    }));
    const { result } = renderManager();
    await act(async () => { await result.current.load(); });
    const before = result.current.filtered.map((p) => `${p.id}:${p.sortOrder}`);
    const target = result.current.prods.find((p) => p.id === "2")!;
    await act(async () => { await result.current.moveProduct(target, 1); });
    expect(result.current.filtered.map((p) => `${p.id}:${p.sortOrder}`)).toEqual(before);
  });
});

describe("editor: input angka Urutan tersimpan via save", () => {
  function stubSaveApi() {
    const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url === "/api/products/1" && method === "GET") {
        return {
          ok: true, status: 200,
          json: async () => ({
            product: {
              ...prod(1, 3), wrDescription: "Deskripsi", adminDescriptionOverride: null,
              wrManaged: false, requireEmail: false,
              variants: [{ id: 1, sku: "DEFAULT-1", label: "Default", price: 10000, stock: -1, is_active: 1, fulfillment_mode: "manual" }],
            },
          }),
        };
      }
      if (url === "/api/products" && method === "GET") {
        return { ok: true, status: 200, json: async () => ({ products: [prod(1, 3)] }) };
      }
      if (url.startsWith("/api/categories")) {
        return { ok: true, status: 200, json: async () => ({ categories: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }));
    return calls;
  }

  it("openEdit memuat sortOrder ke form; save mengirim nilai baru (bukan hardcode 0)", async () => {
    const calls = stubSaveApi();
    const { result } = renderManager();
    await act(async () => { await result.current.openEdit(prod(1, 3)); });
    expect(result.current.form.sortOrder).toBe(3);
    act(() => { result.current.setForm({ ...result.current.form, sortOrder: 42 }); });
    await act(async () => { await result.current.save(); });
    const put = calls.find((c) => c.method === "PUT");
    expect(put).toBeDefined();
    expect(put!.body!.sortOrder).toBe(42);
  });

  it("sortOrder non-angka ditolak validasi sebelum request", async () => {
    const calls = stubSaveApi();
    const { result } = renderManager();
    await act(async () => { await result.current.openEdit(prod(1, 3)); });
    act(() => { result.current.setForm({ ...result.current.form, sortOrder: "abc" as unknown as number }); });
    await act(async () => { await result.current.save(); });
    expect(result.current.formError).toMatch(/Urutan harus angka/);
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });
});

describe("kontrak API urutan tetap", () => {
  it("GET /api/products ORDER BY sort_order ASC", () => {
    const src = read("src/app/api/products/route.ts");
    expect(src).toContain("ORDER BY p.sort_order ASC, p.id ASC");
  });
  it("kolom sort_order ada di schema products", () => {
    const schema = read("drizzle/schema.sql");
    expect(schema).toMatch(/CREATE TABLE[^;]*products[^;]*sort_order INTEGER/m);
  });
  it("ProductsSection merender kolom Urutan + tombol ↑↓", () => {
    const src = read("src/components/admin/sections/ProductsSection.tsx");
    expect(src).toContain("Urutan");
    expect(src).toContain("onMove(p, -1)");
    expect(src).toContain("onMove(p, 1)");
  });
  it("ProductEditorModal punya input Urutan 0-999999", () => {
    const src = read("src/components/admin/ProductEditorModal.tsx");
    expect(src).toContain("form.sortOrder");
    expect(src).toContain("max={999999}");
  });
});
