// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
//
// tests/variant-copy-editor.behavior.test.tsx — Editor S&K + cara aktivasi
// per varian di panel admin (migrasi 0041) dan penandanya di daftar produk.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render } from "./setup/admin-render";
import { ToastProvider } from "@/components/ui/Toast";
import { VariantCopyEditor } from "@/components/admin/sections/VariantCopyEditor";
import { ProductsSection } from "@/components/admin/sections/ProductsSection";
import { ProductEditorModal } from "@/components/admin/ProductEditorModal";
import type { VariantCopyEntry } from "@/lib/product-copy/format";
import type { FormVariant, Prod, ProductForm } from "@/components/admin/product-types";
import { useState } from "react";
import { act } from "@testing-library/react";
import { ProductVariantRows, NonWrFulfillmentPanel } from "@/components/admin/sections/ProductVariantRows";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const base: VariantCopyEntry = {
  variantId: 13,
  label: "Premium Legal",
  isActive: true,
  wrManaged: true,
  supplier: "WR",
  supplierKey: "fixture-key",
  effectiveTerms: "Detail paket:\n- Paket Premium Ultra HD 4K",
  effectiveActivation: "1. Login di aplikasi",
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
  it("shows automatic supplier processing instead of local manual fulfillment controls", () => {
    vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({})})));
    const update=vi.fn();
    render(<ProductVariantRows form={{slug:"muse-ai-1-miliar-token",supplier:"Manual"}} formVariants={[{id:279,sku:"TUNVN-BUFF-1B",label:"Buff",price:1500,stock:-1,is_active:1,fulfillment_mode:"manual"}]} onSetFormVariants={update} productId={112}/>);
    fireEvent.click(screen.getByRole("button",{name:/Buff/}));
    expect(screen.getByText(/Diproses otomatis setelah pembayaran/)).toBeTruthy();
    expect(screen.queryByText(/Badge pembeli: Made By Order/)).toBeNull();
    expect(document.querySelector('select option[value="shared"]')).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
  it("SK terisi otomatis; konflik mempertahankan draft dan pratinjau mencakup deskripsi", async () => {
    const onReload = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: "Teks supplier berubah" }) })));
    const entry = { ...base, supplier: "SK" as const, wrManaged: false };
    const view = render(<ToastProvider><VariantCopyEditor variantId={13} entry={entry} loading={false} error={null} onSaved={vi.fn()} onReload={onReload} description={"Syarat & Ketentuan:\n- Aturan bersama"} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Syarat & Ketentuan/ }));
    expect(screen.getByLabelText("Syarat & Ketentuan")).toHaveProperty("value", base.autoTerms);
    fireEvent.change(screen.getByLabelText("Syarat & Ketentuan"), { target: { value: "Aturan pakai:\n- Draft SK" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan S&K varian" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /Muat sumber terbaru/ }));
    expect(onReload).toHaveBeenCalledOnce();
    view.rerender(<ToastProvider><VariantCopyEditor variantId={13} entry={{ ...entry, autoTerms: "Sumber baru", supplierKey: "new-key" }} loading={false} error={null} onSaved={vi.fn()} description={"Syarat & Ketentuan:\n- Aturan bersama"} /></ToastProvider>);
    expect(screen.getByLabelText("Syarat & Ketentuan")).toHaveProperty("value", "Aturan pakai:\n- Draft SK");
    fireEvent.click(screen.getByText("Pratinjau setelah disimpan"));
    expect(screen.getByText("Aturan bersama")).toBeTruthy();
    expect(screen.getByText("Draft SK")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Batalkan perubahan" }));
    expect(screen.getByLabelText("Syarat & Ketentuan")).toHaveProperty("value", "Sumber baru");
  });
  it("own-stock common instructions survive switching the variant accordion", () => {
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({})})));
    function Form() {
      const [values,setValues]=useState<FormVariant[]>([{id:1,sku:'HEAD',label:'Head',price:14000,stock:1,is_active:1,fulfillment_mode:'unique'},{id:2,sku:'INVITE',label:'Invite',price:12000,stock:-1,is_active:1,fulfillment_mode:'shared'}]);
      return <ProductVariantRows form={{name:'Own',supplier:'Manual'}} formVariants={values} onSetFormVariants={setValues} productId={1}/>;
    }
    render(<ToastProvider><Form/></ToastProvider>);
    fireEvent.change(within(screen.getByRole('region',{name:/Pengaturan varian Head/})).getByLabelText('S&K bersama'),{target:{value:'- Jangan bagikan link'}});
    fireEvent.click(screen.getByRole('button',{name:/^Invite/}));
    expect((within(screen.getByRole('region',{name:/Pengaturan varian Invite/})).getByLabelText('S&K bersama') as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(within(screen.getByRole('region',{name:/Pengaturan varian Invite/})).getByLabelText('Cara penggunaan / aktivasi bersama'),{target:{value:'1. Terima undangan'}});
    fireEvent.click(screen.getByRole('button',{name:/^Head/}));
    expect((within(screen.getByRole('region',{name:/Pengaturan varian Head/})).getByLabelText('S&K bersama') as HTMLTextAreaElement).value).toBe('- Jangan bagikan link');
    fireEvent.click(screen.getByRole('button',{name:/^Invite/}));
    expect((within(screen.getByRole('region',{name:/Pengaturan varian Invite/})).getByLabelText('Cara penggunaan / aktivasi bersama') as HTMLTextAreaElement).value).toBe('1. Terima undangan');
  });

  it("late inventory load cannot overwrite stock after its variant panel has unmounted", async () => {
    let resolve!: (value:unknown)=>void;
    const response=new Promise(r=>{resolve=r;});
    vi.stubGlobal('fetch',vi.fn(()=>response));
    const onStockChange=vi.fn();
    const rendered=render(<ToastProvider><NonWrFulfillmentPanel productId={1} variantId={101} mode='unique' onStockChange={onStockChange}/></ToastProvider>);
    rendered.unmount();
    await act(async()=>resolve({ok:true,json:async()=>({available:99})}));
    expect(onStockChange).not.toHaveBeenCalled();
  });
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
    expect(JSON.parse(String(init?.body))).toMatchObject({ variant_id: 13, terms: `${base.autoTerms}\n- Dilarang berbagi akun`, activation: base.autoActivation, terms_en: "", activation_en: "", supplier_key: base.supplierKey });
    expect(onSaved.mock.calls[0][0]).toMatchObject({ status: "admin", hasOverride: true });
  });

  it("suntingan dijeda: peringatan tampil, teks admin dimuat, bisa ditandai sudah ditinjau tanpa mengubah", async () => {
    const stale: VariantCopyEntry = { ...base, status: "pemasok", adminStale: true, needsReview: true, hasOverride: true, adminTerms: "Aturan pakai:\n- Dilarang berbagi akun", adminActivation: "" };
    const fetchMock = stubSave({ status: "admin", adminStale: false, needsReview: false });
    renderEditor(stale);
    expect(screen.getByText("WR mengubah teks — suntingan dijeda")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Pembeli melihat versi otomatis terbaru");
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
    fireEvent.click(screen.getByRole("button", { name: "Kembali ke versi otomatis" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ variant_id: 13, terms: "", activation: "", terms_en: "", activation_en: "", supplier_key: base.supplierKey });
  });

  it("teks WR yang belum dikurasi diberi ajakan menulis versi Axvara", () => {
    renderEditor({ ...base, status: "pemasok", needsReview: true });
    expect(screen.getByText("Teks WR — belum versi Axvara")).toBeTruthy();
    expect(screen.getByText(/langsung menyunting teks di bawah/)).toBeTruthy();
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
        supplierFilter="all" onSupplierFilterChange={vi.fn()}
        liveProducts={2} hiddenProducts={0} offProducts={0} liveTab="all" onLiveTabChange={vi.fn()} perPageAdmin={20} onPerPageChange={vi.fn()}
        onNew={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onToggleActive={vi.fn()}
        reordering={null} onMove={vi.fn()} onJump={vi.fn()} onSoldCount={vi.fn()}
      />,
    );
    // Tampil di kartu mobile dan baris tabel desktop.
    expect(screen.getAllByText("S&K perlu ditinjau · 2 varian")).toHaveLength(2);
    expect(screen.queryByText(/S&K perlu ditinjau · 0/)).toBeNull();
  });
});

describe("editor produk: tab Deskripsi & S&K (terpisah dari tab Varian)", () => {
  const variants: FormVariant[] = [
    { id: 12, sku: "WR-12", label: "Premium Anti Limit", duration_label: "28 Hari", price: 35000, stock: 0, is_active: 1, wr_auto_managed: 1 },
    { id: 13, sku: "WR-13", label: "Premium Legal", duration_label: "28 Hari", price: 55000, stock: 3, is_active: 1, wr_auto_managed: 1 },
  ];
  const entries: VariantCopyEntry[] = [
    { ...base, variantId: 12, label: "Premium Anti Limit" },
    { ...base, variantId: 13, status: "pemasok", adminStale: true, needsReview: true, hasOverride: true, adminTerms: "Aturan pakai:\n- Dilarang berbagi akun" },
  ];

  function renderModal(form: ProductForm, formVariants = variants, onSetForm = vi.fn(), editing = true) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).startsWith("/api/admin/variant-copy") ? { variants: entries } : {}),
    })));
    render(
      <ToastProvider>
        <ProductEditorModal
          editing={editing} editingId={editing ? 1 : undefined} saving={false} uploading={false} loadingVariants={false}
          hasMultiVariants formError={null} form={form} formImages={[]} formVariants={formVariants} cats={[]}
          onRequestClose={vi.fn()} onSetForm={onSetForm} onSetFormImages={vi.fn()} onSetHasMultiVariants={vi.fn()}
          onSetFormVariants={vi.fn()} onUpload={vi.fn()} onSave={vi.fn()}
        />
      </ToastProvider>,
    );
    return { onSetForm };
  }

  const wrForm: ProductForm = { name: "Netflix Premium", slug: "netflix-premium", description: "Teks WR", adminDescriptionOverride: "Versi Axvara", wrManaged: true };

  it("dirty teks memblokir Simpan Produk, close dan Escape meminta izin; batal draft membuka simpan", async () => {
    renderModal(wrForm);
    await userEvent.click(screen.getByRole("tab", { name: /^Deskripsi & S&K/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Premium Anti Limit · 28 Hari/ }));
    fireEvent.change(screen.getByLabelText("Syarat & Ketentuan"), { target: { value: "Draft belum disimpan" } });
    expect(screen.getByRole("button", { name: /Simpan Produk$/ })).toHaveProperty("disabled", true);
    await userEvent.click(screen.getByRole("tab", { name: "Foto" }));
    fireEvent.click(screen.getByRole("button", { name: "Tutup editor produk" }));
    expect(screen.getByRole("alertdialog", { name: "Buang perubahan teks varian?" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Buang perubahan teks varian?" })).getByRole("button", { name: "Batal" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Edit Produk" }), { key: "Escape" });
    expect(screen.getByRole("alertdialog", { name: "Buang perubahan teks varian?" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Buang perubahan teks varian?" })).getByRole("button", { name: "Batal" }));
    await userEvent.click(screen.getByRole("tab", { name: /^Deskripsi & S&K/ }));
    expect(screen.getByLabelText("Syarat & Ketentuan")).toHaveProperty("value", "Draft belum disimpan");
    fireEvent.click(screen.getByRole("button", { name: "Batalkan perubahan" }));
    expect(screen.getByRole("button", { name: /Simpan Produk$/ })).toHaveProperty("disabled", false);
  });

  it("empat tab; deskripsi dan S&K per varian hanya ada di tab Deskripsi & S&K", async () => {
    renderModal(wrForm);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Produk", "Varian (2)", expect.stringMatching(/^Deskripsi & S&K/), "Foto",
    ]);
    // Tab Produk aktif: deskripsi tidak lagi di sini.
    expect(screen.queryByRole("textbox", { name: "Deskripsi khusus (override)" })).toBeNull();
    // Hanya panel tab aktif yang tampil (atribut hidden), bukan semua sekaligus.
    expect(screen.getAllByRole("tabpanel").map((p) => p.getAttribute("aria-labelledby"))).toEqual([screen.getByRole("tab", { name: "Produk" }).id]);

    await userEvent.click(screen.getByRole("tab", { name: /^Varian/ }));
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    const variantPanel = screen.getByRole("tabpanel", { name: /^Varian/ });
    expect(within(variantPanel).queryByText("Syarat & Ketentuan · Cara Aktivasi")).toBeNull();
    expect(within(variantPanel).getByRole("button", { name: /Premium Legal/ }).getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(screen.getByRole("tab", { name: /^Deskripsi & S&K/ }));
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: "Nama" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Nama (English)" })).toBeTruthy();
    const copyPanel = screen.getByRole("tabpanel", { name: /^Deskripsi & S&K/ });
    expect((within(copyPanel).getByRole("textbox", { name: "Deskripsi (dari WR)" }) as HTMLTextAreaElement).readOnly).toBe(true);
    expect((within(copyPanel).getByRole("textbox", { name: "Deskripsi khusus (override)" }) as HTMLTextAreaElement).value).toBe("Versi Axvara");
    const legal = await within(copyPanel).findByRole("button", { name: /Premium Legal · 28 Hari.*WR mengubah teks/ });
    expect(within(copyPanel).getByRole("button", { name: /Premium Anti Limit · 28 Hari.*Versi Axvara/ })).toBeTruthy();
    fireEvent.click(legal);
    expect((within(copyPanel).getByRole("textbox", { name: "Syarat & Ketentuan" }) as HTMLTextAreaElement).value).toBe("Aturan pakai:\n- Dilarang berbagi akun");
  });

  it("tab menampilkan jumlah varian yang S&K-nya perlu ditinjau", async () => {
    renderModal(wrForm);
    await waitFor(() => expect(screen.getByRole("tab", { name: /^Deskripsi & S&K/ }).textContent).toContain("1 varian S&K perlu ditinjau"));
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/admin/variant-copy?product_id=1")).toBe(true);
  });

  it("produk non-WR: kolom Deskripsi bisa diedit dari tab ini", async () => {
    const { onSetForm } = renderModal({ name: "Canva Pro", slug: "canva-premium", description: "Lama", wrManaged: false }, [
      { id: 1, sku: "CANVA-1", label: "Invite 1 Bulan", price: 2000, stock: -1, is_active: 1 },
      { id: 3, sku: "CANVA-3", label: "Head 1 Bulan", price: 5000, stock: 10, is_active: 0 },
    ]);
    await userEvent.click(screen.getByRole("tab", { name: /^Deskripsi & S&K/ }));
    const panel = screen.getByRole("tabpanel", { name: /^Deskripsi & S&K/ });
    expect(within(panel).queryByRole("textbox", { name: "Deskripsi khusus (override)" })).toBeNull();
    fireEvent.change(within(panel).getByRole("textbox", { name: "Deskripsi" }), { target: { value: "Baru" } });
    expect(onSetForm).toHaveBeenCalledWith(expect.objectContaining({ description: "Baru" }));
    expect(within(panel).getByText(/S&K dan cara penggunaan bersama diatur pada tab Varian/)).toBeTruthy();
  });

  it("produk baru: tanpa permintaan S&K ke server, varian diminta disimpan dulu", async () => {
    renderModal({ name: "Baru", slug: "baru" }, [{ sku: "BARU-1", label: "Paket 1", price: 50000, stock: -1, is_active: 1 }], vi.fn(), false);
    await userEvent.click(screen.getByRole("tab", { name: /^Deskripsi & S&K/ }));
    const panel = screen.getByRole("tabpanel", { name: /^Deskripsi & S&K/ });
    expect(within(panel).getByText(/Panduan tersimpan bersama Simpan Produk/)).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: /^Varian/ }));
    expect(screen.getByLabelText("S&K bersama")).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith("/api/admin/variant-copy"))).toBe(false);
  });
});

describe("editor produk mode single: paritas garansi + pengiriman + template (2026-09-28)", () => {
  const singleForm: ProductForm = {
    name: "Canva Single", slug: "canva-single", description: "desc",
    price: 7500, stock: 20, min_qty: 1,
    warranty_type: "full", warranty_value: 1, warranty_unit: "month",
    fulfillment_mode: "manual",
  };
  const defaultVariant: FormVariant[] = [
    { id: 4, sku: "DEFAULT-2", label: "Default", price: 7500, stock: 20, is_active: 1 },
  ];

  function renderSingleModal(form = singleForm, formVariants = defaultVariant) {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    const onSetForm = vi.fn();
    render(
      <ToastProvider>
        <ProductEditorModal
          editing editingId={2} saving={false} uploading={false} loadingVariants={false}
          hasMultiVariants={false} formError={null} form={form} formImages={[]} formVariants={formVariants} cats={[]}
          onRequestClose={vi.fn()} onSetForm={onSetForm} onSetFormImages={vi.fn()} onSetHasMultiVariants={vi.fn()}
          onSetFormVariants={vi.fn()} onUpload={vi.fn()} onSave={vi.fn()}
        />
      </ToastProvider>,
    );
    return { onSetForm };
  }

  it("tab Varian mode single menampilkan Min. Beli + Masa Garansi + Cara Pengiriman + Template pesan", async () => {
    renderSingleModal();
    await userEvent.click(screen.getByRole("tab", { name: /^Varian/ }));
    const panel = screen.getByRole("tabpanel", { name: /^Varian/ });
    expect(within(panel).getByText("Min. beli")).toBeTruthy();
    expect(within(panel).getByText("Masa garansi")).toBeTruthy();
    expect(within(panel).getByText("Cara pengiriman")).toBeTruthy();
    expect(within(panel).getByText("Template pesan untuk pembeli")).toBeTruthy();
    expect(within(panel).getByRole("textbox", { name: "Template pesan untuk pembeli" })).toBeTruthy();
  });

  it("mengubah garansi + pengiriman mode single memanggil onSetForm", async () => {
    const { onSetForm } = renderSingleModal();
    await userEvent.click(screen.getByRole("tab", { name: /^Varian/ }));
    const panel = screen.getByRole("tabpanel", { name: /^Varian/ });
    fireEvent.change(within(panel).getByRole("combobox", { name: "Masa garansi" }), { target: { value: "limited" } });
    expect(onSetForm).toHaveBeenCalledWith(expect.objectContaining({ warranty_type: "limited" }));
    fireEvent.change(within(panel).getByRole("combobox", { name: "Cara pengiriman" }), { target: { value: "shared" } });
    expect(onSetForm).toHaveBeenCalledWith(expect.objectContaining({ fulfillment_mode: "shared" }));
  });

  it("produk baru tanpa variantId: panel fulfillment meminta simpan dulu", async () => {
    renderSingleModal(singleForm, []);
    await userEvent.click(screen.getByRole("tab", { name: /^Varian/ }));
    const panel = screen.getByRole("tabpanel", { name: /^Varian/ });
    expect(within(panel).getByText(/Simpan produk terlebih dahulu/).textContent).toContain("agar varian punya ID");
  });
});
