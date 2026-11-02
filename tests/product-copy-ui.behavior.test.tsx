// @vitest-environment jsdom
//
// tests/product-copy-ui.behavior.test.tsx — PDP menampilkan salinan Axvara
// dalam satu format untuk produk WR maupun non-WR, dan S&K + cara aktivasi
// TERLIPAT di mobile (permintaan owner 2026-09-24). Data varian memakai hasil
// resolver sungguhan dari snapshot teks WR produksi.
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import snapshot from "./fixtures/product-copy-snapshot.json";
import { resolveVariantCopy } from "@/lib/product-copy/resolve";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "fixture" }),
  usePathname: () => "/produk/fixture",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import ProductDetailClient from "@/app/(shop)/produk/[slug]/product-detail-client";

const pair = (prefix: string) => snapshot.pairs.find((p) => p.variants.some((v) => v.startsWith(prefix)))!;

const NETFLIX_DESC = [
  "Netflix Premium adalah paket tertinggi dari layanan streaming paling populer di dunia, cocok untuk hiburan pribadi maupun keluarga.",
  "",
  "- Ribuan film, serial, dokumenter, dan tayangan original eksklusif",
  "- Kualitas tayangan terbaik",
].join("\n");

const GSUITE_DESC = [
  "Akun GSuite siap pakai dengan pilihan durasi fleksibel.",
  "",
  "- Akun siap digunakan dengan aktivasi cepat",
  "",
  "Syarat & Ketentuan:",
  "- Masa aktif dimulai sejak akun diberikan atau diaktifkan",
  "- Full garansi selama masa aktif akun",
].join("\n");

function variant(id: number, label: string, extra: Record<string, unknown>) {
  return {
    id, product_id: 1, sku: `SKU-${id}`, label, duration_value: 28, duration_unit: "day", duration_label: "28 Hari",
    warranty_type: "none", warranty_value: null, warranty_unit: null, warranty_label: null,
    terms: null, delivery_terms: null, wr_delivery_class: "restock", wr_type: "Private", require_email: 0,
    price: 35_000, compare_price: null, stock: 5, min_qty: 1, fulfillment_mode: "manual", is_active: 1, sort_order: id,
    ...extra,
  };
}

function stubCatalog(slug: string, description: string, variants: unknown[]) {
  const product = { id: "1", slug, name: slug === "netflix-premium" ? "Netflix Premium" : "Akun GSuite", description, price: 35_000, categorySlug: "streaming", image: "/brand/axvara-mark.svg", images: [], stock: 5 };
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input);
    const body = url.startsWith("/api/catalog")
      ? { product: { id: 1, slug, name: product.name, variants }, variantsEnabled: true }
      : { products: url.includes(`slug=${slug}`) ? [product] : [] };
    return { ok: true, status: 200, json: async () => body };
  }));
}

// Picker inline desktop (bukan baris mobile / dialog); menunggu PDP selesai memuat varian.
async function pickVariant(label: string) {
  await screen.findByRole("heading", { level: 1 });
  await waitFor(() => expect(screen.getAllByRole("button").some((b) => b.textContent?.startsWith(label) && b.className.includes("rounded-xl border"))).toBe(true));
  return screen.getAllByRole("button").find((b) => b.textContent?.startsWith(label) && b.className.includes("rounded-xl border"))!;
}

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("PDP produk WR: salinan Axvara per varian", () => {
  const antiLimit = pair("netflix-premium · Premium Anti Limit");
  const legal = pair("netflix-premium · Premium Legal");
  const variants = [
    variant(12, "Premium Anti Limit", { wr_variant_id: "wr-12", copy: resolveVariantCopy(antiLimit.terms, antiLimit.deliveryTerms) }),
    variant(13, "Premium Legal", { wr_variant_id: "wr-13", copy: resolveVariantCopy(legal.terms, legal.deliveryTerms) }),
  ];

  it("S&K dan cara aktivasi terlipat di mobile, terbuka saat diketuk", async () => {
    stubCatalog("netflix-premium", NETFLIX_DESC, variants);
    render(<ProductDetailClient slug="netflix-premium" />);
    // Dua varian: salinan baru tampil setelah pembeli memilih (tanpa fallback ke varian pertama).
    fireEvent.click(await pickVariant("Premium Anti Limit"));
    const termsButton = await screen.findByRole("button", { name: /Syarat & Ketentuan/ });
    const activationButton = screen.getByRole("button", { name: /Cara Aktivasi/ });
    expect(termsButton.getAttribute("aria-expanded")).toBe("false");
    expect(activationButton.getAttribute("aria-expanded")).toBe("false");
    expect(activationButton.textContent).toContain("2 langkah");
    expect(screen.queryByRole("region", { name: /Syarat & Ketentuan/ })).toBeNull();

    fireEvent.click(termsButton);
    expect(termsButton.getAttribute("aria-expanded")).toBe("true");
    const panel = screen.getByRole("region", { name: /Syarat & Ketentuan/ });
    expect(within(panel).getByRole("region", { name: "Aturan pakai" }).textContent).toContain("Dilarang sign out");
    expect(within(panel).getByRole("region", { name: "Garansi" }).textContent).toContain("Garansi 20 hari");

    fireEvent.click(activationButton);
    const steps = screen.getByRole("region", { name: /Cara Aktivasi/ });
    expect(steps.textContent).toContain("Wajib uninstall aplikasi Netflix dulu");
  });

  it("teks mentah pemasok tidak pernah tampil; label S&K ikut varian terpilih", async () => {
    stubCatalog("netflix-premium", NETFLIX_DESC, variants);
    render(<ProductDetailClient slug="netflix-premium" />);
    await pickVariant("Premium Anti Limit");
    const text = () => document.body.textContent ?? "";
    const identity = () => screen.getByTestId("pdp-variant-details").querySelector("[data-testid=pdp-variant-identity]")!.textContent;
    // Sebelum memilih tidak ada S&K varian mana pun.
    expect(text()).not.toContain("Dilarang sign out");
    expect(identity()).toContain("Belum ada varian dipilih");
    fireEvent.click(await pickVariant("Premium Anti Limit"));
    expect(text()).not.toMatch(/bl4ckmarket|TIDAK ADA TOLERANSI|Klo mau aman/);
    expect(identity()).toContain("Premium Anti Limit");

    fireEvent.click(await pickVariant("Premium Legal"));
    await waitFor(() => expect(identity()).toContain("Premium Legal"));
    expect(text()).toContain("Paket Premium Ultra HD 4K");
    expect(text()).toContain("Login di website");
    expect(text()).not.toContain("Dilarang sign out");
  });

  it("tombol varian desktop punya cincin fokus cyan terlihat", async () => {
    stubCatalog("netflix-premium", NETFLIX_DESC, variants);
    render(<ProductDetailClient slug="netflix-premium" />);
    const button = await pickVariant("Premium Anti Limit");
    expect(button.className).toContain("focus-visible:outline-[#00E5FF]");
  });

  it("kotak aktivasi desktop kembali bersarang dan mengikuti varian terpilih", async () => {
    stubCatalog("netflix-premium", NETFLIX_DESC, variants);
    render(<ProductDetailClient slug="netflix-premium" />);
    for (const label of ["Premium Anti Limit", "Premium Legal"]) {
      fireEvent.click(await pickVariant(label));
      const card = within(screen.getByTestId("pdp-variant-details")).getByTestId("product-activation-body").parentElement!;
      for (const token of ["rounded-2xl", "border", "bg-white/[0.03]", "p-5"]) expect(card.classList.contains(token)).toBe(true);
      expect(card.querySelector("h3")?.classList.contains("text-[13px]")).toBe(true);
    }
  });

  it("deskripsi tampil sebagai paragraf pembuka + daftar keunggulan", async () => {
    stubCatalog("netflix-premium", NETFLIX_DESC, variants);
    render(<ProductDetailClient slug="netflix-premium" />);
    await screen.findByRole("heading", { level: 1 });
    const [desktop] = screen.getAllByTestId("product-description-body");
    expect(within(desktop).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Ribuan film, serial, dokumenter, dan tayangan original eksklusif",
      "Kualitas tayangan terbaik",
    ]);
    expect(desktop.querySelector("p")?.textContent).toMatch(/^Netflix Premium adalah paket tertinggi/);
  });
});

describe("PDP produk non-WR: format yang sama dari deskripsi admin", () => {
  it("Canva (migrasi 0042): S&K undangan email + cara aktivasi tampil di panel lipat", async () => {
    const migration = fs.readFileSync("drizzle/migrations/0042_canva_invite_terms.sql", "utf8");
    const canvaDesc = migration.match(/SET description = '([\s\S]*?)', updated_at/)![1].replace(/''/g, "'");
    stubCatalog("akun-gsuite", canvaDesc, [variant(1, "Invite 1 Bulan", { wr_variant_id: null, copy: null, wr_delivery_class: null, fulfillment_mode: "shared" })]);
    render(<ProductDetailClient slug="akun-gsuite" />);
    const termsButton = await screen.findByRole("button", { name: /Syarat & Ketentuan/ });
    fireEvent.click(termsButton);
    const panel = screen.getByRole("region", { name: /Syarat & Ketentuan/ });
    expect(within(panel).getByRole("region", { name: "Proses & pengiriman" }).textContent).toContain("Undangan Canva dikirim lewat email");
    expect(within(panel).getByRole("region", { name: "Aturan pakai" }).textContent).toContain("Pastikan email yang kamu isi saat checkout aktif");
    const activationButton = screen.getByRole("button", { name: /Cara Aktivasi · 1 langkah/ });
    const [desktopActivation] = screen.getAllByTestId("product-activation-body");
    expect(desktopActivation.parentElement?.classList.contains("rounded-2xl")).toBe(true);
    expect(desktopActivation.parentElement?.classList.contains("p-5")).toBe(true);
    fireEvent.click(activationButton);
    expect(screen.getByRole("region", { name: /Cara Aktivasi/ }).textContent).toContain("Buka email undangan dari Canva, lalu terima undangannya");
  });

  it("bagian 'Syarat & Ketentuan:' pindah ke panel S&K dan tidak tampil ganda di deskripsi", async () => {
    stubCatalog("akun-gsuite", GSUITE_DESC, [variant(4, "1 Hari", { wr_variant_id: null, copy: null, wr_delivery_class: null })]);
    render(<ProductDetailClient slug="akun-gsuite" />);
    const termsButton = await screen.findByRole("button", { name: /Syarat & Ketentuan/ });
    // S&K tingkat produk, bukan milik satu varian: tanpa label varian.
    expect(termsButton.textContent).toBe("Syarat & Ketentuan");
    expect(screen.queryByRole("button", { name: /Cara Aktivasi/ })).toBeNull();
    fireEvent.click(termsButton);
    const panel = screen.getByRole("region", { name: /Syarat & Ketentuan/ });
    expect(within(panel).getByRole("region", { name: "Garansi" }).textContent).toContain("Full garansi selama masa aktif akun");
    for (const body of screen.getAllByTestId("product-description-body")) {
      expect(body.textContent).not.toContain("Full garansi selama masa aktif akun");
    }
  });
});

describe("Salinan PDP: judul biasa, langkah tunggal polos, link panjang berlabel", () => {
  it("judul bagian memakai huruf biasa 13px semibold, bukan kapital kecil", async () => {
    const { TermsBody } = await import("@/components/storefront/ProductCopy");
    render(<TermsBody sections={[{ kind: "aturan", items: ["Dilarang ganti password"] }]} />);
    const heading = screen.getByRole("heading", { name: "Aturan pakai" });
    expect(heading.className).toContain("text-[13px]");
    expect(heading.className).toContain("font-semibold");
    expect(heading.className).not.toMatch(/uppercase|text-\[11px\]/);
  });

  it("satu langkah aktivasi tampil sebagai paragraf, beberapa langkah tetap bernomor", async () => {
    const { ActivationBody } = await import("@/components/storefront/ProductCopy");
    const { unmount } = render(<ActivationBody groups={[{ title: null, steps: ["Buka email undangan."] }]} notes={[]} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText("Buka email undangan.").tagName).toBe("P");
    unmount();
    render(<ActivationBody groups={[{ title: "Android", steps: ["Buka aplikasi.", "Masuk dengan akun."] }]} notes={[]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("hanya YouTube berlabel singkat; tujuan lain tetap dapat dibedakan lewat path", async () => {
    const { linkLabel, RichText } = await import("@/components/storefront/ProductCopy");
    const yt = "https://www.youtube.com/watch?v=fBOfOmj9Uj8";
    expect(linkLabel(yt, yt)).toBe("Tonton video panduan");
    expect(linkLabel("https://youtu.be/abc", "https://youtu.be/abc")).toBe("Tonton video panduan");
    expect(linkLabel("https://name.com", "https://name.com/")).toBe("https://name.com");
    expect(linkLabel("@bot_name", "https://t.me/bot_name")).toBe("@bot_name");
    render(<RichText text="Hapus cookie: https://www.netflix.com/clearcookies lalu buka https://www.netflix.com/youraccount. Panduan axvara.tech/go/netflix-login-tv-panjang dan axvara.tech/go/netflix-login-hp-panjang." />);
    const hrefs = screen.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
    expect(hrefs).toEqual([
      ["https://www.netflix.com/clearcookies", "https://www.netflix.com/clearcookies"],
      ["https://www.netflix.com/youraccount", "https://www.netflix.com/youraccount"],
      ["axvara.tech/go/netflix-login-tv-panjang", "/go/netflix-login-tv-panjang"],
      ["axvara.tech/go/netflix-login-hp-panjang", "/go/netflix-login-hp-panjang"],
    ]);
  });
});
