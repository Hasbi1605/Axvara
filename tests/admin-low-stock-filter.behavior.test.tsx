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

it("kartu Stok menipis membawa filternya ke daftar Produk, bukan sekadar pindah tab", async () => {
  stubAdminApi();
  render(<ToastProvider><AdminPage /></ToastProvider>);
  await act(async () => {});

  // Tanpa filter: kedua produk terlihat.
  fireEvent.click(screen.getAllByRole("button").find((node) => node.textContent?.trim() === "boxProduk" || /^(box)?Produk$/.test(node.textContent?.trim() ?? ""))!);
  await act(async () => {});
  expect(screen.getAllByText("Produk Aman").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Produk Tipis").length).toBeGreaterThan(0);

  // Kembali ke Ringkasan, lalu klik kartu "Stok menipis".
  fireEvent.click(screen.getAllByRole("button").find((node) => (node.textContent ?? "").includes("Ringkasan"))!);
  await act(async () => {});
  const card = screen.getAllByRole("button").find((node) => node.textContent?.includes("Stok menipis"));
  expect(card, "kartu Stok menipis harus ada di Ringkasan").toBeTruthy();
  fireEvent.click(card!);
  await act(async () => {});

  // Filter benar-benar diterapkan: hanya produk dengan varian tipis yang tersisa.
  expect(window.location.search).toContain("low_stock=1");
  expect(screen.queryByText("Produk Aman")).toBeNull();
  expect(screen.getAllByText("Produk Tipis").length).toBeGreaterThan(0);

  // Chip filter terlihat dan bisa dilepas — tanpa ini penyaringan tidak kasat mata.
  const chip = screen.getByRole("button", { name: /Stok menipis · varian ≤ 5/ });
  fireEvent.click(chip);
  await act(async () => {});
  expect(screen.getAllByText("Produk Aman").length).toBeGreaterThan(0);
});

it("metrik Stok menipis di Produk memakai satuan varian, sama dengan Ringkasan", async () => {
  stubAdminApi();
  render(<ToastProvider><AdminPage /></ToastProvider>);
  await act(async () => {});
  fireEvent.click(screen.getAllByRole("button").find((node) => node.textContent?.trim() === "boxProduk" || /^(box)?Produk$/.test(node.textContent?.trim() ?? ""))!);
  await act(async () => {});

  // 0 + 3 varian tipis = 3, bukan 1 produk. Dulu layar ini menghitung produk
  // sementara Ringkasan menghitung varian, sehingga satu label = dua angka.
  const label = screen.getByText("Stok menipis");
  expect(label.parentElement?.textContent).toContain("3");
});
