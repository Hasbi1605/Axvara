// @vitest-environment jsdom
//
// tests/quick-variant-modal.behavior.test.tsx — Modal ini sebelumnya dikirim
// tanpa role dialog, tanpa Escape, tanpa focus trap, dan tanpa aria-label pada
// tombol tutup, dan tidak ada test yang bisa memerah karena `.tsx` tidak
// termasuk pola include vitest. Test ini menjaga kontrak a11y DAN alur
// pemilihan varian (harga ikut varian, stok habis tidak bisa dipilih,
// tujuan checkout benar).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QuickVariantModal } from "@/components/storefront/QuickVariantModal";
import { useCart } from "@/stores/cart";
import { DisplayPreferencesProvider } from "@/hooks/useDisplayPrices";
import type { Product } from "@/lib/products";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/",
}));

const product = {
  id: "prod-1",
  name: "Netflix Premium",
  slug: "netflix-premium",
  price: 25_000,
  minPrice: 25_000,
  category: "streaming",
  stock: 10,
  isActive: true,
  image: "/brand/axvara-mark.svg",
} as unknown as Product;

const variants = [
  { id: 11, label: "1 Bulan", price: 25_000, compare_price: 30_000, stock: 5, is_active: 1, warranty_type: "days", warranty_days: 7 },
  { id: 12, label: "3 Bulan", price: 65_000, compare_price: null, stock: 3, is_active: 1, warranty_type: "none" },
  { id: 13, label: "Habis", price: 99_000, compare_price: null, stock: 0, is_active: 1, warranty_type: "none" },
];

function mockCatalog(payload: unknown = { product: { variants } }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  });
}

beforeEach(() => {
  push.mockClear();
  useCart.setState({ items: [], drawerOpen: false });
  vi.stubGlobal("fetch", mockCatalog());
});

afterEach(() => {
  cleanup();
  document.cookie = "axv_locale=; Max-Age=0; Path=/";
  vi.unstubAllGlobals();
});

async function renderModal(mode: "cart" | "checkout" = "cart", onClose = vi.fn()) {
  render(<QuickVariantModal product={product} mode={mode} onClose={onClose} />);
  await waitFor(() => expect(screen.getByRole("radio", { name: /1 Bulan/ })).toBeTruthy());
  return { onClose };
}

describe("QuickVariantModal — kontrak aksesibilitas", () => {
  it("dirender sebagai dialog modal dengan judul terhubung", async () => {
    await renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("quick-variant-title");
    expect(document.getElementById("quick-variant-title")?.textContent).toContain("Netflix Premium");
  });

  it("Escape menutup modal", async () => {
    const { onClose } = await renderModal();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("tombol tutup punya nama aksesibel, bukan ikon tanpa label", async () => {
    await renderModal();
    expect(screen.getByRole("button", { name: "Tutup pilihan varian" })).toBeTruthy();
  });

  it("mengunci scroll body selama modal terbuka", async () => {
    await renderModal();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("daftar varian memakai semantik radiogroup dan melipat varian habis secara default tertutup saat ada varian tersedia", async () => {
    await renderModal();
    const group = screen.getByRole("radiogroup", { name: "Pilih paket atau varian" });
    expect(group).toBeTruthy();
    // Hanya 2 varian tersedia (1 Bulan, 3 Bulan) yang tampil sebagai radio; varian Habis dilipat di <details>.
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.queryByRole("radio", { name: /stok habis/ })).toBeNull();
    const disclosure = screen.getByTestId("soldout-variants-disclosure") as HTMLDetailsElement;
    expect(disclosure.open).toBe(false);
    expect(disclosure.textContent).toContain("Lihat 1 paket sedang habis");
    expect(disclosure.textContent).toContain("Habis");
    expect(disclosure.textContent).toContain("99.000");
  });

  it("varian terpilih ditandai aria-checked, bukan hanya warna", async () => {
    await renderModal();
    const first = screen.getByRole("radio", { name: /1 Bulan/ });
    expect(first.getAttribute("aria-checked")).toBe("true");
    const second = screen.getByRole("radio", { name: /3 Bulan/ });
    fireEvent.click(second);
    expect(second.getAttribute("aria-checked")).toBe("true");
    expect(first.getAttribute("aria-checked")).toBe("false");
  });

  it("ketika semua varian habis, varian habis tetap tampil disabled tanpa lipatan ganda", async () => {
    vi.stubGlobal("fetch", mockCatalog({
      product: { variants: [{ id: 13, label: "Habis", price: 99_000, compare_price: null, stock: 0, is_active: 1, warranty_type: "none" }] },
    }));
    render(<QuickVariantModal product={product} mode="cart" onClose={vi.fn()} />);
    const sold = await screen.findByRole("radio", { name: /stok habis/ });
    expect((sold as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("soldout-variants-disclosure")).toBeNull();
  });
});

describe("QuickVariantModal — alur pemilihan varian", () => {
  it("memilih varian default pertama yang masih ada stok", async () => {
    await renderModal();
    expect(screen.getByRole("radio", { name: /1 Bulan/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("harga tombol aksi mengikuti varian yang dipilih", async () => {
    await renderModal("cart");
    fireEvent.click(screen.getByRole("radio", { name: /3 Bulan/ }));
    expect(screen.getByRole("button", { name: /Tambah ke Keranjang/ }).textContent).toContain("65.000");
  });

  it("mode cart menambahkan varian terpilih ke store lalu menutup modal setelah konfirmasi baca", async () => {
    const { onClose } = await renderModal("cart");
    fireEvent.click(screen.getByRole("radio", { name: /3 Bulan/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /sudah membaca/i }));
    fireEvent.click(screen.getByRole("button", { name: /Tambah ke Keranjang/ }));
    const { items } = useCart.getState();
    expect(items).toHaveLength(1);
    expect(items[0].variantId).toBe(12);
    expect(items[0].price).toBe(65_000);
    expect(onClose).toHaveBeenCalled();
  });

  it("mode checkout mengarahkan ke checkout dengan slug + variant + qty stepper setelah konfirmasi baca", async () => {
    await renderModal("checkout");
    fireEvent.click(screen.getByRole("radio", { name: /3 Bulan/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /sudah membaca/i }));
    fireEvent.click(screen.getByRole("button", { name: /Beli Sekarang/ }));
    // Qty default = min (1 untuk varian biasa) — dibawa eksplisit agar Beli
    // Langsung varian min>1 tidak dead-end di quote.
    expect(push).toHaveBeenCalledWith("/checkout?buy=netflix-premium&variant=12&qty=1");
  });

  it("stepper modal dibuka di minimum dan floor di min (varian min-besar)", async () => {
    vi.stubGlobal("fetch", mockCatalog({
      product: { variants: [{ id: 21, label: "GSuite", price: 10_000, stock: -1, is_active: 1, warranty_type: "none", min_qty: 50 }] },
    }));
    render(<QuickVariantModal product={product} mode="cart" onClose={vi.fn()} />);
    // Angka kini di dalam input ketik (bukan teks) — dibuka di min 50.
    await waitFor(() => expect((screen.getByRole("textbox", { name: /Jumlah pembelian/ }) as HTMLInputElement).value).toBe("50"));
    expect(screen.getByText(/Min\. pembelian 50/)).toBeTruthy();
    // Tombol kurang disabled di floor min.
    const dec = screen.getByRole("button", { name: "Kurangi jumlah" }) as HTMLButtonElement;
    expect(dec.disabled).toBe(true);
    // Stepper visual 36px dengan area tap vertikal 44px (pseudo-elemen).
    for (const stepper of [dec, screen.getByRole("button", { name: "Tambah jumlah" })]) {
      expect(stepper.className).toContain("h-9");
      expect(stepper.className).toContain("w-9");
      expect(stepper.className).toContain("before:-inset-y-1");
      expect(stepper.className).not.toContain("h-11");
    }
    // Harga aksi = total (50 × 10.000).
    expect(screen.getByRole("button", { name: /Tambah ke Keranjang/ }).textContent).toContain("500.000");
  });

  it("tombol + menaikkan qty dan ketik manual di-clamp ke [min, max]", async () => {
    vi.stubGlobal("fetch", mockCatalog({
      product: { variants: [{ id: 21, label: "GSuite", price: 10_000, stock: -1, is_active: 1, warranty_type: "none", min_qty: 50 }] },
    }));
    const onClose = vi.fn();
    render(<QuickVariantModal product={product} mode="cart" onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Tambah jumlah" })).toBeTruthy());
    // + : 50 → 51, total ikut berubah.
    fireEvent.click(screen.getByRole("button", { name: "Tambah jumlah" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Tambah ke Keranjang/ }).textContent).toContain("510.000"));
    // Ketik 75 → commit blur → total 750.000.
    const input = screen.getByRole("textbox", { name: /Jumlah pembelian/ }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "75" } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByRole("button", { name: /Tambah ke Keranjang/ }).textContent).toContain("750.000"));
    // Ketik 5 (di bawah min) → commit blur → kembali ke 50.
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByRole("button", { name: /Tambah ke Keranjang/ }).textContent).toContain("500.000"));
    // Confirm memakai qty ter-commit (50) → centang baca → add + tutup.
    fireEvent.click(screen.getByRole("checkbox", { name: /sudah membaca/i }));
    fireEvent.click(screen.getByRole("button", { name: /Tambah ke Keranjang/ }));
    const { useCart } = await import("@/stores/cart");
    expect(useCart.getState().items[0]?.qty).toBe(50);
    expect(onClose).toHaveBeenCalled();
  });

  it("varian nonaktif disaring dari daftar", async () => {
    vi.stubGlobal("fetch", mockCatalog({
      product: { variants: [...variants, { id: 99, label: "Arsip", price: 1_000, stock: 5, is_active: 0, warranty_type: "none" }] },
    }));
    render(<QuickVariantModal product={product} mode="cart" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("radio")).toHaveLength(2));
    expect(screen.queryByRole("radio", { name: /Arsip/ })).toBeNull();
  });

  it.each([["id", /stok di bawah minimum/, "Stok < min"], ["en", /stock below minimum/, "Stock < min"]] as const)("varian stok di bawah min disembunyikan saat ada varian normal, dan tetap disabled saat semua di bawah min (%s)", async (locale, aria, notice) => {
    // Temuan review: stok 3/min 50 — qty berapa pun pasti gagal di quote.
    // Saat ada varian normal, varian < min disembunyikan otomatis.
    vi.stubGlobal("fetch", mockCatalog({
      product: { variants: [
        { id: 31, label: "Kecil", price: 10_000, stock: 3, is_active: 1, warranty_type: "none", min_qty: 50 },
        { id: 32, label: "Normal", price: 20_000, stock: 10, is_active: 1, warranty_type: "none", min_qty: 1 },
      ] },
    }));
    document.cookie = `axv_locale=${locale}; Path=/`;
    const firstRender = render(<DisplayPreferencesProvider><QuickVariantModal product={product} mode="cart" onClose={vi.fn()} /></DisplayPreferencesProvider>);
    await waitFor(() => expect(screen.getByRole("radio", { name: /Normal/ })).toBeTruthy());
    expect(screen.queryByRole("radio", { name: /Kecil/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /Normal/ }).getAttribute("aria-checked")).toBe("true");
    const disclosure = screen.getByTestId("soldout-variants-disclosure") as HTMLDetailsElement;
    expect(disclosure.open).toBe(false);
    expect(disclosure.textContent).toContain(locale === "en" ? "Show 1 out-of-stock plan" : "Lihat 1 paket sedang habis");
    expect(disclosure.textContent).toContain(notice);
    firstRender.unmount();

    // Bila hanya ada varian di bawah min, tetap tampil disabled + aksesibel tanpa lipatan.
    vi.stubGlobal("fetch", mockCatalog({
      product: { variants: [
        { id: 31, label: "Kecil", price: 10_000, stock: 3, is_active: 1, warranty_type: "none", min_qty: 50 },
      ] },
    }));
    render(<DisplayPreferencesProvider><QuickVariantModal product={product} mode="cart" onClose={vi.fn()} /></DisplayPreferencesProvider>);
    const kecil = await screen.findByRole("radio", { name: /Kecil/ }) as HTMLButtonElement;
    expect(kecil.disabled).toBe(true);
    await waitFor(() => expect(kecil.getAttribute("aria-label")).toMatch(aria));
    expect(screen.getByText(notice)).toBeTruthy();
    expect(screen.queryByTestId("soldout-variants-disclosure")).toBeNull();
  });

  it("kegagalan fetch varian menampilkan pesan error, bukan modal kosong senyap", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    render(<QuickVariantModal product={product} mode="cart" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Gagal mengambil varian/)).toBeTruthy());
  });

  it("panel desktop dilebarkan ke 2 kolom untuk cart/checkout (mobile tetap bottom-sheet 480px)", async () => {
    await renderModal("checkout");
    const dialog = screen.getByRole("dialog");
    const panel = dialog.firstElementChild as HTMLElement | null;
    expect(panel).toBeTruthy();
    const classes = panel?.getAttribute("class") ?? "";
    expect(classes).toContain("max-w-[480px]");
    expect(classes).toContain("sm:max-w-[620px]");
    expect(classes).toContain("lg:max-w-[920px]");
    const group = screen.getByRole("radiogroup", { name: "Pilih paket atau varian" });
    const groupClasses = group.getAttribute("class") ?? "";
    expect(groupClasses).toContain("sm:grid-cols-2");
    expect(groupClasses).toContain("sm:max-h-[340px]");
  });

  it("wajib centang konfirmasi baca sebelum Beli Sekarang / Tambah ke Keranjang", async () => {
    const { onClose } = await renderModal("checkout");
    fireEvent.click(screen.getByRole("button", { name: /Beli Sekarang/ }));
    expect(push).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Centang konfirmasi");
    const checkbox = screen.getByRole("checkbox", { name: /sudah membaca/i });
    expect(document.activeElement).toBe(checkbox);
    fireEvent.click(checkbox);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Beli Sekarang/ }));
    expect(push).toHaveBeenCalledWith("/checkout?buy=netflix-premium&variant=11&qty=1");
  });

  it("menampilkan deskripsi, aturan pakai (tanpa duplikasi), S&K, cara aktivasi, dan me-reset centang saat S&K varian berubah", async () => {
    const richProduct = {
      ...product,
      name: "Google AI / Gemini Pro 12 Bulan",
      slug: "gemini-sb",
      description: "Aktivasi Google AI Pro langsung ke akun Google sendiri.\n- Akses Gemini Pro & Google One",
    } as unknown as Product;
    const richVariants = [
      {
        id: 51,
        label: "CDK AI Pro 12 Bulan",
        price: 29_200,
        stock: 48,
        is_active: 1,
        warranty_type: "none",
        copy: {
          source: "admin",
          sections: [
            { kind: "paket", items: ["Kunci aktivasi CDK Student 12 bulan."] },
            { kind: "aturan", items: ["Wajib VPN USA selama aktivasi.", "Wajib kartu kredit/debit valid."] },
            { kind: "garansi", items: ["Tidak ada garansi bila kartu ditolak."] },
          ],
          activation: [{ title: null, steps: ["Sambungkan VPN USA lalu buka axvara.tech/go/gemini-students.", "Tempel CDK di axvara.tech/go/gemini-cdk-verify."] }],
          notes: ["Video tutorial: axvara.tech/go/tutor-gemini-cdk"],
        },
      },
      {
        id: 52,
        label: "Link Redeem 6 Bulan",
        price: 19_000,
        stock: 10,
        is_active: 1,
        warranty_type: "none",
        copy: {
          source: "admin",
          sections: [
            { kind: "paket", items: ["Link redeem 6 bulan tanpa kartu."] },
            { kind: "aturan", items: ["Wajib di-redeem dalam 12 jam."] },
          ],
          activation: [{ title: null, steps: ["Buka link redeem di browser."] }],
          notes: [],
        },
      },
    ];
    vi.stubGlobal("fetch", mockCatalog({ product: { description: richProduct.description, variants: richVariants } }));
    render(<QuickVariantModal product={richProduct} mode="checkout" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: /CDK AI Pro 12 Bulan/ })).toBeTruthy());

    const copyPanel = screen.getByTestId("quick-modal-copy");
    expect(copyPanel.textContent).toContain("Wajib VPN USA selama aktivasi.");
    expect(copyPanel.textContent).toContain("Aktivasi Google AI Pro langsung ke akun Google sendiri.");
    expect(copyPanel.textContent).toContain("Kunci aktivasi CDK Student 12 bulan.");
    expect(copyPanel.textContent).toContain("Tidak ada garansi bila kartu ditolak.");
    expect(copyPanel.textContent).toContain("Cara Aktivasi");
    // Aturan pakai tampil 1x di blok highlight atas, bukan dobel di TermsBody.
    expect(copyPanel.textContent?.match(/Wajib VPN USA selama aktivasi\./g)).toHaveLength(1);
    const links = Array.from(copyPanel.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toContain("/go/gemini-students");
    expect(links).toContain("/go/gemini-cdk-verify");

    const checkbox = screen.getByRole("checkbox", { name: /sudah membaca/i }) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    // Ganti ke varian dengan S&K berbeda → isi panel berganti & centang di-reset.
    fireEvent.click(screen.getByRole("radio", { name: /Link Redeem 6 Bulan/ }));
    expect(copyPanel.textContent).toContain("Wajib di-redeem dalam 12 jam.");
    expect(copyPanel.textContent).not.toContain("Wajib VPN USA selama aktivasi.");
    expect(checkbox.checked).toBe(false);
  });

  it("alur 2 langkah mobile: Lanjut → baca ketentuan → Ubah kembali ke pilihan paket", async () => {
    await renderModal("checkout");
    const nextBtn = screen.getByRole("button", { name: /Lanjut · Rp\s+25\.000/ });
    fireEvent.click(nextBtn);
    expect(screen.queryByRole("button", { name: /Lanjut ·/ })).toBeNull();
    const backBtn = screen.getByRole("button", { name: /Ubah/ });
    fireEvent.click(backBtn);
    expect(screen.getByRole("button", { name: /Lanjut · Rp\s+25\.000/ })).toBeTruthy();
  });

  it("locale EN memakai descriptionEn, copy_en, dan label bahasa Inggris", async () => {
    const enProduct = {
      ...product,
      name: "Google AI Pro",
      nameEn: "Google AI Pro",
      description: "Deskripsi ID",
      descriptionEn: "English product overview.",
    } as unknown as Product;
    vi.stubGlobal("fetch", mockCatalog({
      product: {
        description: "Deskripsi ID",
        descriptionEn: "English product overview.",
        variants: [{
          id: 61,
          label: "12 Bulan",
          price: 29_200,
          stock: 10,
          is_active: 1,
          warranty_type: "none",
          copy: { source: "admin", sections: [{ kind: "aturan", items: ["Aturan ID"] }], activation: [], notes: [] },
          copy_en: { source: "admin", sections: [{ kind: "aturan", items: ["USA VPN required."] }], activation: [{ title: null, steps: ["Open link."] }], notes: [] },
        }],
      },
    }));
    document.cookie = "axv_locale=en; Path=/";
    render(<DisplayPreferencesProvider><QuickVariantModal product={enProduct} mode="checkout" onClose={vi.fn()} /></DisplayPreferencesProvider>);
    await waitFor(() => expect(screen.getByTestId("quick-modal-copy").textContent).toContain("USA VPN required."));
    expect(screen.getByTestId("quick-modal-copy").textContent).toContain("English product overview.");
    expect(screen.getByRole("checkbox", { name: /I have read the description/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Continue ·/ })).toBeTruthy();
  });
});
