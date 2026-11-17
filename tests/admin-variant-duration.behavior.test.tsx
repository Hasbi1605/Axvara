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

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const duration = { duration_value: 3, duration_unit: "month", duration_label: "3 Bulan" };
const warranty = { warranty_type: "full", warranty_value: 7, warranty_unit: "day" };
const variant: FormVariant = { id: 11, sku: "DEFAULT-1", label: "Default", price: 5000, stock: 5, is_active: 1, ...duration, ...warranty };

function Fields({ multi, locked = false }: { multi: boolean; locked?: boolean }) {
  const [form, setForm] = useState<ProductForm>({ ...duration, ...warranty, wrManaged: locked });
  const [variants, setVariants] = useState<FormVariant[]>([variant]);
  return <ToastProvider>
    {multi ? <ProductVariantRows form={form} formVariants={variants} onSetFormVariants={setVariants} editing={false} />
      : <SingleVariantFields form={form} onSetForm={setForm} editing={false} />}
    <output data-testid="draft">{JSON.stringify(multi ? variants[0] : form)}</output>
  </ToastProvider>;
}
const draft = () => JSON.parse(screen.getByTestId("draft").textContent!);

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
});

const product: Prod = { id: "1", name: "Test Product", slug: "test-product", description: "", price: 5000, stock: 5, categorySlug: "tools-pro", image: "", images: [], soldCount: 0, isActive: true };
function managerApi(savedDuration: typeof duration, multi: boolean) {
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT" || init?.method === "POST") writes.push(JSON.parse(String(init.body)));
    if (url === "/api/products/1" && !init?.method) return { ok: true, json: async () => ({ product: { ...product, variants: [{ ...variant, ...savedDuration, sku: multi ? "PACKAGE-1" : "DEFAULT-1" }] } }) };
    return { ok: true, json: async () => ({ products: [product], categories: [] }) };
  }));
  return writes;
}

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
