// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "./setup/admin-render";
import { ProductEditorModal } from "@/components/admin/ProductEditorModal";
import { Badge, PageHeader, StatCard, NativeSelect, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/admin/ui";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps long unique credentials in a zero-min-content track inside the bounded editor", async () => {
  const secret = `https://example.test/activate/${"long-secret".repeat(100)}`;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ inventory: [{ id: 1, secret }], available: 1, reserved: 0, delivered: 0, variants: [] }) })));
  const noop = vi.fn();
  render(<ToastProvider><ProductEditorModal editing editingId={1} saving={false} uploading={false} loadingVariants={false} hasMultiVariants formError={null}
    form={{ name: "Gemini Plus", slug: "gemini-plus", displayPosition: 1 }} formImages={[]} cats={[]}
    formVariants={[{ id: 1, sku: "GEMINI-6", label: "Gemini Plus 6 Bulan", price: 10000, stock: 1, fulfillment_mode: "unique", is_active: 1 }]}
    onRequestClose={noop} onSetForm={noop} onSetFormImages={noop} onSetHasMultiVariants={noop} onSetFormVariants={noop} onUpload={noop} onSave={noop}
  /></ToastProvider>);
  expect(screen.queryByText("Nama di WhatsApp (Alias)")).toBeNull();
  expect(screen.getByLabelText("Posisi tampil produk").tagName).toBe("P");
  expect(screen.getByRole("tablist", { name: "Bagian editor produk" }).className).toContain("w-fit");
  expect(screen.getByRole("tablist", { name: "Bagian editor produk" }).classList.contains("w-full")).toBe(false);
  await userEvent.click(screen.getByRole("tab", { name: "Varian (1)" }));
  const credential = await screen.findByText(secret);
  expect(credential.className).toContain("truncate");
  expect(credential.closest("li")?.className).toContain("minmax(0,1fr)");
  expect(screen.getByRole("tabpanel", { name: "Varian (1)" }).className).toContain("min-w-0");
  expect(screen.getByRole("button", { name: /Gemini Plus 6 Bulan/ }).className).toContain("h-auto");
  await waitFor(() => expect(screen.getByRole("button", { name: "Impor stok unik" })).toBeTruthy());
  expect(screen.getByRole("button", { name: "Simpan Produk" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Tutup editor produk" })).toBeTruthy();
});

it("provides neutral statistics, sentence hierarchy, spaced tables and inset select chevrons", () => {
  render(<><PageHeader title="Produk" description="Kelola katalog." /><StatCard label="Butuh perhatian" value={12} tone="warning" hint="Periksa stok" />
    <Badge>Manual</Badge><NativeSelect aria-label="Kategori" className="w-full px-2 sm:w-44"><option>Premium</option></NativeSelect>
    <Table><TableHeader><TableRow><TableHead>Nama</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>Gemini</TableCell></TableRow></TableBody></Table>
  </>);
  expect(screen.getByRole("heading", { name: "Produk", level: 2 })).toBeTruthy();
  expect(screen.getByText("12").className).toContain("text-admin-fg");
  expect(screen.getByText("12").className).not.toContain("text-admin-warning");
  expect(screen.getByText("Periksa stok").className).toContain("text-admin-warning");
  expect(screen.getByRole("combobox").className).toContain("pr-9");
  expect(screen.getByRole("combobox").parentElement?.className).toContain("sm:w-44");
  expect(screen.getByText("Manual").className).toContain("bg-admin-subtle");
  expect(screen.getByRole("columnheader").className).toContain("first:pl-6");
  expect(screen.getByRole("cell").className).toContain("py-3");
  expect(screen.getByRole("cell").className).toContain("last:pr-6");
});

it("WR modal allows Nama/Slug edits without auto-rewriting an existing slug", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ variants: [] }) })));
  const onSetForm = vi.fn();
  const noop = vi.fn();
  render(
    <ToastProvider>
      <ProductEditorModal
        editing
        editingId={1}
        saving={false}
        uploading={false}
        loadingVariants={false}
        hasMultiVariants
        formError={null}
        form={{
          name: "Netflix Premium",
          slug: "netflix-premium",
          categorySlug: "streaming",
          badge: "Terlaris",
          wrManaged: true,
        }}
        formImages={[]}
        cats={[
          { id: 1, slug: "streaming", name: "Streaming" },
          { id: 2, slug: "desain", name: "Desain" },
        ]}
        formVariants={[{ id: 11, sku: "WR-11", label: "1 Bulan", price: 20000, stock: 5, is_active: 1, wr_auto_managed: 1 }]}
        onRequestClose={noop}
        onSetForm={onSetForm}
        onSetFormImages={noop}
        onSetHasMultiVariants={noop}
        onSetFormVariants={noop}
        onUpload={noop}
        onSave={noop}
      />
    </ToastProvider>,
  );

  expect(screen.queryByText(/Dikelola otomatis Warung Rebahan/)).toBeNull();
  const nameInput = screen.getByRole("textbox", { name: "Nama *" }) as HTMLInputElement;
  const slugInput = screen.getByRole("textbox", { name: "Slug *" }) as HTMLInputElement;
  expect(nameInput.readOnly).toBe(false);
  expect(slugInput.readOnly).toBe(false);
  fireEvent.change(nameInput, { target: { value: "Netflix Baru" } });
  expect(onSetForm).toHaveBeenCalledWith(expect.objectContaining({ name: "Netflix Baru", slug: "netflix-premium" }));
  fireEvent.change(slugInput, { target: { value: "Netflix Baru" } });
  expect(onSetForm).toHaveBeenCalledWith(expect.objectContaining({ slug: "netflix-baru" }));

  const catSelect = screen.getByRole("combobox", { name: "Kategori" }) as HTMLSelectElement;
  const badgeInput = screen.getByRole("textbox", { name: "Badge" }) as HTMLInputElement;
  expect(catSelect.disabled).toBe(false);
  expect(badgeInput.readOnly).toBe(false);

  fireEvent.change(catSelect, { target: { value: "desain" } });
  expect(onSetForm).toHaveBeenCalledWith(expect.objectContaining({ categorySlug: "desain" }));
  fireEvent.change(badgeInput, { target: { value: "Hemat" } });
  expect(onSetForm).toHaveBeenCalledWith(expect.objectContaining({ badge: "Hemat" }));

  expect(screen.getAllByRole("tab")).toHaveLength(4);
  await userEvent.click(screen.getByRole("tab", { name: /^Deskripsi & S&K/ }));
  expect(screen.getByRole("tabpanel", { name: /^Deskripsi & S&K/ })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Simpan Produk" }) as HTMLButtonElement).disabled).toBe(false);
});
