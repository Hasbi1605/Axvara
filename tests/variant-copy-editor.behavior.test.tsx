// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
//
// tests/variant-copy-editor.behavior.test.tsx — Editor Deskripsi & S&K
// (CopyVariantTable, CopyEditorSheet, ProductCopyTab) dan penanda di daftar produk.
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render } from "./setup/admin-render";
import { ToastProvider } from "@/components/ui/Toast";
import { ProductCopyTab } from "@/components/admin/sections/ProductCopyTab";
import { useVariantCopyEntries } from "@/components/admin/sections/VariantCopyEditor";
import { ProductsSection } from "@/components/admin/sections/ProductsSection";
import { ProductEditorModal } from "@/components/admin/ProductEditorModal";
import { ProductVariantRows, NonWrFulfillmentPanel } from "@/components/admin/sections/ProductVariantRows";
import { AdminPortalContext } from "@/components/admin/ui/portal";
import type { VariantCopyEntry } from "@/lib/product-copy/format";
import type { FormVariant, Prod, ProductForm } from "@/components/admin/product-types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
  reviewKind: null,
  reviewed: false,
  hasOverride: false,
  adminTerms: "",
  adminActivation: "",
  adminTermsEn: "",
  adminActivationEn: "",
  autoTerms: "Detail paket:\n- Paket Premium Ultra HD 4K\n\nGaransi:\n- Perbaikan garansi 1x24 jam",
  autoActivation: "1. Login di aplikasi",
  supplierTerms: "Plan: Premium Ultra HD 4K\nGaransi fixing 1x24 jam",
  supplierActivation: "",
};

const defaultVariants: FormVariant[] = [
  { id: 12, sku: "WR-12", label: "Premium Anti Limit", duration_label: "28 Hari", price: 35000, stock: 0, is_active: 1, wr_auto_managed: 1 },
  { id: 13, sku: "WR-13", label: "Premium Legal", duration_label: "28 Hari", price: 55000, stock: 3, is_active: 1, wr_auto_managed: 1 },
];

function CopyTabHarness({
  initialForm,
  variants = defaultVariants,
  initialEntries,
  productId = 1,
  hasMultiVariants = true,
  onFormChange,
}: {
  initialForm: ProductForm;
  variants?: FormVariant[];
  initialEntries: VariantCopyEntry[];
  productId?: number;
  hasMultiVariants?: boolean;
  onFormChange?: (form: ProductForm) => void;
}) {
  const [form, setForm] = useState<ProductForm>(initialForm);
  const variantCopy = useVariantCopyEntries(productId);
  return (
    <ToastProvider>
      <ProductCopyTab
        productId={productId}
        form={form}
        onSetForm={(next) => {
          setForm(next);
          onFormChange?.(next);
        }}
        formVariants={variants}
        hasMultiVariants={hasMultiVariants}
        loadingVariants={false}
        variantCopy={{
          ...variantCopy,
          entries: variantCopy.entries.size > 0
            ? variantCopy.entries
            : new Map(initialEntries.map((e) => [e.variantId, e])),
        }}
      />
    </ToastProvider>
  );
}

describe("ProductCopyTab & CopyVariantTable & CopyEditorSheet", () => {
  it("renders status pills, EN completeness marker, sorts inactive variants last, and opens drawer with first-field focus", async () => {
    const entries: VariantCopyEntry[] = [
      { ...base, variantId: 10, status: "pemasok", reviewKind: "raw", needsReview: true, isActive: false },
      { ...base, variantId: 11, status: "admin", hasOverride: true, adminTerms: "Detail paket:\n- Custom", adminTermsEn: "Package details:\n- Custom EN" },
      { ...base, variantId: 12, status: "axvara" },
      { ...base, variantId: 13, status: "pemasok", adminStale: true, reviewKind: "changed", needsReview: true, hasOverride: true, adminTerms: "Aturan pakai:\n- Lama" },
      { ...base, variantId: 14, status: "none", autoTerms: "", autoActivation: "" },
    ];
    const variants: FormVariant[] = [
      { id: 10, sku: "V10", label: "Varian Nonaktif", price: 10000, stock: 1, is_active: 0 },
      { id: 11, sku: "V11", label: "7 Hari", price: 15000, stock: 1, is_active: 1 },
      { id: 12, sku: "V12", label: "1 Bulan", price: 25000, stock: 1, is_active: 1 },
      { id: 13, sku: "V13", label: "Stale Varian", price: 35000, stock: 1, is_active: 1 },
      { id: 14, sku: "V14", label: "Kosong Varian", price: 45000, stock: 1, is_active: 1 },
    ];

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ variants: entries }),
    })));

    render(
      <CopyTabHarness
        initialForm={{ name: "Canva Pro", description: "Intro", wrManaged: false }}
        variants={variants}
        initialEntries={entries}
      />,
    );

    // 1 missing description EN + 3 active variants without EN (12, 13, 14) = 4 kosong
    expect(await screen.findByText(/4 kosong/)).toBeTruthy();

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("7 Hari"),
      expect.stringContaining("1 Bulan"),
      expect.stringContaining("Stale Varian"),
      expect.stringContaining("Kosong Varian"),
      expect.stringContaining("Varian Nonaktif"),
    ]);

    expect(within(rows[0]).getByText("Disunting admin")).toBeTruthy();
    expect(within(rows[0]).getByLabelText("Versi English tersedia")).toBeTruthy();
    expect(within(rows[1]).getByText("Kurasi AXVARA")).toBeTruthy();
    expect(within(rows[1]).getByLabelText("Versi English kosong")).toBeTruthy();
    expect(within(rows[2]).getByText("Perlu ditinjau")).toBeTruthy();
    expect(within(rows[3]).getByText("Kosong")).toBeTruthy();
    expect(within(rows[4]).getByText("Nonaktif")).toBeTruthy();
    expect(within(rows[4]).getByText("Teks supplier")).toBeTruthy();

    // Name (EN) hidden in ID mode, visible in EN mode
    expect(screen.queryByLabelText("Nama (EN)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /English/ }));
    expect(screen.getByLabelText("Nama (EN)")).toBeTruthy();

    // Open drawer for 7 Hari -> first field focused
    fireEvent.click(screen.getByRole("button", { name: "Edit S&K 7 Hari" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Detail paket")).toBe(document.activeElement);
  });

  it("saves variant copy with ID + EN drafts kept across language toggle and inserts snippets", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            variant: {
              ...base,
              status: "admin",
              hasOverride: true,
              adminTerms: body.terms,
              adminActivation: body.activation,
              adminTermsEn: body.terms_en,
              adminActivationEn: body.activation_en,
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ variants: [base] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CopyTabHarness
        initialForm={{ name: "Canva Pro", description: "Deskripsi", supplier: "Manual", wrManaged: false }}
        variants={[defaultVariants[1]]}
        initialEntries={[base]}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit S&K Premium Legal · 28 Hari" }));
    const sheet = screen.getByRole("dialog");
    const saveBtn = within(sheet).getByRole("button", { name: "Simpan" }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // Insert snippet in Proses & pengiriman (ID)
    fireEvent.click(within(sheet).getByRole("button", { name: "+ Dikirim otomatis…" }));
    expect(within(sheet).getByText("Belum disimpan")).toBeTruthy();
    expect(saveBtn.disabled).toBe(false);
    expect(within(sheet).getByTestId("product-terms-body").textContent).toContain("Dikirim otomatis setelah pembayaran terkonfirmasi");

    // Switch to EN inside drawer; ID draft stays preserved while EN draft is edited
    fireEvent.click(within(sheet).getByRole("button", { name: "EN" }));
    expect(within(sheet).getByText(/Kosong — pembeli EN melihat versi Indonesia/)).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText("Detail paket"), { target: { value: "Ready-to-use 4K account" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "+ Contact AXVARA admin…" }));
    expect(within(sheet).getByTestId("product-terms-body").textContent).toContain("Ready-to-use 4K account");

    // Switch back to ID and verify ID snippet draft is still there
    fireEvent.click(within(sheet).getByRole("button", { name: "ID" }));
    expect((within(sheet).getByRole("textbox", { name: "Proses & pengiriman" }) as HTMLTextAreaElement).value).toContain(
      "Dikirim otomatis setelah pembayaran terkonfirmasi",
    );

    fireEvent.click(saveBtn);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(putCall?.[0]).toBe("/api/admin/variant-copy");
    const payload = JSON.parse(String(putCall?.[1]?.body));
    expect(payload.variant_id).toBe(13);
    expect(payload.terms).toContain("Dikirim otomatis setelah pembayaran terkonfirmasi");
    expect(payload.terms_en).toContain("Package details:\n- Ready-to-use 4K account");
    expect(payload.terms_en).toContain("Usage rules:\n- Need help? Contact AXVARA admin");
  });

  it("acknowledges raw/changed supplier text, toggles Lihat teks baru, and reverts via overflow menu", async () => {
    const rawEntry: VariantCopyEntry = {
      ...base,
      variantId: 12,
      status: "pemasok",
      reviewKind: "raw",
      needsReview: true,
      hasOverride: false,
    };
    const staleEntry: VariantCopyEntry = {
      ...base,
      variantId: 13,
      status: "admin",
      reviewKind: "changed",
      adminStale: true,
      needsReview: true,
      hasOverride: true,
      adminTerms: "Aturan pakai:\n- Dilarang berbagi akun",
    };

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        if (body.action === "acknowledge") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              variant: { ...rawEntry, reviewed: true, needsReview: false, reviewKind: null },
            }),
          };
        }
        if (body.terms === "") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              variant: { ...staleEntry, status: "axvara", hasOverride: false, adminStale: false, needsReview: false, reviewKind: null, adminTerms: "" },
            }),
          };
        }
      }
      return { ok: true, status: 200, json: async () => ({ variants: [rawEntry, staleEntry] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CopyTabHarness
        initialForm={{ name: "Netflix", wrManaged: true }}
        variants={defaultVariants}
        initialEntries={[rawEntry, staleEntry]}
      />,
    );

    // Acknowledge raw supplier text
    fireEvent.click(await screen.findByRole("button", { name: "Edit S&K Premium Anti Limit · 28 Hari" }));
    let sheet = screen.getByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Teks supplier sudah oke" }));
    await screen.findByText(/Ditandai sudah ditinjau/);
    fireEvent.click(within(sheet).getByRole("button", { name: "Tutup panel S&K" }));

    // Open stale variant -> review banner + Lihat teks baru + revert in overflow menu
    fireEvent.click(screen.getByRole("button", { name: "Edit S&K Premium Legal · 28 Hari" }));
    sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("alert").textContent).toContain("WR mengubah teks. Pembeli masih melihat suntinganmu.");
    fireEvent.click(within(sheet).getByRole("button", { name: "Lihat teks baru" }));
    expect(within(sheet).getByText(/Perbaikan garansi 1x24 jam/)).toBeTruthy();

    await userEvent.click(within(sheet).getByRole("button", { name: "Aksi lainnya" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Kembali ke versi otomatis" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const revertCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "PUT" && JSON.parse(String(init.body)).terms === "",
    );
    expect(revertCall).toBeTruthy();
  });

  it("copies ID+EN text to selected other variants via bulk endpoint and updates table statuses", async () => {
    const entry12: VariantCopyEntry = { ...base, variantId: 12, status: "none", autoTerms: "", autoActivation: "" };
    const entry13: VariantCopyEntry = { ...base, variantId: 13, status: "axvara" };

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/admin/variant-copy/bulk" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            variants: body.variant_ids.map((id: number) => ({
              ...entry12,
              variantId: id,
              status: "admin",
              hasOverride: true,
              adminTerms: body.terms,
              adminActivation: body.activation,
              adminTermsEn: body.terms_en,
              adminActivationEn: body.activation_en,
            })),
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ variants: [entry12, entry13] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CopyTabHarness
        initialForm={{ name: "Canva", wrManaged: false }}
        variants={defaultVariants}
        initialEntries={[entry12, entry13]}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit S&K Premium Legal · 28 Hari" }));
    const sheet = screen.getByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Salin ke varian lain" }));
    const selectAll = screen.getByRole("checkbox", { name: /Pilih semua/ });
    await userEvent.click(selectAll);
    await userEvent.click(screen.getByRole("button", { name: "Terapkan (1)" }));

    await screen.findByText("Diterapkan ke 1 varian");
    const bulkCall = fetchMock.mock.calls.find(([u]) => u === "/api/admin/variant-copy/bulk");
    expect(JSON.parse(String(bulkCall?.[1]?.body))).toMatchObject({
      product_id: 1,
      variant_ids: [12],
      terms: expect.stringContaining("Detail paket:"),
    });
  });

  it("shows all >20 bulk targets, enforces 20-variant cap without blocking variants 21+, and allows selecting the last target", async () => {
    const manyVariants: FormVariant[] = Array.from({ length: 23 }, (_, i) => ({
      id: i + 1,
      sku: `SKU-${i + 1}`,
      label: `Varian ${i + 1}`,
      price: 10000,
      stock: -1,
      is_active: 1,
    }));
    const manyEntries: VariantCopyEntry[] = manyVariants.map((v) => ({
      ...base,
      variantId: v.id!,
      label: v.label,
      status: v.id === 1 ? "axvara" : "none",
      autoTerms: v.id === 1 ? base.autoTerms : "",
      autoActivation: v.id === 1 ? base.autoActivation : "",
    }));

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/admin/variant-copy/bulk" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            variants: body.variant_ids.map((id: number) => ({
              ...manyEntries[0],
              variantId: id,
              status: "admin",
              hasOverride: true,
              adminTerms: body.terms,
              adminActivation: body.activation,
            })),
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ variants: manyEntries }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CopyTabHarness
        initialForm={{ name: "Banyak Varian", wrManaged: false }}
        variants={manyVariants}
        initialEntries={manyEntries}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit S&K Varian 1" }));
    const sheet = screen.getByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Salin ke varian lain" }));

    // 22 others visible; cap select-all selects first 20 and blocks a 21st
    const selectCap = screen.getByRole("checkbox", { name: /Pilih 20 pertama \(dari 22\)/ });
    await userEvent.click(selectCap);
    expect(screen.getByText(/Maksimal 20 varian sekali salin \(20\/20 dipilih\)/)).toBeTruthy();
    const lastCheckbox = screen.getByRole("checkbox", { name: "Varian 23" }) as HTMLButtonElement;
    expect(lastCheckbox.getAttribute("aria-checked")).toBe("false");
    expect(lastCheckbox.disabled).toBe(true);

    // Clear all, then select the 22nd (last) target and apply
    await userEvent.click(selectCap);
    expect(lastCheckbox.disabled).toBe(false);
    await userEvent.click(lastCheckbox);
    expect(lastCheckbox.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Terapkan (1)" }));

    await screen.findByText("Diterapkan ke 1 varian");
    const bulkCall = fetchMock.mock.calls.find(([u]) => u === "/api/admin/variant-copy/bulk");
    expect(JSON.parse(String(bulkCall?.[1]?.body)).variant_ids).toEqual([23]);
  });

  it("enables Kembali ke versi otomatis for EN-only override and clears all 4 fields", async () => {
    const enOnlyEntry: VariantCopyEntry = {
      ...base,
      variantId: 13,
      status: "axvara",
      hasOverride: false,
      adminTerms: "",
      adminActivation: "",
      adminTermsEn: "Package details:\n- English only override",
      adminActivationEn: "",
    };

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            variant: { ...enOnlyEntry, adminTermsEn: "", adminActivationEn: "" },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ variants: [enOnlyEntry] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CopyTabHarness
        initialForm={{ name: "Canva EN", wrManaged: false }}
        variants={[defaultVariants[1]]}
        initialEntries={[enOnlyEntry]}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit S&K Premium Legal · 28 Hari" }));
    const sheet = screen.getByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: "Aksi lainnya" }));
    const revertItem = screen.getByRole("menuitem", { name: "Kembali ke versi otomatis" });
    expect(revertItem.getAttribute("aria-disabled")).not.toBe("true");
    await userEvent.click(revertItem);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      variant_id: 13,
      terms: "",
      activation: "",
      terms_en: "",
      activation_en: "",
      supplier_key: base.supplierKey,
    });
    expect(screen.getByLabelText("Versi English kosong")).toBeTruthy();
  });

  it("handles 409 supplier-changed conflict preserving draft on reload and prompts unsaved discard", async () => {
    let reloadCount = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return { ok: false, status: 409, json: async () => ({ error: "Teks supplier berubah" }) };
      }
      reloadCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          variants: [
            {
              ...base,
              supplierKey: reloadCount > 1 ? "new-key" : "fixture-key",
              autoTerms: reloadCount > 1 ? "Detail paket:\n- Sumber baru" : base.autoTerms,
            },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <CopyTabHarness
        initialForm={{ name: "SK Prod", supplier: "SK", wrManaged: false }}
        variants={[defaultVariants[1]]}
        initialEntries={[base]}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit S&K Premium Legal · 28 Hari" }));
    const sheet = screen.getByRole("dialog");
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Aturan pakai" }), { target: { value: "Draft SK penting" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Simpan" }));

    expect((await within(sheet).findByRole("alert")).textContent).toContain("Teks supplier berubah");
    fireEvent.click(within(sheet).getByRole("button", { name: "Muat ulang sumber (pertahankan draft)" }));
    await waitFor(() => expect(reloadCount).toBeGreaterThanOrEqual(2));
    expect((within(sheet).getByRole("textbox", { name: "Aturan pakai" }) as HTMLTextAreaElement).value).toBe("Draft SK penting");

    // Closing while dirty triggers confirm dialog; confirming discards and closes
    fireEvent.click(within(sheet).getByRole("button", { name: "Batal" }));
    const confirm = screen.getByRole("alertdialog", { name: "Buang perubahan teks?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Buang perubahan" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("product-wide drawer edits description S&K/activation via composeDescription with Terapkan button", async () => {
    const onFormChange = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ variants: [] }) })));

    render(
      <CopyTabHarness
        initialForm={{
          name: "Canva Pro",
          description: "Pembuka bagus.\n\n- Fitur AI\n\nSyarat & Ketentuan:\n- Email aktif",
          wrManaged: false,
        }}
        variants={[]}
        initialEntries={[]}
        onFormChange={onFormChange}
      />,
    );

    expect(screen.getByText("1 aturan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit S&K berlaku untuk semua varian" }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("Diterapkan ke form — klik Simpan Produk untuk menyimpan")).toBeTruthy();
    const applyBtn = within(sheet).getByRole("button", { name: "Terapkan" }) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);

    fireEvent.change(within(sheet).getByLabelText("Garansi"), { target: { value: "Garansi 30 hari" } });
    fireEvent.change(within(sheet).getByLabelText("Cara aktivasi"), { target: { value: "Buka email\nTerima undangan" } });
    expect(applyBtn.disabled).toBe(false);

    fireEvent.click(applyBtn);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onFormChange).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("Syarat & Ketentuan:\n- Email aktif\n- Garansi 30 hari"),
      }),
    );
    expect(onFormChange).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("Cara Aktivasi:\n1. Buka email\n2. Terima undangan"),
      }),
    );
    expect(screen.getByText("2 aturan · 2 langkah")).toBeTruthy();
  });
});

describe("ProductVariantRows & NonWrFulfillmentPanel", () => {
  it("shows automatic supplier processing instead of local manual fulfillment controls", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const update = vi.fn();
    render(
      <ProductVariantRows
        form={{ slug: "muse-ai-1-miliar-token", supplier: "Manual" }}
        formVariants={[{ id: 279, sku: "TUNVN-BUFF-1B", label: "Buff", price: 1500, stock: -1, is_active: 1, fulfillment_mode: "manual" }]}
        onSetFormVariants={update}
        productId={112}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Buff/ }));
    expect(screen.getByText(/Diproses otomatis setelah pembayaran/)).toBeTruthy();
    expect(screen.queryByText(/Badge pembeli: Made By Order/)).toBeNull();
    expect(document.querySelector('select option[value="shared"]')).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("own-stock variant accordions no longer expose a second copy editor", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const update = vi.fn();
    const values: FormVariant[] = [
      { id: 1, sku: "HEAD", label: "Head", price: 14000, stock: 1, is_active: 1, fulfillment_mode: "unique", admin_terms: "- Jangan bagikan link" },
      { id: 2, sku: "INVITE", label: "Invite", price: 12000, stock: -1, is_active: 1, fulfillment_mode: "shared", admin_activation: "1. Terima undangan" },
    ];
    render(<ToastProvider><ProductVariantRows form={{ name: "Own", supplier: "Manual" }} formVariants={values} onSetFormVariants={update} productId={1} /></ToastProvider>);
    expect(screen.queryByLabelText("S&K bersama")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Invite/ }));
    expect(screen.queryByLabelText("Cara penggunaan / aktivasi bersama")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Head/ }));
    expect(screen.queryByLabelText("S&K bersama")).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("late inventory load cannot overwrite stock after its variant panel has unmounted", async () => {
    let resolve!: (value: unknown) => void;
    const response = new Promise((r) => { resolve = r; });
    vi.stubGlobal("fetch", vi.fn(() => response));
    const onStockChange = vi.fn();
    const rendered = render(<ToastProvider><NonWrFulfillmentPanel productId={1} variantId={101} mode="unique" onStockChange={onStockChange} /></ToastProvider>);
    rendered.unmount();
    await act(async () => resolve({ ok: true, json: async () => ({ available: 99 }) }));
    expect(onStockChange).not.toHaveBeenCalled();
  });
});

describe("daftar produk admin", () => {
  it("separates changed/raw badges, filters the full existing result before pagination and resets", () => {
    const prod = (id: string, extra: Partial<Prod> = {}): Prod => ({ id, slug: id, name: `Produk ${id}`, description: "", price: 1000, categorySlug: "akun-premium", image: "", images: [], soldCount: 0, stock: 1, isActive: true, ...extra });
    const list = [prod("both", { copyReview: 3, copyReviewChanged: 1, copyReviewRaw: 2 }), prod("raw", { copyReview: 1, copyReviewChanged: 0, copyReviewRaw: 1 }), prod("legacy", { copyReview: 4 }), prod("excluded", { copyReview: 1, copyReviewChanged: 1, copyReviewRaw: 0 }), prod("archive", { archivedAt: "2026-11-15", copyReview: 1, copyReviewChanged: 1, copyReviewRaw: 0 })];
    const existing = list.slice(0, 3);
    function List() {
      const [page, setPage] = useState(1);
      return <ProductsSection prods={list} filtered={existing} paged={existing.slice(page - 1, page)} q="existing search" safePage={page} totalPages={3} perPage={1}
        loadingList={false} toggling={null} activeProducts={4} lowStock={0} soldProducts={0} onQueryChange={vi.fn()} onPageChange={setPage} onlyLowStock={false} onClearLowStock={vi.fn()}
        supplierFilter="all" onSupplierFilterChange={vi.fn()} liveProducts={4} hiddenProducts={0} offProducts={0} liveTab="all" onLiveTabChange={vi.fn()} perPageAdmin={20} onPerPageChange={vi.fn()}
        onNew={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onToggleActive={vi.fn()} reordering={null} onMove={vi.fn()} onJump={vi.fn()} onSoldCount={vi.fn()} />;
    }
    render(<List />);
    expect(screen.getAllByText("Supplier mengubah S&K · 1 varian")).toHaveLength(2);
    expect(screen.getAllByText("S&K belum dirapikan · 2 varian")).toHaveLength(2);
    expect(screen.getAllByText("Supplier mengubah S&K · 1 varian")[0].className).toContain("text-admin-danger");
    expect(screen.getAllByText("S&K belum dirapikan · 2 varian")[0].className).toContain("text-admin-muted");
    const filter = screen.getByRole("combobox", { name: "Tinjauan S&K" });
    expect(within(filter).getByRole("option", { name: "Supplier mengubah teks (2)" })).toBeTruthy();
    expect(within(filter).getByRole("option", { name: "Belum dirapikan (2)" })).toBeTruthy();
    expect(within(filter).getByRole("option", { name: "Semua yang perlu ditinjau (4)" })).toBeTruthy();
    fireEvent.change(filter, { target: { value: "changed" } });
    expect(screen.getByText("Filter aktif")).toBeTruthy();
    for (const button of screen.getAllByRole("button", { name: "Turunkan Produk both" })) expect(button).toHaveProperty("disabled", true);
    expect(screen.getByRole("textbox", { name: "Pindah Produk both ke posisi 1 sampai 1" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/Hal 1 dari 1 · 1 produk/)).toBeTruthy();
    expect(screen.queryByText("Produk excluded")).toBeNull();
    fireEvent.change(filter, { target: { value: "raw" } });
    expect(screen.getByText(/Hal 1 dari 2 · 2 produk/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Berikutnya" }));
    expect(screen.getAllByText("Produk raw")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Reset tinjauan S&K" }));
    expect(filter).toHaveProperty("value", "all");
    expect(screen.queryByText("Filter aktif")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Berikutnya" }));
    fireEvent.click(screen.getByRole("button", { name: "Berikutnya" }));
    expect(screen.getAllByText("S&K perlu ditinjau · 4 varian")).toHaveLength(2);
    fireEvent.change(filter, { target: { value: "review" } });
    expect(screen.getByText(/Hal 1 dari 3 · 3 produk/)).toBeTruthy();
  });

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
    expect(screen.getAllByText("S&K perlu ditinjau · 2 varian")).toHaveLength(2);
    expect(screen.queryByText(/S&K perlu ditinjau · 0/)).toBeNull();
  });
});

describe("editor produk: integrasi tab Deskripsi & S&K", () => {
  const entries: VariantCopyEntry[] = [
    { ...base, variantId: 12, label: "Premium Anti Limit" },
    { ...base, variantId: 13, status: "pemasok", adminStale: true, needsReview: true, reviewKind: "changed", hasOverride: true, adminTerms: "Aturan pakai:\n- Dilarang berbagi akun" },
  ];

  function renderModal(form: ProductForm, formVariants = defaultVariants, onSetForm = vi.fn(), editing = true, copyEntries = entries) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).startsWith("/api/admin/variant-copy") ? { variants: copyEntries } : {}),
    })));
    render(
      <AdminPortalContext.Provider value={document.body}>
        <ToastProvider>
          <ProductEditorModal
            editing={editing} editingId={editing ? 1 : undefined} saving={false} uploading={false} loadingVariants={false}
            hasMultiVariants formError={null} form={form} formImages={[]} formVariants={formVariants} cats={[]}
            onRequestClose={vi.fn()} onSetForm={onSetForm} onSetFormImages={vi.fn()} onSetHasMultiVariants={vi.fn()}
            onSetFormVariants={vi.fn()} onUpload={vi.fn()} onSave={vi.fn()}
          />
        </ToastProvider>
      </AdminPortalContext.Provider>,
    );
    return { onSetForm };
  }

  const wrForm: ProductForm = { name: "Netflix Premium", slug: "netflix-premium", description: "Teks WR", adminDescriptionOverride: "Versi Axvara", wrManaged: true };

  it("empat tab; deskripsi WR status pill, EN tersembunyi sampai dipilih, dan tabel varian di tab Deskripsi & S&K", async () => {
    renderModal(wrForm);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Produk", "Varian (2)", expect.stringMatching(/^Deskripsi & S&K/), "Foto",
    ]);

    await userEvent.click(screen.getByRole("tab", { name: /^Deskripsi & S&K/ }));
    const copyPanel = screen.getByRole("tabpanel", { name: /^Deskripsi & S&K/ });
    expect(within(copyPanel).queryByLabelText("Nama (EN)")).toBeNull();
    expect((within(copyPanel).getByLabelText("Teks deskripsi") as HTMLTextAreaElement).value).toBe("Versi Axvara");
    expect(within(copyPanel).getByText("Teks asli WR/SK (pembanding)")).toBeTruthy();
    expect(within(copyPanel).getByText("Disunting admin")).toBeTruthy();
    expect(within(copyPanel).getByRole("button", { name: "Pakai teks asli" })).toBeTruthy();
    expect(await within(copyPanel).findByRole("button", { name: "Edit S&K Premium Legal · 28 Hari" })).toBeTruthy();
  });

  it("tab menampilkan jumlah varian yang S&K-nya perlu ditinjau", async () => {
    renderModal(wrForm);
    await waitFor(() => expect(screen.getByRole("tab", { name: /^Deskripsi & S&K/ }).textContent).toContain("1 varian S&K perlu ditinjau"));
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/admin/variant-copy?product_id=1")).toBe(true);
    expect(within(screen.getByRole("tab", { name: /^Deskripsi & S&K/ })).getByText("1").className).toContain("text-admin-danger");
  });

  it("raw-only tab count stays neutral and ignores inactive changed variants", async () => {
    renderModal(wrForm, defaultVariants, vi.fn(), true, [
      { ...base, needsReview: true, reviewKind: "raw", status: "pemasok" },
      { ...base, variantId: 12, isActive: false, needsReview: true, reviewKind: "changed" },
    ]);
    await waitFor(() => expect(screen.getByRole("tab", { name: /^Deskripsi & S&K/ }).textContent).toContain("1 varian S&K perlu ditinjau"));
    const badge = within(screen.getByRole("tab", { name: /^Deskripsi & S&K/ })).getByText("1");
    expect(badge.className).toContain("text-admin-muted");
    expect(badge.className).not.toContain("text-admin-danger");
  });

  it("produk Manual memakai tabel varian dan drawer yang sama serta bisa mengedit deskripsi", async () => {
    const { onSetForm } = renderModal(
      { name: "Canva Pro", slug: "canva-premium", description: "Lama", wrManaged: false, supplier: "Manual" },
      [
        { id: 1, sku: "CANVA-1", label: "Invite 1 Bulan", price: 2000, stock: -1, is_active: 1 },
        { id: 3, sku: "CANVA-3", label: "Head 1 Bulan", price: 5000, stock: 10, is_active: 0 },
      ],
    );
    await userEvent.click(screen.getByRole("tab", { name: /^Deskripsi & S&K/ }));
    const panel = screen.getByRole("tabpanel", { name: /^Deskripsi & S&K/ });
    expect(within(panel).queryByText("Teks asli WR/SK (pembanding)")).toBeNull();
    fireEvent.change(within(panel).getByLabelText("Teks deskripsi"), { target: { value: "Baru" } });
    expect(onSetForm).toHaveBeenCalledWith(expect.objectContaining({ description: "Baru" }));
    expect(within(panel).getByRole("button", { name: "Edit S&K Invite 1 Bulan" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Edit S&K berlaku untuk semua varian" })).toBeTruthy();
  });

  it("produk baru: tanpa permintaan S&K ke server, varian baru disabled sampai disimpan", async () => {
    renderModal({ name: "Baru", slug: "baru" }, [{ sku: "BARU-1", label: "Paket 1", price: 50000, stock: -1, is_active: 1 }], vi.fn(), false);
    await userEvent.click(screen.getByRole("tab", { name: /^Deskripsi & S&K/ }));
    const panel = screen.getByRole("tabpanel", { name: /^Deskripsi & S&K/ });
    expect(within(panel).getByText("Belum disimpan")).toBeTruthy();
    expect((within(panel).getByRole("button", { name: "Edit S&K Paket 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(panel).getByRole("button", { name: "Edit S&K berlaku untuk semua varian" }) as HTMLButtonElement).disabled).toBe(false);
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
      <AdminPortalContext.Provider value={document.body}><ToastProvider>
        <ProductEditorModal
          editing editingId={2} saving={false} uploading={false} loadingVariants={false}
          hasMultiVariants={false} formError={null} form={form} formImages={[]} formVariants={formVariants} cats={[]}
          onRequestClose={vi.fn()} onSetForm={onSetForm} onSetFormImages={vi.fn()} onSetHasMultiVariants={vi.fn()}
          onSetFormVariants={vi.fn()} onUpload={vi.fn()} onSave={vi.fn()}
        />
      </ToastProvider></AdminPortalContext.Provider>,
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
    expect(within(panel).queryByLabelText("S&K bersama")).toBeNull();
    expect(within(panel).queryByLabelText("Cara penggunaan / aktivasi bersama")).toBeNull();
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
