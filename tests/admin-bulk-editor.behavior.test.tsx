// @vitest-environment jsdom
//
// Editor harga grosir admin — kontrak validasi (cermin server) + interaksi
// BulkTierEditor di jalur editor AKTIF (`ProductVariantRows`, dirender oleh
// ProductEditorModal). File ini dulu menguji VariantEditor yang sudah dihapus
// sebagai komponen mati; cakupan interaksi dipindahkan ke komponen yang
// benar-benar dipakai admin. Simpan/payload di modal tetap dicakup
// tests/admin-bulk-scope.behavior.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { useState } from "react";
import { render } from "./setup/admin-render";
import { ProductVariantRows } from "@/components/admin/sections/ProductVariantRows";
import { bulkDraftFromApi, validateBulkDraft, type BulkContext, type BulkDraft } from "@/components/admin/BulkTierEditor";
import { validateBulkPricing } from "@/lib/bulk-pricing";
import { ToastProvider } from "@/components/ui/Toast";
import type { FormVariant, ProductForm } from "@/components/admin/product-types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function variant(overrides: Partial<FormVariant> = {}): FormVariant {
  return {
    id: 11, sku: "GPT-1M", label: "Premium 1 Bulan", price: 10000, stock: -1, min_qty: 1,
    fulfillment_mode: "manual", is_active: 1,
    bulk: bulkDraftFromApi({ enabled: true, tiers: [{ min_qty: 10, unit_price: 9000 }, { min_qty: 50, unit_price: 8000 }] }),
    ...overrides,
  };
}

type Capture = { current: FormVariant[]; setPrice: (price: number) => void; setLabel: (label: string) => void };

function Harness({ initial, capture }: { initial: FormVariant[]; capture: Capture }) {
  const [variants, setVariants] = useState(initial);
  capture.current = variants;
  capture.setPrice = (price) => setVariants((prev) => prev.map((item) => ({ ...item, price })));
  capture.setLabel = (label) => setVariants((prev) => prev.map((item) => ({ ...item, label })));
  return <ProductVariantRows
    form={{ supplier: "Manual", slug: "chatgpt" } as ProductForm}
    formVariants={variants}
    onSetFormVariants={(updater) => setVariants((prev) => updater(prev))}
    productId={7}
    editing
  />;
}

function setup(variants: FormVariant[]) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
  const capture: Capture = { current: variants, setPrice: () => {}, setLabel: () => {} };
  render(<ToastProvider><Harness initial={variants} capture={capture} /></ToastProvider>);
  return capture;
}

const open = () => fireEvent.click(screen.getByRole("button", { name: /Atur harga grosir/ }));
const input = (n: RegExp) => screen.getByLabelText(n) as HTMLInputElement;
const bulkOf = (capture: { current: FormVariant[] }) => capture.current[0].bulk!;
const ctx = (capture: { current: FormVariant[] }): BulkContext => ({
  base: Number(capture.current[0].price), minQty: Math.max(1, Number(capture.current[0].min_qty ?? 1) || 1),
  stock: Number(capture.current[0].stock), mode: capture.current[0].fulfillment_mode || "manual",
});

describe("validateBulkDraft (cermin kontrak server)", () => {
  const base: BulkContext = { base: 10000, minQty: 1, stock: -1, mode: "manual" };
  const draft = (enabled: boolean, rows: [string, string][]): BulkDraft => ({
    enabled, touched: true, open: true, storedInvalid: false,
    rows: rows.map(([qty, price], i) => ({ key: `k${i}`, qty, price, saved: false })),
  });

  it("payload terurut naik, integer, dan lolos validator server", () => {
    const v = validateBulkDraft(draft(true, [["50", "8000"], ["10", "9000"]]), base);
    expect(v.errorCount).toBe(0);
    expect(v.payload).toEqual({ enabled: true, tiers: [{ min_qty: 10, unit_price: 9000 }, { min_qty: 50, unit_price: 8000 }] });
    expect(validateBulkPricing(v.payload, 10000)).not.toBeNull();
  });

  it("min. 2, ambang boleh sama dengan Min. beli, desimal/eksponen/ribuan ditolak apa adanya", () => {
    expect(validateBulkDraft(draft(true, [["1", "9000"]]), base).errors.k0?.qty).toMatch(/minimal 2/);
    expect(validateBulkDraft(draft(true, [["5", "9000"]]), { ...base, minQty: 5 }).errorCount).toBe(0);
    for (const raw of ["9.000", "9e3", "9,5", "1.5", "-1", " ", "abc"]) {
      const v = validateBulkDraft(draft(true, [["10", raw]]), base);
      expect(v.errors.k0?.price, raw).toBeTruthy();
      expect(v.payload).toBeNull();
    }
    expect(validateBulkDraft(draft(true, [["1e1", "9000"]]), base).errors.k0?.qty).toBeTruthy();
  });

  it("duplikat, harga > dasar, harga naik, dan enabled tanpa baris adalah error", () => {
    expect(validateBulkDraft(draft(true, [["10", "9000"], ["10", "8000"]]), base).errors.k1?.qty).toMatch(/sudah dipakai/);
    expect(validateBulkDraft(draft(true, [["10", "10001"]]), base).errors.k0?.price).toMatch(/harga dasar/);
    expect(validateBulkDraft(draft(true, [["10", "8000"], ["20", "9000"]]), base).errors.k1?.price).toMatch(/tingkat 10 pcs/);
    expect(validateBulkDraft(draft(true, []), base).groupError).toMatch(/minimal satu tingkat/);
  });

  it("disabled: hanya bentuk; harga basi di atas dasar boleh, tetapi tidak saat diaktifkan", () => {
    const rows: [string, string][] = [["10", "9000"], ["50", "8000"]];
    const stale = { ...base, base: 7000 };
    const off = validateBulkDraft(draft(false, rows), stale);
    expect(off.errorCount).toBe(0);
    expect(off.notes.length).toBe(1);
    expect(off.payload).toEqual({ enabled: false, tiers: [{ min_qty: 10, unit_price: 9000 }, { min_qty: 50, unit_price: 8000 }] });
    expect(validateBulkPricing(off.payload, 7000)).not.toBeNull();
    expect(validateBulkDraft(draft(true, rows), stale).errorCount).toBe(2);
    // bentuk tetap diperiksa saat disabled
    expect(validateBulkDraft(draft(false, [["10", "8000"], ["20", "9000"]]), base).errorCount).toBe(1);
    expect(validateBulkDraft(draft(false, []), base).payload).toEqual({ enabled: false, tiers: [] });
  });

  it("peringatan non-blocking: harga sama, melebihi batas, stok", () => {
    const eq = validateBulkDraft(draft(true, [["10", "10000"]]), base);
    expect(eq.errorCount).toBe(0);
    expect(eq.warnings.k0?.price).toMatch(/tidak ada potongan/);
    expect(validateBulkDraft(draft(true, [["12", "9000"]]), { ...base, mode: "unique" }).warnings.k0?.qty).toMatch(/batas 10/);
    expect(validateBulkDraft(draft(true, [["150", "9000"]]), base).warnings.k0?.qty).toMatch(/batas 100/);
    const stock = validateBulkDraft(draft(true, [["20", "9000"]]), { ...base, stock: 15 });
    expect(stock.warnings.k0?.qty).toMatch(/Stok saat ini 15/);
    expect(stock.payload).not.toBeNull();
  });

  it("konfigurasi tersimpan rusak yang tidak disentuh tidak divalidasi dan tanpa payload", () => {
    const bad = bulkDraftFromApi({ enabled: false, tiers: [] }, true);
    const v = validateBulkDraft(bad, base);
    expect(v.errorCount).toBe(0);
    expect(v.payload).toBeNull();
  });
});

describe("BulkTierEditor di jalur editor aktif (ProductVariantRows)", () => {
  it("ringkasan tingkat tersimpan tampil saat bagian tertutup", () => {
    setup([variant()]);
    expect(screen.getByTestId("bulk-11-summary").textContent).toBe("10+ Rp9.000 · 50+ Rp8.000");
  });

  it("edit tingkat menyimpan nilai apa adanya dan menandai draft berubah", () => {
    const capture = setup([variant()]);
    open();
    fireEvent.change(input(/^Harga \/ pcs tingkat 1/), { target: { value: "8500" } });
    expect(bulkOf(capture).touched).toBe(true);
    expect(validateBulkDraft(bulkOf(capture), ctx(capture)).payload)
      .toEqual({ enabled: true, tiers: [{ min_qty: 10, unit_price: 8500 }, { min_qty: 50, unit_price: 8000 }] });
  });

  it("matikan lalu nyalakan lagi mempertahankan semua tier; mematikan tidak menghapus", () => {
    const capture = setup([variant()]);
    const toggle = screen.getByRole("checkbox", { name: /Harga grosir/ }) as HTMLInputElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(bulkOf(capture).enabled).toBe(false);
    expect(bulkOf(capture).rows).toHaveLength(2);
    expect(screen.getByTestId("bulk-11-summary").textContent).toBe("Pengaturan disimpan; harga grosir tidak berlaku.");
    expect(validateBulkDraft(bulkOf(capture), ctx(capture)).payload)
      .toEqual({ enabled: false, tiers: [{ min_qty: 10, unit_price: 9000 }, { min_qty: 50, unit_price: 8000 }] });
  });

  it("nilai mentah tidak dikoersi: ribuan tetap apa adanya dan ditandai tidak valid", () => {
    const capture = setup([variant()]);
    open();
    fireEvent.change(input(/^Harga \/ pcs tingkat 2/), { target: { value: "8.000" } });
    const reopened = input(/^Harga \/ pcs tingkat 2/);
    expect(reopened.value).toBe("8.000");
    expect(bulkOf(capture).rows[1].price).toBe("8.000");
    expect(validateBulkDraft(bulkOf(capture), ctx(capture)).errorCount).toBe(1);
    expect(within(document.getElementById("bulk-11-body")!).getByText(/tanpa titik/)).toBeTruthy();
  });

  it("ambang sama dengan Min. beli valid; perubahan harga dasar memvalidasi ulang langsung", () => {
    const capture = setup([variant({ min_qty: 10 })]);
    open();
    expect(validateBulkDraft(bulkOf(capture), ctx(capture)).errorCount).toBe(0);
    act(() => capture.setPrice(8500));
    expect(validateBulkDraft(bulkOf(capture), ctx(capture)).errorCount).toBeGreaterThan(0);
    expect(within(document.getElementById("bulk-11-body")!).getByText(/Harga: Tidak boleh lebih mahal dari harga dasar \(Rp8\.500\)/)).toBeTruthy();
  });

  it("disabled dengan harga basi vs dasar baru boleh disimpan tanpa error", () => {
    const capture = setup([variant({ bulk: bulkDraftFromApi({ enabled: false, tiers: [{ min_qty: 10, unit_price: 9000 }] }) })]);
    act(() => capture.setPrice(8000));
    expect(validateBulkDraft(bulkOf(capture), ctx(capture)).errorCount).toBe(0);
  });

  it("baris tidak diurutkan saat mengetik, payload diurutkan setelah validasi; maksimal 5 tingkat", () => {
    const capture = setup([variant({ bulk: bulkDraftFromApi({ enabled: true, tiers: [{ min_qty: 10, unit_price: 9000 }] }) })]);
    open();
    fireEvent.click(screen.getByRole("button", { name: /Tambah tingkat/ }));
    const qty2 = input(/^Min\. jumlah tingkat 2/);
    fireEvent.change(qty2, { target: { value: "5" } });
    fireEvent.change(input(/^Harga \/ pcs tingkat 2/), { target: { value: "8000" } });
    const order = () => screen.getAllByLabelText(/^Min\. jumlah tingkat/).map((el) => (el as HTMLInputElement).value);
    expect(order()).toEqual(["10", "5"]);
    for (const [qty, price] of [["20", "8500"], ["30", "8000"], ["40", "7500"]]) {
      fireEvent.click(screen.getByRole("button", { name: /Tambah tingkat/ }));
      const rows = screen.getAllByLabelText(/^Min\. jumlah tingkat/);
      const n = rows.length;
      fireEvent.change(rows[n - 1], { target: { value: qty } });
      fireEvent.change(input(new RegExp(`^Harga / pcs tingkat ${n}`)), { target: { value: price } });
    }
    expect(screen.queryByRole("button", { name: /Tambah tingkat/ })).toBeNull();
    expect(screen.getByText("Maksimal 5 tingkat")).toBeTruthy();
    // qty 5 berharga 8000 sementara qty 10 berharga 9000: harga naik, ditolak
    const invalid = validateBulkDraft(bulkOf(capture), ctx(capture));
    expect(invalid.errorCount).toBeGreaterThan(0);
    expect(invalid.sorted.map((row) => row.qty)).toEqual([5, 10, 20, 30, 40]);
    fireEvent.change(input(/^Harga \/ pcs tingkat 2/), { target: { value: "9900" } });
    const valid = validateBulkDraft(bulkOf(capture), ctx(capture));
    expect(valid.errorCount).toBe(0);
    expect(valid.payload!.tiers.map((t) => t.min_qty)).toEqual([5, 10, 20, 30, 40]);
  });

  it("konfigurasi rusak: peringatan perbaikan dan tidak dihapus diam-diam", () => {
    const capture = setup([variant({ bulk: bulkDraftFromApi({ enabled: false, tiers: [] }, true) })]);
    expect(screen.getByText("Perlu diperbaiki")).toBeTruthy();
    open();
    expect(screen.getByText(/tidak valid, jadi tidak dipakai pembeli/)).toBeTruthy();
    // Edit lain di form tidak menyentuh draft rusak: payload tetap dihilangkan.
    act(() => capture.setLabel("Premium"));
    expect(bulkOf(capture).touched).toBe(false);
    expect(validateBulkDraft(bulkOf(capture), ctx(capture)).payload).toBeNull();
  });

  it("menghapus tingkat tersimpan terakhir meminta konfirmasi; tingkat lain langsung", () => {
    const capture = setup([variant()]);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Hapus tingkat 50 pcs" }));
    expect(screen.queryByRole("alertdialog", { name: "Hapus tingkat terakhir?" })).toBeNull();
    expect(bulkOf(capture).rows).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Hapus tingkat 10 pcs" }));
    const dialog = screen.getByRole("alertdialog", { name: "Hapus tingkat terakhir?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Batal" }));
    expect(bulkOf(capture).rows).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Hapus tingkat 10 pcs" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Hapus tingkat terakhir?" })).getByRole("button", { name: "Hapus tingkat" }));
    expect(bulkOf(capture).rows).toHaveLength(0);
    // enabled + 0 tier => ditolak validator
    expect(validateBulkDraft(bulkOf(capture), ctx(capture)).groupError).toMatch(/minimal satu tingkat/);
  });
});
