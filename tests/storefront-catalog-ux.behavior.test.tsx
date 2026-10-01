// @vitest-environment jsdom
//
// tests/storefront-catalog-ux.behavior.test.tsx — UX katalog storefront.
//
// Dua keputusan yang dikunci:
//  1. Kontrak 2026-10-01 (REVISI keputusan owner — mengubah revisi 2026-09-30:
//     kartu habis TAMPIL LAGI di belakang dengan overlay STOK HABIS + foto
//     abu-abu untuk trust). Klien mengurutkan ready-dulu sebagai pertahanan
//     lapis-2 bila API mengirim kartu habis (PDP/search langsung).
//  2. Pagination 2 tahap: 16 awal lalu SEKALIGUS semua (tombol "Tampilkan
//     semua (N lainnya)" + ciutkan), reset ke 16 saat filter berubah.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
// Beranda interaktif kini di home-client.tsx (page.tsx = server, SSR katalog).
// Tanpa `initialProducts` klien memuat /api/products seperti sebelumnya.
import { HomeClient as HomePage } from "@/app/home-client";

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

describe("urutan katalog: ready dulu, habis di belakang (pertahanan lapis-2)", () => {
  it("kartu habis yang lolos API tetap dipindah ke belakang", async () => {
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

describe("tampilkan semua menggantikan batch berulang", () => {
  it("menampilkan 16 produk pertama lalu sekaligus semua + ciutkan", async () => {
    stubCatalog(Array.from({ length: 20 }, (_, i) => product(i + 1, { stock: 5 })));
    render(<HomePage />);
    await act(async () => {});

    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(16);
    // Tidak ada kontrol pagination lama.
    expect(screen.queryByLabelText("Next")).toBeNull();
    expect(screen.queryByLabelText("Prev")).toBeNull();

    const more = screen.getByRole("button", { name: /Tampilkan semua \(4 produk lainnya\)/i });
    fireEvent.click(more);
    await act(async () => {});

    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(20);
    expect(screen.queryByRole("button", { name: /produk lainnya/i }), "tombol hilang saat habis").toBeNull();

    const collapse = screen.getByRole("button", { name: /Ciutkan ke 16 produk/i });
    fireEvent.click(collapse);
    await act(async () => {});

    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(16);
  });

  it("ganti kategori mengembalikan tampilan ke 16 awal", async () => {
    stubCatalog([
      ...Array.from({ length: 18 }, (_, i) => product(i + 1, { stock: 5, categorySlug: "produktivitas-office" })),
      ...Array.from({ length: 3 }, (_, i) => product(100 + i, { stock: 5, categorySlug: "ai-chatbot" })),
    ]);
    render(<HomePage />);
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: /Tampilkan semua \(5 produk lainnya\)/i }));
    await act(async () => {});
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(21);

    fireEvent.click(screen.getByRole("button", { name: /AI.*Chatbot/i }));
    await act(async () => {});
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /Semua/i }));
    await act(async () => {});
    expect(screen.getAllByRole("heading", { level: 3 }), "kembali ke 16 awal").toHaveLength(16);
  });
});

describe("overlay stok habis di kartu", () => {
  it("kartu habis punya overlay + foto abu-abu + aria habis", async () => {
    stubCatalog([
      product(1, { name: "Ready Satu", stock: 5 }),
      product(2, { name: "Habis Dua", stock: 0 }),
    ]);
    const { container } = render(<HomePage />);
    await act(async () => {});

    // Overlay tampil tepat 1x (hanya kartu habis).
    const overlays = Array.from(container.querySelectorAll('[data-testid="soldout-overlay"]'));
    expect(overlays).toHaveLength(1);
    // Foto kartu habis grayscale.
    const imgs = Array.from(container.querySelectorAll("img")).filter((el) =>
      el.getAttribute("alt") === "Habis Dua",
    );
    expect(imgs.length).toBeGreaterThan(0);
    expect(imgs[0].className).toContain("grayscale");
    // Link kartu habis berlabel aksesibel.
    expect(screen.getByRole("link", { name: /Habis Dua.*stok habis/i })).toBeTruthy();
  });
});

describe("copy hero: order cepat tanpa login (keputusan owner 2026-10-01)", () => {
  it("subheadline + trust item menekankan order tanpa login, bukan QRIS", async () => {
    stubCatalog([product(1, { name: "Ready Satu", stock: 5 })]);
    render(<HomePage />);
    await act(async () => {});

    expect(
      screen.getByText("Berbagai tools AI dan aplikasi premium dengan harga murah. Order cepat dan otomatis tanpa perlu login."),
    ).toBeTruthy();
    expect(screen.getByText("Order cepat tanpa login")).toBeTruthy();
    // Copy lama hilang total.
    expect(screen.queryByText(/jauh lebih murah dibanding official/)).toBeNull();
    expect(screen.queryByText("QRIS otomatis")).toBeNull();
  });
});
