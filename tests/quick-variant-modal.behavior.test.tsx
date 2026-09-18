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

  it("daftar varian memakai semantik radiogroup", async () => {
    await renderModal();
    const group = screen.getByRole("radiogroup", { name: "Pilih paket atau varian" });
    expect(group).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
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

  it("varian habis diberi tahu lewat nama aksesibel dan tidak bisa dipilih", async () => {
    await renderModal();
    const sold = screen.getByRole("radio", { name: /stok habis/ });
    expect((sold as HTMLButtonElement).disabled).toBe(true);
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

  it("mode cart menambahkan varian terpilih ke store lalu menutup modal", async () => {
    const { onClose } = await renderModal("cart");
    fireEvent.click(screen.getByRole("radio", { name: /3 Bulan/ }));
    fireEvent.click(screen.getByRole("button", { name: /Tambah ke Keranjang/ }));
    const { items } = useCart.getState();
    expect(items).toHaveLength(1);
    expect(items[0].variantId).toBe(12);
    expect(items[0].price).toBe(65_000);
    expect(onClose).toHaveBeenCalled();
  });

  it("mode checkout mengarahkan ke checkout dengan slug + variant + qty stepper", async () => {
    await renderModal("checkout");
    fireEvent.click(screen.getByRole("radio", { name: /3 Bulan/ }));
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
    expect((screen.getByRole("button", { name: "Kurangi jumlah" }) as HTMLButtonElement).disabled).toBe(true);
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
    // Confirm memakai qty ter-commit (50) → add + tutup.
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
    await waitFor(() => expect(screen.getAllByRole("radio")).toHaveLength(3));
    expect(screen.queryByRole("radio", { name: /Arsip/ })).toBeNull();
  });

  it("kegagalan fetch varian menampilkan pesan error, bukan modal kosong senyap", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    render(<QuickVariantModal product={product} mode="cart" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Gagal mengambil varian/)).toBeTruthy());
  });

  it("panel desktop dilebarkan (mobile tetap bottom-sheet 480px)", async () => {
    // Regresi visual 2026-09-18: panel 480px terlalu sempit di desktop —
    // sm+ harus 620→660px, grid 2 kolom, dan list lebih tinggi agar scroll
    // internal tidak muncul untuk 4 varian. Cukup assert kelas responsif.
    await renderModal();
    const dialog = screen.getByRole("dialog");
    const panel = dialog.firstElementChild as HTMLElement | null;
    expect(panel).toBeTruthy();
    const classes = panel?.getAttribute("class") ?? "";
    expect(classes).toContain("max-w-[480px]");
    expect(classes).toContain("sm:max-w-[620px]");
    expect(classes).toContain("lg:max-w-[660px]");
    const group = screen.getByRole("radiogroup", { name: "Pilih paket atau varian" });
    const groupClasses = group.getAttribute("class") ?? "";
    expect(groupClasses).toContain("sm:grid-cols-2");
    expect(groupClasses).toContain("sm:max-h-[340px]");
  });
});
