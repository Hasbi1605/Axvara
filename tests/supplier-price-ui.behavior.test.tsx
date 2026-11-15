// @vitest-environment jsdom
//
// Panel supplier TUNVN/AIVault — perapian tab Markup (15 Nov 2026):
// harga VND tidak tampil, #60 API TEST tersembunyi, Simpan eksplisit hanya
// mengirim field yang berubah, draf baris lain tidak hilang saat satu baris
// disimpan, dan AIVault memakai nama produk AXVARA + tab selebar isi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render as renderAdmin } from "./setup/admin-render";
import { ToastProvider } from "@/components/ui/Toast";
import { TunvnManager } from "@/components/admin/TunvnManager";
import { AivaultManager } from "@/components/admin/AivaultManager";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Radix Switch memakai ResizeObserver (tidak ada di jsdom).
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
beforeEach(() => { vi.stubGlobal("ResizeObserver", ResizeObserverStub); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const tunvnItem = (id: number, over: Record<string, unknown> = {}) => ({
  supplier_product_id: id, name: `Supplier ${id}`, price_vnd: 36000, price_usdt: 1.39, stock: 63, visible: 0,
  axvara_product_id: 5, markup_percent: 35, sell_price_idr: 34200, fx_idr_per_usdt: 18220, synced_at: null,
  admin_name: null, admin_description: null, publish_requested: 0, axvara_name: "CapCut Pro", axvara_description: null,
  axvara_is_active: 0, variant_price: 34200, variant_is_active: 0, axvara_slug: "capcut-pro-tunvn", family: "capcut", family_key: "capcut",
  variant_id: id, variant_sku: `TUNVN-${id}`, variant_label: `Varian ${id}`, tunvn_admin_price_idr: null, excluded: 0, product_archived: 0, ...over,
});

function tunvnFetch(calls: { url: string; init?: RequestInit }[]) {
  return vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/tunvn/products/")) return Response.json({ ok: true });
    if (url.includes("/tunvn/orders")) return Response.json({ ok: true, items: [] });
    if (url.includes("/tunvn/balance")) return Response.json({ ok: true, configured: true, balance_usdt: 3.6, balance_vnd: 9800000, username: "axv" });
    if (url.includes("/tunvn/buff")) return Response.json({ ok: true, variants: [], probe: null, probe_error: null, muse_product: null });
    return Response.json({ ok: true, configured: true, items: [
      tunvnItem(37, { supplier_description: "Capcut Pro 1 Month Team Plan - Full Warranty" }), tunvnItem(44),
      tunvnItem(60, { name: "API TEST", excluded: 1, axvara_name: null, family_key: "p60", variant_id: null }),
    ], counts: { total: 3, published: 0, requested: 0, in_stock: 3, mapped: 2, active_variants: 0 }, last_sync_at: null });
  });
}

describe("TUNVN tab Markup", () => {
  it("tanpa VND, #60 tersembunyi, Simpan hanya field berubah, draf baris lain bertahan", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", tunvnFetch(calls));
    renderAdmin(<ToastProvider><TunvnManager /></ToastProvider>);
    expect(await screen.findByText("akun axv")).toBeTruthy();
    expect(document.body.textContent).not.toContain("VND");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Markup" }), { button: 0 });
    await screen.findByText("CapCut Pro");
    expect(document.body.textContent).not.toContain("VND");
    expect(screen.queryByText("API TEST")).toBeNull();
    expect(document.body.textContent).toContain("≈ Rp");

    const row37 = screen.getByRole("form", { name: "Harga Varian 37" });
    const row44 = screen.getByRole("form", { name: "Harga Varian 44" });
    const save37 = within(row37).getByRole("button", { name: "Simpan" }) as HTMLButtonElement;
    expect(save37.disabled).toBe(true);

    fireEvent.change(within(row44).getByLabelText("Markup %"), { target: { value: "50" } });
    fireEvent.change(within(row37).getByLabelText("Harga manual (Rp)"), { target: { value: "40000" } });
    expect(save37.disabled).toBe(false);
    fireEvent.click(save37);

    await waitFor(() => expect(calls.some(c => c.url.endsWith("/tunvn/products/37"))).toBe(true));
    const patch = calls.find(c => c.url.endsWith("/tunvn/products/37"))!;
    expect(JSON.parse(String(patch.init?.body))).toEqual({ admin_price_idr: 40000 });
    await screen.findByText("Harga Varian 37 disimpan.");
    // Baris 44 tidak di-unmount oleh muat ulang: draf markup masih ada.
    expect((within(screen.getByRole("form", { name: "Harga Varian 44" })).getByLabelText("Markup %") as HTMLInputElement).value).toBe("50");
  });

  it("Katalog: deskripsi supplier terlipat sebagai rujukan admin", async () => {
    vi.stubGlobal("fetch", tunvnFetch([]));
    renderAdmin(<ToastProvider><TunvnManager /></ToastProvider>);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Katalog" }), { button: 0 });
    const summary = await screen.findByText(/Deskripsi supplier/);
    expect(summary.closest("details")?.open).toBe(false);
    expect(screen.getByText("Capcut Pro 1 Month Team Plan - Full Warranty")).toBeTruthy();
    expect(screen.getAllByText(/Deskripsi supplier/)).toHaveLength(1);
  });

  it("menolak harga manual 0 di klien tanpa mengirim permintaan", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", tunvnFetch(calls));
    renderAdmin(<ToastProvider><TunvnManager /></ToastProvider>);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Markup" }), { button: 0 });
    const row = await screen.findByRole("form", { name: "Harga Varian 37" });
    fireEvent.change(within(row).getByLabelText("Harga manual (Rp)"), { target: { value: "0" } });
    fireEvent.click(within(row).getByRole("button", { name: "Simpan" }));
    expect(await within(row).findByRole("alert")).toBeTruthy();
    expect(calls.some(c => c.url.includes("/tunvn/products/"))).toBe(false);
  });
});

describe("AIVault", () => {
  it("tab tidak selebar layar dan grup memakai nama produk AXVARA", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/aivault/balance")) return Response.json({ balance: 5 });
      if (url.includes("/aivault/orders")) return Response.json({ items: [] });
      return Response.json({ ok: true, configured: true, last_sync_at: null, items: [{
        service_id: "adobe-12m", name: "Adobe Express 12M", stock: 3, unit_price_usd: 0.1, markup_percent: 35, variant_id: 9, label: "12 Bulan",
        variant_price: 2500, variant_active: 0, product_active: 0, aivault_admin_price_idr: null, fx_idr_per_usd: 18000,
        product_name: "Adobe Express Premium", product_archived: 0, family: { key: "adobe", name: "Adobe Express" },
      }] });
    }));
    renderAdmin(<ToastProvider><AivaultManager /></ToastProvider>);
    expect(screen.getByRole("tablist").className).toContain("w-fit");
    expect(screen.getByRole("tablist").className).not.toMatch(/(^|\s)w-full(\s|$)/);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Markup" }), { button: 0 });
    expect(await screen.findByText("Adobe Express Premium")).toBeTruthy();
    expect(screen.getByText("Induk nonaktif")).toBeTruthy();
    expect((within(screen.getByRole("form", { name: "Harga 12 Bulan" })).getByRole("button", { name: "Simpan" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
