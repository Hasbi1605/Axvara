// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import AdminPage from "@/app/(shop)/admin/page";
import { ToastProvider } from "@/components/ui/Toast";
import { EMPTY_ADMIN_OVERVIEW } from "@/components/admin/AdminOverview";
import { emptySelectedReport } from "@/lib/dashboard-report";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/admin"); });

it("rapid filters cannot overwrite newer data, and loading/errors never relabel stale finance", async () => {
  const pending: { url: string; resolve: (response: unknown) => void }[] = [];
  const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });
  vi.stubGlobal("fetch", vi.fn((input: unknown) => {
    const url = String(input);
    if (url.startsWith("/api/admin/overview")) return new Promise(resolve => pending.push({ url, resolve }));
    return Promise.resolve(response(url === "/api/auth/me" ? { authed: true, email: "fixture@example.test" } : url.startsWith("/api/products") ? { products: [] } : { categories: [] }));
  }));
  const report = (name: string) => {
    const selected = emptySelectedReport("week");
    selected.orders = 1; selected.revenue = 15000; selected.cost = 10000; selected.profit = 5000;
    selected.top_products = [{ name, qty: 1, revenue: 15000, cost: 10000, profit: 5000 }];
    return { ...EMPTY_ADMIN_OVERVIEW, selected_report: selected };
  };
  render(<ToastProvider><AdminPage /></ToastProvider>);
  await act(async () => {});
  expect(pending).toHaveLength(1);
  await act(async () => { pending[0].resolve(response(report("Original week"))); });
  expect(screen.getByText("Original week")).toBeTruthy();
  const header = screen.getByTestId("admin-session-header");
  expect(within(header).getByText("fixture@example.test")).toBeTruthy();
  expect(within(header).getByText(/Asia\/Jakarta · Dibuat/)).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Minggu ini" }));
  await act(async () => {});
  expect(pending).toHaveLength(1);
  expect(screen.getByText("Original week")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Hari ini" }));
  await act(async () => {});
  expect(screen.queryByText("Original week")).toBeNull();
  expect(within(header).queryByText(/Dibuat/)).toBeNull();
  expect(pending[1].url).toContain("period=today");
  fireEvent.click(screen.getByRole("tab", { name: "Bulan ini" }));
  await act(async () => {});
  expect(pending[2].url).toContain("period=month");
  await act(async () => { pending[2].resolve(response(report("Newest month"))); });
  expect(screen.getByText("Newest month")).toBeTruthy();
  await act(async () => { pending[1].resolve(response(report("Late today"))); });
  expect(screen.getByText("Newest month")).toBeTruthy();
  expect(screen.queryByText("Late today")).toBeNull();
  fireEvent.change(screen.getByLabelText("Bulan historis"), { target: { value: "2024-02" } });
  await act(async () => {});
  expect(pending[3].url).toContain("date_from=2024-02-01&date_to=2024-02-29");
  await act(async () => { pending[3].resolve(response({ error: "database unavailable" }, false)); });
  expect(screen.getByRole("alert").textContent).toContain("belum berhasil dimuat");
  expect(screen.queryByText("Newest month")).toBeNull();
  expect(within(header).queryByText(/Dibuat/)).toBeNull();
  expect(screen.queryByText("Untung Produk")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Muat ulang ringkasan" }));
  await act(async () => {});
  expect(pending[4].url).toBe(pending[3].url);
  await act(async () => { pending[4].resolve(response(report("Historical recovered"))); });
  expect(screen.getByText("Historical recovered")).toBeTruthy();
});
