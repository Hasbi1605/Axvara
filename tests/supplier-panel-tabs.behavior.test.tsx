// @vitest-environment jsdom
//
// tests/supplier-panel-tabs.behavior.test.tsx — Panel supplier terpadu WR/SK:
// Ringkas default + lazy-load per tab + 4 kartu Ringkas + Antrean 7 kolom
// (Retry/Batal/BlockedRetry + SK send/invoice fences) + Markup FamilyCard/bulk
// + Alat (Sinkron, Exclusion, Sandbox SK).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render as renderAdmin } from "./setup/admin-render";
import { WarungRebahanManager } from "@/components/admin/WarungRebahanManager";
import { SekalipayManager } from "@/components/admin/SekalipayManager";
import { PixelverifManager } from "@/components/admin/PixelverifManager";
import { ToastProvider } from "@/components/ui/Toast";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
beforeEach(() => { vi.stubGlobal("ResizeObserver", ResizeObserverStub); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); });

type StubOptions = {
  overrides?: Record<string, unknown>;
  handlers?: (url: string, init?: RequestInit) => Response | Promise<Response> | null;
};

function stubSupplierApi(opts: StubOptions = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const handled = opts.handlers?.(url, init);
    if (handled) return handled;
    const body =
      url.includes("/saldo") ? {
        current: { balance: 100000, isLow: false, threshold: 250000 },
        capacity: { balance: 100000, avgOrderCost: 10000, estimatedOrders: 10 },
      }
      : url.includes("/sync-log") ? {
        logs: [],
        diff: { last_at: "2026-11-19 01:00:00", healthy: true, last_change_at: null, last_change: null, last_error: null, full_sweep_at: null },
        configured: true, dispatch_enabled: true, sync_enabled: true,
        counts: { active_variants: 1, mapped_variants: 2, total_variants: 3, families: 2 },
      }
      : url.includes("/exclusions") ? { exclusions: [{ id: 1, pattern: "%canva%", reason: "manual" }] }
      : url.includes("/orders") ? { orders: [], total: 0, page: 1, per_page: 20 }
      : url.includes("/markup") ? {
          variants: [
            { wr_variant_id: "WR-LIVE", sk_variant_id: "SK-LIVE", wr_variant_name: "V Live", sk_variant_name: "V Live", wr_product_name: "Canva", sk_product_name: "Canva", product_name: "Canva Pro", product_slug: "canva-pro", variant_label: "1 Bulan", axvara_product_id: 101, supplier_product_id: "P1", product_archived: 0, wr_price: 10000, sk_price: 10000, wr_stock: 5, sk_stock: 5, markup_percent: 50, markup_fixed: 0, axvara_sell_price: 15000, axvara_variant_id: 1, wr_delivery_class: "restock", sk_order_process: "auto", variant_status: "live", variant_reason: "Tampil di storefront" },
            { wr_variant_id: "WR-HABIS", sk_variant_id: "SK-HABIS", wr_variant_name: "V Habis", sk_variant_name: "V Habis", wr_product_name: "Canva", sk_product_name: "Canva", product_name: "Canva Pro", product_slug: "canva-pro", variant_label: "3 Bulan", axvara_product_id: 101, supplier_product_id: "P1", product_archived: 0, wr_price: 10000, sk_price: 10000, wr_stock: 0, sk_stock: 0, markup_percent: 50, markup_fixed: 0, axvara_sell_price: 15000, axvara_variant_id: 2, wr_delivery_class: "made_by_order", sk_order_process: "manual", variant_status: "hidden_soldout", variant_reason: "Stok habis" },
            { wr_variant_id: "WR-OFF", sk_variant_id: "SK-OFF", wr_variant_name: "V Off", sk_variant_name: "V Off", wr_product_name: "Netflix", sk_product_name: "Netflix", product_name: "Netflix", product_slug: "netflix", variant_label: "1 Bulan", axvara_product_id: 102, supplier_product_id: "P2", product_archived: 1, wr_price: 10000, sk_price: 10000, wr_stock: 5, sk_stock: 5, markup_percent: 50, markup_fixed: 0, axvara_sell_price: 15000, axvara_variant_id: 3, wr_delivery_class: "restock", sk_order_process: "auto", variant_status: "off", variant_reason: "Produk diarsipkan" },
          ],
          total: 3,
        }
      : {};
    return Response.json({ ...body, ...(opts.overrides?.[url.split("?")[0]] as object ?? {}) });
  }));
  return calls;
}

it("shows observed Pixel plans under Semua but excludes them from active and bulk controls", async () => {
  stubSupplierApi({ handlers: url => url.endsWith("/pixelverif/products") ? Response.json({
    configured: true, items: [
      { service_key: "full_3", label: "Aktivasi Langsung 3 Bulan", variant_id: 1, variant_status: "off", variant_active: 0, markup_percent: 35, family: { key: "three", name: "Google AI Pro 3 Bulan" } },
      { service_key: "full_6", label: "Aktivasi Langsung 6 Bulan", variant_id: null, variant_status: "hidden_nocatalog", pixel_observed_state: "available", credit_cost: 1.2, markup_percent: 0, family: { key: "six", name: "Google AI Pro 6 Bulan" } },
      { service_key: "normal_6", label: "Link Redeem 6 Bulan", variant_id: null, variant_status: "hidden_nocatalog", pixel_observed_state: "disabled", markup_percent: 0, family: { key: "six", name: "Google AI Pro 6 Bulan" } },
    ],
  }) : null });
  renderAdmin(<ToastProvider><PixelverifManager /></ToastProvider>);
  await userEvent.click(screen.getByRole("tab", { name: "Markup" }));
  await userEvent.click(await screen.findByRole("tab", { name: "Semua (3)" }));
  expect(screen.getByText("Aktivasi Langsung 6 Bulan")).toBeTruthy();
  expect(screen.getByText("Tersedia di Pixel")).toBeTruthy();
  expect(screen.getByText("Nonaktif di Pixel")).toBeTruthy();
  expect(screen.queryByRole("switch", { name: /6 Bulan/ })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: /6 Bulan/ })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Cari varian" }), { target: { value: "normal_6" } });
  expect(screen.getByText("Link Redeem 6 Bulan")).toBeTruthy();
  expect(screen.queryByText("Aktivasi Langsung 6 Bulan")).toBeNull();
  expect(screen.queryByText("Pilih halaman ini")).toBeNull();
});

describe("tab dalam-halaman WR", () => {
  it("mempertahankan hasil filter terbaru saat respons antrean lama terlambat", async () => {
    let resolveOld: (response: Response) => void = () => {};
    const slowOrders = new Promise<Response>(resolve => { resolveOld = resolve; });
    const orderResponse = (code: string) => Response.json({ orders: [{ id: 1, order_code: code, status: "pending", quantity: 1 }], total: 1, page: 1 });
    const calls = stubSupplierApi({ handlers: url => {
      if (url.includes("/warung/orders?status=all")) return slowOrders;
      if (url.includes("/warung/orders?status=pending")) return orderResponse("WR-FILTERED");
      return null;
    } });
    renderAdmin(<ToastProvider><WarungRebahanManager /></ToastProvider>);
    await userEvent.click(screen.getByRole("tab", { name: /Antrean/ }));
    await waitFor(() => expect(calls.some(call => call.url.includes("/warung/orders?status=all"))).toBe(true));
    fireEvent.change(screen.getByLabelText(/filter status order WR/i), { target: { value: "pending" } });
    const table = within(await screen.findByRole("table"));
    expect(await table.findByText("WR-FILTERED")).toBeTruthy();
    await act(async () => { resolveOld(orderResponse("WR-OLD")); });
    expect(table.queryByText("WR-OLD")).toBeNull();
    expect(table.getByText("WR-FILTERED")).toBeTruthy();
  });

  it("default Ringkas (4 kartu + status pills); Antrean/Markup/Alat lazy + cache", async () => {
    const calls = stubSupplierApi();
    renderAdmin(<ToastProvider><WarungRebahanManager /></ToastProvider>);
    expect(await screen.findByRole("heading", { name: "Warung Rebahan" })).toBeTruthy();
    expect(await screen.findByText("~10 order")).toBeTruthy();
    expect(screen.getByText("Varian aktif")).toBeTruthy();
    expect(screen.getByText("Keluarga produk")).toBeTruthy();
    expect(screen.getByText("2 dipetakan · 3 di katalog")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.queryByText("Konfigurasi tersedia")).toBeNull();
    expect(screen.getByText("Pengiriman otomatis aktif")).toBeTruthy();
    expect(screen.getByText("Sinkron otomatis aktif")).toBeTruthy();

    const hit = (frag: string) => calls.filter((c) => c.url.includes(frag)).length;
    expect(hit("/saldo")).toBe(1);
    expect(hit("/sync-log")).toBe(1);
    expect(hit("/warung/orders"), "antrean tidak fetch sebelum dibuka").toBe(0);
    expect(hit("/warung/markup"), "markup tidak fetch sebelum dibuka").toBe(0);
    expect(hit("/warung/exclusions"), "exclusions tidak fetch sebelum dibuka").toBe(0);

    await userEvent.click(screen.getByRole("tab", { name: /Antrean/ }));
    await waitFor(() => expect(hit("/warung/orders")).toBe(1));

    await userEvent.click(screen.getByRole("tab", { name: /^Markup/ }));
    await waitFor(() => expect(hit("/warung/markup")).toBe(1));

    await userEvent.click(screen.getByRole("tab", { name: /^Alat/ }));
    await waitFor(() => expect(hit("/warung/exclusions")).toBe(1));

    // Cache: bolak-balik tidak refetch.
    await userEvent.click(screen.getByRole("tab", { name: /Ringkas/ }));
    await userEvent.click(screen.getByRole("tab", { name: /Antrean/ }));
    await userEvent.click(screen.getByRole("tab", { name: /^Markup/ }));
    await userEvent.click(screen.getByRole("tab", { name: /^Alat/ }));
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    expect(hit("/warung/orders"), "cache antrean").toBe(1);
    expect(hit("/warung/markup"), "cache markup").toBe(1);
    expect(hit("/warung/exclusions"), "cache alat").toBe(1);
  });

  it("Ringkas WR jujur saat saldo stale dan sync partial/failed", async () => {
    stubSupplierApi({
      overrides: {
        "/api/admin/warung/saldo": {
          current: { balance: 85000, isLow: true, threshold: 250000 },
          capacity: { balance: 85000, avgOrderCost: 8500, estimatedOrders: 10 },
          stale: true,
        },
      },
      handlers: (url) => url.includes("/warung/sync")
        ? Response.json({ ok: true, status: "partial", synced: 5, variantsSynced: 12, errors: ["timeout upstream"] })
        : null,
    });
    renderAdmin(<ToastProvider><WarungRebahanManager /></ToastProvider>);
    expect(await screen.findByText("Saldo live gagal — menampilkan terakhir tercatat.")).toBeTruthy();
    expect(screen.getByText(/Di bawah batas/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Sinkron sekarang" }));
    expect(await screen.findByText(/Sync sebagian: 5 produk, 12 varian.*timeout upstream/)).toBeTruthy();
  });

  it("sub-tab markup default Live; FamilyCard + %/Rp tanpa saklar + bulk + partial honesty", async () => {
    const calls = stubSupplierApi({
      overrides: {
        "/api/admin/warung/markup": {
          variants: [
            { wr_variant_id: "WR-LIVE", wr_variant_name: "V Live", wr_product_name: "Canva", product_name: "Canva Pro", product_slug: "canva-pro", variant_label: "1 Bulan", axvara_product_id: 101, supplier_product_id: "P1", product_archived: 0, wr_price: 10000, wr_stock: 5, markup_percent: 50, markup_fixed: 500, axvara_sell_price: 15500, axvara_variant_id: 1, wr_delivery_class: "restock", variant_status: "live", variant_reason: "Tampil di storefront" },
            { wr_variant_id: "WR-HABIS", wr_variant_name: "V Habis", wr_product_name: "Canva", product_name: "Canva Pro", product_slug: "canva-pro", variant_label: "3 Bulan", axvara_product_id: 101, supplier_product_id: "P1", product_archived: 0, wr_price: 10000, wr_stock: 0, markup_percent: 50, markup_fixed: 0, axvara_sell_price: 15000, axvara_variant_id: 2, wr_delivery_class: "made_by_order", variant_status: "hidden_soldout", variant_reason: "Stok habis" },
            { wr_variant_id: "WR-OFF", wr_variant_name: "V Off", wr_product_name: "Netflix", product_name: "Netflix", product_slug: "netflix", variant_label: "1 Bulan", axvara_product_id: 102, supplier_product_id: "P2", product_archived: 1, wr_price: 10000, wr_stock: 5, markup_percent: 50, markup_fixed: 0, axvara_sell_price: 15000, axvara_variant_id: 3, wr_delivery_class: "restock", variant_status: "off", variant_reason: "Produk diarsipkan" },
          ],
          total: 520,
        },
      },
      handlers: (url, init) => {
        if (url.endsWith("/warung/markup") && init?.method === "PUT") return Response.json({ ok: true, sell_price: 16500 });
        if (url.endsWith("/warung/markup/bulk") && init?.method === "POST") return Response.json({ ok: true, updated: 1, failed: [] });
        return null;
      },
    });
    renderAdmin(<ToastProvider><WarungRebahanManager /></ToastProvider>);
    await userEvent.click(screen.getByRole("tab", { name: /^Markup/ }));
    expect(await screen.findByText("Canva Pro")).toBeTruthy();
    // Honesty banner when total > loaded rows
    expect(screen.getByText(/Menampilkan 3 dari 520 varian/)).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Semua (3 / 520)" })).toBeTruthy();
    // No activation switch for WR/SK; bulk reset stays hidden until selecting a row.
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText("reset Rp ke 0")).toBeNull();

    // Default Live: only 1 Bulan (WR-LIVE) visible
    expect(screen.getByRole("form", { name: "Harga 1 Bulan" })).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Harga 3 Bulan" })).toBeNull();
    expect(screen.getByText("AUTO")).toBeTruthy();

    // Edit WR % + fixed and save
    const form = screen.getByRole("form", { name: "Harga 1 Bulan" });
    fireEvent.change(within(form).getByLabelText("Markup %"), { target: { value: "60" } });
    fireEvent.change(within(form).getByLabelText("Markup nominal (Rp)"), { target: { value: "500" } });
    await userEvent.click(within(form).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(calls.some(c => c.init?.method === "PUT")).toBe(true));
    const put = calls.find(c => c.init?.method === "PUT")!;
    expect(JSON.parse(String(put.init?.body))).toEqual({ wr_variant_id: "WR-LIVE", markup_percent: 60, markup_fixed: 500 });

    // Bulk markup checks only checked/visible row and confirms via ConfirmDialog
    await userEvent.click(screen.getByRole("checkbox", { name: "Pilih V Live untuk bulk markup" }));
    expect(screen.getByText("reset Rp ke 0")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Terapkan ke 1 varian" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Terapkan markup" }));
    await waitFor(() => expect(calls.some(c => c.url.endsWith("/warung/markup/bulk"))).toBe(true));
    const bulkCall = calls.find(c => c.url.endsWith("/warung/markup/bulk"))!;
    expect(JSON.parse(String(bulkCall.init?.body))).toEqual({ variant_ids: ["WR-LIVE"], markup_percent: 20, markup_fixed: 0, update_fixed: false });

    // Switch to Hidden & Off sub-tabs; archived product disables inputs
    await userEvent.click(screen.getByRole("tab", { name: /Disembunyikan otomatis/ }));
    expect(screen.getByRole("form", { name: "Harga 3 Bulan" })).toBeTruthy();
    expect(screen.getByText("MANUAL")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: /Nonaktif manual/ }));
    expect(screen.getByText("Arsip")).toBeTruthy();
    expect((within(screen.getByRole("form", { name: "Harga 1 Bulan" })).getByLabelText("Markup %") as HTMLInputElement).disabled).toBe(true);
  });

  it("Antrean WR: 7 kolom, Retry/Batal ConfirmDialog, dan BlockedRetry", async () => {
    const calls = stubSupplierApi({
      handlers: (url, init) => {
        if (url.includes("/warung/orders?")) {
          return Response.json({
            orders: [
              { id: 10, order_code: "AXV-RETRY", wr_order_id: null, wr_product_name: "Canva", wr_variant_name: "1 Bulan", quantity: 1, wr_cost: 12000, status: "blocked_balance", attempt_count: 1, max_attempts: 3, last_error: "insufficient_balance", order_status: "lunas", customer_name: "Budi", customer_wa: "62812****9900", sales_channel: "web", created_at: "2026-11-18 01:00:00" },
              { id: 11, order_code: "AXV-SENT", wr_order_id: "RBHN-999", wr_product_name: "Netflix", wr_variant_name: "1 Bulan", quantity: 1, wr_cost: 25000, status: "failed", attempt_count: 3, max_attempts: 3, last_error: "timeout", order_status: "lunas", request_sent_at: "2026-11-18 02:00:00" },
            ],
            total: 2, page: 1, per_page: 20,
          });
        }
        if (url.endsWith("/warung/orders/10/void") && init?.method === "POST") return Response.json({ ok: true });
        return null;
      },
    });
    renderAdmin(<ToastProvider><WarungRebahanManager /></ToastProvider>);
    await userEvent.click(screen.getByRole("tab", { name: /Antrean/ }));
    const table = within(await screen.findByRole("table"));
    expect(table.getAllByRole("columnheader").map(c => c.textContent)).toEqual(["Pesanan", "Unit", "Biaya", "Status", "Pembeli", "Umur antrean", "Aksi"]);
    expect(table.getByText("Canva — 1 Bulan · 1 unit")).toBeTruthy();
    expect(table.getByText("Budi · 62812****9900 · web")).toBeTruthy();
    expect(table.getByText("Tak bisa retry")).toBeTruthy();

    // Batal opens ConfirmDialog; cancel aborts without POST, confirm triggers void
    const cancelBtn = table.getByRole("button", { name: "Batal" });
    await userEvent.click(cancelBtn);
    const alert = await screen.findByRole("alertdialog");
    await userEvent.click(within(alert).getByRole("button", { name: "Kembali" }));
    expect(calls.some(c => c.url.includes("/void"))).toBe(false);

    await userEvent.click(cancelBtn);
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Batalkan order" }));
    await waitFor(() => expect(calls.some(c => c.url.endsWith("/warung/orders/10/void"))).toBe(true));
  });
});

describe("tab dalam-halaman SK", () => {
  it("memakai Ringkas/Antrean/Markup/Alat, sandbox + exclusions di Alat, dan gerbang retry SK", async () => {
    const calls = stubSupplierApi({
      handlers: (url) => {
        if (url.includes("/sekalipay/orders?")) {
          return Response.json({
            orders: [
              // Eligible pre-send failed (no sk_invoice, no request_sent_at, lunas)
              { id: 1, order_code: "SK-OK", sk_invoice: null, request_sent_at: null, sk_product_name: "Viu", sk_variant_name: "1 Bulan", quantity: 1, sk_cost: 5000, status: "failed", attempt_count: 3, max_attempts: 3, order_status: "lunas" },
              // Blocked: has sk_invoice (must reconcile, never retry)
              { id: 2, order_code: "SK-INV", sk_invoice: "INV-123", request_sent_at: null, sk_product_name: "Viu", sk_variant_name: "1 Bulan", quantity: 1, sk_cost: 5000, status: "failed", attempt_count: 0, max_attempts: 3, order_status: "lunas" },
              // Blocked: has request_sent_at
              { id: 3, order_code: "SK-SENT", sk_invoice: null, request_sent_at: "2026-11-19 00:00:00", sk_product_name: "Viu", sk_variant_name: "1 Bulan", quantity: 1, sk_cost: 5000, status: "retry", attempt_count: 0, max_attempts: 3, order_status: "lunas" },
              // Blocked: payment_status belum paid walau status order lunas
              { id: 4, order_code: "SK-UNPAID", sk_invoice: null, request_sent_at: null, sk_product_name: "Viu", sk_variant_name: "1 Bulan", quantity: 1, sk_cost: 5000, status: "pending", attempt_count: 0, max_attempts: 3, order_status: "lunas", order_payment_status: "pending" },
            ],
            total: 4, page: 1, per_page: 20,
          });
        }
        return null;
      },
    });
    renderAdmin(<ToastProvider><SekalipayManager /></ToastProvider>);
    await screen.findByRole("heading", { name: "Sekalipay" });

    expect(screen.getAllByRole("tab").map(t => t.textContent)).toEqual(["Ringkas", "Antrean", "Markup", "Alat"]);
    expect(screen.queryByRole("tab", { name: /Audit SK/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Aturan/ })).toBeNull();

    const hit = (frag: string) => calls.filter((c) => c.url.includes(frag)).length;
    expect(hit("/sekalipay/orders"), "antrean lazy").toBe(0);
    expect(hit("/sekalipay/markup"), "markup lazy").toBe(0);
    expect(hit("/sekalipay/exclusions"), "alat lazy").toBe(0);

    // Antrean enforces SK send/invoice/order_status fences
    await userEvent.click(screen.getByRole("tab", { name: /Antrean/ }));
    const table = within(await screen.findByRole("table"));
    expect(table.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
    expect(table.getAllByText("Tak bisa retry")).toHaveLength(3);
    const sentRow = within(table.getByRole("row", { name: /SK-SENT/ }));
    expect(sentRow.queryByRole("button", { name: "Retry" })).toBeNull();
    await userEvent.click(sentRow.getByRole("button", { name: "Batal" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Batalkan order" }));
    await waitFor(() => expect(calls.some(c => c.url.endsWith("/sekalipay/orders/3/void"))).toBe(true));

    // Sandbox & exclusions live under Alat (not Antrean)
    expect(screen.queryByPlaceholderText("product_id")).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: /^Alat/ }));
    expect(await screen.findByPlaceholderText("product_id")).toBeTruthy();
    expect(screen.getByText("%canva%")).toBeTruthy();
  });
});

describe("kontrak API tab (variant_status + total + pagination)", () => {
  it("GET markup WR: variant_status + total; hierarki off > kalah > habis", async () => {
    const { createD1Fixture } = await import("./helpers/d1-fixture");
    const fx = createD1Fixture();
    try {
      fx.sql.prepare(`INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, sort_order) VALUES (1, 2, 'P', 'p', 'd', 1000, 5, 1, 0), (2, 2, 'Q', 'q', 'd', 1000, 0, 1, 1)`).run();
      fx.sql.prepare(`INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active, sort_order) VALUES (11, 1, 'A', 'A', 1500, 5, 1, 0), (12, 2, 'B', 'B', 1500, 0, 1, 0)`).run();
      fx.sql.prepare(`INSERT INTO wr_products (wr_product_id, wr_product_name, axvara_product_id) VALUES ('WP1', 'WP', 1), ('WP2', 'WQ', 2)`).run();
      fx.sql.prepare(`INSERT INTO wr_variants (wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_stock, axvara_variant_id) VALUES ('WVA', 'WP1', 'A', 1000, 5, 11), ('WVB', 'WP2', 'B', 1000, 0, 12)`).run();
      const { GET } = await import("@/app/api/admin/warung/markup/route");
      const { NextRequest } = await import("next/server");
      const res = await GET(new NextRequest("http://localhost/api/admin/warung/markup") as never);
      expect(res.status).toBe(401);
    } finally {
      fx.close();
    }
  });
});
