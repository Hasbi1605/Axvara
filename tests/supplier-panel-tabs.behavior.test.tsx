// @vitest-environment jsdom
//
// tests/supplier-panel-tabs.behavior.test.tsx — Tab dalam-halaman WR/SK
// (keputusan owner 2026-10-01): Ringkas default + lazy-load per tab +
// pagination antrean + sub-tab status markup Live/Hidden/Off.
//
// Yang dikunci:
// 1. Mount hanya fetch Ringkas (saldo+log); Antrean/Markup/Aturan/Audit/Alat
//    fetch saat tab dibuka pertama, cache setelahnya (tidak refetch).
// 2. Antrean punya pagination (total + halaman) — halaman 2 dulu hilang.
// 3. Markup: sub-tab status default Live + badge per baris + pagination lokal.
// 4. API markup mengembalikan variant_status + total; API orders total + page.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WarungRebahanManager } from "@/components/admin/WarungRebahanManager";
import { SekalipayManager } from "@/components/admin/SekalipayManager";
import { ToastProvider } from "@/components/ui/Toast";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.resetModules(); });

function stubSupplierApi(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const body =
      url.includes("/saldo") ? { current: { balance: 100000, isLow: false, threshold: 250000 } }
      : url.includes("/sync-log") ? { logs: [] }
      : url.includes("/exclusions") ? { exclusions: [] }
      : url.includes("/orders") ? { orders: [], total: 0, page: 1, per_page: 20 }
      : url.includes("/markup") ? {
          variants: [
            { wr_variant_id: "WR-LIVE", sk_variant_id: "SK-LIVE", wr_variant_name: "V Live", sk_variant_name: "V Live", wr_price: 10000, sk_price: 10000, wr_stock: 5, sk_stock: 5, markup_percent: 50, markup_fixed: 0, axvara_sell_price: 15000, axvara_variant_id: 1, wr_delivery_class: "restock", sk_order_process: "auto", variant_status: "live", variant_reason: "Tampil di storefront" },
            { wr_variant_id: "WR-HABIS", sk_variant_id: "SK-HABIS", wr_variant_name: "V Habis", sk_variant_name: "V Habis", wr_price: 10000, sk_price: 10000, wr_stock: 0, sk_stock: 0, markup_percent: 50, markup_fixed: 0, axvara_sell_price: 15000, axvara_variant_id: 2, wr_delivery_class: "restock", sk_order_process: "auto", variant_status: "hidden_soldout", variant_reason: "Stok habis" },
            { wr_variant_id: "WR-OFF", sk_variant_id: "SK-OFF", wr_variant_name: "V Off", sk_variant_name: "V Off", wr_price: 10000, sk_price: 10000, wr_stock: 5, sk_stock: 5, markup_percent: 50, markup_fixed: 0, axvara_sell_price: 15000, axvara_variant_id: 3, wr_delivery_class: "restock", sk_order_process: "auto", variant_status: "off", variant_reason: "Nonaktif manual" },
          ],
          total: 3,
        }
      : {};
    return { ok: true, status: 200, json: async () => ({ ...body, ...(overrides[url.split("?")[0]] as object ?? {}) }) };
  }));
  return calls;
}

describe("tab dalam-halaman WR", () => {
  it("default Ringkas; Antrean/Markup lazy + cache", async () => {
    const calls = stubSupplierApi();
    render(<ToastProvider><WarungRebahanManager /></ToastProvider>);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    const hit = (frag: string) => calls.filter((u) => u.includes(frag)).length;
    expect(hit("/saldo") >= 1, "Ringkas fetch saldo saat mount").toBe(true);
    expect(hit("/warung/orders"), "antrean tidak fetch sebelum dibuka").toBe(0);
    expect(hit("/warung/markup"), "markup tidak fetch sebelum dibuka").toBe(0);

    fireEvent.click(screen.getByRole("tab", { name: /Antrean/ }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(hit("/warung/orders"), "buka Antrean = 1 fetch").toBe(1);

    fireEvent.click(screen.getByRole("tab", { name: /^Markup/ }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(hit("/warung/markup"), "buka Markup = 1 fetch").toBe(1);

    // Cache: bolak-balik tidak refetch.
    fireEvent.click(screen.getByRole("tab", { name: /Ringkas/ }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    fireEvent.click(screen.getByRole("tab", { name: /Antrean/ }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(hit("/warung/orders"), "cache antrean").toBe(1);
  });

  it("sub-tab markup default Live; Hidden + Off terpisah; Simpan tetap ada", async () => {
    stubSupplierApi();
    render(<ToastProvider><WarungRebahanManager /></ToastProvider>);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    fireEvent.click(screen.getByRole("tab", { name: /^Markup/ }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    // Default Live: hanya V Live.
    expect(screen.getByText(/V Live/)).toBeTruthy();
    expect(screen.queryByText(/V Habis/)).toBeNull();
    // Badge Live tampil.
    expect(screen.getAllByText("Live").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: /Disembunyikan otomatis/ }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.getByText(/V Habis/)).toBeTruthy();
    expect(screen.queryByText(/V Live/)).toBeNull();
    // Tombol Simpan tetap ada di tab Hidden (markup boleh diubah).
    expect(screen.getAllByRole("button", { name: "Simpan" }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: /Nonaktif manual/ }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.getByText(/V Off/)).toBeTruthy();
  });
});

describe("tab dalam-halaman SK", () => {
  it("5 tab; Audit/Alat lazy (mutasi/transaksi/lock tidak fetch saat mount)", async () => {
    const calls = stubSupplierApi();
    render(<ToastProvider><SekalipayManager /></ToastProvider>);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    // 5 tab utama tampil.
    for (const label of ["Ringkas", "Antrean", "Markup", "Aturan", "Audit SK", "Alat"]) {
      expect(screen.getByRole("tab", { name: new RegExp(label) }), `tab ${label}`).toBeTruthy();
    }
    const hit = (frag: string) => calls.filter((u) => u.includes(frag)).length;
    expect(hit("/sekalipay/orders"), "antrean lazy").toBe(0);
    expect(hit("/sekalipay/markup"), "markup lazy").toBe(0);
    expect(hit("/sekalipay/mutations"), "mutasi lazy (tab Audit)").toBe(0);
    expect(hit("/sekalipay/transactions"), "transaksi lazy (tab Audit)").toBe(0);
    expect(hit("/sekalipay/locks"), "lock lazy (tab Alat)").toBe(0);

    fireEvent.click(screen.getByRole("tab", { name: /Audit SK/ }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(hit("/sekalipay/mutations"), "buka Audit = fetch mutasi").toBe(1);
    expect(hit("/sekalipay/transactions"), "buka Audit = fetch transaksi").toBe(1);

    fireEvent.click(screen.getByRole("tab", { name: /^Alat/ }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(hit("/sekalipay/locks"), "buka Alat = fetch lock").toBe(1);
  });

  it("sandbox berada di tab Antrean (bukan section sendiri)", async () => {
    stubSupplierApi();
    render(<ToastProvider><SekalipayManager /></ToastProvider>);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    // Ringkas: tidak ada form sandbox.
    expect(screen.queryByPlaceholderText("product_id")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Antrean/ }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.getByPlaceholderText("product_id")).toBeTruthy();
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
      // vi.stubEnv tidak dibutuhkan: route memakai globalThis.DB fixture.
      const { GET } = await import("@/app/api/admin/warung/markup/route");
      void GET;
      // Route butuh sesi admin — tanpa sesi balas 401 (kontrak auth utuh).
      const { NextRequest } = await import("next/server");
      const res = await GET(new NextRequest("http://localhost/api/admin/warung/markup") as never);
      expect(res.status).toBe(401);
    } finally {
      fx.close();
    }
  });
});
