// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "./setup/admin-render";
import { OrdersManager } from "@/components/admin/OrdersManager";

vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/admin/OrderAccessAdmin", () => ({ OrderAccessAdmin: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/admin"); });
const row = (i: number) => ({ code: `AXV-${i}`, customer_name: `Pembeli ${i}`, payment_method: "qris", order_kind: "apps", items: [{ name: "Aplikasi", qty: 1, price: 1000 }], payment_amount: 1000, status: "pending", created_at: "2026-11-13T00:00:00Z" });
function stub() {
  const fetcher = vi.fn(async (input: string) => {
    const params = new URL(input, "http://localhost").searchParams;
    const page = Number(params.get("page"));
    return Response.json({ orders: Array.from({ length: page === 1 ? 25 : 5 }, (_, i) => row((page - 1) * 25 + i)), pagination: { page, pages: 2, total: 30 }, stats: { total: 30, pending: 30, paid: 0, revenue: 0 }, counts: { channels: { web: 20, telegram: 10 } }, methods: ["nowpayments:usdtbsc", "sekalipay_gateway:BCA"] });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

it("appends only the next 25-page request, retains rows, and resets on a faceted filter", async () => {
  const fetcher = stub(); render(<OrdersManager />);
  await screen.findByText("Menampilkan 25 dari 30");
  expect(new URL(fetcher.mock.calls[0][0], "http://localhost").searchParams.get("limit")).toBe("25");
  fireEvent.click(screen.getByRole("button", { name: "Muat 25 lagi" }));
  await screen.findByText("Menampilkan 30 dari 30");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByText("AXV-0")).toBeTruthy(); expect(screen.getByText("AXV-29")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Muat 25 lagi" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Status" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: "Lunas" }));
  await screen.findByText("Menampilkan 25 dari 30");
  expect(screen.queryByText("AXV-29")).toBeNull();
  expect(fetcher.mock.calls[2][0]).toContain("status=lunas");
  expect(fetcher.mock.calls[2][0]).toContain("page=1");
  expect(screen.getByRole("button", { name: "Hapus filter Status: Lunas" })).toBeTruthy();
});

it("debounces live search and exports the exact filters including the proof deep link", async () => {
  window.history.replaceState(null, "", "/admin?section=orders&proof=submitted&kind=games&method=sekalipay_gateway%3ABCA");
  const fetcher = stub(); render(<OrdersManager />); await screen.findByText("Menampilkan 25 dari 30");
  fireEvent.change(screen.getByLabelText("Pencarian"), { target: { value: "AXG-123" } });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  const href = screen.getByRole("link", { name: "Ekspor CSV" }).getAttribute("href")!;
  const params = new URL(href, "http://localhost").searchParams;
  expect(Object.fromEntries(params)).toEqual({ kind: "games", method: "sekalipay_gateway:BCA", proof: "submitted", q: "AXG-123", export: "csv" });
  fireEvent.click(screen.getByRole("button", { name: "Hapus filter Bukti manual menunggu" }));
  await waitFor(() => expect(window.location.search).not.toContain("proof="));
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  await waitFor(() => expect(new URLSearchParams(window.location.search).get("kind")).toBeNull());
});

it("restores URL filters and appended rows on browser navigation", async () => {
  const fetcher = stub(); render(<OrdersManager />); await screen.findByText("Menampilkan 25 dari 30");
  act(() => { window.history.pushState(null, "", "/admin?section=orders&channel=telegram&page=2&q=restored"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await screen.findByText("Menampilkan 30 dari 30");
  expect((screen.getByLabelText("Pencarian") as HTMLInputElement).value).toBe("restored");
  expect(fetcher.mock.calls.slice(1).every(([url]) => url.includes("channel=telegram") && url.includes("q=restored"))).toBe(true);
});

it("keeps the list after a failed append, retries the same page and guards QRIS confirmation", async () => {
  const fetcher = stub(); render(<OrdersManager />); await screen.findByText("Menampilkan 25 dari 30");
  fetcher.mockResolvedValueOnce(Response.json({ error: "internal_error" }, { status: 500 }));
  fireEvent.click(screen.getByRole("button", { name: "Muat 25 lagi" }));
  await screen.findByRole("alert"); expect(screen.getByText("AXV-0")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
  await screen.findByText("Menampilkan 30 dari 30");
  expect(fetcher.mock.calls[2][0]).toContain("page=2");
  await userEvent.click(screen.getByRole("button", { name: "Tindakan lain AXV-0" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "ACC pembayaran" }));
  const dialog = await screen.findByRole("dialog", { name: "ACC pembayaran QRIS?" });
  expect(within(dialog).getByText(/nominal persis/)).toBeTruthy();
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "pendek" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "ACC & lunaskan" }));
  expect(fetcher).toHaveBeenCalledTimes(3);
});
