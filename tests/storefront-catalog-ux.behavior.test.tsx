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
import { HomeClient as HomePage } from "@/app/(shop)/home-client";
import { useSearch } from "@/stores/search";

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
    categorySlug: "produktivitas-office",
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

afterEach(() => { cleanup(); useSearch.setState({ q: "" }); vi.unstubAllGlobals(); });

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

    fireEvent.click(screen.getByRole("button", { name: "Produktivitas & Office" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Produktivitas & Office" }));
    fireEvent.click(screen.getByRole("button", { name: /Tampilkan semua \(2 produk lainnya\)/i }));
    await act(async () => {});
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(18);

    fireEvent.click(screen.getByRole("button", { name: /AI.*Chatbot/i }));
    await act(async () => {});
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /Semua/i }));
    await act(async () => {});
    expect(screen.getAllByRole("heading", { level: 3 }), "kembali ke pratinjau per kategori").toHaveLength(11);
    fireEvent.click(screen.getByRole("button", { name: "Produktivitas & Office" }));
    expect(screen.getAllByRole("heading", { level: 3 }), "kategori kembali ke 16 awal").toHaveLength(16);
  });
});

describe("LCP mobile: 4 kartu pertama eager + prioritas tinggi, sisanya lazy", () => {
  it("kartu 1–4 eager/high, kartu 5+ lazy (hemat bandwidth awal)", async () => {
    stubCatalog(Array.from({ length: 10 }, (_, i) => product(i + 1, { stock: 5, image: "/r2/products/fixture.webp" })));
    const { container } = render(<HomePage />);
    await act(async () => {});

    const imgs = Array.from(container.querySelectorAll('img[alt^="Produk "]'));
    expect(imgs).toHaveLength(8);
    imgs.slice(0, 4).forEach((img) => {
      expect(img.getAttribute("loading")).toBe("eager");
      expect(img.getAttribute("fetchpriority")).toBe("high");
    });
    imgs.slice(4).forEach((img) => {
      expect(img.getAttribute("loading")).toBe("lazy");
    });
  });

  it("kartu ke-9+ memakai content-visibility agar browser melewatkan paint jauh", async () => {
    stubCatalog(Array.from({ length: 10 }, (_, i) => product(i + 1, { stock: 5 })));
    const { container } = render(<HomePage />);
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Produktivitas & Office" }));
    // Pembungkus content-visibility = parent grid > a kartu produk.
    const grid = container.querySelector(".mt-6.grid") as HTMLElement;
    const wrappers = Array.from(grid.children) as HTMLElement[];
    expect(wrappers).toHaveLength(10);
    wrappers.slice(0, 8).forEach((card) => {
      expect(card.style.contentVisibility).toBe("");
    });
    wrappers.slice(8, 10).forEach((card) => {
      expect(card.style.contentVisibility).toBe("auto");
    });
  });
});

describe("Semua dikelompokkan per kategori", () => {
  const categories = [
    { id: 1, slug: "ai-chatbot", name: "AI & Chatbot", sort_order: 20 },
    { id: 2, slug: "desain-video", name: "Desain & Video", sort_order: 10 },
  ];

  it("header mengikuti urutan kategori, habis di ekor grup, eyebrow disembunyikan hanya pada grup", async () => {
    stubCatalog([]);
    const { container } = render(<HomePage initialCategories={categories} initialProducts={[
      product(1, { categorySlug: "ai-chatbot", stock: 0 }),
      product(2, { categorySlug: "desain-video", stock: 0 }),
      product(3, { categorySlug: "ai-chatbot", stock: 5 }),
      product(4, { categorySlug: "desain-video", stock: 5 }),
    ]} />);
    const sections = [...container.querySelectorAll("[data-catalog-category]")];
    expect(sections.map(section => section.getAttribute("data-catalog-category"))).toEqual(["desain-video", "ai-chatbot"]);
    const icons = sections.map(section => section.querySelector<HTMLImageElement>(".catalog-category-icon")!);
    expect(icons.map(icon => icon.getAttribute("src"))).toEqual(["/brand/catalog/category-3d/desain-video.webp", "/brand/catalog/category-3d/ai-chatbot.webp"]);
    expect(icons.map(icon => icon.getAttribute("loading"))).toEqual(["eager", "lazy"]);
    expect(icons.every(icon => icon.alt === "" && icon.width === 40 && icon.getAttribute("decoding") === "async")).toBe(true);
    expect(sections.map(section => [...section.querySelectorAll("h3")].map(node => node.textContent))).toEqual([["Produk 4", "Produk 2"], ["Produk 3", "Produk 1"]]);
    expect(container.querySelector('a[href="/produk/produk-1"] p.uppercase')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "AI & Chatbot" }));
    expect(container.querySelector("[data-catalog-category]")).toBeNull();
    expect(container.querySelector('a[href="/produk/produk-1"] p.uppercase')?.textContent).toBe("AI & Chatbot");
    fireEvent.click(screen.getByRole("button", { name: "Semua" }));
    act(() => useSearch.setState({ q: "Produk 4" }));
    expect(container.querySelector("[data-catalog-category]")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 }).map(node => node.textContent)).toEqual(["Produk 4"]);
  });

  it("maksimal delapan kartu per grup; Tampilkan N lainnya membuka sisa di section yang sama dengan loading", async () => {
    stubCatalog([]);
    const { container } = render(<HomePage initialCategories={categories} initialProducts={Array.from({ length: 12 }, (_, index) => product(index + 1, { categorySlug: "ai-chatbot" }))} />);
    const section = container.querySelector('[data-catalog-category="ai-chatbot"]')!;
    expect(section.querySelectorAll("h3")).toHaveLength(8);
    expect(section.querySelectorAll(".hidden.lg\\:block")).toHaveLength(4);
    expect(screen.queryByText(/\d+ produk • tampil \d+/)).toBeNull();
    expect(section.querySelector("h2")?.nextElementSibling?.textContent).toBe("· 12");
    expect(screen.queryByRole("button", { name: /Tampilkan semua/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Lihat semua/ })).toBeNull();
    const more = screen.getByRole("button", { name: /Tampilkan 8 lainnya.*Tampilkan 4 lainnya.*AI & Chatbot/ });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    vi.useFakeTimers();
    try {
      fireEvent.click(more);
      expect(more.getAttribute("aria-busy")).toBe("true");
      expect(section.querySelectorAll("h3")).toHaveLength(8);
      act(() => { vi.advanceTimersByTime(420); });
    } finally { vi.useRealTimers(); }
    // Tetap di beranda + Semua: section sama kini memuat 12 kartu.
    expect(container.querySelector('[data-catalog-category="ai-chatbot"]')).toBe(section);
    expect(section.querySelectorAll("h3")).toHaveLength(12);
    expect(section.querySelectorAll(".hidden.lg\\:block")).toHaveLength(0);
    expect(section.querySelectorAll(".catalog-card-reveal")).toHaveLength(4);
    expect(section.querySelectorAll(".catalog-card-reveal-mobile")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Semua" }).getAttribute("aria-pressed")).toBe("true");
    const less = screen.getByRole("button", { name: /Tampilkan lebih sedikit/ });
    expect(less.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(less);
    expect(section.querySelectorAll("h3")).toHaveLength(8);
  });

  it("kategori <= 8 produk: tombol hanya untuk mobile", () => {
    stubCatalog([]);
    render(<HomePage initialCategories={categories} initialProducts={Array.from({ length: 6 }, (_, index) => product(index + 1, { categorySlug: "ai-chatbot" }))} />);
    const more = screen.getByRole("button", { name: /Tampilkan 2 lainnya/ });
    expect(more.parentElement!.className).toContain("lg:hidden");
  });

  it("reduced motion membuka langsung tanpa spinner atau timer", () => {
    stubCatalog([]);
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", addEventListener() {}, removeEventListener() {} }));
    const { container } = render(<HomePage initialCategories={categories} initialProducts={Array.from({ length: 12 }, (_, index) => product(index + 1, { categorySlug: "ai-chatbot" }))} />);
    fireEvent.click(screen.getByRole("button", { name: /Tampilkan 8 lainnya/ }));
    expect(container.querySelector('[data-catalog-category="ai-chatbot"]')!.querySelectorAll("h3")).toHaveLength(12);
    expect(screen.getByRole("button", { name: /Tampilkan lebih sedikit/ }).getAttribute("aria-busy")).toBe("false");
  });

  it("menjaga klik selama loading dan membersihkan timer saat beranda dilepas", () => {
    stubCatalog([]);
    const { unmount } = render(<HomePage initialCategories={categories} initialProducts={Array.from({ length: 24 }, (_, index) => product(index + 1, { categorySlug: index < 12 ? "ai-chatbot" : "desain-video" }))} />);
    vi.useFakeTimers();
    try {
      const buttons = screen.getAllByRole("button", { name: /Tampilkan 8 lainnya/ }) as HTMLButtonElement[];
      fireEvent.click(buttons[0]);
      expect(buttons.every(button => button.getAttribute("aria-disabled") === "true" && !button.disabled)).toBe(true);
      expect(buttons.map(button => button.getAttribute("aria-busy"))).toEqual(["true", "false"]);
      fireEvent.click(buttons[1]);
      expect(buttons[1].getAttribute("aria-busy")).toBe("false");
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("tombol visual ramping, target sentuh 44px, tanpa outline cyan menetap", () => {
    stubCatalog([]);
    render(<HomePage initialCategories={categories} initialProducts={Array.from({ length: 12 }, (_, index) => product(index + 1, { categorySlug: "ai-chatbot" }))} />);
    const button = screen.getByRole("button", { name: /Tampilkan 8 lainnya/ });
    const surface = button.firstElementChild!;
    expect(button.className).toContain("min-h-11");
    expect(surface.className).toContain("h-8");
    expect(surface.className).toContain("group-focus-visible:outline-white/60");
    expect(button.className + surface.className).not.toMatch(/outline-\[#00E5FF\]/);
    expect(surface.className).toContain("group-active:border-[#00E5FF]/40");
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
