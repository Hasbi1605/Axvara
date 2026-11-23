// @vitest-environment jsdom
// PDP + QuickVariantModal + BulkPriceTiers: render nyata, tanpa mock komponen.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Product } from "@/lib/products";
import { BulkPriceTiers } from "@/components/storefront/BulkPriceTiers";
import { QuickVariantModal } from "@/components/storefront/QuickVariantModal";
import { useCart } from "@/stores/cart";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "gpt-plus" }),
  usePathname: () => "/produk/gpt-plus",
  useRouter: () => ({ push: nav.push, replace: vi.fn(), back: vi.fn() }),
}));

import ProductDetailClient from "@/app/(shop)/produk/[slug]/product-detail-client";

const norm = (text: string | null | undefined) => String(text ?? "").replace(/\s/g, " ");
const tiers = [{ min_qty: 10, unit_price: 9000 }, { min_qty: 50, unit_price: 8000 }];
const product = {
  id: "1", slug: "gpt-plus", name: "GPT Plus", description: "Deskripsi.", price: 10_000, categorySlug: "ai",
  image: "/brand/axvara-mark.svg", images: [], stock: 100, variantCount: 1,
} as unknown as Product;

function variant(extra: Record<string, unknown> = {}) {
  return {
    id: 11, product_id: 1, label: "1 Bulan", price: 10_000, compare_price: null, stock: -1, min_qty: 1, is_active: 1,
    warranty_type: "none", fulfillment_mode: "manual", wr_variant_id: "wr-11", wr_delivery_class: "restock",
    bulk_pricing_enabled: true, bulk_pricing_tiers: tiers, bulk_pricing_invalid: false, ...extra,
  };
}

function renderPdp(v = variant()) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ products: [] }) })));
  const catalog = { slug: "gpt-plus", product: { id: 1, slug: "gpt-plus", name: "GPT Plus", variants: [v] }, variantsEnabled: true };
  render(<ProductDetailClient slug="gpt-plus" initialProducts={[product]} initialCatalog={catalog as never} />);
}
const qtyInput = () => document.getElementById("pdp-qty-input") as HTMLInputElement;
const setQty = (n: number) => { fireEvent.change(qtyInput(), { target: { value: String(n) } }); fireEvent.blur(qtyInput()); };
const tierList = () => screen.queryByRole("list", { name: "Harga grosir" });
const stickyBuy = () => screen.getAllByRole("button").find((b) => b.textContent?.includes("Beli Sekarang") && !b.closest("[role=dialog]"))!;
const live = () => within(screen.getByTestId("bulk-full")).getByRole("status");

beforeEach(() => { nav.push.mockClear(); localStorage.clear(); useCart.setState({ items: [], drawerOpen: false }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("BulkPriceTiers (props saja)", () => {
  const props = { basePrice: 10_000, tiers, minQty: 1, qty: 12, maxQty: 100, stockMax: -1, capMax: 100, onSetQty: vi.fn(), qtyInputId: "q" };
  it("tanpa tier tidak merender apa pun", () => {
    const { container } = render(<BulkPriceTiers mode="full" {...props} tiers={[]} />);
    expect(container.textContent).toBe("");
  });
  it("baris tier R1: rentang inklusif dari min_qty asli ('N+' hanya tier terakhir), harga di kanan, tanpa chip %, aria-current, label '· jumlahmu' hanya di baris aktif", () => {
    const { rerender } = render(<BulkPriceTiers mode="full" {...props} />);
    const list = screen.getByRole("list", { name: "Harga grosir" });
    expect(list.className).not.toContain("grid-cols-3"); // daftar baris, bukan kolom price-break
    expect(list.className).toContain("rounded-xl");
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => norm(li.textContent))).toEqual(["1–9 pcsRp 10.000", "10–49 pcs · jumlahmuRp 9.000", "50+ pcsRp 8.000"]);
    expect(items.map((li) => li.getAttribute("aria-current"))).toEqual([null, "true", null]);
    expect(list.textContent).not.toMatch(/%|−|>\s*\d/); // tidak ada "−20%" atau "> 2"
    expect(screen.getByText("Berlaku untuk semua unit varian ini.")).toBeTruthy(); // satu baris catatan
    expect(screen.getByRole("heading", { name: "Harga grosir" }).className).toMatch(/text-\[14px\].*font-semibold|font-semibold.*text-\[14px\]/);
    expect(screen.getByRole("heading", { name: "Harga grosir" }).className).not.toMatch(/uppercase|tracking-/);
    expect(screen.getByText("per pcs").className).toContain("text-[12px]");
    expect(screen.queryByText(/Harga grosir · per pcs/i)).toBeNull();
    rerender(<BulkPriceTiers mode="full" {...props} locale="en" />);
    expect(norm(within(screen.getByRole("list", { name: "Bulk pricing" })).getAllByRole("listitem")[1].textContent)).toBe("10–49 pcs · your qtyRp 9.000");
  });
  it("baris aktif netral (tanpa garis biru kiri / wash cyan / glow): latar putih halus, rentang+harga tebal, tidak aktif normal putih65%", () => {
    render(<BulkPriceTiers mode="full" {...props} />);
    const items = within(screen.getByRole("list", { name: "Harga grosir" })).getAllByRole("listitem");
    for (const li of items) { expect(li.className).not.toMatch(/shadow-\[inset|#00E5FF|glow|rounded-xl/); }
    expect(items[1].className).toContain("bg-white/[0.06]");
    for (const li of items) { expect(li.className).toContain("min-h-11"); expect(li.className).toContain("px-4"); expect(li.className).toContain("tabular-nums"); }
    expect(screen.getByRole("list", { name: "Harga grosir" }).className).toContain("divide-white/[0.06]"); // pemisah 1px antarbaris
    expect(Array.from(items[1].querySelectorAll("span")).find((el) => /jumlahmu/.test(el.textContent ?? "") && el.children.length === 0)!.className).toMatch(/text-\[12px\].*font-normal.*text-white\/50/);
    expect(items[0].className).toContain("font-normal");
    expect(items[0].className).toContain("text-white/70");
    expect(items[1].className).not.toContain("font-normal");
    const price = (li: HTMLElement) => Array.from(li.querySelectorAll("span")).find((el) => el.children.length === 0 && /^Rp\s/.test(el.textContent ?? ""))!;
    expect(price(items[1]).className).toContain("font-semibold");
    expect(price(items[0]).className).toContain("font-normal");
    expect(price(items[0]).className).not.toContain("font-semibold");
    expect(items[1].querySelector(".sr-only")).toBeNull();
    expect(items[0].textContent).not.toContain("jumlahmu");
    expect(items[1].textContent).toContain("· jumlahmu"); // label terlihat, bukan sr-only
  });
  it("batas jumlah: baris aktif berlabel di qty 1/2/3/4/9/10/49/50; rentang dari min_qty nyata (tier 3 => 1–2 dan 3–9, bukan asumsi '> 2')", () => {
    const three = [{ min_qty: 3, unit_price: 8000 }, { min_qty: 10, unit_price: 7000 }];
    const base = { ...props, tiers: three, basePrice: 10_000, maxQty: 100 };
    const expectations: Array<[number, number]> = [[1, 0], [2, 0], [3, 1], [4, 1], [9, 1], [10, 2], [49, 2], [50, 2]];
    for (const [qty, active] of expectations) {
      const { unmount } = render(<BulkPriceTiers mode="full" {...base} qty={qty} />);
      const items = within(screen.getByRole("list", { name: "Harga grosir" })).getAllByRole("listitem");
      expect(items.map((li) => li.getAttribute("aria-current") === "true"), `qty ${qty}`).toEqual([0, 1, 2].map((i) => i === active));
      expect(items.map((li) => norm(li.textContent.replace(" · jumlahmu", "")))).toEqual(["1–2 pcsRp 10.000", "3–9 pcsRp 8.000", "10+ pcsRp 7.000"]);
      unmount();
    }
    // Tier pertama di 2 => basis "1 pcs".
    render(<BulkPriceTiers mode="full" {...base} tiers={[{ min_qty: 2, unit_price: 9000 }, { min_qty: 10, unit_price: 8000 }]} qty={1} />);
    expect(within(screen.getByRole("list", { name: "Harga grosir" })).getAllByRole("listitem").map((li) => norm(li.textContent.replace(" · jumlahmu", "")))).toEqual(["1 pcsRp 10.000", "2–9 pcsRp 9.000", "10+ pcsRp 8.000"]);
  });
  it("enam baris (basis + 5 tier) tetap daftar baris; uang panjang tidak terpotong/overflow", () => {
    const five = [2, 5, 10, 25, 50].map((min_qty, i) => ({ min_qty, unit_price: 28_000 - i * 2000 }));
    render(<BulkPriceTiers mode="full" {...props} tiers={five} basePrice={12_500_000} qty={5} />);
    const list = screen.getByRole("list", { name: "Harga grosir" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
    expect(list.className).not.toContain("grid-cols-3");
    expect(list.className).not.toMatch(/overflow-x|scroll|flex-nowrap/);
    const first = within(list).getAllByRole("listitem")[0];
    expect(first.querySelector("span.min-w-0")).toBeTruthy();
    const price = Array.from(first.querySelectorAll("span")).find((el) => el.children.length === 0 && /^Rp\s/.test(el.textContent ?? ""))!;
    // nowrap dipasang di pembungkus harga (span shrink-0), leaf hanya bobot font.
    expect(price.closest(".whitespace-nowrap")).toBeTruthy();
    expect(norm(first.textContent)).toContain("Rp 12.500.000");
  });
  it("tier tak tercapai redup dengan alasan stok/plafon dan tanpa tombol", () => {
    const { rerender } = render(<BulkPriceTiers mode="full" {...props} qty={10} maxQty={30} stockMax={30} />);
    const last = within(screen.getByRole("list", { name: "Harga grosir" })).getAllByRole("listitem")[2];
    expect(last.className).toContain("opacity-50");
    expect(norm(last.textContent)).toContain("Melebihi stok saat ini");
    expect(last.textContent).not.toContain("8.000");
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<BulkPriceTiers mode="full" {...props} qty={10} maxQty={10} stockMax={-1} capMax={10} />);
    expect(norm(within(screen.getByRole("list", { name: "Harga grosir" })).getAllByRole("listitem")[2].textContent)).toContain("Maks. 10 per pesanan");
  });
  it("EN tanpa menerjemahkan data pemilik; format Rp tetap", () => {
    render(<BulkPriceTiers mode="full" {...props} qty={8} locale="en" />);
    expect(screen.getByRole("heading", { name: "Bulk pricing" })).toBeTruthy();
    expect(screen.getByText("Applies to every unit of this variant.")).toBeTruthy();
    expect(norm(screen.getByRole("button").textContent)).toBe("Add 2 more Rp 9.000/pcs");
    expect(screen.getByRole("button").querySelector("svg")!.getAttribute("aria-hidden")).toBe("true"); // ikon ArrowRight, bukan glyph →
    expect(norm(screen.getByRole("status").textContent)).toBe("Regular price: Rp 10.000 per pcs.");
  });
  it("tombol tier berikutnya berukuran min-h-11 dan memanggil onSetQty dengan ambang", () => {
    const onSetQty = vi.fn();
    render(<BulkPriceTiers mode="full" {...props} qty={8} onSetQty={onSetQty} />);
    const button = screen.getByRole("button");
    expect(button.className).toContain("min-h-11");
    fireEvent.click(button);
    expect(onSetQty).toHaveBeenCalledWith(10);
  });
  it("compact: baris aktif + tombol + <details> berisi daftar penuh", () => {
    render(<BulkPriceTiers mode="compact" {...props} />);
    expect(norm(screen.getByText(/grosir 10\+/).textContent)).toBe("Rp 9.000/pcs · grosir 10+");
    expect(norm(screen.getByRole("button").textContent)).toBe("Tambah 38 pcs lagi Rp 8.000/pcs");
    const summary = screen.getByText("Lihat harga grosir");
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.closest("details")?.querySelector("ul")).toBeTruthy();
  });
});

describe("PDP", () => {
  it("judul tetap harga dasar; daftar tier muncul di bawah stepper; total + hemat + CTA mobile memakai satuan efektif", () => {
    renderPdp();
    expect(norm(document.querySelector("span.font-display")?.textContent)).toBe("Rp 10.000");
    expect(tierList()).toBeTruthy();
    setQty(12);
    // Baris jumlah: stepper di kiri, "Sisa 50" di kanannya pada baris yang sama; ringkasan 2 bagian di bawahnya.
    const qtyRow = qtyInput().closest("div.flex.items-center.gap-3")!;
    expect(qtyRow.textContent).toMatch(/Stok tersedia|Sisa \d+/);
    expect(qtyRow.querySelector("span.text-white\\/40")!.className).toContain("text-xs");
    const summary = screen.getByTestId("pdp-qty-summary");
    expect(qtyRow.contains(summary)).toBe(false);
    expect(qtyRow.nextElementSibling).toBe(summary);
    expect(norm(summary.textContent)).toBe("Total Rp 108.000Hemat Rp 12.000");
    const total = within(summary).getByText("Rp 108.000");
    expect(total.className).toContain("font-semibold");
    expect(total.parentElement!.className).toContain("text-white/60");
    const saved = within(summary).getByText("Hemat Rp 12.000");
    expect(saved.className).toContain("text-emerald-300/80"); // hijau yang sama dengan checkout
    expect(saved.className).toContain("whitespace-nowrap");
    expect(summary.className).toContain("flex-wrap");
    expect(summary.textContent).not.toMatch(/Sisa|Stok|·/); // tidak lagi satu baris "Sisa · Total · hemat"
    // Judul "Harga grosir" 16px di bawah ringkasan.
    expect(screen.getByTestId("bulk-full").className).toContain("mt-4");
    expect(norm(stickyBuy().textContent)).toContain("Rp 108.000");
    expect(norm(document.querySelector("span.font-display")?.textContent)).toBe("Rp 10.000");
    const rows = within(tierList()!).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("aria-current"))).toEqual([null, "true", null]);
  });

  it("qty 1: CTA mobile tetap harga satuan; stepper 44px dan tanpa aria-live ganda pada input", () => {
    renderPdp();
    expect(norm(stickyBuy().textContent)).toContain("Rp 10.000");
    expect(norm(stickyBuy().textContent)).not.toContain("Rp 90.000");
    expect(screen.getByRole("button", { name: "Kurangi jumlah" }).className).toContain("h-11 w-11");
    expect(screen.getByRole("button", { name: "Tambah jumlah" }).className).toContain("h-11 w-11");
    expect(qtyInput().getAttribute("aria-live")).toBeNull();
  });

  it("tombol tier berikutnya mengisi qty persis, fokus bertahan, lalu pindah ke input bila tombol hilang", () => {
    renderPdp();
    const hint = () => screen.getByRole("button", { name: /^Tambah \d+ pcs lagi/ });
    expect(norm(hint().textContent)).toBe("Tambah 9 pcs lagi Rp 9.000/pcs");
    fireEvent.click(hint());
    expect(qtyInput().value).toBe("10");
    expect(norm(hint().textContent)).toBe("Tambah 40 pcs lagi Rp 8.000/pcs");
    expect(document.activeElement).toBe(hint());
    fireEvent.click(hint());
    expect(qtyInput().value).toBe("50");
    expect(screen.queryByRole("button", { name: /^Tambah \d+ pcs lagi/ })).toBeNull();
    expect(document.activeElement).toBe(qtyInput());
  });

  it("stok terbatas: tier di atas stok redup dengan alasan dan tidak ada petunjuk menggoda", () => {
    renderPdp(variant({ stock: 30 }));
    setQty(10);
    expect(screen.queryByRole("button", { name: /^Tambah \d+ pcs lagi/ })).toBeNull();
    const rows = within(tierList()!).getAllByRole("listitem");
    expect(rows[2].className).toContain("opacity-50");
    expect(norm(rows[2].textContent)).toContain("Melebihi stok saat ini");
    setQty(80);
    expect(qtyInput().value).toBe("30"); // batas stok tetap berlaku, tidak dinaikkan
  });

  it("plafon varian unik 10: tier 50 tak tercapai dengan alasan plafon, batas qty tidak naik", () => {
    renderPdp(variant({ fulfillment_mode: "unique", stock: 40, inventory_available: 40 }));
    setQty(99);
    expect(qtyInput().value).toBe("10");
    expect(norm(within(tierList()!).getAllByRole("listitem")[2].textContent)).toContain("Maks. 10 per pesanan");
  });

  it("pengumuman langsung hanya berubah saat tier aktif berganti, bukan di tiap qty", () => {
    renderPdp();
    expect(live().textContent).toBe(norm("Harga normal: Rp 10.000 per pcs.").replace(/ /g, " ").length ? live().textContent : "");
    const texts: string[] = [live().textContent!];
    for (const n of [2, 5, 9, 10, 11, 49, 50]) { setQty(n); texts.push(live().textContent!); }
    expect(norm(texts[0])).toBe("Harga normal: Rp 10.000 per pcs.");
    expect(texts.slice(0, 4).every((t) => t === texts[0])).toBe(true);
    expect(norm(texts[4])).toBe("Harga grosir berlaku: Rp 9.000 per pcs.");
    expect(texts[5]).toBe(texts[4]);
    expect(texts[6]).toBe(texts[4]);
    expect(norm(texts[7])).toBe("Harga grosir berlaku: Rp 8.000 per pcs.");
    expect(new Set(texts).size).toBe(3);
  });

  it("tambah ke keranjang membawa harga DASAR + cache tier; qty turun ke bawah ambang kembali ke dasar", () => {
    renderPdp();
    setQty(12);
    fireEvent.click(screen.getAllByRole("button", { name: /Tambah ke Keranjang|Keranjang/ })[0]);
    const line = useCart.getState().items[0];
    expect(line).toMatchObject({ price: 10_000, qty: 12, variantId: 11, bulkTiers: tiers });
    setQty(9);
    expect(norm(stickyBuy().textContent)).toContain("Rp 90.000");
    expect(screen.queryByText(/hemat/)).toBeNull();
    expect(norm(document.querySelector("span.font-display")?.textContent)).toBe("Rp 10.000");
  });

  it("disabled/invalid/basi: tanpa daftar tier, tanpa hemat, tanpa cache di keranjang", () => {
    for (const extra of [{ bulk_pricing_enabled: false }, { bulk_pricing_invalid: true }, { price: 8500 }]) {
      renderPdp(variant(extra));
      expect(tierList()).toBeNull();
      setQty(60);
      expect(screen.queryByText(/hemat/)).toBeNull();
      fireEvent.click(screen.getAllByRole("button", { name: /Tambah ke Keranjang|Keranjang/ })[0]);
      expect(useCart.getState().items[0].bulkTiers ?? []).toEqual([]);
      cleanup();
      useCart.setState({ items: [] });
    }
  });

  it("petunjuk 'Grosir mulai N pcs' hanya sebagai teks muted di baris varian desktop, tanpa tabel tier di sana", () => {
    renderPdp();
    const picker = screen.getByText("Pilih Varian").parentElement!;
    expect(norm(picker.textContent)).toContain("Grosir mulai 10 pcs");
    expect(within(picker).queryByRole("list", { name: "Harga grosir" })).toBeNull();
  });
});

describe("QuickVariantModal", () => {
  const mockCatalog = (v = variant()) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ product: { variants: [v] } }) }));
  async function open(mode: "cart" | "checkout" = "cart", v = variant()) {
    mockCatalog(v);
    render(<QuickVariantModal product={product} mode={mode} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: /1 Bulan/ })).toBeTruthy());
  }
  const modalQty = () => document.getElementById("quick-modal-qty-input") as HTMLInputElement;

  it("kompak: satuan aktif, petunjuk 44px, daftar penuh di <details>, total + hemat; header tetap harga dasar", async () => {
    await open();
    expect(norm(screen.getByText(/pcs$/, { selector: "p" }).textContent)).toBe("Rp 10.000/pcs");
    fireEvent.click(screen.getByRole("button", { name: /^Tambah 9 pcs lagi/ }));
    expect(modalQty().value).toBe("10");
    expect(norm(screen.getByText(/grosir 10\+/).textContent)).toBe("Rp 9.000/pcs · grosir 10+");
    // Total hanya di CTA; footer modal hanya 'hemat' (tidak ada "Total" di bawah label Jumlah atau di footer).
    expect(norm(screen.getByText(/^hemat Rp 10\.000$/).textContent)).toBe("hemat Rp 10.000");
    expect(screen.queryByText(/^Total Rp/)).toBeNull();
    const summary = screen.getByText("Lihat harga grosir");
    expect(summary.querySelector("svg")).toBeTruthy(); // chevron seperti disclosure lain
    const disclosure = summary.closest("details")!;
    expect(within(disclosure).getByRole("list", { name: "Harga grosir" })).toBeTruthy();
    expect(norm(document.getElementById("quick-variant-title")!.parentElement!.textContent)).toContain("Rp 10.000");
    expect(norm(screen.getByRole("button", { name: /Tambah ke Keranjang/ }).textContent)).toContain("Rp 90.000");
  });

  it("tambah ke keranjang: harga dasar tidak dimutasi, tier tervalidasi di-cache; mode checkout memakai qty yang sama", async () => {
    await open("cart");
    fireEvent.click(screen.getByRole("button", { name: /^Tambah 9 pcs lagi/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /sudah membaca/i }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Tambah ke Keranjang/ })); });
    expect(useCart.getState().items[0]).toMatchObject({ price: 10_000, qty: 10, variantId: 11, bulkTiers: tiers });
    cleanup(); nav.push.mockClear();
    await open("checkout");
    fireEvent.click(screen.getByRole("button", { name: /^Tambah 9 pcs lagi/ }));
    expect(norm(screen.getByRole("button", { name: /Beli Sekarang/ }).textContent)).toContain("Rp 90.000");
  });

  it("tanpa tier: tidak ada blok grosir dan alur lama utuh", async () => {
    await open("cart", variant({ bulk_pricing_enabled: false, bulk_pricing_tiers: [] }));
    expect(screen.queryByTestId("bulk-compact")).toBeNull();
    expect(screen.queryByText("Lihat harga grosir")).toBeNull();
  });
});
