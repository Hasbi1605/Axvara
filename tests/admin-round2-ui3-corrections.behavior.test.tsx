// @vitest-environment jsdom
//
// Regresi koreksi PM round 1 untuk area UI3 (hanya Games/TUNVN/Pedia/WR-SK):
// 1. Games: kontrol desktop muat (tanpa min-width yang memaksa scroll) dan
//    kartu mobile mempertahankan SEMUA kontrol (Grup + guard eligibility sama).
// 2. TUNVN: tabel desktop disembunyikan di bawah md, kartu mobile tetap ada, dan
//    fallback error yang tidak dikenal tetap manusiawi di kedua tampilan.
// 3. Pedia: identifier supplier hanya di detail terlipat + helper refill memuat ID.
// 4. WR/SK & Pedia: angka tidak menampilkan nilai menyesatkan saat memuat (D6).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { GamesManager } from "@/components/admin/GamesManager";
import { render as renderAdmin } from "./setup/admin-render";
import { ToastProvider } from "@/components/ui/Toast";
import { TunvnManager } from "@/components/admin/TunvnManager";
import { PediaManager } from "@/components/admin/PediaManager";
import { WarungRebahanManager } from "@/components/admin/WarungRebahanManager";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/admin"); });

const gameItem = (over: Record<string, unknown> = {}) => ({
  id: 1, buyer_sku_code: "sk:ml-86", product_name: "86 Diamond", game_brand: "Mobile Legends",
  product_type: "Umum", product_type_name: null, sk_variant_id: 101, sk_sku: "ML-86",
  sk_product_name: "Mobile Legends", game_slug: "mobile-legends", description: "✅ Proses cepat",
  supplier: "sekalipay", supplier_active: 1, stock: 10, min_order: 1, cost: 19500,
  reference_price: null, sell_price: 21100, seller_active: 1, backup_seller_active: 0,
  backup_sku_code: null, enabled: 0, display_group: null, display_order: null,
  synced_at: "2026-11-13 06:00:00", contract_supported: true,
  markup_source: "global", markup_percent: null, effective_markup_percent: 5, markup_fixed: 0,
  availability: { available: false, reason: "admin_disabled" }, sellable: false,
  margin: { cost: 19500, sell: 21100, floor: 20085, margin_rp: 1600, margin_pct: 8.2, source: "floor", competitive: null },
  effectiveGroup: "all", ...over,
});

function gamesFetch(items: Record<string, unknown>[]) {
  window.history.replaceState(null, "", "/admin?section=games&tab=variants");
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json({ items, total: items.length, brands: [], limit: 50, offset: 0, games: [], pricing: { markup_percent: 5, rounding: 100 },
      sync: { last_sync_at: "2026-11-13 06:00:00", counts: { total: items.length, enabled: 1, supplier_active: 1, seller_active: 1, with_reference: 0, contract_supported: 1, sellable: 0, supplier_off: items.filter(item => item.supplier_active === 0).length } } });
  }));
  return calls;
}

describe("Games: kontrol desktop muat & kartu mobile lengkap", () => {
  it("desktop table menjaga overflow di region sendiri dan label kategori utuh", async () => {
    gamesFetch([gameItem()]);
    renderAdmin(<ToastProvider><GamesManager /></ToastProvider>);
    const table = await screen.findByRole("table");
    // A4: kontrol lengkap boleh bergulir dalam region, bukan melebarkan halaman.
    expect(table.querySelectorAll("td").length).toBeGreaterThan(0);
    const mins = [...table.querySelectorAll("td, th")].map((cell) => cell.className.match(/min-w-\[(\d+)px\]/)?.[1]).filter(Boolean);
    expect(mins, `masih ada min-width px: ${mins.join(",")}`).toEqual([]);
    expect(within(table).getByRole("combobox", { name: "Kategori sk:ml-86" })).toBeTruthy();
    expect(within(table).getByRole("switch", { name: /Aktifkan sk:ml-86/ })).toBeTruthy();
    expect(within(table).getByRole("combobox", { name: "Kategori sk:ml-86" }).className).toContain("w-full");
    expect(screen.getByRole("region", { name: "Tabel varian game" }).className).toContain("overflow-x-auto");
  });

  it("kartu mobile mempertahankan select Kategori dan guard eligibility yang sama", async () => {
    const calls = gamesFetch([gameItem(), gameItem({ buyer_sku_code: "sk:ff-70", supplier_active: 0, enabled: 0 })]);
    renderAdmin(<ToastProvider><GamesManager /></ToastProvider>);
    const cards = await screen.findByLabelText("Kartu varian game");
    // Dua kartu + dua kontrol Kategori (satu per SKU) tetap tersedia di mobile.
    expect(within(cards).getAllByRole("combobox", { name: /Kategori sk:/ }).length).toBe(2);
    // SKU dengan supplier nonaktif: switch aktivasi harus disabled (guard sama
    // dengan desktop), sedangkan SKU yang sehat tetap bisa diaktifkan.
    const blocked = within(cards).getByRole("switch", { name: /Aktifkan sk:ff-70/ });
    expect((blocked as HTMLButtonElement).disabled).toBe(true);
    expect(within(cards).getByText(/Belum bisa diaktifkan: supplier nonaktif/)).toBeTruthy();
    expect((within(cards).getByRole("switch", { name: /Aktifkan sk:ml-86/ }) as HTMLButtonElement).disabled).toBe(false);
    // Kategori bisa diubah dari kontrol mobile → PATCH dengan display_group benar.
    fireEvent.change(within(cards).getByRole("combobox", { name: "Kategori sk:ml-86" }), { target: { value: "bestseller" } });
    await waitFor(() => expect(calls.some((call) => call.init?.method === "PATCH")).toBe(true));
    const patch = calls.find((call) => call.init?.method === "PATCH")!;
    expect(JSON.parse(String(patch.init!.body))).toEqual({ buyer_sku_code: "sk:ml-86", display_group: "bestseller" });
  });

  it("filter Bisa dijual + sort sellable tetap dikirim, Oura tidak dirender", async () => {
    const calls = gamesFetch([gameItem()]);
    renderAdmin(<ToastProvider><GamesManager /></ToastProvider>);
    await screen.findByRole("table");
    await waitFor(() => expect(calls[0].url).toContain("sort=sellable"));
    fireEvent.change(screen.getByLabelText("Filter bisa dijual"), { target: { value: "1" } });
    await waitFor(() => expect(calls.some((call) => call.url.includes("sellable=1"))).toBe(true));
    expect(screen.queryByText(/Oura/)).toBeNull();
  });
});

describe("TUNVN: breakpoint tabel vs kartu", () => {
  const link = { id: 502, order_code: "AXV-20261113-BBB2222", item_index: 0, kind: "buff", quantity: 1, cost_usdt: 0.62, status: "needs_admin", provider_order_group: null, provider_batch_id: "BATCH-4471", provider_order_code: null, last_error: "some_unknown_error_code", receipt_json: null, has_receipt: 0, can_retry: 1, purchase_disabled: 0, request_sent_at: "2026-11-13 07:10:00", completed_at: null };

  it("tabel desktop tersembunyi di bawah md dan kartu mobile hanya satu tampilan", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/tunvn/orders")) return Response.json({ ok: true, items: [link] });
      if (url.includes("/tunvn/balance")) return Response.json({ ok: true, configured: true, balance_usdt: 0.61, balance_vnd: 9800000 });
      if (url.includes("/tunvn/buff")) return Response.json({ ok: true, variants: [], probe: null, probe_error: null, muse_product: null });
      return Response.json({ ok: true, configured: true, items: [], counts: { total: 0, published: 0, requested: 0, in_stock: 0 }, last_sync_at: null });
    }));
    renderAdmin(<ToastProvider><TunvnManager /></ToastProvider>);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Antrean" }), { button: 0 });
    const table = await screen.findByRole("table");
    // Pembungkus tabel: hidden di mobile, block mulai md (sama seperti kartu md:hidden).
    const wrapper = table.parentElement!.parentElement!;
    expect(wrapper.className).toContain("hidden");
    expect(wrapper.className).toContain("md:block");
    const cards = screen.getByLabelText("Kartu pengiriman TUNVN");
    expect(cards.className).toContain("md:hidden");
    expect(cards.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    // Fallback error tak dikenal tetap manusiawi di kartu mobile.
    expect(within(cards).getByText("Perlu diperiksa")).toBeTruthy();
    expect(within(cards).queryByText("some_unknown_error_code")).toBeNull();
    // Guard aksi tetap: retry tersedia, receipt tidak.
    expect(within(cards).getByRole("button", { name: "Coba lagi" })).toBeTruthy();
    expect(within(cards).queryByRole("button", { name: "Lihat receipt" })).toBeNull();
    expect(within(cards).getByRole("button", { name: "Periksa status" })).toBeTruthy();
  });
});

describe("Pedia: identifier supplier hanya di detail, guard aksi utuh", () => {
  function pediaFetch(rows: Record<string, unknown>[]) {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("products")) return Response.json({ ok: true, products: [], tiers: [] });
      if (url.includes("services")) return Response.json({ ok: true, total: 0, rows: [], diff: {} });
      if (url.includes("overview")) return Response.json({ ok: true, providers: [] });
      if (url.includes("orders")) return Response.json({ ok: true, rows });
      return Response.json({ ok: true, settings: {}, balance_history: [] });
    }));
  }

  it("ID order supplier tersedia di detail, helper refill memuat ID, dan pesanan selesai tidak ikut", async () => {
    pediaFetch([
      { order_code: "AXP-REFILL1", status: "completed", followup_state: "open", refill_status: "manual_requested", supplier_order_id: "778123", refill_supplier_id: "9912", supplier_service_id: 6001, product_name: "Followers", quantity: 100, total: 5000, target_normalized: "@brand" },
      { order_code: "AXP-DONE2", status: "completed", supplier_order_id: "555000", product_name: "Views", quantity: 10, total: 1000 },
    ]);
    renderAdmin(<ToastProvider><PediaManager initialTab="orders" /></ToastProvider>);
    const card = await screen.findByRole("article", { name: "Pesanan AXP-REFILL1" });
    // Baris utama tetap bersih: ringkasan tidak memuat ID mentah.
    expect(within(card).getByText(/Layanan IndoSMM #6001 · sudah dibuat di supplier/)).toBeTruthy();
    const details = within(card).getByText("Detail pesanan").closest("details")!;
    expect(details.hasAttribute("open")).toBe(false);
    expect(within(details).getByText(/ID order supplier: 778123/)).toBeTruthy();
    expect(within(details).getByText(/ID refill 9912/)).toBeTruthy();
    // Helper aksi manual menyebut ID yang dibutuhkan untuk menghubungi CS.
    expect(within(card).getByText(/Order ID 778123/)).toBeTruthy();
    // Riwayat selesai tidak ikut tab tindakan.
    expect(screen.queryByRole("article", { name: "Pesanan AXP-DONE2" })).toBeNull();
    expect(card.textContent).not.toContain("555000");
  });
});

describe("D6: angka tidak menyesatkan saat memuat", () => {
  it("WR: kapasitas & sinkron terakhir berupa Skeleton selama loading, bukan ~0/Belum pernah", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      await gate;
      if (url.includes("/saldo")) return Response.json({ current: { balance: 512000, isLow: false, threshold: 250000 }, capacity: { estimatedOrders: 84, avgOrderCost: 6100 } });
      if (url.includes("/sync-log")) return Response.json({ logs: [], diff: { last_at: "2026-11-13 06:15:00", healthy: true } });
      return Response.json({ orders: [], total: 0, page: 1, per_page: 20 });
    }));
    renderAdmin(<ToastProvider><WarungRebahanManager /></ToastProvider>);
    await screen.findByRole("heading", { name: "Warung Rebahan" });
    expect(screen.queryByText(/~0 order/)).toBeNull();
    expect(screen.queryByText("Belum pernah")).toBeNull();
    expect(screen.getByText("Memuat kapasitas…")).toBeTruthy();
    // Muncul dua kali: hint StatCard + isi kartu detail sinkron.
    expect(screen.getAllByText("Memuat status sinkron…").length).toBeGreaterThan(0);
    await act(async () => { release!(); await gate; });
    await waitFor(() => expect(screen.getByText("~84 order")).toBeTruthy());
  });

  it("Pedia: label tindakan tidak menampilkan (0) selama memuat", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("orders")) { await gate; return Response.json({ ok: true, rows: [] }); }
      if (url.includes("products")) return Response.json({ ok: true, products: [], tiers: [] });
      if (url.includes("overview")) return Response.json({ ok: true, providers: [] });
      if (url.includes("services")) return Response.json({ ok: true, total: 0, rows: [], diff: {} });
      return Response.json({ ok: true, settings: {}, balance_history: [] });
    }));
    renderAdmin(<ToastProvider><PediaManager initialTab="orders" /></ToastProvider>);
    expect(await screen.findByText("Perlu tindakan · memuat…")).toBeTruthy();
    expect(screen.queryByText("Perlu tindakan (0)")).toBeNull();
    await act(async () => { release!(); await gate; });
    await waitFor(() => expect(screen.getByText("Perlu tindakan (0)")).toBeTruthy());
  });
});
