// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import AdminPage from "@/app/admin/page";
import { ToastProvider } from "@/components/ui/Toast";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("loads authenticated admin data once and does not refetch on ordinary renders", async () => {
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
  for (const url of dataUrls) expect(counts[url], url).toBe(1);
  // Switching sections changes page state but is not a request to reload data.
  fireEvent.click(screen.getByRole("button", { name: /Produk$/ }));
  await act(async () => {});
  view.rerender(<ToastProvider><AdminPage /></ToastProvider>);
  await act(async () => {});
  for (const url of dataUrls) expect(counts[url], url).toBe(1);
});
