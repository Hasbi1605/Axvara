// @vitest-environment jsdom
//
// tests/storefront-catalog-ux.behavior.test.tsx — UX katalog storefront.
//
// Dua keputusan yang dikunci:
//  1. Produk stok habis TETAP TAMPIL tetapi selalu di belakang produk ready.
//     Sebelumnya urutan murni sort_order, sehingga produk habis bisa menempati
//     baris pertama katalog.
//  2. Nomor halaman diganti tombol "Tampilkan N produk lagi" (pola marketplace),
//     batch 12 dan reset ke batch pertama saat filter berubah.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import HomePage from "@/app/page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function product(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id: String(id),
    slug: `produk-${id}`,
    name: `Produk ${id}`,
    description: "desc",
    price: 10000,
    categorySlug: "tools-pro",
    image: "",
    images: [],
    soldCount: 0,
    stock: -1,
    isActive: true,
    sortOrder: id,
    variantCount: 1,
    ...overrides,
  };
}

function stubCatalog(products: Record<string, unknown>[]) {
  // jsdom tidak menyediakan dua API browser yang dipakai hero/kartu katalog.
  if (!window.matchMedia) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }));
  }
  vi.stubGlobal("IntersectionObserver", class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
    root = null; rootMargin = ""; thresholds = [];
  });
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ products }),
  })));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("urutan katalog: ready dulu, habis di belakang", () => {
  it("produk stok habis tetap tampil tetapi dipindah ke belakang", async () => {
    // sort_order membuat produk HABIS berada paling depan bila tidak diurutkan.
    stubCatalog([
      product(1, { name: "Habis Duluan", stock: 0, sortOrder: 0 }),
      product(2, { name: "Ready Kedua", stock: 5, sortOrder: 1 }),
      product(3, { name: "Ready Ketiga", stock: -1, sortOrder: 2 }),
    ]);
    render(<HomePage />);
    await act(async () => {});

    const names = screen.getAllByRole("heading", { level: 3 }).map((n) => n.textContent?.trim());
    expect(names).toEqual(["Ready Kedua", "Ready Ketiga", "Habis Duluan"]);
  });

  it("di dalam kelompok yang sama, sort_order admin dipertahankan", async () => {
    stubCatalog([
      product(1, { name: "Ready B", stock: 5, sortOrder: 2 }),
      product(2, { name: "Ready A", stock: 5, sortOrder: 1 }),
      product(3, { name: "Habis B", stock: 0, sortOrder: 4 }),
      product(4, { name: "Habis A", stock: 0, sortOrder: 3 }),
    ]);
    render(<HomePage />);
    await act(async () => {});

    const names = screen.getAllByRole("heading", { level: 3 }).map((n) => n.textContent?.trim());
    expect(names).toEqual(["Ready A", "Ready B", "Habis A", "Habis B"]);
  });
});

describe("load more menggantikan nomor halaman", () => {
  it("menampilkan 12 produk pertama lalu menambah batch berikutnya", async () => {
    stubCatalog(Array.from({ length: 20 }, (_, i) => product(i + 1, { stock: 5 })));
    render(<HomePage />);
    await act(async () => {});

    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(12);
    // Tidak ada kontrol pagination lama.
    expect(screen.queryByLabelText("Next")).toBeNull();
    expect(screen.queryByLabelText("Prev")).toBeNull();

    const more = screen.getByRole("button", { name: /Tampilkan 8 produk lagi/i });
    fireEvent.click(more);
    await act(async () => {});

    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(20);
    expect(screen.queryByRole("button", { name: /produk lagi/i }), "tombol hilang saat habis").toBeNull();
  });

  it("ganti kategori mengembalikan tampilan ke batch pertama", async () => {
    stubCatalog([
      ...Array.from({ length: 14 }, (_, i) => product(i + 1, { stock: 5, categorySlug: "tools-pro" })),
      ...Array.from({ length: 3 }, (_, i) => product(100 + i, { stock: 5, categorySlug: "ai-gateway" })),
    ]);
    render(<HomePage />);
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: /Tampilkan 5 produk lagi/i }));
    await act(async () => {});
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(17);

    fireEvent.click(screen.getByRole("button", { name: /AI Gateway/i }));
    await act(async () => {});
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /Semua/i }));
    await act(async () => {});
    expect(screen.getAllByRole("heading", { level: 3 }), "kembali ke batch pertama").toHaveLength(12);
  });
});
