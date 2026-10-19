// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import AdminPage from "@/app/(shop)/admin/page";
import { ToastProvider } from "@/components/ui/Toast";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/admin"); });

it("loads products only on section entry, refreshes on return and ignores ordinary renders", async () => {
  const counts: Record<string, number> = {};
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    counts[url] = (counts[url] ?? 0) + 1;
    // Bound a regression: the old dependency loop must fail the assertion,
    // rather than exhaust memory while continuously resolving responses.
    if (counts[url] > 5) return new Promise(() => {});
    const body = url === "/api/auth/me" ? { authed: true, email: "fixture@example.test" }
      : url === "/api/products" ? { products: [] }
        : url.startsWith("/api/categories") ? { categories: [] } : {};
    return { ok: true, status: 200, json: async () => body };
  }));
  const view = render(<ToastProvider><AdminPage /></ToastProvider>);
  await act(async () => {});
  const dataUrls = ["/api/products", "/api/categories?all=1", "/api/admin/overview"];
  expect(counts["/api/admin/overview"]).toBe(1);
  for (const url of dataUrls.slice(0, 2)) expect(counts[url] ?? 0, url).toBe(0);
  // The first visit loads the editor/catalog data exactly once.
  fireEvent.click(screen.getByRole("button", { name: /Produk$/ }));
  await act(async () => {});
  view.rerender(<ToastProvider><AdminPage /></ToastProvider>);
  await act(async () => {});
  for (const url of dataUrls) expect(counts[url], url).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: /Ringkasan/ }));
  await act(async () => {});
  expect(counts["/api/products"]).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: /Produk$/ }));
  await act(async () => {});
  expect(counts["/api/products"]).toBe(2);
  expect(counts["/api/categories?all=1"]).toBe(2);
});

it("opens a direct products section without loading financial reports, then loads them on entering summary", async () => {
  window.history.replaceState(null, "", "/admin?section=products");
  const counts: Record<string, number> = {};
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input); counts[url] = (counts[url] ?? 0) + 1;
    const body = url === "/api/auth/me" ? { authed: true, email: "fixture@example.test" }
      : url === "/api/products" ? { products: [] } : { categories: [] };
    return { ok: true, status: 200, json: async () => body };
  }));
  render(<ToastProvider><AdminPage /></ToastProvider>);
  await act(async () => {});
  expect(counts["/api/admin/overview"] ?? 0).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: /Ringkasan/ }));
  await act(async () => {});
  expect(counts["/api/admin/overview"]).toBe(1);
});


it.each(["orders", "links", "settings"])("direct %s entry does not fetch the product catalog", async section => {
  window.history.replaceState(null, "", `/admin?section=${section}`);
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input); urls.push(url);
    return { ok: true, status: 200, json: async () => url === "/api/auth/me"
      ? { authed: true, email: "fixture@example.test" } : { orders: [], links: [], settings: {} } };
  }));
  render(<ToastProvider><AdminPage /></ToastProvider>);
  await act(async () => {});
  expect(urls).not.toContain("/api/products");
  expect(urls).not.toContain("/api/categories?all=1");
  expect(urls).not.toContain("/api/admin/overview");
});
