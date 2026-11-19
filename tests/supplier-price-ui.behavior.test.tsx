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
import { StorebatManager } from "@/components/admin/StorebatManager";
import { MiraiManager } from "@/components/admin/MiraiManager";

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
  admin_name: null, admin_description: null, axvara_name: "CapCut Pro", axvara_description: null,
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
    expect(screen.getByText("2 dipetakan · 2 di katalog")).toBeTruthy();
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

  it("Markup: deskripsi supplier terlipat dan saklar hanya mengirim is_active", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", tunvnFetch(calls));
    renderAdmin(<ToastProvider><TunvnManager /></ToastProvider>);
    expect(screen.queryByRole("tab", { name: "Katalog" })).toBeNull();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Markup" }), { button: 0 });
    const summary = await screen.findByText(/Deskripsi supplier/);
    expect(summary.closest("details")?.open).toBe(false);
    expect(screen.getByText("Capcut Pro 1 Month Team Plan - Full Warranty")).toBeTruthy();
    expect(screen.getAllByText(/Deskripsi supplier/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("switch", { name: "Aktif Varian 37" }));
    await screen.findByText("Varian 37 diaktifkan.");
    expect(calls.filter(call => call.init?.method === "PATCH").map(call => [call.url, JSON.parse(String(call.init?.body))])).toEqual([
      ["/api/admin/tunvn/products/37", { is_active: true }],
    ]);
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

describe.each([
  { name: "StoreBat", route: "storebat", key: "124", Manager: StorebatManager, currency: "USD", price: { id: 124, price_usd: 0.125, fx_idr_per_usd: 18000, delivery_type: "muse_buff" } },
  { name: "Mirai", route: "mirai", key: "GPT_10M", Manager: MiraiManager, currency: "USDT", price: { package_code: "GPT_10M", cost_usdt: 0.123456, fx_idr_per_usdt: 18000 } },
])("$name", ({ name, route, key, Manager, currency, price }) => {
  function setup({ failedBalance = false, empty = false, delay = 0 } = {}) {
    let manual: number | null = 2000;
    const requests: [string, RequestInit | undefined][] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      requests.push([url, init]);
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (url.endsWith("/balance")) return failedBalance ? Response.json({ error: "balance_unavailable" }, { status: 503 }) : Response.json({ ok: true, balance: 2.5, currency });
      if (url.endsWith(`/products/${key}`)) {
        manual = JSON.parse(String(init?.body)).admin_price_idr;
        return Response.json({ ok: true });
      }
      if (url.endsWith("/products")) return Response.json({ ok: true, configured: true, dispatch_enabled: false, sync_enabled: true, last_sync_at: "1795012740000", last_error: null,
        items: empty ? [] : [{ ...price, name: "Paket supplier", label: "Paket A", markup_percent: 35, variant_id: 10, admin_price_idr: manual, stock: -1, variant_price: manual ?? 3100, product_active: 0, variant_active: 1, product_archived: 0, product_name: "Katalog AXVARA", family: { key: "paket", name: "Paket" } },
          { ...price, ...(route === "mirai" ? { package_code: "ARC" } : { id: 22 }), name: "Arsip supplier", label: "Paket B", markup_percent: 35, variant_id: 11, admin_price_idr: null, stock: 0, variant_price: 3100, product_active: 0, variant_active: 0, product_archived: 1, family: { key: "arsip", name: "Paket arsip" } }],
      });
      if (url.endsWith("/orders") && init?.method === "POST") return Response.json({ ok: true, ...(JSON.parse(String(init.body)).action === "reveal" ? { receipt: JSON.stringify({ redeem_codes: ["fixture-code"], amount_usdt: 0.123456 }) } : { link: { status: "completed" } }) });
      if (url.endsWith("/orders")) return Response.json({ ok: true, items: empty ? [] : [
        { id: 1, order_code: "SAFE-01", status: "needs_admin", can_retry: 1, attempt_count: 0, quantity: 1 },
        { id: 2, order_code: "UNSAFE-02", status: "needs_admin", can_retry: 0, has_receipt: 1, attempt_count: 3, quantity: 1, cost_usdt: 0.123456, cost_usd: 0.125 },
        { id: 3, order_code: "OTHER-03", status: "completed", can_retry: 1, attempt_count: 1, quantity: 1 },
      ] });
      if (url.endsWith("/publish")) return Response.json({ ok: true });
      throw new Error(`Unexpected ${url}`);
    }));
    renderAdmin(<Manager />);
    return requests;
  }

  it("saldo gagal tetapi katalog tetap tampil; arsip terkunci dan simpan hanya field berubah", async () => {
    const calls = setup({ failedBalance: true });
    expect(await screen.findByText("Saldo: HTTP 503: Saldo belum dapat dibaca.")).toBeTruthy();
    expect(screen.getByText("Pengiriman otomatis nonaktif")).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Markup" }), { button: 0 });
    expect(await screen.findByText("Katalog AXVARA")).toBeTruthy();
    expect(screen.getByText("Induk nonaktif")).toBeTruthy();
    expect(screen.getByText("Arsip")).toBeTruthy();
    expect((within(screen.getByRole("form", { name: "Harga Paket B" })).getByLabelText("Markup %") as HTMLInputElement).disabled).toBe(true);
    const row = within(screen.getByRole("form", { name: "Harga Paket A" }));
    expect(row.getByText(route === "mirai" ? /0,1235 USDT/ : /\$0\.125.*per 1 miliar token/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("VND");
    const input = row.getByLabelText("Harga manual (Rp)");
    const save = row.getByRole("button", { name: "Simpan" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(save);
    expect(await row.findByRole("alert")).toBeTruthy();
    expect(calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(save);
    expect(await screen.findByText("Harga Paket A disimpan.")).toBeTruthy();
    expect(calls.filter(([, init]) => init?.method === "PATCH").map(([url, init]) => [url, JSON.parse(String(init?.body))])).toEqual([[`/api/admin/${route}/products/${key}`, { admin_price_idr: null }]]);
  });

  it("antrean hanya menawarkan retry aman, reveal lewat POST, dan publish lewat Alat", async () => {
    const calls = setup();
    expect(await screen.findByText(route === "mirai" ? "2,50 USDT" : "$2.50")).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Antrean" }), { button: 0 });
    const table = within(screen.getByRole("table"));
    const cards = within(screen.getByLabelText(`Kartu pengiriman ${name}`));
    expect(table.getAllByRole("button", { name: "Coba lagi" })).toHaveLength(1);
    expect(cards.getAllByRole("button", { name: "Coba lagi" })).toHaveLength(1);
    expect(screen.queryByText(/fixture-code/)).toBeNull();
    fireEvent.click(table.getByRole("button", { name: "Coba lagi" }));
    await screen.findByText("Pesanan diproses ulang.");
    const reveal = cards.getByRole("button", { name: "Lihat receipt" });
    fireEvent.click(reveal);
    expect(within(await screen.findByRole("dialog", { name: `Receipt ${name}` })).getByText(/fixture-code/)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(reveal));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Alat" }), { button: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Sinkronkan katalog" }));
    expect(await screen.findByText("Sinkron katalog selesai.")).toBeTruthy();
    expect(calls.filter(([, init]) => init?.method === "POST").map(([url, init]) => [url, init?.cache, JSON.parse(String(init?.body))])).toEqual([
      [`/api/admin/${route}/orders`, "no-store", { id: 1, action: "retry" }],
      [`/api/admin/${route}/orders`, "no-store", { id: 2, action: "reveal" }],
      [`/api/admin/${route}/publish`, "no-store", {}],
    ]);
  });

  it("memisahkan loading dari katalog dan antrean kosong", async () => {
    setup({ empty: true, delay: 50 });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Antrean" }), { button: 0 });
    expect(screen.getByText(`Memuat data ${name}…`)).toBeTruthy();
    expect(screen.queryByText(`Belum ada pesanan ${name}.`)).toBeNull();
    expect(await screen.findByText(`Belum ada pesanan ${name}.`)).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Markup" }), { button: 0 });
    expect(screen.getByText("Sinkronkan katalog dari tab Alat untuk memulai.")).toBeTruthy();
  });
});

it.each([
  ["AIVault", AivaultManager, "USD"], ["TUNVN", TunvnManager, "USDT"],
  ["StoreBat", StorebatManager, "USD"], ["Mirai", MiraiManager, "USDT"],
] as const)("%s shares tabs, desktop and mobile queue status/formatting, and sync failure handling", async (name, Manager, currency) => {
  const states = [
    [{ status: "pending" }, "Menunggu"], [{ status: "claimed" }, "Memproses"], [{ status: "processing" }, "Menunggu supplier"],
    [{ status: "completed" }, "Selesai"], [{ status: "needs_admin", last_error: "opaque_code" }, "Perlu diperiksa"],
    [{ status: "needs_admin", last_error: "blocked_balance" }, "Saldo kurang"], [{ status: "failed" }, "Gagal"],
    [{ status: "needs_admin", purchase_disabled: 1, can_retry: 1 }, "Penanganan manual"],
  ] as const;
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.endsWith("/balance")) return Response.json({ balance: 0, currency });
    if (url.endsWith("/products")) return Response.json({ configured: true, items: [], last_sync_at: "2026-11-18 23:58:00", last_error: { at: "2026-11-19 00:00:00", error: "opaque_code" } });
    if (url.endsWith("/buff")) return Response.json({ variants: [], probe: null, muse_product: null });
    if (url.endsWith("/publish")) return Response.json({ skipped: "claimed_elsewhere" }, { status: 503 });
    return Response.json({ items: [
      ...states.map(([state], i) => ({ id: i, order_code: `FIXTURE-${i}`, item_index: 1, quantity: 2, cost_usd: 0.1, cost_usdt: 0.274,
        created_at: "2026-11-18 01:00:00", updated_at: "2026-11-18 05:28:00", ...state })),
      ...(name === "TUNVN" ? [{ id: 60, order_code: "EXCLUDED-60", source_product_id: 60, quantity: 1 }] : []),
    ] });
  }));
  renderAdmin(<Manager />);
  expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Ringkas", "Antrean", "Markup", "Alat"]);
  expect(screen.getByText(`Katalog, harga, dan pengiriman otomatis ${name}.`)).toBeTruthy();
  expect(await screen.findByText("19 Nov 2026, 06.58")).toBeTruthy();
  expect(screen.getByText(currency === "USD" ? "$0.00" : "0,00 USDT")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("Sinkron gagal (19 Nov 2026, 07.00)");
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Antrean" }), { button: 0 });
  const table = within(screen.getByRole("table"));
  expect(table.getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["Pesanan", "Unit", "Biaya", "Status", "Waktu", "Aksi"]);
  for (const scope of [table, within(screen.getByLabelText(`Kartu pengiriman ${name}`))]) {
    for (const [, label] of states) expect(scope.getByText(label)).toBeTruthy();
    expect(scope.getAllByText("18 Nov 2026, 12.28")).toHaveLength(states.length);
    expect(scope.getAllByText(currency === "USD" ? "$0.10" : "0,2740 USDT")).toHaveLength(states.length);
    expect(scope.queryByText(/opaque_code|EXCLUDED-60|Siap dikirim/)).toBeNull();
    expect(scope.queryByRole("button", { name: "Coba lagi" })).toBeNull();
  }
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Alat" }), { button: 0 });
  fireEvent.click(screen.getByRole("button", { name: "Sinkronkan katalog" }));
  expect(await screen.findByText("Sinkron: HTTP 503: Sinkron sedang berjalan di proses lain.")).toBeTruthy();
});
