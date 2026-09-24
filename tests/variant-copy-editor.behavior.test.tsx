// @vitest-environment jsdom
//
// tests/variant-copy-editor.behavior.test.tsx — Editor S&K + cara aktivasi
// per varian di panel admin (migrasi 0041) dan penandanya di daftar produk.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { VariantCopyEditor } from "@/components/admin/sections/VariantCopyEditor";
import { ProductsSection } from "@/components/admin/sections/ProductsSection";
import type { VariantCopyEntry } from "@/lib/product-copy/format";
import type { Prod } from "@/components/admin/product-types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const base: VariantCopyEntry = {
  variantId: 13,
  label: "Premium Legal",
  isActive: true,
  wrManaged: true,
  status: "axvara",
  adminStale: false,
  needsReview: false,
  hasOverride: false,
  adminTerms: "",
  adminActivation: "",
  autoTerms: "Detail paket:\n- Paket Premium Ultra HD 4K\n\nGaransi:\n- Perbaikan garansi 1x24 jam",
  autoActivation: "1. Login di aplikasi",
  supplierTerms: "Plan: Premium Ultra HD 4K\nGaransi fixing 1x24 jam",
  supplierActivation: "",
};

function renderEditor(entry: VariantCopyEntry, onSaved = vi.fn()) {
  render(
    <ToastProvider>
      <VariantCopyEditor variantId={entry.variantId} entry={entry} loading={false} error={null} onSaved={onSaved} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Syarat & Ketentuan · Cara Aktivasi/ }));
  return { onSaved };
}

function stubSave(returned: Partial<VariantCopyEntry>) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, variant: { ...base, ...JSON.parse(String(init?.body ?? "{}")), ...returned } }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("VariantCopyEditor", () => {
  it("terlipat dengan status; dibuka berisi salinan yang sedang tampil + teks asli WR sebagai pembanding", () => {
    renderEditor(base);
    expect(screen.getByText("Versi Axvara (otomatis)")).toBeTruthy();
    expect((screen.getByLabelText("Syarat & Ketentuan") as HTMLTextAreaElement).value).toBe(base.autoTerms);
    expect((screen.getByLabelText("Cara Aktivasi") as HTMLTextAreaElement).value).toBe(base.autoActivation);
    expect(screen.getByText("Teks asli WR (pembanding)")).toBeTruthy();
    // Belum ada perubahan → tidak ada yang perlu disimpan.
    expect((screen.getByRole("button", { name: "Simpan S&K varian" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Pakai versi otomatis" })).toBeNull();
  });

  it("menyunting lalu menyimpan mengirim teks varian ke endpoint khusus", async () => {
    const fetchMock = stubSave({ status: "admin", hasOverride: true });
    const { onSaved } = renderEditor(base);
    const terms = screen.getByLabelText("Syarat & Ketentuan");
    fireEvent.change(terms, { target: { value: `${base.autoTerms}\n- Dilarang berbagi akun` } });
    expect(screen.getByText("Belum disimpan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Simpan S&K varian" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/variant-copy");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({ variant_id: 13, terms: `${base.autoTerms}\n- Dilarang berbagi akun`, activation: base.autoActivation });
    expect(onSaved.mock.calls[0][0]).toMatchObject({ status: "admin", hasOverride: true });
  });

  it("suntingan dijeda: peringatan tampil, teks admin dimuat, bisa ditandai sudah ditinjau tanpa mengubah", async () => {
    const stale: VariantCopyEntry = { ...base, status: "pemasok", adminStale: true, needsReview: true, hasOverride: true, adminTerms: "Aturan pakai:\n- Dilarang berbagi akun", adminActivation: "" };
    const fetchMock = stubSave({ status: "admin", adminStale: false, needsReview: false });
    renderEditor(stale);
    expect(screen.getByText("WR mengubah teks — suntingan dijeda")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Pembeli sekarang melihat teks WR terbaru");
    expect((screen.getByLabelText("Syarat & Ketentuan") as HTMLTextAreaElement).value).toBe(stale.adminTerms);
    const confirm = screen.getByRole("button", { name: "Tandai sudah ditinjau" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).terms).toBe(stale.adminTerms);
  });

  it("'Pakai versi otomatis' menghapus suntingan (teks kosong)", async () => {
    const fetchMock = stubSave({ status: "axvara", hasOverride: false });
    renderEditor({ ...base, status: "admin", hasOverride: true, adminTerms: "Garansi:\n- Garansi 7 hari" });
    fireEvent.click(screen.getByRole("button", { name: "Pakai versi otomatis" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ variant_id: 13, terms: "", activation: "" });
  });

  it("teks WR yang belum dikurasi diberi ajakan menulis versi Axvara", () => {
    renderEditor({ ...base, status: "pemasok", needsReview: true });
    expect(screen.getByText("Teks WR — belum versi Axvara")).toBeTruthy();
    expect(screen.getByText(/Tulis versi Axvara di bawah/)).toBeTruthy();
  });

  it("varian baru (belum punya ID) diminta disimpan dulu", () => {
    render(<ToastProvider><VariantCopyEditor loading={false} error={null} onSaved={vi.fn()} /></ToastProvider>);
    expect(screen.getByText(/Simpan produk terlebih dahulu/)).toBeTruthy();
  });
});

describe("daftar produk admin", () => {
  it("produk dengan S&K varian yang perlu ditinjau diberi penanda", () => {
    const prod = (id: string, copyReview: number): Prod => ({
      id, slug: `p-${id}`, name: `Produk ${id}`, description: "", price: 1000, categorySlug: "akun-premium",
      image: "", images: [], soldCount: 0, stock: 1, isActive: true, copyReview,
    });
    const list = [prod("1", 2), prod("2", 0)];
    render(
      <ProductsSection
        prods={list} paged={list} filtered={list} q="" safePage={1} totalPages={1} perPage={20}
        loadingList={false} toggling={null} activeProducts={2} lowStock={0} soldProducts={0}
        onQueryChange={vi.fn()} onPageChange={vi.fn()} onlyLowStock={false} onClearLowStock={vi.fn()}
        onNew={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onToggleActive={vi.fn()}
      />,
    );
    // Tampil di kartu mobile dan baris tabel desktop.
    expect(screen.getAllByText("S&K perlu ditinjau · 2 varian")).toHaveLength(2);
    expect(screen.queryByText(/S&K perlu ditinjau · 0/)).toBeNull();
  });
});
