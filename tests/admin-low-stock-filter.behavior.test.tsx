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

const product = (id: string, name: string, lowStockVariants: number) => ({
  id, name, slug: name.toLowerCase().replace(/\s+/g, "-"), description: "", price: 1000,
  categorySlug: "tools-pro", image: "", images: [], soldCount: 0, stock: 10,
  isActive: true, lowStockVariants,
});

function stubAdminApi() {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    const body = url === "/api/auth/me" ? { authed: true, email: "fixture@example.test" }
      : url === "/api/products" ? { products: [product("1", "Produk Aman", 0), product("2", "Produk Tipis", 3)] }
        : url.startsWith("/api/categories") ? { categories: [] }
          : url === "/api/admin/overview" ? { low_stock: 3 } : {};
    return { ok: true, status: 200, json: async () => body };
  }));
}

it("legacy low-stock links still apply a visible removable filter after the summary pill is removed", async () => {
  stubAdminApi();
  render(<ToastProvider><AdminPage /></ToastProvider>);
  await act(async () => {});
  expect(screen.queryByRole("button", { name: /Stok menipis/ })).toBeNull();

  window.history.pushState(null, "", "/admin?section=products&low_stock=1");
  fireEvent.popState(window);
  await act(async () => {});
  expect(screen.queryByText("Produk Aman")).toBeNull();
  expect(screen.getAllByText("Produk Tipis").length).toBeGreaterThan(0);
  const chip = screen.getByRole("button", { name: /Stok menipis · varian ≤ 5/ });
  fireEvent.click(chip);
  await act(async () => {});
  expect(screen.getAllByText("Produk Aman").length).toBeGreaterThan(0);
});

it("metrik Hidden otomatis di Produk jujur: pecundang + habis yang tak tampil (2026-10-01)", async () => {
  stubAdminApi();
  render(<ToastProvider><AdminPage /></ToastProvider>);
  await act(async () => {});
  fireEvent.click(screen.getAllByRole("button").find((node) => node.textContent?.trim() === "boxProduk" || /^(box)?Produk$/.test(node.textContent?.trim() ?? ""))!);
  await act(async () => {});

  // Kartu "Produk aktif" lama menipu (termasuk yang hidden). Kini kartu
  // "Hidden otomatis" = yang toggle ON tapi tidak tampil di toko.
  // Fixture: 2 produk live → Hidden otomatis = 0.
  const label = screen.getByText("Hidden otomatis");
  expect(label.parentElement?.textContent).toContain("0");
});
