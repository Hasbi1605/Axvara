// @vitest-environment jsdom
//
// tests/product-copy-ui.behavior.test.tsx — PDP menampilkan salinan Axvara
// dalam satu format untuk produk WR maupun non-WR, dan S&K + cara aktivasi
// TERLIPAT di mobile (permintaan owner 2026-09-24). Data varian memakai hasil
// resolver sungguhan dari snapshot teks WR produksi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import snapshot from "./fixtures/product-copy-snapshot.json";
import { resolveVariantCopy } from "@/lib/product-copy/resolve";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "fixture" }),
  usePathname: () => "/produk/fixture",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import ProductDetailClient from "@/app/produk/[slug]/product-detail-client";

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
    await screen.findByRole("button", { name: /Syarat & Ketentuan/ });
    const text = () => document.body.textContent ?? "";
    expect(text()).not.toMatch(/bl4ckmarket|TIDAK ADA TOLERANSI|Klo mau aman/);
    expect(screen.getByRole("heading", { level: 2, name: /Syarat & Ketentuan/ }).textContent).toContain("Premium Anti Limit");

    const legalButton = screen.getAllByRole("button").find((b) => b.textContent?.startsWith("Premium Legal"))!;
    fireEvent.click(legalButton);
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: /Syarat & Ketentuan/ }).textContent).toContain("Premium Legal"));
    expect(text()).toContain("Paket Premium Ultra HD 4K");
    expect(text()).toContain("Login di website");
    expect(text()).not.toContain("Dilarang sign out");
  });

  it("deskripsi tampil sebagai paragraf pembuka + daftar keunggulan", async () => {
    stubCatalog("netflix-premium", NETFLIX_DESC, variants);
    render(<ProductDetailClient slug="netflix-premium" />);
    await screen.findByRole("button", { name: /Syarat & Ketentuan/ });
    const [desktop] = screen.getAllByTestId("product-description-body");
    expect(within(desktop).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Ribuan film, serial, dokumenter, dan tayangan original eksklusif",
      "Kualitas tayangan terbaik",
    ]);
    expect(desktop.querySelector("p")?.textContent).toMatch(/^Netflix Premium adalah paket tertinggi/);
  });
});

describe("PDP produk non-WR: format yang sama dari deskripsi admin", () => {
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
