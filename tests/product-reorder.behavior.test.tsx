// @vitest-environment jsdom
//
// tests/product-reorder.behavior.test.tsx — Kontrol urutan produk di admin
// (issue perbaikan-3in1 2026-09-28, bagian A; diperbaiki 2026-09-29).
//
// Cakupan:
// 1. `normalizeSortOrder`: clamp 0-999999, NaN/infinit → null.
// 2. `globalProductOrder`: urutan global = aktif dulu, ready dulu, lalu
//    sortOrder, lalu id (identik dengan `filtered` di useProductManager).
// 3. `moveProduct`: pindah TEPAT satu posisi via POST /api/products/reorder —
//    server menukar dengan satu tetangga lalu menormalisasi seluruh key
//    10,20,30… secara atomik, sehingga klik tidak pernah skip 2–3 posisi.
//    Termasuk kasus batas halaman (per halaman 8): produk terakhir hal.1
//    bertetangga dengan produk pertama hal.2. Batas kelompok status
//    (ready vs habis vs nonaktif) tidak dikirim request sama sekali.
//    Sukses TANPA fetch ulang (realtime, halaman/scroll/focus utuh).
// 4. Validasi form menolak sortOrder non-angka; save mengirim sortOrder form
//    (bukan hardcode 0 seperti sebelumnya).
// 5. Kontrak API tidak berubah: GET /api/products ORDER BY sort_order ASC.
// 6. Migrasi 0047: backfill 0 → unik mengikuti id (idempoten, nilai admin
//    yang sudah diatur tidak digeser).
// 7. Display kolom Urutan = NOMOR POSISI (pos+1, selalu 1..N rapi), bukan
//    raw sort_order (kunci teknis boleh kembar/lompat — laporan owner
//    2026-09-29: 2,2,3,3,7,17,18,19 padahal posisi di toko sudah benar).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { ProductsSection } from "@/components/admin/sections/ProductsSection";
import { requireAdmin } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
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
    // Endpoint reorder baru: tiru server — pindah tepat satu tetangga ATAU
    // lompat ke targetPosition dalam bucket yang sama, lalu normalisasi
    // seluruh key 10,20,30…
    if (url === "/api/products/reorder" && method === "POST") {
      const body = calls[calls.length - 1].body ?? {};
      const targetId = String((body as { productId?: unknown }).productId ?? "");
      const target = store.get(targetId);
      if (!target) return { ok: false, status: 404, json: async () => ({ error: "not found" }) };
      const inBucket = (p: Prod) => `${p.isActive ? "a" : "i"}:${p.stock !== -1 && (p.stock ?? 0) <= 0 ? "s" : "r"}`;
      const canon = (list: Prod[]) => [...list].sort((a, b) =>
        Number(!a.isActive) - Number(!b.isActive)
        || Number(a.stock !== -1 && (a.stock ?? 0) <= 0) - Number(b.stock !== -1 && (b.stock ?? 0) <= 0)
        || (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
        || Number(a.id) - Number(b.id));
      const ordered = canon([...store.values()]);
      const idx = ordered.findIndex((p) => p.id === targetId);
      const bucket = inBucket(ordered[idx]);
      const members = ordered.filter((p) => inBucket(p) === bucket);
      const rawTarget = (body as { targetPosition?: unknown }).targetPosition;
      if (rawTarget !== undefined) {
        const clampedPosition = Math.max(1, Math.min(members.length, Math.floor(Number(rawTarget))));
        const rest = members.filter((p) => p.id !== targetId);
        rest.splice(clampedPosition - 1, 0, target);
        let cursor = 0;
        for (let i = 0; i < ordered.length; i++) {
          if (inBucket(ordered[i]) === bucket) ordered[i] = rest[cursor++];
        }
      } else {
        const direction = Number((body as { direction?: unknown }).direction ?? 0) as -1 | 1;
        const neighbor = ordered[idx + direction];
        if (idx < 0 || !neighbor || inBucket(ordered[idx]) !== inBucket(neighbor)) {
          return { ok: false, status: 409, json: async () => ({ error: "Produk sudah berada di batas kelompoknya." }) };
        }
        const at = ordered.findIndex((p) => p.id === neighbor.id);
        [ordered[idx], ordered[at]] = [ordered[at], ordered[idx]];
      }
      ordered.forEach((p, i) => { store.get(p.id)!.sortOrder = (i + 1) * 10; });
      return {
        ok: true, status: 200,
        json: async () => ({ ok: true, products: ordered.map((p, i) => ({ id: Number(p.id), sortOrder: (i + 1) * 10 })) }),
      };
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

describe("moveProduct: TEPAT satu posisi via POST /api/products/reorder", () => {
  it("↓ di tengah bertukar dengan tetangga bawah (satu POST, posisi bertukar)", async () => {
    stubApi(tenProducts());
    const { result } = renderManager();
    await act(async () => { await result.current.load(); });
    expect(result.current.filtered.map((p) => p.id)).toEqual(
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
    );
    const target = result.current.prods.find((p) => p.id === "3")!;
    await act(async () => { await result.current.moveProduct(target, 1); });
    // Daftar terurut ulang: 3 dan 4 bertukar posisi — tidak lebih.
    expect(result.current.filtered.map((p) => p.id)).toEqual(
      ["1", "2", "4", "3", "5", "6", "7", "8", "9", "10"],
    );
  });

  it("↑ di tengah bertukar dengan tetangga atas (satu POST)", async () => {
    const { calls } = stubApi(tenProducts());
    const { result } = renderManager();
    await act(async () => { await result.current.load(); });
    const target = result.current.prods.find((p) => p.id === "4")!;
    await act(async () => { await result.current.moveProduct(target, -1); });
    const posts = calls.filter((c) => c.url === "/api/products/reorder" && c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ productId: 4, direction: -1 });
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    expect(result.current.filtered.map((p) => p.id).slice(0, 5)).toEqual(
      ["1", "2", "4", "3", "5"],
    );
  });

  it("klik berurutan tidak pernah skip: 3× ↓ di kelompok longgar = 3 posisi", async () => {
    stubApi(tenProducts());
    const { result } = renderManager();
    await act(async () => { await result.current.load(); });
    for (let i = 0; i < 3; i++) {
      const target = result.current.prods.find((p) => p.id === "3")!;
      await act(async () => { await result.current.moveProduct(target, 1); });
    }
    expect(result.current.filtered.map((p) => p.id).slice(0, 7)).toEqual(
      ["1", "2", "4", "5", "6", "3", "7"],
    );
    expect(result.current.filtered.map((p) => p.sortOrder)).toEqual(
      [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    );
  });

  it("baseline kembar 0 TETAP pindah tepat satu (regresi skip 2–3 posisi)", async () => {
    const zeroes = () => Array.from({ length: 5 }, (_, i) => prod(i + 1, 0));
    stubApi(zeroes());
    const { result } = renderManager();
    await act(async () => { await result.current.load(); });
    expect(result.current.filtered.map((p) => p.id)).toEqual(["1", "2", "3", "4", "5"]);
    const target = result.current.prods.find((p) => p.id === "2")!;
    await act(async () => { await result.current.moveProduct(target, 1); });
    // Tepat satu tetangga dilewati — bukan jatuh ke dasar kelompok.
    expect(result.current.filtered.map((p) => p.id)).toEqual(
      ["1", "3", "2", "4", "5"],
    );
    expect(result.current.filtered.map((p) => p.sortOrder)).toEqual([10, 20, 30, 40, 50]);
  });

  it("batas kelompok status tidak dikirim request (ready tidak masuk habis/nonaktif)", async () => {
    const list = [
      prod(1, 10, { stock: -1 }),
      prod(2, 20, { stock: 0 }),
      prod(3, 30, { isActive: false }),
    ];
    const { calls } = stubApi(list);
    const { result } = renderManager();
    await act(async () => { await result.current.load(); });
    // Urutan kanonis: ready(1) → habis(2) → nonaktif(3).
    expect(result.current.filtered.map((p) => p.id)).toEqual(["1", "2", "3"]);
    const ready = result.current.prods.find((p) => p.id === "1")!;
    const inactive = result.current.prods.find((p) => p.id === "3")!;
    await act(async () => { await result.current.moveProduct(ready, 1); });
    await act(async () => { await result.current.moveProduct(inactive, -1); });
    expect(calls.filter((c) => c.url === "/api/products/reorder")).toHaveLength(0);
    expect(result.current.filtered.map((p) => p.id)).toEqual(["1", "2", "3"]);
  });

  it("sukses tanpa fetch ulang: halaman/scroll/focus utuh (realtime)", async () => {
    const { calls } = stubApi(tenProducts());
    const { result } = renderManager();
    await act(async () => { await result.current.load(); });
    await act(async () => { await result.current.setPage(() => 2); });
    expect(result.current.safePage).toBe(2);
    expect(result.current.paged.map((p) => p.id)).toEqual(["9", "10"]);
    const target = result.current.prods.find((p) => p.id === "9")!;
    await act(async () => { await result.current.moveProduct(target, 1); });
    // Satu POST reorder, nol GET ulang — halaman tetap 2.
    expect(calls.filter((c) => c.url === "/api/products/reorder")).toHaveLength(1);
    expect(calls.filter((c) => c.url === "/api/products" && c.method === "GET")).toHaveLength(1);
    expect(result.current.safePage).toBe(2);
  });

  it("↑ di puncak dan ↓ di dasar tidak mengirim request apa pun", async () => {
    const { calls } = stubApi(tenProducts());
    const { result } = renderManager();
    await act(async () => { await result.current.load(); });
    const first = result.current.prods.find((p) => p.id === "1")!;
    const last = result.current.prods.find((p) => p.id === "10")!;
    await act(async () => { await result.current.moveProduct(first, -1); });
    await act(async () => { await result.current.moveProduct(last, 1); });
    expect(calls.filter((c) => c.url === "/api/products/reorder")).toHaveLength(0);
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
    const posts = calls.filter((c) => c.url === "/api/products/reorder");
    // SATU POST — server menukar + menormalisasi seluruh key.
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ productId: 8, direction: 1 });
    // Urutan global mencerminkan pertukaran tepat satu posisi.
    expect(result.current.filtered.map((p) => p.id)).toEqual(
      ["1", "2", "3", "4", "5", "6", "7", "9", "8", "10"],
    );
    expect(store.get("9")!.sortOrder).toBe(80);
    expect(store.get("8")!.sortOrder).toBe(90);
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

  it("gerakan no-op tidak mengirim request (sudah di posisi itu)", async () => {
    // id 1 (order 1) di puncak: ↑ tetangga tak ada → return dini (dicakup
    // test batas). Di sini dua gerakan berurutan mengirim tepat 1 POST
    // per gerakan (tidak ada PUT parsial / request ganda).
    const { calls } = stubApi(tenProducts());
    const { result } = renderManager();
    await act(async () => { await result.current.load(); });
    const target = result.current.prods.find((p) => p.id === "5")!;
    await act(async () => { await result.current.moveProduct(target, -1); });
    const afterFirst = result.current.prods.find((p) => p.id === "5")!;
    await act(async () => { await result.current.moveProduct(afterFirst, 1); });
    expect(calls.filter((c) => c.url === "/api/products/reorder")).toHaveLength(2);
  });

  it("jump: posisi 10 → 1 dalam SATU request targetPosition", async () => {
    const { calls } = stubApi(tenProducts());
    const { result } = renderManager();
    await act(async () => { await result.current.load(); });
    const last = result.current.prods.find((p) => p.id === "10")!;
    await act(async () => { await result.current.jumpProduct(last, 1); });
    const posts = calls.filter((c) => c.url === "/api/products/reorder");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({ productId: 10, targetPosition: 1 });
    expect(result.current.filtered.map((p) => p.id)[0]).toBe("10");
  });

  it("jump ke posisi sendiri tidak mengirim request", async () => {
    const { calls } = stubApi(tenProducts());
    const { result } = renderManager();
    await act(async () => { await result.current.load(); });
    const first = result.current.prods.find((p) => p.id === "1")!;
    await act(async () => { await result.current.jumpProduct(first, 1); });
    expect(calls.filter((c) => c.url === "/api/products/reorder")).toHaveLength(0);
  });

  it("429 tidak me-reset posisi: rollback + state utuh", async () => {
    stubApi(tenProducts());
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/api/products" && method === "GET") {
        return { ok: true, status: 200, json: async () => ({ products: tenProducts() }) };
      }
      if (url.startsWith("/api/categories")) {
        return { ok: true, status: 200, json: async () => ({ categories: [] }) };
      }
      return { ok: false, status: 429, json: async () => ({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }) };
    }));
    const { result } = renderManager();
    await act(async () => { await result.current.load(); });
    const before = result.current.filtered.map((p) => p.id);
    const target = result.current.prods.find((p) => p.id === "3")!;
    await act(async () => { await result.current.moveProduct(target, 1); });
    expect(result.current.filtered.map((p) => p.id)).toEqual(before);
  });
});

describe("editor: modal membaca posisi 1..N, tidak mengirim kunci posisi", () => {
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

  it("openEdit memuat posisi 1..N ke modal; save TIDAK mengirim kunci posisi", async () => {
    const calls = stubSaveApi();
    const { result } = renderManager();
    await act(async () => { await result.current.openEdit(prod(1, 3)); });
    // Modal berbicara posisi (1 dari 1), bukan raw key (3).
    expect(result.current.form.displayPosition).toBe(1);
    expect(result.current.form.sortOrder).toBeUndefined();
    await act(async () => { await result.current.save(); });
    const put = calls.find((c) => c.method === "PUT");
    expect(put).toBeDefined();
    // Edit existing tidak boleh menggeser posisi diam-diam.
    expect(put!.body!.sortOrder).toBeUndefined();
  });

  it("modal produk baru menampilkan posisi akhir + mengalokasikan kunci akhir", async () => {
    stubSaveApi();
    const { result } = renderManager();
    await act(async () => { await result.current.load(); });
    act(() => { result.current.openNew(); });
    expect(result.current.form.displayPosition).toBe(2);
    expect(result.current.form.sortOrder).toBeGreaterThan(0);
  });
});

describe("endpoint POST /api/products/reorder (server, D1 fixture)", () => {
  let fixture: ReturnType<typeof createD1Fixture>;
  const postRaw = async (body: unknown, authed = true) => {
    // Import ulang per panggilan: modul route meng-cache binding D1 via
    // getD1() di level helper — tanpa reset, POST kedua membaca fixture
    // yang sudah ditutup (D1 fixture diganti tiap beforeEach). vi.resetModules
    // ikut me-reset vi.mock auth, jadi mock dipasang ulang SETELAH reset
    // via doMock (bukan via vi.mocked yang menunjuk mock lama).
    vi.resetModules();
    vi.doMock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => authed ? { email: "admin@test" } : null) }));
    const { POST } = await import("@/app/api/products/reorder/route");
    return POST(new NextRequest("http://localhost/api/products/reorder", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }) as never);
  };
  const post = (body: unknown) => postRaw(body, true);
  const orderOf = () => fixture.sql.prepare("SELECT id, sort_order FROM products ORDER BY sort_order, id").all()
    .map((r) => `${r.id}:${r.sort_order}`).join(" ");
  beforeEach(() => {
    vi.resetModules();
    fixture = createD1Fixture();
    vi.mocked(requireAdmin).mockReset();
    fixture.sql.prepare(
      "INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, sort_order) VALUES (1,1,'A','a','d',1000,-1,1,0),(2,1,'B','b','d',1000,-1,1,0),(3,1,'C','c','d',1000,-1,1,0),(4,1,'D','d','d',1000,0,1,0),(5,1,'E','e','d',1000,-1,0,0)",
    ).run();
  });
  afterEach(() => { fixture.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("menukar tepat satu tetangga lalu menormalisasi 10,20,30…", async () => {
    const res = await post({ productId: 2, direction: 1 });
    expect(res.status).toBe(200);
    const body = await res.json() as { products: { id: number; sortOrder: number }[] };
    expect(body.products.map((p) => p.id)).toEqual([1, 3, 2, 4, 5]);
    expect(body.products.map((p) => p.sortOrder)).toEqual([10, 20, 30, 40, 50]);
    expect(orderOf()).toBe("1:10 3:20 2:30 4:40 5:50");
  });

  it("klik berurutan tidak pernah skip: 1× ↓ lalu kandas di batas kelompok", async () => {
    // Fixture: ready = id 1,2,3 · habis = id 4 · nonaktif = id 5. id 2 turun
    // sekali (2→3): langkah kedua 409 karena tetangga berikutnya (id 4)
    // beda bucket — bukan skip ke habis/nonaktif.
    expect((await post({ productId: 2, direction: 1 })).status).toBe(200);
    expect(orderOf()).toBe("1:10 3:20 2:30 4:40 5:50");
    expect((await post({ productId: 2, direction: 1 })).status).toBe(409);
    expect(orderOf()).toBe("1:10 3:20 2:30 4:40 5:50");
  });

  it("batas kelompok: ready tidak turun ke habis; nonaktif tidak naik (409)", async () => {
    // id 3 = ready terakhir; id 4 = habis; id 5 = nonaktif.
    expect((await post({ productId: 3, direction: 1 })).status).toBe(409);
    expect((await post({ productId: 5, direction: -1 })).status).toBe(409);
    // DB tidak berubah.
    expect(orderOf()).toBe("1:0 2:0 3:0 4:0 5:0");
  });

  it("batas katalog: puncak ↑ dan dasar ↓ ditolak 409", async () => {
    expect((await post({ productId: 1, direction: -1 })).status).toBe(409);
    expect((await post({ productId: 5, direction: 1 })).status).toBe(409);
  });

  it("validasi + auth: body salah 400, tanpa admin 401", async () => {
    expect((await post({ productId: 1, direction: 2 })).status).toBe(400);
    expect((await post({ productId: -1, direction: 1 })).status).toBe(400);
    expect((await post({ productId: 1 })).status).toBe(400);
    expect((await postRaw({ productId: 1, direction: 1 }, false)).status).toBe(401);
  });

  it("jump 2 → 1 dalam satu request: urutan berubah, DB ternormalisasi", async () => {
    // Kasus owner (posisi 30 → 1) tidak perlu 29× klik: cukup ketik 1.
    const res = await post({ productId: 2, targetPosition: 1 });
    expect(res.status).toBe(200);
    const body = await res.json() as { clamped: boolean; products: { id: number; sortOrder: number }[] };
    expect(body.clamped).toBe(false);
    expect(body.products.map((p) => p.id)).toEqual([2, 1, 3, 4, 5]);
    expect(orderOf()).toBe("2:10 1:20 3:30 4:40 5:50");
  });

  it("jump keluar bucket dijepit + flag clamped jujur", async () => {
    // id 3 (ready) diminta ke posisi 99 → dijepit ke ujung bucket ready.
    const res = await post({ productId: 3, targetPosition: 99 });
    expect(res.status).toBe(200);
    const body = await res.json() as { clamped: boolean; products: { id: number }[] };
    expect(body.clamped).toBe(true);
    expect(body.products.map((p) => p.id).slice(0, 3)).toEqual([1, 2, 3]);
  });

  it("jump hanya menulis baris yang berubah (hemat write D1)", async () => {
    // Normalisasi dulu agar key sudah 10,20,30…
    await post({ productId: 2, direction: 1 });
    const before = fixture.control.queries;
    // id 1 (10) ↔ id 3 (20): hanya 2 baris berubah + 1 SELECT baca.
    const res = await post({ productId: 1, direction: 1 });
    expect(res.status).toBe(200);
    expect(fixture.control.queries - before).toBeLessThanOrEqual(4);
  });
});

describe("migrasi 0048: normalisasi kunci kembar → 10,20,30…", () => {
  const nodeRequire = createRequire(import.meta.url);
  const { DatabaseSync } = nodeRequire("node:sqlite") as {
    DatabaseSync: new (location: string) => {
      exec: (sql: string) => void;
      prepare: (sql: string) => {
        run: (...p: unknown[]) => unknown;
        get: (...p: unknown[]) => Record<string, unknown> | undefined;
        all: (...p: unknown[]) => Record<string, unknown>[];
      };
      close: () => void;
    };
  };

  function seedDb(orders: (number | null)[]) {
    const db = new DatabaseSync(":memory:");
    db.exec(read("drizzle/schema.sql"));
    db.exec("DELETE FROM product_variants; DELETE FROM products;");
    orders.forEach((order, i) => {
      db.prepare(
        "INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, sort_order) VALUES (?,?,?,?,?,?,?,1,?)",
      ).run(i + 1, 1, `P${i + 1}`, `p-${i + 1}`, "d", 10000, -1, order);
    });
    return db;
  }

  it("semua 0 → 1..N mengikuti id; rerun tidak menggeser", () => {
    const db = seedDb([0, 0, 0, 0, 0]);
    try {
      db.exec(read("drizzle/migrations/0047_product_sort_order_backfill.sql"));
      const rows = db.prepare("SELECT id, sort_order FROM products ORDER BY id").all();
      expect(rows.map((r) => Number(r.sort_order))).toEqual([1, 2, 3, 4, 5]);
      // Rerun idempoten: nilai tidak bergeser.
      db.exec(read("drizzle/migrations/0047_product_sort_order_backfill.sql"));
      const rows2 = db.prepare("SELECT id, sort_order FROM products ORDER BY id").all();
      expect(rows2.map((r) => Number(r.sort_order))).toEqual([1, 2, 3, 4, 5]);
    } finally {
      db.close();
    }
  });

  it("NULL dinormalisasi; nilai admin (>0) tidak disentuh, offset di atasnya", () => {
    const db = seedDb([null, 0, 10, 0, 3]);
    try {
      db.exec(read("drizzle/migrations/0047_product_sort_order_backfill.sql"));
      const rows = db.prepare("SELECT id, sort_order FROM products ORDER BY id").all();
      // id 3 (10) dan id 5 (3) utuh; tiga baris 0/NULL → 11,12,13 mengikuti id.
      expect(rows.map((r) => Number(r.sort_order))).toEqual([11, 12, 10, 13, 3]);
      expect(new Set(rows.map((r) => Number(r.sort_order))).size).toBe(5);
    } finally {
      db.close();
    }
  });

  it("0048: key kembar produksi (0,0,1,1,2,2,18,19) → unik 10,20,30… tanpa mengubah urutan tampil", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(read("drizzle/schema.sql"));
      db.exec("DELETE FROM product_variants; DELETE FROM products;");
      const raws = [0, 0, 1, 1, 2, 2, 18, 19];
      raws.forEach((order, i) => {
        db.prepare(
          "INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, sort_order) VALUES (?,?,?,?,?,?,?,1,?)",
        ).run(i + 1, 1, `P${i + 1}`, `p-${i + 1}`, "d", 10000, -1, order);
      });
      const before = db.prepare("SELECT id FROM products ORDER BY sort_order, id").all().map((r) => Number(r.id));
      db.exec(read("drizzle/migrations/0048_product_sort_order_normalize.sql"));
      const after = db.prepare("SELECT id, sort_order FROM products ORDER BY sort_order").all();
      // Urutan tampil identik, key menjadi unik berjarak.
      expect(after.map((r) => Number(r.id))).toEqual(before);
      expect(after.map((r) => Number(r.sort_order))).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
      // Rerun idempoten.
      db.exec(read("drizzle/migrations/0048_product_sort_order_normalize.sql"));
      const rerun = db.prepare("SELECT sort_order FROM products ORDER BY sort_order").all();
      expect(rerun.map((r) => Number(r.sort_order))).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
    } finally {
      db.close();
    }
  });
});

describe("kontrak API urutan tetap", () => {
  it("GET /api/products memetakan sort_order → sortOrder (regresi 0 semua)", () => {
    // Regresi produksi 2026-09-29: PUT /api/products/[id] tersimpan (detail
    // benar), tetapi GET /api/products tidak mengirim sortOrder sehingga
    // admin selalu melihat 0 dan ↑↓ menukar nilai yang sama. Mapper wajib
    // memetakan snake_case DB → camelCase API dengan normalisasi Number.
    const src = read("src/app/api/products/route.ts");
    expect(src).toContain("sortOrder: r.sort_order == null ? 0 : Number(r.sort_order)");
  });
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
  it("kolom Urutan menampilkan NOMOR POSISI yang bisa diketik, bukan raw sort_order", () => {
    // Regresi tampilan 2026-09-29: raw boleh kembar/lompat (2,2,3,3,7,…)
    // padahal posisi di toko benar — yang dipajang harus nomor posisi 1..N
    // dalam input ketik (lompat 30→1 dalam satu request, bukan 29× klik).
    const src = read("src/components/admin/sections/ProductsSection.tsx");
    expect(src).toContain("(orderIndex.get(p.id) ?? 0) + 1");
    expect(src).toContain("onJump(p, target)");
    expect(src).not.toContain(">{p.sortOrder ?? 0}<");
  });
  it("ProductEditorModal menampilkan posisi read-only (bukan input kunci)", () => {
    const src = read("src/components/admin/ProductEditorModal.tsx");
    expect(src).toContain("form.displayPosition");
    expect(src).not.toContain("max={999999}");
  });
});

describe("kolom Urutan = nomor posisi 1..N walau raw kembar/lompat", () => {
  function sectionProps(list: Prod[]) {
    const noop = vi.fn();
    const setPage = vi.fn();
    return {
      prods: list, paged: list, filtered: list, q: "", safePage: 1, totalPages: 1, perPage: 20,
      loadingList: false, toggling: null, activeProducts: list.length, lowStock: 0, soldProducts: 0,
      onQueryChange: noop, onPageChange: setPage, onlyLowStock: false, onClearLowStock: noop,
      onNew: noop, onEdit: noop, onDelete: noop, onToggleActive: noop,
      reordering: null, onMove: noop, onJump: noop,
    };
  }

  it("raw 2,2,3,3,7,17,18,19 (kasus screenshot owner) tampil 1..8", () => {
    // Daftar `filtered` sudah terurut tampil (posisi benar, angka raw acak).
    const raws = [2, 2, 3, 3, 7, 17, 18, 19];
    const list = raws.map((order, i) => prod(i + 1, order));
    const { container } = render(<ProductsSection {...sectionProps(list)} />);
    // Badge desktop kini input ketik bernilai 1..8 berurutan.
    const inputs = [...container.querySelectorAll('td input[title^="Posisi"]')] as HTMLInputElement[];
    expect(inputs.map((el) => el.value)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    // Tooltip tetap membawa kunci teknis untuk diagnosis.
    const titles = inputs.map((el) => el.getAttribute("title"));
    expect(titles[0]).toContain("kunci teknis sort_order: 2");
    expect(titles[5]).toContain("kunci teknis sort_order: 17");
    // Kartu mobile: "#N dari 8".
    expect(container.textContent).toContain("#1 dari 8");
    expect(container.textContent).toContain("#8 dari 8");
  });

  it("input posisi diketik lalu Enter memanggil onJump (lompat 30 → 1)", async () => {
    const onJump = vi.fn();
    const list = Array.from({ length: 5 }, (_, i) => prod(i + 1, (i + 1) * 10));
    const props = { ...sectionProps(list), onJump };
    const { container } = render(<ProductsSection {...props} />);
    const first = container.querySelector('td input[title^="Posisi"]') as HTMLInputElement;
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(first, { target: { value: "5" } });
    fireEvent.blur(first);
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump.mock.calls[0][1]).toBe(5);
  });

  it("setelah ↑↓, nomor posisi tetap 1..N berurutan (urutan tampil = posisi)", () => {
    const list = [2, 2, 3].map((order, i) => prod(i + 1, order));
    const props = sectionProps(list);
    const { container, rerender } = render(<ProductsSection {...props} />);
    // Simulasi hasil moveProduct: id 3 (raw 3) digeser ke 4 → tampil paling bawah.
    const moved = list.map((p) => (p.id === "3" ? { ...p, sortOrder: 4 } : p));
    const ordered = [...moved].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || Number(a.id) - Number(b.id));
    rerender(<ProductsSection {...props} prods={moved} paged={ordered} filtered={ordered} />);
    const inputs = [...container.querySelectorAll('td input[title^="Posisi"]')] as HTMLInputElement[];
    expect(inputs.map((el) => el.value)).toEqual(["1", "2", "3"]);
  });
});
