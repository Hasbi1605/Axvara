// @vitest-environment jsdom
//
// Editor harga grosir admin (BulkTierEditor di dalam VariantEditor).
// Kontrak backend dibaca dari main: GET varian mengekspos
// bulk_pricing:{enabled,tiers} (+ bulk_pricing_corrupt), POST/PUT strict;
// field bulk_pricing yang DIHILANGKAN dipertahankan server, disabled
// mempertahankan tier, threshold boleh sama dengan Min. beli.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render } from "./setup/admin-render";
import VariantEditor from "@/components/admin/VariantEditor";
import { bulkDraftFromApi, validateBulkDraft, type BulkContext, type BulkDraft } from "@/components/admin/BulkTierEditor";
import { validateBulkPricing } from "@/lib/bulk-pricing";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function variant(overrides: Record<string, unknown> = {}) {
  return {
    id: 11, product_id: 7, sku: "GPT-1M", label: "Premium 1 Bulan",
    duration_value: 1, duration_unit: "month", duration_label: null,
    warranty_type: "none", warranty_value: null, warranty_unit: null, warranty_label: null,
    price: 10000, compare_price: null, stock: -1, min_qty: 1,
    fulfillment_mode: "manual", is_active: 1, sort_order: 10,
    bulk_pricing: { enabled: true, tiers: [{ min_qty: 10, unit_price: 9000 }, { min_qty: 50, unit_price: 8000 }] },
    ...overrides,
  };
}

type PostedVariant = Record<string, unknown> & { id?: number; bulk_pricing?: { enabled: boolean; tiers: Array<{ min_qty: number; unit_price: number }> } };
type Posted = { url: string; body: { variants: PostedVariant[] } };
function setup(variants: Record<string, unknown>[], saveResponse?: { status: number; body: unknown }) {
  const posts: Posted[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/admin/variants") && init?.method === "POST") {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      const r = saveResponse ?? { status: 200, body: { ok: true } };
      return { ok: r.status < 400, status: r.status, json: async () => r.body };
    }
    if (url.startsWith("/api/admin/variants")) return { ok: true, status: 200, json: async () => ({ variants, aliases: [] }) };
    return { ok: true, status: 200, json: async () => ({ items: [], available: [] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<ToastProvider><VariantEditor productId={7} productName="ChatGPT" onClose={() => {}} /></ToastProvider>);
  return { posts };
}

async function ready() { await screen.findByText("Premium 1 Bulan"); }
const save = async () => { await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Simpan Semua/ })); }); };
const open = () => fireEvent.click(screen.getByRole("button", { name: /Atur harga grosir/ }));
const input = (n: RegExp) => screen.getByLabelText(n) as HTMLInputElement;

describe("validateBulkDraft (cermin kontrak server)", () => {
  const ctx: BulkContext = { base: 10000, minQty: 1, stock: -1, mode: "manual" };
  const draft = (enabled: boolean, rows: [string, string][]): BulkDraft => ({
    enabled, touched: true, open: true, storedInvalid: false,
    rows: rows.map(([qty, price], i) => ({ key: `k${i}`, qty, price, saved: false })),
  });

  it("payload terurut naik, integer, dan lolos validator server", () => {
    const v = validateBulkDraft(draft(true, [["50", "8000"], ["10", "9000"]]), ctx);
    expect(v.errorCount).toBe(0);
    expect(v.payload).toEqual({ enabled: true, tiers: [{ min_qty: 10, unit_price: 9000 }, { min_qty: 50, unit_price: 8000 }] });
    expect(validateBulkPricing(v.payload, 10000)).not.toBeNull();
  });

  it("min. 2, ambang boleh sama dengan Min. beli, desimal/eksponen/ribuan ditolak apa adanya", () => {
    expect(validateBulkDraft(draft(true, [["1", "9000"]]), ctx).errors.k0?.qty).toMatch(/minimal 2/);
    expect(validateBulkDraft(draft(true, [["5", "9000"]]), { ...ctx, minQty: 5 }).errorCount).toBe(0);
    for (const raw of ["9.000", "9e3", "9,5", "1.5", "-1", " ", "abc"]) {
      const v = validateBulkDraft(draft(true, [["10", raw]]), ctx);
      expect(v.errors.k0?.price, raw).toBeTruthy();
      expect(v.payload).toBeNull();
    }
    expect(validateBulkDraft(draft(true, [["1e1", "9000"]]), ctx).errors.k0?.qty).toBeTruthy();
  });

  it("duplikat, harga > dasar, harga naik, dan enabled tanpa baris adalah error", () => {
    expect(validateBulkDraft(draft(true, [["10", "9000"], ["10", "8000"]]), ctx).errors.k1?.qty).toMatch(/sudah dipakai/);
    expect(validateBulkDraft(draft(true, [["10", "10001"]]), ctx).errors.k0?.price).toMatch(/harga dasar/);
    expect(validateBulkDraft(draft(true, [["10", "8000"], ["20", "9000"]]), ctx).errors.k1?.price).toMatch(/tingkat 10 pcs/);
    expect(validateBulkDraft(draft(true, []), ctx).groupError).toMatch(/minimal satu tingkat/);
  });

  it("disabled: hanya bentuk; harga basi di atas dasar boleh, tetapi tidak saat diaktifkan", () => {
    const rows: [string, string][] = [["10", "9000"], ["50", "8000"]];
    const stale = { ...ctx, base: 7000 };
    const off = validateBulkDraft(draft(false, rows), stale);
    expect(off.errorCount).toBe(0);
    expect(off.notes.length).toBe(1);
    expect(off.payload).toEqual({ enabled: false, tiers: [{ min_qty: 10, unit_price: 9000 }, { min_qty: 50, unit_price: 8000 }] });
    expect(validateBulkPricing(off.payload, 7000)).not.toBeNull();
    expect(validateBulkDraft(draft(true, rows), stale).errorCount).toBe(2);
    // bentuk tetap diperiksa saat disabled
    expect(validateBulkDraft(draft(false, [["10", "8000"], ["20", "9000"]]), ctx).errorCount).toBe(1);
    expect(validateBulkDraft(draft(false, []), ctx).payload).toEqual({ enabled: false, tiers: [] });
  });

  it("peringatan non-blocking: harga sama, melebihi batas, stok", () => {
    const eq = validateBulkDraft(draft(true, [["10", "10000"]]), ctx);
    expect(eq.errorCount).toBe(0);
    expect(eq.warnings.k0?.price).toMatch(/tidak ada potongan/);
    expect(validateBulkDraft(draft(true, [["12", "9000"]]), { ...ctx, mode: "unique" }).warnings.k0?.qty).toMatch(/batas 10/);
    expect(validateBulkDraft(draft(true, [["150", "9000"]]), ctx).warnings.k0?.qty).toMatch(/batas 100/);
    const stock = validateBulkDraft(draft(true, [["20", "9000"]]), { ...ctx, stock: 15 });
    expect(stock.warnings.k0?.qty).toMatch(/Stok saat ini 15/);
    expect(stock.payload).not.toBeNull();
  });

  it("konfigurasi tersimpan rusak yang tidak disentuh tidak divalidasi dan tanpa payload", () => {
    const bad = bulkDraftFromApi({ enabled: false, tiers: [] }, true);
    const v = validateBulkDraft(bad, ctx);
    expect(v.errorCount).toBe(0);
    expect(v.payload).toBeNull();
  });
});

describe("BulkTierEditor di VariantEditor", () => {
  it("bulk yang tidak diedit DIHILANGKAN dari payload (server mempertahankan)", async () => {
    const { posts } = setup([variant()]);
    await ready();
    expect(screen.getByTestId("bulk-11-summary").textContent).toBe("10+ Rp9.000 · 50+ Rp8.000");
    fireEvent.change(input(/Nama varian/), { target: { value: "Premium 1 Bulan X" } });
    await save();
    expect(posts).toHaveLength(1);
    expect("bulk_pricing" in posts[0].body.variants[0]).toBe(false);
  });

  it("edit tier mengirim bulk_pricing terurut dan menandai dirty", async () => {
    const { posts } = setup([variant()]);
    await ready();
    expect(screen.getByText("Semua perubahan tersimpan")).toBeTruthy();
    open();
    fireEvent.change(input(/^Harga \/ pcs tingkat 1/), { target: { value: "8500" } });
    expect(screen.getByText("Perubahan belum disimpan")).toBeTruthy();
    await save();
    expect(posts[0].body.variants[0].bulk_pricing).toEqual({ enabled: true, tiers: [{ min_qty: 10, unit_price: 8500 }, { min_qty: 50, unit_price: 8000 }] });
    await waitFor(() => expect(screen.getByText(/berhasil disimpan/)).toBeTruthy());
  });

  it("matikan lalu nyalakan lagi mempertahankan semua tier; mematikan tidak menghapus", async () => {
    const { posts } = setup([variant()]);
    await ready();
    const toggle = screen.getByRole("checkbox", { name: /Harga grosir/ }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(screen.getByText("Nonaktif")).toBeTruthy();
    expect(screen.getByTestId("bulk-11-summary").textContent).toBe("Pengaturan disimpan; harga grosir tidak berlaku.");
    await save();
    expect(posts[0].body.variants[0].bulk_pricing).toEqual({ enabled: false, tiers: [{ min_qty: 10, unit_price: 9000 }, { min_qty: 50, unit_price: 8000 }] });
  });

  it("simpan tidak valid: tanpa request, alert, bagian terbuka, fokus ke isian pertama, nilai mentah tidak dikoersi", async () => {
    const { posts } = setup([variant()]);
    await ready();
    open();
    const price = input(/^Harga \/ pcs tingkat 2/);
    fireEvent.change(price, { target: { value: "8.000" } });
    fireEvent.click(screen.getByRole("button", { name: /Tutup harga grosir/ }));
    await save();
    expect(posts).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toBe("Perbaiki 1 isian harga grosir sebelum menyimpan.");
    const reopened = input(/^Harga \/ pcs tingkat 2/);
    expect(reopened.value).toBe("8.000");
    expect(reopened.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(reopened);
    expect(document.getElementById(reopened.getAttribute("aria-describedby")!)?.textContent).toMatch(/tanpa titik/);
  });

  it("ambang sama dengan Min. beli valid; perubahan harga dasar memvalidasi ulang langsung", async () => {
    const { posts } = setup([variant({ min_qty: 10 })]);
    await ready();
    open();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(input(/^Harga jual/), { target: { value: "8500" } });
    expect(screen.getByText("Perlu diperbaiki")).toBeTruthy();
    expect(within(document.getElementById("bulk-11-body")!).getByText(/Harga: Tidak boleh lebih mahal dari harga dasar \(Rp8\.500\)/)).toBeTruthy();
    await save();
    expect(posts).toHaveLength(0);
    fireEvent.change(input(/^Harga jual/), { target: { value: "10000" } });
    expect(screen.queryByText("Perlu diperbaiki")).toBeNull();
    await save();
    expect(posts).toHaveLength(1);
  });

  it("disabled dengan harga basi vs dasar baru boleh disimpan tanpa mengirim bulk", async () => {
    const { posts } = setup([variant({ bulk_pricing: { enabled: false, tiers: [{ min_qty: 10, unit_price: 9000 }] } })]);
    await ready();
    fireEvent.change(input(/^Harga jual/), { target: { value: "8000" } });
    await save();
    expect(posts).toHaveLength(1);
    expect("bulk_pricing" in posts[0].body.variants[0]).toBe(false);
  });

  it("mengaktifkan lagi tier basi terhadap harga dasar baru diblokir", async () => {
    const { posts } = setup([variant({ bulk_pricing: { enabled: false, tiers: [{ min_qty: 10, unit_price: 9000 }] } })]);
    await ready();
    fireEvent.change(input(/^Harga jual/), { target: { value: "8000" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Harga grosir/ }));
    await save();
    expect(posts).toHaveLength(0);
    expect(screen.getAllByRole("alert")[0].textContent).toMatch(/Perbaiki 1 isian/);
  });

  it("baris tidak diurutkan saat mengetik, payload diurutkan setelah validasi; maksimal 5 tingkat", async () => {
    const { posts } = setup([variant({ bulk_pricing: { enabled: true, tiers: [{ min_qty: 10, unit_price: 9000 }] } })]);
    await ready();
    open();
    fireEvent.click(screen.getByRole("button", { name: /Tambah tingkat/ }));
    const qty2 = input(/^Min\. jumlah tingkat 2/);
    expect(document.activeElement).toBe(qty2);
    fireEvent.change(qty2, { target: { value: "5" } });
    fireEvent.change(input(/^Harga \/ pcs tingkat 2/), { target: { value: "8000" } });
    const order = () => screen.getAllByLabelText(/^Min\. jumlah tingkat/).map((el) => (el as HTMLInputElement).value);
    expect(order()).toEqual(["10", "5"]);
    expect(document.activeElement).toBe(qty2);
    for (const [qty, price] of [["20", "8500"], ["30", "8000"], ["40", "7500"]]) {
      fireEvent.click(screen.getByRole("button", { name: /Tambah tingkat/ }));
      const rows = screen.getAllByLabelText(/^Min\. jumlah tingkat/);
      const n = rows.length;
      fireEvent.change(rows[n - 1], { target: { value: qty } });
      fireEvent.change(input(new RegExp(`^Harga / pcs tingkat ${n}`)), { target: { value: price } });
    }
    expect(screen.queryByRole("button", { name: /Tambah tingkat/ })).toBeNull();
    expect(screen.getByText("Maksimal 5 tingkat")).toBeTruthy();
    // qty 5 berharga 8000 sementara qty 10 berharga 9000: harga naik terhadap tingkat sebelumnya, ditolak
    await save();
    expect(posts).toHaveLength(0);
    fireEvent.change(input(/^Harga \/ pcs tingkat 2/), { target: { value: "9900" } });
    await save();
    expect(posts).toHaveLength(1);
    expect(posts[0].body.variants[0].bulk_pricing!.tiers.map((t)  => t.min_qty)).toEqual([5, 10, 20, 30, 40]);
  });

  it("server 409 mempertahankan isian dan menampilkan pesan; 400 sama", async () => {
    const { posts } = setup([variant()], { status: 409, body: { error: "stale_variant", message: "Varian berubah oleh admin lain. Muat ulang lalu simpan lagi." } });
    await ready();
    open();
    fireEvent.change(input(/^Harga \/ pcs tingkat 1/), { target: { value: "8800" } });
    await save();
    expect(posts).toHaveLength(1);
    expect(screen.getByRole("alert").textContent).toMatch(/berubah oleh admin lain/);
    expect(input(/^Harga \/ pcs tingkat 1/).value).toBe("8800");
    expect(screen.getByText("Perubahan belum disimpan")).toBeTruthy();
    // Kontrol aktif lagi setelah gagal
    expect((screen.getByRole("button", { name: /Simpan Semua/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("konfigurasi rusak: peringatan perbaikan, edit lain tidak mengirim bulk, tidak dihapus diam-diam", async () => {
    const { posts } = setup([variant({ bulk_pricing: { enabled: false, tiers: [] }, bulk_pricing_corrupt: true })]);
    await ready();
    expect(screen.getByText("Perlu diperbaiki")).toBeTruthy();
    open();
    expect(screen.getByText(/tidak valid, jadi tidak dipakai pembeli/)).toBeTruthy();
    fireEvent.change(input(/Nama varian/), { target: { value: "Premium" } });
    await save();
    expect(posts).toHaveLength(1);
    expect("bulk_pricing" in posts[0].body.variants[0]).toBe(false);
  });

  it("duplikasi menyalin tier valid sebagai dirty dan mengirimkannya; varian baru bisa mengatur tier sebelum disimpan", async () => {
    const { posts } = setup([variant()]);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /Duplikasi/ }));
    const copy = screen.getAllByTestId(/-summary$/)[1];
    expect(copy.textContent).toBe("10+ Rp9.000 · 50+ Rp8.000");
    fireEvent.change(screen.getAllByLabelText(/^SKU/)[1], { target: { value: "GPT-2M" } });
    await save();
    expect(posts[0].body.variants).toHaveLength(2);
    expect("bulk_pricing" in posts[0].body.variants[0]).toBe(false);
    expect(posts[0].body.variants[1].bulk_pricing!.tiers).toHaveLength(2);
    expect(posts[0].body.variants[1].id).toBeUndefined();
  });

  it("varian baru: aktifkan harga grosir menyisipkan baris pertama terfokus", async () => {
    setup([]);
    await screen.findByText(/belum memiliki varian/);
    fireEvent.click(screen.getByRole("button", { name: /Tambah varian pertama/ }));
    const toggle = screen.getByRole("checkbox", { name: /Harga grosir/ });
    fireEvent.click(toggle);
    expect(document.activeElement).toBe(screen.getByLabelText(/^Min\. jumlah tingkat 1/));
    expect(screen.getByRole("button", { name: /Tutup harga grosir/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("menghapus tingkat tersimpan terakhir meminta konfirmasi; tingkat lain langsung; fokus berpindah", async () => {
    const { posts } = setup([variant({ bulk_pricing: { enabled: true, tiers: [{ min_qty: 10, unit_price: 9000 }, { min_qty: 50, unit_price: 8000 }] } })]);
    await ready();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Hapus tingkat 50 pcs" }));
    expect(screen.queryByRole("alertdialog", { name: "Hapus tingkat terakhir?" })).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Hapus tingkat 10 pcs");
    fireEvent.click(screen.getByRole("button", { name: "Hapus tingkat 10 pcs" }));
    const dialog = screen.getByRole("alertdialog", { name: "Hapus tingkat terakhir?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Batal" }));
    expect(screen.getAllByLabelText(/^Min\. jumlah tingkat/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Hapus tingkat 10 pcs" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Hapus tingkat terakhir?" })).getByRole("button", { name: "Hapus tingkat" }));
    expect(screen.queryAllByLabelText(/^Min\. jumlah tingkat/)).toHaveLength(0);
    expect(document.activeElement).toBe(document.getElementById("bulk-11-add"));
    // enabled + 0 tier => ditolak klien
    await save();
    expect(posts).toHaveLength(0);
    expect(screen.getAllByRole("alert")[0].textContent).toMatch(/Perbaiki 1 isian/);
  });

  it("saat menyimpan semua kontrol tier dinonaktifkan", async () => {
    let release: (value: unknown) => void = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") { await gate; return { ok: true, status: 200, json: async () => ({}) }; }
      if (url.startsWith("/api/admin/variants")) return { ok: true, status: 200, json: async () => ({ variants: [variant()], aliases: [] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    }));
    render(<ToastProvider><VariantEditor productId={7} productName="ChatGPT" onClose={() => {}} /></ToastProvider>);
    await ready();
    open();
    fireEvent.change(input(/^Harga \/ pcs tingkat 1/), { target: { value: "8800" } });
    await save();
    expect(input(/^Harga \/ pcs tingkat 1/).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Tambah tingkat/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Harga grosir/ }) as HTMLInputElement).disabled).toBe(true);
    await act(async () => { release(null); });
  });
});
