// @vitest-environment jsdom
// Admin detail pesanan Games: item dari games_order_items + "Cek ulang Sekalipay".
// Fixture endpoint saja; tanpa panggilan produksi.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render } from "./setup/admin-render";
import { afterEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({}), useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/" }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
vi.mock("@/components/admin/OrderAccessAdmin", () => ({ OrderAccessAdmin: () => null }));

import { OrdersManager } from "@/components/admin/OrdersManager";

const CODE = "AXG-20261116-4206447D";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const row = { code: CODE, customer_name: "Terry", customer_wa: "6283", customer_email: "t@example.com", items: [{ name: "Mobile Legends — Mobilelegend - 50 Diamond", price: 15600, qty: 1 }], subtotal: 15600, payment_amount: 15657, payment_method: "qris", status: "lunas", payment_status: "paid", sales_channel: "web", order_kind: "games", fulfillment_status: "not_required", created_at: "2026-11-16 13:16:31", supplier_links: [] };
const games = { order_code: CODE, game_name: "Mobile Legends", product_name: "Mobilelegend - 50 Diamond", customer_no: "161586434|5030", nickname: "VoidWalker", status: "needs_check", sn: null, supplier: "sekalipay", sk_invoice: "SPY1794835064NFVO", supplier_ref: "AXG202611164206447D", last_error: "mismatch: completed tanpa hasil H2H", cost: 14825, max_price: 15568 };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); toast.success.mockReset(); });

describe("Admin Games order detail", () => {
  it("shows the Games line and recovers a needs_check order via Sekalipay recheck", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/admin/games/orders/") && url.endsWith("/recheck")) { expect(init?.method).toBe("POST"); return json({ ok: true, outcome: "success", item_status: "success", sn: "MLBB1611263232621", message: "Transaksi Sukses" }); }
      if (url.startsWith("/api/admin/games/orders/")) return json({ ok: true, games });
      return json({ orders: [row], pagination: { page: 1, pages: 1, total: 1 }, stats: { total: 1, pending: 0, paid: 1, revenue: 15657 }, counts: { channels: { web: 1 } }, methods: ["qris"] });
    });
    vi.stubGlobal("fetch", fetcher);
    render(<OrdersManager />);
    const tr = (await screen.findAllByText(CODE))[0].closest("tr")!;
    expect(within(tr).getByText(/Mobile Legends — Mobilelegend - 50 Diamond x1/)).toBeTruthy();
    fireEvent.click(within(tr).getByRole("button", { name: "Detail" }));
    const dialog = await screen.findByRole("dialog", { name: "Detail pesanan" });
    expect(await within(dialog).findByText("Mobile Legends — Mobilelegend - 50 Diamond")).toBeTruthy();
    expect(within(dialog).getByText(/Perlu dicek admin/)).toBeTruthy();
    expect(within(dialog).getByText("Modal Sekalipay: Rp 14.825")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cek ulang Sekalipay" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(fetcher.mock.calls.some(([url]) => String(url) === `/api/admin/games/orders/${CODE}/recheck`)).toBe(true);
  });

  it("does not offer recheck for successful orders", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("/api/admin/games/orders/")
      ? json({ ok: true, games: { ...games, status: "success", sn: "SN1", last_error: null } })
      : json({ orders: [row], pagination: { page: 1, pages: 1, total: 1 }, stats: { total: 1, pending: 0, paid: 1, revenue: 1 }, counts: { channels: { web: 1 } }, methods: ["qris"] })));
    render(<OrdersManager />);
    const tr = (await screen.findAllByText(CODE))[0].closest("tr")!;
    fireEvent.click(within(tr).getByRole("button", { name: "Detail" }));
    const dialog = await screen.findByRole("dialog", { name: "Detail pesanan" });
    expect(await within(dialog).findByText("SN: SN1")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Cek ulang Sekalipay" })).toBeNull();
  });
});
