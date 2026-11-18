// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, renderHook, screen } from "@testing-library/react";
import { render } from "./setup/admin-render";
import { ProductVariantRows } from "@/components/admin/sections/ProductVariantRows";
import { SingleVariantFields } from "@/components/admin/sections/SingleVariantFields";
import { useProductManager } from "@/components/admin/useProductManager";
import type { FormVariant, Prod, ProductForm } from "@/components/admin/product-types";
import { ToastProvider } from "@/components/ui/Toast";
import { DurationFields } from "@/components/admin/sections/VariantDurationFields";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const duration = { duration_value: 3, duration_unit: "month", duration_label: "3 Bulan" };
const warranty = { warranty_type: "full", warranty_value: 7, warranty_unit: "day" };
const variant: FormVariant = { id: 11, sku: "DEFAULT-1", label: "Default", price: 5000, stock: 5, is_active: 1, ...duration, ...warranty };

function Fields({ multi, locked = false, cost = {} }: { multi: boolean; locked?: boolean; cost?: Pick<FormVariant, "supplier_cost" | "supplier_cost_source"> }) {
  const [form, setForm] = useState<ProductForm>({ ...duration, ...warranty, ...cost, wrManaged: locked });
  const [variants, setVariants] = useState<FormVariant[]>([{ ...variant, ...cost }]);
  return <ToastProvider>
    {multi ? <ProductVariantRows form={form} formVariants={variants} onSetFormVariants={setVariants} editing={false} />
      : <SingleVariantFields form={form} onSetForm={setForm} editing={false} />}
    <output data-testid="draft">{JSON.stringify(multi ? variants[0] : form)}</output>
  </ToastProvider>;
}
const draft = () => JSON.parse(screen.getByTestId("draft").textContent!);

it("R4-5: zero duration is cleared, switching legacy lifetime zero starts at one", () => {
  const onChange = vi.fn();
  const view = render(<DurationFields value={{ duration_value: 0, duration_unit: "lifetime", duration_label: "Forever" }} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Satuan masa aktif"), { target: { value: "month" } });
  expect(onChange).toHaveBeenLastCalledWith({ duration_value: 1, duration_unit: "month", duration_label: null });
  view.rerender(<DurationFields value={{ duration_value: 1, duration_unit: "month", duration_label: null }} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Masa aktif (opsional)"), { target: { value: "0" } });
  expect(onChange).toHaveBeenLastCalledWith({ duration_value: null, duration_unit: null, duration_label: null });
});

it.each([false, true])("single/multi=%s: warranty edits never change duration; duration is editable and clearable", (multi) => {
  render(<Fields multi={multi} />);
  expect((screen.getByLabelText("Masa aktif (opsional)") as HTMLInputElement).value).toBe("3");
  fireEvent.change(screen.getByLabelText("Lama garansi"), { target: { value: "14" } });
  expect(draft()).toMatchObject({ ...duration, warranty_value: 14 });
  fireEvent.change(screen.getByLabelText("Satuan garansi"), { target: { value: "year" } });
  expect(draft()).toMatchObject({ ...duration, warranty_unit: "year" });
  for (const type of ["limited", "none", "custom", "full"]) {
    fireEvent.change(screen.getByLabelText("Masa garansi"), { target: { value: type } });
    expect(draft()).toMatchObject({ ...duration, warranty_type: type });
  }
  fireEvent.change(screen.getByLabelText("Masa aktif (opsional)"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Satuan masa aktif"), { target: { value: "year" } });
  expect(draft()).toMatchObject({ duration_value: 2, duration_unit: "year", duration_label: null, warranty_value: 14, warranty_unit: "year" });
  fireEvent.change(screen.getByLabelText("Masa aktif (opsional)"), { target: { value: "" } });
  expect(draft()).toMatchObject({ duration_value: null, duration_unit: null, duration_label: null, warranty_value: 14 });
  fireEvent.change(screen.getByLabelText("Satuan masa aktif"), { target: { value: "month" } });
  expect(draft()).toMatchObject({ duration_value: 1, duration_unit: "month" });
  fireEvent.change(screen.getByLabelText("Satuan masa aktif"), { target: { value: "" } });
  expect(draft()).toMatchObject({ duration_value: null, duration_unit: null });
});

it.each([false, true])("single/multi=%s: WR keeps duration and warranty locked", (multi) => {
  render(<Fields multi={multi} locked />);
  expect((screen.getByLabelText("Masa aktif (WR)") as HTMLInputElement).readOnly).toBe(true);
  expect((screen.getByLabelText("Satuan masa aktif") as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByLabelText("Lama garansi") as HTMLInputElement).readOnly).toBe(true);
  expect((screen.getByLabelText("Masa garansi (WR)") as HTMLSelectElement).disabled).toBe(true);
  expect(draft()).toMatchObject(duration);
  if (multi) {
    const label = screen.getByLabelText<HTMLInputElement>("Nama varian / paket *");
    expect(label.readOnly).toBe(false);
    fireEvent.change(label, { target: { value: "Paket Baru" } });
    expect(draft().label).toBe("Paket Baru");
    expect(screen.getByLabelText<HTMLInputElement>("Harga jual (Rp) * (WR)").readOnly).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>(/^Stok \(WR\)/).readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "Tambah Varian" })).toBeNull();
  }
});

it.each([false, true])("single/multi=%s: supplier modal is read-only, manual modal remains editable", (multi) => {
  for (const [source, cost, display] of [["WR", 12500, "12.500"], ["SK", null, "—"]] as const) {
    const view = render(<Fields multi={multi} cost={{ supplier_cost_source: source, supplier_cost: cost }} />);
    const input = screen.getByLabelText<HTMLInputElement>(new RegExp(`Modal \\(Rp\\) dari ${source}`));
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe(display);
    view.unmount();
  }
  render(<Fields multi={multi} />);
  const input = screen.getByLabelText<HTMLInputElement>(/Modal \(Rp\) \(0 = tanpa modal\)/);
  expect(input.readOnly).toBe(false);
  fireEvent.change(input, { target: { value: "1000" } });
  expect(draft().manual_cost).toBe(1000);
});

const product: Prod = { id: "1", name: "Test Product", slug: "test-product", description: "", price: 5000, stock: 5, categorySlug: "tools-pro", image: "", images: [], soldCount: 0, isActive: true };
function managerApi(savedDuration: typeof duration, multi: boolean, source?: "WR" | "SK") {
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT" || init?.method === "POST") writes.push(JSON.parse(String(init.body)));
    if (url === "/api/products/1" && !init?.method) return { ok: true, json: async () => ({ product: { ...product, wrManaged: source === "WR", variants: [{ ...variant, ...savedDuration, sku: multi ? "PACKAGE-1" : "DEFAULT-1", manual_cost: 42, supplier_cost: source ? 12500 : null, supplier_cost_source: source }] } }) };
    return { ok: true, json: async () => ({ products: [product], categories: [] }) };
  }));
  return writes;
}

it.each([[true, "WR"], [false, "WR"], [false, "SK"]] as const)("multi=%s %s: editor writes admin text but not supplier modal", async (multi, source) => {
  const writes = managerApi(duration, multi, source);
  const { result } = renderHook(() => useProductManager({ success: vi.fn(), error: vi.fn() }, vi.fn()));
  await act(async () => { await result.current.openEdit(product); });
  expect(multi ? result.current.formVariants[0] : result.current.form).toMatchObject({ supplier_cost: 12500, supplier_cost_source: source });
  act(() => {
    result.current.setForm({ ...result.current.form, name: "Nama Baru", slug: "nama-baru", adminDescriptionOverride: "Override" });
    result.current.setFormVariants(prev => prev.map(v => ({ ...v, label: "Paket Baru" })));
  });
  await act(async () => { await result.current.save(); });
  expect(writes[0]).toMatchObject({ name: "Nama Baru", slug: "nama-baru" });
  expect(writes[0]).not.toHaveProperty("supplier_cost_source");
  if (source === "WR") {
    expect(writes[0]).toHaveProperty("adminDescriptionOverride", "Override");
    expect(writes[0]).not.toHaveProperty("description");
  }
  const savedVariant = (writes[0].variants as FormVariant[])[0];
  expect(savedVariant.label).toBe("Paket Baru");
  expect(savedVariant).not.toHaveProperty("manual_cost");
  expect(savedVariant).not.toHaveProperty("supplier_cost");
});

it.each([false, true])("single/multi=%s: open/save without edits preserves every stored duration field", async (multi) => {
  const writes = managerApi(duration, multi);
  const { result } = renderHook(() => useProductManager({ success: vi.fn(), error: vi.fn() }, vi.fn()));
  await act(async () => { await result.current.openEdit(product); });
  expect(result.current.hasMultiVariants).toBe(multi);
  expect(result.current.productDirty).toBe(false);
  await act(async () => { await result.current.save(); });
  expect(writes[0]).not.toHaveProperty("duration_value");
  expect((writes[0].variants as FormVariant[])[0]).toMatchObject(duration);
});

it.each(["lifetime", "custom"])("single: preserves legacy %s duration on open/save", async (unit) => {
  const legacy = { duration_value: 0, duration_unit: unit, duration_label: "Stored label" };
  const writes = managerApi(legacy, false);
  const { result } = renderHook(() => useProductManager({ success: vi.fn(), error: vi.fn() }, vi.fn()));
  await act(async () => { await result.current.openEdit(product); });
  render(<ToastProvider><SingleVariantFields form={result.current.form} onSetForm={result.current.setForm} editing={false} /></ToastProvider>);
  expect((screen.getByLabelText("Satuan masa aktif") as HTMLSelectElement).value).toBe(unit);
  expect(screen.getByText("Stored label")).toBeTruthy();
  await act(async () => { await result.current.save(); });
  expect((writes[0].variants as FormVariant[])[0]).toMatchObject(legacy);
});

it("single: edited duration is saved instead of replaying the old default; new products accept duration", async () => {
  const writes = managerApi(duration, false);
  const { result } = renderHook(() => useProductManager({ success: vi.fn(), error: vi.fn() }, vi.fn()));
  await act(async () => { await result.current.openEdit(product); });
  act(() => result.current.setForm({ ...result.current.form, duration_value: 2, duration_unit: "year", duration_label: null }));
  await act(async () => { await result.current.save(); });
  expect((writes[0].variants as FormVariant[])[0]).toMatchObject({ duration_value: 2, duration_unit: "year", duration_label: null, ...warranty });
  act(() => result.current.openNew());
  expect(result.current.form.duration_value).toBeNull();
  act(() => result.current.setForm({ ...result.current.form, name: "New Product", slug: "new-product", duration_value: 14, duration_unit: "day" }));
  await act(async () => { await result.current.save(); });
  expect((writes[1].variants as FormVariant[])[0]).toMatchObject({ duration_value: 14, duration_unit: "day" });
});
