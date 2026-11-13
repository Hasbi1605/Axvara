// @vitest-environment jsdom
// Pedia status UI: buyer page lifecycle/counts/ETA/freshness, admin Orders rows
// and Market entry-point redirects. Fixture endpoints only; no production calls.
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render } from "./setup/admin-render";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ code: "AXP-20261102-2C24A247" }));
const redirect = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => route, useSearchParams: () => new URLSearchParams(window.location.search), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/" }));
vi.mock("@/components/pedia/status-view", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/pedia/status-view")>()), redirectBrowser: redirect }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
vi.mock("@/components/admin/OrderAccessAdmin", () => ({ OrderAccessAdmin: () => <div data-testid="market-access-widget">PIN admin</div> }));
vi.mock("@/components/storefront/WrCredentialsPanel", () => ({ WrCredentialsPanel: () => <div data-testid="wr-credentials" />, checkoutContactKey: () => "k" }));
vi.mock("@/components/storefront/DeviceOrders", () => ({ DeviceOrders: () => null }));
vi.mock("@/components/storefront/StoreWhatsAppLink", () => ({ StoreWhatsAppLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

import BuyerPage from "@/app/pedia/pesanan/[code]/page";
import MarketPesananPage from "@/app/(shop)/pesanan/[code]/page";
import LacakClient from "@/app/(shop)/lacak-pesanan/lacak-pesanan-client";
import { OrdersManager } from "@/components/admin/OrdersManager";

const CODE = "AXP-20261102-2C24A247";
const order = {
  code: CODE, order_kind: "pedia", product_name: "Followers Instagram", product_slug: "followers-instagram",
  service_name: "Indonesia Premium", tier_name: "Premium", tier_note: null, quantity: 100,
  target: "https://instagram.com/buyer", status: "in_progress", start_count: 8177, remains: 73, done: 27, percent: 27,
  eta_start: "0–1 jam", eta_finish: null, refill_days: 0, refill_eligible: false, paid_at: "2026-11-02 12:20:00", qris: null,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const stubOrder = (value: Record<string, unknown>) => { const fetcher = vi.fn(async (_url?: string) => json({ order: value })); vi.stubGlobal("fetch", fetcher); return fetcher; };

beforeEach(() => { route.code = CODE; redirect.mockReset(); toast.error.mockReset(); localStorage.clear(); sessionStorage.clear(); window.history.replaceState(null, "", "/"); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Pedia buyer status page", () => {
  it("shows the actual lifecycle and reported counts instead of a generic Lunas hero (fixture 8177/100/73 → 27)", async () => {
    stubOrder(order);
    render(<BuyerPage />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Pesanan Berjalan");
    expect(screen.queryByText(/Lunas — Terdeteksi Otomatis/)).toBeNull();
    expect(screen.queryByText(/Pembayaran Dikonfirmasi/)).toBeNull();
    const status = screen.getAllByRole("status").find((el) => el.textContent?.includes("Berjalan"))!;
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toMatch(/Lunas · .*2026.* WIB/);
  });

  it("renders start count, quantity, remains and done as separate known values with a real progress bar", async () => {
    stubOrder(order);
    render(<BuyerPage />);
    await screen.findByText("Pesanan Berjalan");
    const metrics = screen.getByLabelText("Jumlah pesanan");
    const read = (label: string) => within(metrics).getByText(label).nextElementSibling!.textContent;
    expect(read("Jumlah awal")).toBe("8.177");
    expect(read("Dipesan")).toBe("100");
    expect(read("Sisa")).toBe("73");
    expect(read("Masuk")).toBe("27");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("27");
    expect(screen.getByText("27 / 100 masuk")).toBeTruthy();
    expect(screen.getByText(/Followers Instagram · Indonesia Premium/)).toBeTruthy();
    expect(screen.queryByText(/× 1\b/)).toBeNull();
  });

  it("keeps unknown counts unknown: no zero bar, no 0 / 100, never completed 100%", async () => {
    stubOrder({ ...order, start_count: null, remains: null, done: null, percent: null });
    render(<BuyerPage />);
    await screen.findByText("Pesanan Berjalan");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("Jumlah masuk belum dikonfirmasi")).toBeTruthy();
    expect(screen.queryByText(/0 \/ 100/)).toBeNull();
    const metrics = screen.getByLabelText("Jumlah pesanan");
    expect(within(metrics).getByText("Jumlah awal").nextElementSibling!.textContent).toBe("Belum dilaporkan");
    expect(within(metrics).getByText("Sisa").nextElementSibling!.textContent).toBe("Belum dilaporkan");
    expect(within(metrics).getByText("Masuk").nextElementSibling!.textContent).toBe("Belum dilaporkan");
  });

  it("reports 100% only for a confirmed completed status", async () => {
    stubOrder({ ...order, status: "completed", remains: 0, done: 100, percent: 100 });
    render(<BuyerPage />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toContain("Pesanan Selesai");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByText("100 / 100 masuk")).toBeTruthy();
  });

  it.each([
    ["queued", "Pembayaran Diterima", "Pembayaran diterima"],
    ["submitted", "Pesanan Diproses", "Diproses"],
    ["partial", "Pesanan Selesai Sebagian", "Selesai sebagian"],
    ["canceled", "Pesanan Dibatalkan", null],
    ["needs_check", "Pesanan Sedang Dicek", "Sedang kami cek"],
  ])("status %s gets its own title and never the green Lunas pill", async (status, title, pill) => {
    stubOrder({ ...order, status, start_count: null, remains: null, done: null, percent: null, product_slug: "followers-instagram" });
    render(<BuyerPage />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(title);
    expect(screen.queryByText(/Lunas — Terdeteksi Otomatis/)).toBeNull();
    if (pill) expect(screen.getAllByRole("status").some((el) => el.textContent?.includes(pill))).toBe(true);
    else expect(screen.getByText("Dibatalkan", { selector: "span.rounded-full" })).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("keeps the secondary paid line when the service is canceled after payment, but never invents it for an unpaid buyer cancel", async () => {
    stubOrder({ ...order, status: "canceled", start_count: null, remains: null, done: null, percent: null, product_slug: "followers-instagram" });
    const paid = render(<BuyerPage />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Pesanan Dibatalkan");
    expect(screen.getByText(/Lunas · .*2026.* WIB/)).toBeTruthy();
    expect(screen.queryByText(/Lunas — Terdeteksi Otomatis/)).toBeNull();
    paid.unmount();
    stubOrder({ ...order, status: "expired", buyer_canceled: true, paid_at: null, done: null, percent: null, qris: null });
    render(<BuyerPage />);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Pesanan Dibatalkan");
    expect(screen.queryByText(/Lunas/)).toBeNull();
  });

  it("shows only honest ETA text: eta_finish, else eta_start before progress, else nothing (no avg_time/speed clock)", async () => {
    stubOrder({ ...order, status: "queued", done: null, percent: null, remains: null, start_count: null, eta_start: "0–1 jam", eta_finish: null, avg_time: "5 menit", speed_per_day: 9999 });
    const first = render(<BuyerPage />);
    expect(await screen.findByText(/Perkiraan mulai: 0–1 jam setelah pembayaran\. Estimasi layanan, bukan jaminan\./)).toBeTruthy();
    expect(screen.queryByText(/5 menit/)).toBeNull();
    first.unmount();
    stubOrder({ ...order, eta_start: "Mengikuti antrean layanan", eta_finish: "1–12 jam" });
    const second = render(<BuyerPage />);
    expect(await screen.findByText("Perkiraan selesai: 1–12 jam. Estimasi mengikuti antrean.")).toBeTruthy();
    second.unmount();
    stubOrder({ ...order, eta_start: "0–1 jam", eta_finish: null });
    render(<BuyerPage />);
    await screen.findByText("Pesanan Berjalan");
    expect(screen.queryByText(/Perkiraan/)).toBeNull();
  });

  it("never shows supplier identity, credentials or email-detail copy", async () => {
    stubOrder(order);
    const { container } = render(<BuyerPage />);
    await screen.findByText("Pesanan Berjalan");
    expect(container.textContent).not.toMatch(/IndoSMM|supplier|kredensial|PIN|garansi|detail akun|email.*detail/i);
  });

  it("polls awaiting 5s, running 10s and needs_check 30s; stops at terminal; pauses when hidden", async () => {
    vi.useFakeTimers();
    let hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    let current: Record<string, unknown> = { ...order, status: "needs_check" };
    const fetcher = vi.fn(async (_url?: string) => json({ order: current }));
    vi.stubGlobal("fetch", fetcher);
    render(<BuyerPage />);
    await act(async () => {});
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/otomatis tiap 30 detik/)).toBeTruthy();
    hidden = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    hidden = false; current = { ...order, status: "in_progress" };
    await act(async () => { fireEvent(document, new Event("visibilitychange")); });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/otomatis tiap 10 detik/)).toBeTruthy();
    current = { ...order, status: "completed", remains: 0, done: 100, percent: 100 };
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(screen.queryByText(/otomatis tiap/)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("shows last-checked time and keeps last confirmed data when a refresh fails", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (_url?: string) => json({ order }));
    vi.stubGlobal("fetch", fetcher);
    render(<BuyerPage />);
    await act(async () => {});
    expect(screen.getByText(/Diperbarui .* WIB · otomatis tiap 10 detik$/)).toBeTruthy();
    fetcher.mockRejectedValueOnce(new Error("Koneksi terputus"));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByText(/pembaruan terakhir gagal/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Koneksi terputus");
    expect(screen.getByText("27 / 100 masuk")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Pesanan Berjalan");
  });
});

const adminRow = (extra: Record<string, unknown>) => ({
  code: CODE, customer_name: "Ahmad Fauzi", customer_wa: "62812000", customer_email: "ahmad.fauzi@example.com",
  items: [{ name: "Followers Instagram", price: 1000, qty: 1, pedia: { quantity: 100 } }], subtotal: 1000, payment_amount: 1001,
  payment_method: "qris", status: "lunas", payment_status: "paid", sales_channel: "web", order_kind: "pedia",
  fulfillment_status: "manual_required", created_at: "2026-11-02 12:00:00", supplier_links: [],
  pedia: { status: "in_progress", quantity: 100, done: 27, percent: 27, target: "https://instagram.com/buyer", supplier: "indosmm", supplier_order_id: "22024298", last_error: null },
  ...extra,
});
const stubAdmin = (orders: Record<string, unknown>[]) => vi.stubGlobal("fetch", vi.fn(async () => json({ orders, pagination: { page: 1, pages: 1, total: orders.length }, stats: { total: orders.length, pending: 0, paid: orders.length, revenue: 1000 }, counts: { channels: { web: orders.length } }, methods: ["qris"] })));

describe("Admin OrdersManager Pedia rows", () => {
  it.each([
    { code: "AXV-20261113-CRYP0001", order_kind: "apps", payment_method: "nowpayments:usdtbsc" },
    { code: "AXV-20261113-GATE0001", order_kind: "apps", payment_method: "sekalipay_gateway:BCA" },
    { code: "AXG-20261113-GAME0001", order_kind: "games", payment_method: "qris" },
  ])("hides legacy manual actions in row/detail for $code", async (extra) => {
    stubAdmin([adminRow({ ...extra, status: "pending", payment_status: "unpaid", pedia: null })]);
    render(<OrdersManager />);
    const row = (await screen.findAllByText(extra.code))[0].closest("tr")!;
    for (const name of [/ACC pembayaran/, /Konfirmasi lunas/, /Tolak/, /Batalkan/]) expect(within(row).queryByRole("button", { name })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Detail" }));
    const dialog = await screen.findByRole("dialog", { name: "Detail pesanan" });
    for (const name of [/ACC pembayaran/, /Konfirmasi lunas/, /Tolak/, /Batalkan/, /Kirim ke pembeli/]) expect(within(dialog).queryByRole("button", { name })).toBeNull();
    if (extra.order_kind === "games") {
      expect(within(dialog).queryByTestId("market-access-widget")).toBeNull();
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith(`/api/admin/orders/${extra.code}`))).toBe(false);
    }
  });
  it("shows Pedia chip + actual lifecycle + purchased quantity, never handover for a Pedia order with a false manual_required flag", async () => {
    stubAdmin([adminRow({})]);
    render(<OrdersManager />);
    const row = (await screen.findAllByText(CODE))[0].closest("tr")!;
    expect(within(row).getByText("Pedia")).toBeTruthy();
    expect(within(row).getByTestId("pedia-status-chip").textContent).toBe("Berjalan");
    expect(within(row).queryByText("Perlu handover")).toBeNull();
    expect(within(row).queryByRole("button", { name: /Kirim ke pembeli/ })).toBeNull();
    expect(row.textContent).toContain("Followers Instagram · 100 · 27/100 masuk");
    expect(row.textContent).not.toContain("×1");
    expect(within(row).getByText("Ahmad Fauzi")).toBeTruthy();
  });

  it("derives a name from the email for legacy blank rows and keeps the unknown state for a missing item", async () => {
    stubAdmin([adminRow({ customer_name: "", pedia: null })]);
    render(<OrdersManager />);
    const row = (await screen.findAllByText(CODE))[0].closest("tr")!;
    expect(within(row).getByText("Ahmad Fauzi")).toBeTruthy();
    expect(within(row).getByTestId("pedia-status-chip").textContent).toBe("Status belum diketahui");
    expect(within(row).queryByText("Selesai")).toBeNull();
    expect(within(row).queryByRole("button", { name: /Kirim ke pembeli/ })).toBeNull();
  });

  it("falls back to quantity from the item snapshot and shows no lifecycle chip before payment", async () => {
    stubAdmin([adminRow({ status: "pending", payment_status: "unpaid", fulfillment_status: null, pedia: { status: "queued", quantity: null, done: null, target: null, supplier: null, supplier_order_id: null, last_error: null } })]);
    render(<OrdersManager />);
    const row = (await screen.findAllByText(CODE))[0].closest("tr")!;
    expect(within(row).queryByTestId("pedia-status-chip")).toBeNull();
    expect(row.textContent).toContain("Followers Instagram · 100");
  });

  it("links needs_check to Admin → Pedia → Pesanan without re-implementing actions; detail hides the Market PIN widget and handover", async () => {
    stubAdmin([adminRow({ pedia: { status: "needs_check", quantity: 100, done: null, target: "https://instagram.com/buyer", supplier: "indosmm", supplier_order_id: "1", last_error: "timeout" } })]);
    render(<OrdersManager />);
    const row = (await screen.findAllByText(CODE))[0].closest("tr")!;
    const link = within(row).getByRole("link", { name: "Tindak lanjut di Pedia" });
    expect(link.getAttribute("href")).toBe("/admin?section=pedia&tab=orders");
    fireEvent.click(within(row).getByRole("button", { name: "Detail" }));
    const dialog = await screen.findByRole("dialog", { name: "Detail pesanan" });
    expect(within(dialog).queryByTestId("market-access-widget")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Kirim ke pembeli/ })).toBeNull();
    expect(within(dialog).getByText(/Tujuan: https:\/\/instagram.com\/buyer/)).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Tindak lanjut di Pedia" })).toBeTruthy();
  });

  it("pending Pedia rows and details expose no Market ACC/Tolak/Konfirmasi/Batalkan actions (API rejects AXP)", async () => {
    stubAdmin([adminRow({ status: "pending", payment_status: "unpaid", fulfillment_status: null })]);
    render(<OrdersManager />);
    const row = (await screen.findAllByText(CODE))[0].closest("tr")!;
    for (const name of [/ACC pembayaran/, /Tolak/, /Konfirmasi lunas/, /Batalkan/]) expect(within(row).queryByRole("button", { name })).toBeNull();
    expect(within(row).getByText("Menunggu pembayaran QRIS")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Detail" }));
    const dialog = await screen.findByRole("dialog", { name: "Detail pesanan" });
    for (const name of [/Konfirmasi lunas/, /Batalkan pesanan/, /Tolak/]) expect(within(dialog).queryByRole("button", { name })).toBeNull();
    expect(within(dialog).getByText("Menunggu pembayaran QRIS")).toBeTruthy();
  });

  it("keeps the real Market pending actions: QRIS ACC/Tolak and manual Konfirmasi lunas/Batalkan, in row and detail", async () => {
    stubAdmin([
      adminRow({ code: "AXV-20261102-QRIS0001", order_kind: "apps", pedia: undefined, status: "pending", payment_status: "unpaid", fulfillment_status: null }),
      adminRow({ code: "AXV-20261102-MANU0001", order_kind: "apps", pedia: undefined, status: "pending", payment_status: "unpaid", fulfillment_status: null, payment_method: "seabank" }),
    ]);
    render(<OrdersManager />);
    const qrisRow = (await screen.findAllByText("AXV-20261102-QRIS0001"))[0].closest("tr")!;
    expect(within(qrisRow).getByRole("button", { name: /ACC pembayaran/ })).toBeTruthy();
    await userEvent.click(within(qrisRow).getByRole("button", { name: /Tindakan lain/ }));
    expect(screen.getByRole("menuitem", { name: "Batalkan pesanan" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    const manualRow = (await screen.findAllByText("AXV-20261102-MANU0001"))[0].closest("tr")!;
    expect(within(manualRow).getByRole("button", { name: /Konfirmasi lunas/ })).toBeTruthy();
    await userEvent.click(within(manualRow).getByRole("button", { name: /Tindakan lain/ }));
    expect(screen.getByRole("menuitem", { name: "Batalkan pesanan" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    fireEvent.click(within(manualRow).getByRole("button", { name: "Detail" }));
    const dialog = await screen.findByRole("dialog", { name: "Detail pesanan" });
    expect(within(dialog).getByRole("button", { name: /Konfirmasi lunas/ })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Batalkan pesanan/ })).toBeTruthy();
    expect(within(dialog).queryByText("Menunggu pembayaran QRIS")).toBeNull();
  });

  it("keeps Market rows unchanged: manual_required still shows Perlu handover + Kirim ke pembeli and the PIN widget", async () => {
    stubAdmin([adminRow({ code: "AXV-20261102-AAAA1111", order_kind: "apps", pedia: undefined, items: [{ name: "Netflix", price: 1000, qty: 2 }] })]);
    render(<OrdersManager />);
    const row = (await screen.findAllByText("AXV-20261102-AAAA1111"))[0].closest("tr")!;
    expect(within(row).getByText("Perlu handover")).toBeTruthy();
    expect(within(row).getByRole("button", { name: /Kirim ke pembeli/ })).toBeTruthy();
    expect(within(row).queryByText("Pedia")).toBeNull();
    expect(row.textContent).toContain("Netflix x2");
    fireEvent.click(within(row).getByRole("button", { name: "Detail" }));
    expect(await screen.findByTestId("market-access-widget")).toBeTruthy();
  });
});

describe("Market entry points for AXP codes", () => {
  it("/pesanan/AXP redirects to the Pedia host before any fetch and never renders the Market layout", async () => {
    route.code = CODE;
    const fetcher = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", fetcher);
    const { container } = render(<MarketPesananPage />);
    await waitFor(() => expect(redirect).toHaveBeenCalledWith(`https://pedia.axvara.tech/pesanan/${CODE}`));
    expect(fetcher).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/Garansi|Detail akun|Kredensial/i);
    expect(screen.queryByTestId("wr-credentials")).toBeNull();
  });

  it("lacak deep link ?code=AXP redirects contact-free", async () => {
    window.history.replaceState(null, "", `/lacak-pesanan?code=${CODE}&contact=buyer@example.com&wa=0812&email=x@y.z`);
    const fetcher = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", fetcher);
    render(<LacakClient />);
    await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));
    const url = String(redirect.mock.calls[0][0]);
    expect(url).toBe(`https://pedia.axvara.tech/lacak?code=${CODE}`);
    expect(url).not.toMatch(/contact|email|wa=|@|0812/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("lacak form recognizes AXP, hints, and routes to Pedia without running the Market lookup or carrying the contact", () => {
    const fetcher = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", fetcher);
    render(<LacakClient />);
    fireEvent.change(screen.getByLabelText(/Kode pesanan/), { target: { value: CODE.toLowerCase() } });
    fireEvent.change(screen.getByLabelText(/No. WA atau email checkout/), { target: { value: "buyer@example.com" } });
    expect(screen.getByText(/Kode AXP adalah pesanan Pedia/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Lacak di Pedia/ }).getAttribute("href")).toBe(`https://pedia.axvara.tech/lacak?code=${CODE}`);
    expect(screen.queryByText(/Format kode belum tepat/)).toBeNull();
    fireEvent.submit(screen.getByRole("form", { name: "Formulir lacak pesanan" }));
    expect(redirect).toHaveBeenCalledWith(`https://pedia.axvara.tech/lacak?code=${CODE}`, "assign");
    expect(String(redirect.mock.calls[0][0])).not.toContain("buyer");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("defensive: a lookup response of kind pedia renders one pointer card, no Market steps/warranty/credentials/qty line", async () => {
    window.history.replaceState(null, "", "/lacak-pesanan");
    const fetcher = vi.fn(async () => json({ order: { code: CODE, order_kind: "pedia", status: "lunas", pedia_status: "Berjalan", items: [{ name: "X", price: 1, qty: 1 }], credentials_ready: true } }));
    vi.stubGlobal("fetch", fetcher);
    const { container } = render(<LacakClient />);
    fireEvent.change(screen.getByLabelText(/Kode pesanan/), { target: { value: "AXV-20261102-FAKE0001" } });
    const contact = screen.getByLabelText(/No. WA atau email checkout/);
    fireEvent.change(contact, { target: { value: "buyer@example.com" } });
    await act(async () => { fireEvent.submit(contact.closest("form")!); });
    const card = await screen.findByLabelText("Pesanan Pedia");
    expect(within(card).getByRole("link", { name: "Buka status pesanan" }).getAttribute("href")).toBe(`https://pedia.axvara.tech/pesanan/${CODE}`);
    expect(container.textContent).not.toMatch(/Pesanan diproses|Detail pesanan|Garansi|garansi|× \d/);
    expect(screen.queryByTestId("wr-credentials")).toBeNull();
    expect(container.querySelector('[aria-label="Alur status pesanan"]')).toBeNull();
  });
});
