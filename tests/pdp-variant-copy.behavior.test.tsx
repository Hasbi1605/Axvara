// @vitest-environment jsdom
//
// tests/pdp-variant-copy.behavior.test.tsx — S&K / detail PDP produk multi-varian
// (laporan owner 2026-11-02: deskripsi dan S&K varian bercampur membingungkan).
// Satu state pilihan menentukan harga, keranjang, checkout DAN salinan varian.
// Sebelum memilih tidak boleh ada S&K milik varian pertama.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Product } from "@/lib/products";
import { catalogCopy } from "@/lib/i18n/catalog-copy";
import { resolveVariantCopy } from "@/lib/product-copy/resolve";
import { useCart } from "@/stores/cart";
import { ProductCard } from "@/components/storefront/ProductCard";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "head-premium" }),
  usePathname: () => "/produk/head-premium",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import ProductDetailClient from "@/app/(shop)/produk/[slug]/product-detail-client";

const DESCRIPTION = [
  "Akun premium dengan beberapa pilihan masa aktif.",
  "",
  "Pilihan varian:",
  "- 3 Bulan: akun bersama",
  "- 18 Bulan: akun private",
  "",
  "Syarat & Ketentuan:",
  "- Dilarang membagikan akun ke pihak lain",
].join("\n");

const product = {
  id: "7", slug: "head-premium", name: "Head Premium", description: DESCRIPTION, price: 30_000,
  categorySlug: "tools-pro", image: "/brand/axvara-mark.svg", images: [], stock: 9, variantCount: 3,
} as unknown as Product;

const TERMS_3 = "Masa aktif tiga bulan khusus paket reguler";
const TERMS_18 = "Masa aktif delapan belas bulan khusus paket panjang";

function variant(id: number, label: string, price: number, copy: unknown) {
  return {
    id, label, price, compare_price: null, stock: 5, min_qty: 1, is_active: 1, warranty_type: "none",
    fulfillment_mode: "manual", wr_variant_id: `wr-${id}`, wr_delivery_class: "restock", copy,
  };
}

const variants = [
  variant(41, "3 Bulan", 50_000, resolveVariantCopy(TERMS_3, "Login lewat website paket reguler")),
  variant(42, "18 Bulan", 150_000, resolveVariantCopy(TERMS_18, "Login lewat website paket panjang")),
  variant(43, "Tanpa Salinan", 70_000, null),
];

function renderPdp(list: unknown[] = variants, description: string = DESCRIPTION) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ products: [] }) })));
  const catalog = { slug: "head-premium", product: { id: 7, slug: "head-premium", name: "Head Premium", variants: list }, variantsEnabled: true };
  render(<ProductDetailClient slug="head-premium" initialProducts={[{ ...product, description } as Product]} initialCatalog={catalog as never} />);
}

const norm = (text: string | null | undefined) => String(text ?? "").replace(/\s/g, " ");
const body = () => document.body.textContent ?? "";
const details = () => screen.getByTestId("pdp-variant-details");
const mobileCopy = () => screen.getByTestId("pdp-mobile-copy");
const identity = (root: HTMLElement) => within(root).getByTestId("pdp-variant-identity");
// Picker inline desktop: tombol varian di kartu info (bukan di dialog).
const pickerButton = (label: string) =>
  screen.getAllByRole("button").find((b) => b.textContent?.startsWith(label) && !b.closest("[role=dialog]") && b.className.includes("rounded-xl border"))!;

beforeEach(() => { localStorage.clear(); useCart.setState({ items: [] }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("PDP multi-varian: S&K mengikuti satu pilihan", () => {
  it("Jaspay tetap antrean otomatis di PDP dan modal, tanpa klaim proses manual atau stok instan", async () => {
    renderPdp([{ ...variants[0], wr_variant_id: "jaspay:fixture:monthly", wr_delivery_class: "made_by_order" }, variants[1]]);
    expect(screen.getByText("Cara pengiriman mengikuti varian yang dipilih.")).toBeTruthy();
    fireEvent.click(within(details()).getByRole("button", { name: "Pilih varian" }));
    const radio = within(screen.getByRole("dialog")).getByRole("radio", { name: /^3 Bulan/ });
    expect(radio.textContent).toContain("Diproses otomatis");
    expect(radio.textContent).not.toContain("Made By Order");
    fireEvent.click(radio);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const eta = screen.getByText("Made by order — dibuat otomatis oleh bot setelah pembayaran. Estimasi 15 menit–1 jam.");
    expect(eta.parentElement?.textContent).toContain("Diproses otomatis");
    expect(eta.parentElement?.textContent).not.toMatch(/disiapkan admin|Kirim otomatis|12 jam/);
  });

  it("S1 belum memilih: placeholder + tombol pilih; bila ada ketentuan produk tampil di bawah chip 'Berlaku untuk semua varian' tanpa judul Ketentuan produk", () => {
    renderPdp();
    for (const root of [details(), mobileCopy()]) {
      expect(identity(root).textContent).toContain("Belum ada varian dipilih");
      const choose = within(root).getByRole("button", { name: "Pilih varian" });
      expect(choose.className).toContain("min-h-[44px]");
      expect(choose.className).toContain("focus-visible:outline-[#00E5FF]");
    }
    expect(body()).not.toContain(TERMS_3);
    expect(body()).not.toContain(TERMS_18);
    expect(body()).not.toContain("Login lewat website");
    expect(within(details()).queryByText("Ketentuan produk")).toBeNull();
    expect(within(mobileCopy()).queryByText("Ketentuan produk")).toBeNull();
    expect(body()).not.toContain("Cara aktivasi produk");
    // Desktop: chip + ketentuan tingkat produk tampil di satu kartu.
    expect(within(details()).getByText("Berlaku untuk semua varian")).toBeTruthy();
    expect(details().textContent).toContain("Dilarang membagikan akun ke pihak lain");
    // Mobile: satu panel S&K ber-meta "Berlaku untuk semua varian" sebelum memilih.
    const mobileToggles = within(mobileCopy()).getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    expect(mobileToggles).toHaveLength(1);
    expect(mobileToggles[0].textContent).toContain("Syarat & Ketentuan");
    expect(mobileToggles[0].textContent).toContain("Berlaku untuk semua varian");
    // Harga tidak diam-diam milik varian pertama.
    expect(norm(screen.getByText("Rp 30.000", { selector: "span" }).textContent)).toBe("Rp 30.000");
    expect(useCart.getState().items).toHaveLength(0);
  });

  it("S1 belum memilih tanpa S&K/aktivasi produk: hanya ajakan pilih varian tanpa panel lipat mobile", () => {
    renderPdp(variants, "Akun premium tanpa ketentuan di deskripsi.");
    expect(within(details()).queryByText("Berlaku untuk semua varian")).toBeNull();
    expect(within(details()).queryByTestId("product-terms-body")).toBeNull();
    expect(within(mobileCopy()).queryByRole("button", { name: /^Syarat & Ketentuan/ })).toBeNull();
    expect(within(mobileCopy()).queryByRole("button", { name: /^Cara Aktivasi/ })).toBeNull();
  });

  it("S2 pilih 3 Bulan: salinan varian + ketentuan produk digabung dalam satu S&K dan satu Cara Aktivasi; ganti 18 Bulan memperbarui semuanya", async () => {
    renderPdp();
    fireEvent.click(pickerButton("3 Bulan"));
    expect(identity(details()).textContent).toContain("3 Bulan");
    expect(within(details()).queryByText("Berlaku untuk semua varian")).toBeNull();
    expect(within(details()).queryByText("Ketentuan produk")).toBeNull();
    expect(within(details()).queryByText("Cara aktivasi produk")).toBeNull();
    // Satu TermsBody memuat salinan varian + ketentuan produk; satu kotak Cara Aktivasi.
    expect(within(details()).getAllByTestId("product-terms-body")).toHaveLength(1);
    expect(details().textContent).toContain(TERMS_3);
    expect(details().textContent).toContain("Dilarang membagikan akun ke pihak lain");
    expect(within(details()).getAllByTestId("product-activation-body")).toHaveLength(1);
    expect(within(details()).getByRole("heading", { level: 3, name: "Cara Aktivasi" })).toBeTruthy();
    expect(body()).not.toContain(TERMS_18);
    // Mobile: maksimal dua panel lipat dengan judul tunggal.
    const mobileToggles = within(mobileCopy()).getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    expect(mobileToggles.map((b) => b.textContent)).toEqual([
      expect.stringContaining("Syarat & Ketentuan · 3 Bulan"),
      expect.stringContaining("Cara Aktivasi · 1 langkah"),
    ]);
    // Harga besar di kartu info + CTA mobile memakai varian yang sama.
    expect(norm(screen.getAllByText(/Rp 50\.000/).map((n) => n.textContent).join("|"))).toContain("Rp 50.000");
    fireEvent.click(screen.getByRole("button", { name: /Tambah ke Keranjang/ }));
    expect(useCart.getState().items.map((i) => [i.variantId, i.price])).toEqual([[41, 50_000]]);

    fireEvent.click(pickerButton("18 Bulan"));
    expect(identity(details()).textContent).toContain("18 Bulan");
    expect(details().textContent).toContain(TERMS_18);
    expect(details().textContent).toContain("Dilarang membagikan akun ke pihak lain");
    expect(body()).not.toContain(TERMS_3);
    fireEvent.click(screen.getByRole("button", { name: /Tambah ke Keranjang/ }));
    expect(useCart.getState().items.map((i) => i.variantId).sort()).toEqual([41, 42]);

    fireEvent.click(pickerButton("3 Bulan"));
    expect(details().textContent).toContain(TERMS_3);
    expect(body()).not.toContain(TERMS_18);
  });

  it("S2 varian tanpa salinan sendiri saat produk punya ketentuan/aktivasi: tanpa pesan belum tersedia, tampilkan chip 'Berlaku untuk semua varian'", () => {
    const descWithActivation = [
      DESCRIPTION,
      "",
      "Cara Aktivasi:",
      "1. Buka website resmi",
      "2. Masuk dengan email pesanan",
    ].join("\n");
    renderPdp(variants, descWithActivation);
    fireEvent.click(pickerButton("Tanpa Salinan"));
    expect(identity(details()).textContent).toContain("Tanpa Salinan");
    expect(details().textContent).not.toContain("khusus varian ini belum tersedia");
    expect(mobileCopy().textContent).not.toContain("khusus varian ini belum tersedia");
    expect(within(details()).queryByText("Ketentuan produk")).toBeNull();
    expect(within(mobileCopy()).queryByText("Ketentuan produk")).toBeNull();
    expect(body()).not.toContain("Cara aktivasi produk");
    expect(body()).not.toContain(TERMS_3);
    expect(body()).not.toContain(TERMS_18);
    expect(within(details()).getByText("Berlaku untuk semua varian")).toBeTruthy();
    expect(details().textContent).toContain("Dilarang membagikan akun ke pihak lain");
    expect(within(details()).getByRole("heading", { level: 3, name: "Cara Aktivasi" })).toBeTruthy();
    expect(details().textContent).toContain("Buka website resmi");
    const mobileToggles = within(mobileCopy()).getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    expect(mobileToggles).toHaveLength(2);
    expect(mobileToggles[0].textContent).toContain("Syarat & Ketentuan · Berlaku untuk semua varian");
    expect(mobileToggles[1].textContent).toContain("Cara Aktivasi · 2 langkah");
  });

  it("S3 tanpa salinan varian dan tanpa ketentuan produk: tampilkan pesan belum tersedia saja", () => {
    renderPdp(variants, "Akun premium tanpa ketentuan di deskripsi.");
    fireEvent.click(pickerButton("Tanpa Salinan"));
    expect(identity(details()).textContent).toContain("Tanpa Salinan");
    expect(details().textContent).toContain("khusus varian ini belum tersedia");
    expect(mobileCopy().textContent).toContain("khusus varian ini belum tersedia");
    expect(within(details()).queryByText("Berlaku untuk semua varian")).toBeNull();
    expect(within(mobileCopy()).queryByRole("button", { name: /^Syarat & Ketentuan/ })).toBeNull();
  });

  it("kamus ID/EN menyediakan appliesAllVariants dan tidak lagi memakai termsProduct/activationProduct", () => {
    expect(catalogCopy("id").appliesAllVariants).toBe("Berlaku untuk semua varian");
    expect(catalogCopy("en").appliesAllVariants).toBe("Applies to all variants");
    expect("termsProduct" in catalogCopy("id")).toBe(false);
    expect("activationProduct" in catalogCopy("id")).toBe(false);
  });

  it("deskripsi umum diberi label; bagian Pilihan varian menjadi Perbandingan varian", () => {
    renderPdp();
    const general = screen.getAllByRole("heading", { level: 2, name: "Deskripsi umum" }).find((h) => h.closest(".lg\\:block"))!;
    expect(general).toBeTruthy();
    // Desktop: deskripsi umum dulu, lalu Syarat & Ketentuan varian.
    expect(general.compareDocumentPosition(details()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText("Perbandingan varian").length).toBeGreaterThan(0);
    expect(screen.queryByText("Pilihan varian:")).toBeNull();
    expect(screen.queryByText("Pilihan varian")).toBeNull();
    // Teks bandingan tetap utuh, bukan dipotong.
    expect(body()).toContain("3 Bulan: akun bersama");
    expect(body()).toContain("18 Bulan: akun private");
  });

  it("mobile: deskripsi umum tampil sebelum detail varian; panel yang terbuka tetap terbuka saat varian diganti", () => {
    renderPdp();
    const description = screen.getAllByText("Deskripsi umum").find((n) => n.closest(".lg\\:hidden"))!;
    expect(description.compareDocumentPosition(mobileCopy()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(pickerButton("3 Bulan"));
    const toggle = () => within(mobileCopy()).getByRole("button", { name: /^Syarat & Ketentuan/ });
    expect(toggle().textContent).toContain("3 Bulan");
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(pickerButton("18 Bulan"));
    expect(toggle().textContent).toContain("18 Bulan");
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(within(mobileCopy()).getByRole("region", { name: /Syarat & Ketentuan/ }).textContent).toContain(TERMS_18);
    // Berpindah ke varian tanpa salinan sendiri tetap menjaga panel S&K terbuka.
    fireEvent.click(pickerButton("Tanpa Salinan"));
    expect(toggle().textContent).toContain("Berlaku untuk semua varian");
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(within(mobileCopy()).getByRole("region", { name: /Syarat & Ketentuan/ }).textContent).toContain("Dilarang membagikan akun ke pihak lain");
  });

  it("identitas varian berupa wilayah aria-live polite yang hanya memuat nama varian lengkap", () => {
    renderPdp();
    fireEvent.click(pickerButton("18 Bulan"));
    const live = identity(details()).querySelector("[aria-live=polite]")!;
    expect(live).toBeTruthy();
    expect(live.textContent).not.toContain(TERMS_18);
    expect(live.textContent).toContain("18 Bulan");
  });

  it("tombol pilih/ganti membuka panel yang sama; radio di panel menyinkronkan identitas, harga dan S&K", async () => {
    renderPdp();
    fireEvent.click(within(details()).getByRole("button", { name: "Pilih varian" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
    fireEvent.click(within(dialog).getByRole("radio", { name: /^18 Bulan/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(identity(details()).textContent).toContain("18 Bulan");
    expect(identity(mobileCopy()).textContent).toContain("18 Bulan");
    expect(details().textContent).toContain(TERMS_18);
    expect(within(details()).getByRole("button", { name: "Ganti varian" })).toBeTruthy();
  });

  it("salinan identik di semua varian berlaku umum: tampil tanpa memilih dan tanpa tombol ganti", () => {
    const same = resolveVariantCopy("Garansi tujuh hari penuh", "Login di website resmi");
    renderPdp([variant(51, "1 Bulan", 20_000, same), variant(52, "3 Bulan", 50_000, same)]);
    expect(identity(details()).textContent).toContain("Semua varian");
    expect(details().textContent).toContain("Garansi tujuh hari penuh");
    expect(within(details()).queryByRole("button", { name: /Pilih varian|Ganti varian/ })).toBeNull();
  });

  it("produk varian tunggal / legacy tetap menampilkan salinan tanpa memilih", () => {
    renderPdp([variant(61, "1 Bulan", 20_000, resolveVariantCopy("Garansi tujuh hari penuh", null))]);
    expect(screen.queryByTestId("pdp-variant-details")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: /Syarat & Ketentuan/ }).textContent).toContain("1 Bulan");
    expect(body()).toContain("Garansi tujuh hari penuh");
    expect(screen.getAllByRole("heading", { level: 2, name: "Deskripsi Produk" })).toHaveLength(2);
  });
});

describe("kartu Produk Serupa (compact) di desktop", () => {
  it("memperbesar teks hanya dari sm ke atas; ukuran mobile 156px tidak berubah", () => {
    const { container } = render(<ProductCard product={{ ...product, soldCount: 3, comparePrice: 40_000 } as Product} compact />);
    const link = container.querySelector("a")!;
    const html = link.innerHTML;
    expect(link.querySelector("p.uppercase")!.className).toMatch(/text-\[9px\].*sm:text-\[11px\]/);
    const title = link.querySelector("h3")!;
    expect(title.className).toContain("text-[11.5px]");
    expect(title.className).toContain("sm:text-[15px]");
    expect(title.className).toContain("min-h-[30px]");
    expect(title.className).toContain("sm:min-h-[40px]");
    expect(Array.from(link.querySelectorAll("span")).find((n) => n.textContent?.startsWith("Rp"))!.className).toMatch(/text-\[13px\].*sm:text-\[17px\]/);
    expect(html).toContain("sm:text-xs");
    expect(link.querySelector("div.px-2\\.5")!.className).toContain("sm:px-3.5");
  });

  it("wadah kartu Serupa 156px di mobile dan 260px (bukan 300px) dari sm", () => {
    const source = readFileSync("src/app/(shop)/produk/[slug]/product-detail-client.tsx", "utf8");
    expect(source.match(/w-\[156px\] sm:w-\[260px\]/g)).toHaveLength(2);
    expect(source).not.toContain("sm:w-[300px]");
  });
});
