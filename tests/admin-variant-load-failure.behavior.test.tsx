// @vitest-environment jsdom
//
// Membuka produk saat sumber varian GAGAL dulu menghasilkan form kosong tanpa
// satu pun pesan (openEdit menelan error lalu setFormVariants([])). Admin bisa
// mengira variannya terhapus — dan menyimpan dari keadaan itu mengirim
// `variants: []` yang membuat server menonaktifkan seluruh varian produk.
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

it("gagal memuat varian memberi peringatan, bukan form kosong yang diam", async () => {
  const produk = {
    id: "7", name: "Produk Multi Varian", slug: "produk-multi", description: "",
    price: 5000, categorySlug: "tools-pro", image: "", images: [],
    soldCount: 0, stock: 10, isActive: true, variantCount: 3,
  };
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url === "/api/auth/me") return { ok: true, status: 200, json: async () => ({ authed: true, email: "fixture@example.test" }) };
    if (url === "/api/products") return { ok: true, status: 200, json: async () => ({ products: [produk] }) };
    if (url.startsWith("/api/categories")) return { ok: true, status: 200, json: async () => ({ categories: [] }) };
    if (url === "/api/admin/overview") return { ok: true, status: 200, json: async () => ({}) };
    // Kedua sumber varian tumbang (mis. D1 hiccup).
    if (url === "/api/products/7") return { ok: false, status: 500, json: async () => ({ error: "boom" }) };
    if (url.startsWith("/api/admin/variants")) return { ok: false, status: 500, json: async () => ({ error: "Varian gagal dimuat" }) };
    return { ok: true, status: 200, json: async () => ({}) };
  }));

  render(<ToastProvider><AdminPage /></ToastProvider>);
  await act(async () => {});
  fireEvent.click(screen.getAllByRole("button").find((n) => /^(box)?Produk$/.test(n.textContent?.trim() ?? ""))!);
  await act(async () => {});

  fireEvent.click(screen.getAllByRole("button").find((n) => (n.textContent ?? "").includes("Edit Produk & Varian"))!);
  await act(async () => {});

  // Editor terbuka, tetapi admin DIBERI TAHU bahwa varian belum termuat.
  expect(document.getElementById("product-editor-title")?.textContent).toMatch(/Edit Produk/);
  const warning = screen.getByText(/jangan simpan sebelum varian tampil/i);
  expect(warning).toBeTruthy();
  expect(warning.textContent).toMatch(/Varian gagal dimuat/i);
});

it("varian nonaktif ikut termuat di editor sehingga bisa diaktifkan ulang", async () => {
  // Temuan review: GET /api/products/:id filter is_active=1 — varian nonaktif
  // tak terlihat, tak bisa diaktifkan ulang, dan menyimpan dari daftar parsial
  // menonaktifkan permanen yang tak terlihat via `id NOT IN (...)`.
  const produk = {
    id: "9", name: "Produk Campuran", slug: "produk-campuran", description: "",
    price: 5000, categorySlug: "tools-pro", image: "", images: [],
    soldCount: 0, stock: 10, isActive: true, variantCount: 2,
  };
  const variants = [
    { id: 91, sku: "CAMP-1", label: "Aktif", price: 5000, stock: 10, is_active: 1 },
    { id: 92, sku: "CAMP-2", label: "Mati", price: 6000, stock: 5, is_active: 0 },
  ];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url === "/api/auth/me") return { ok: true, status: 200, json: async () => ({ authed: true, email: "fixture@example.test" }) };
    if (url === "/api/products") return { ok: true, status: 200, json: async () => ({ products: [produk] }) };
    if (url.startsWith("/api/categories")) return { ok: true, status: 200, json: async () => ({ categories: [] }) };
    if (url === "/api/admin/overview") return { ok: true, status: 200, json: async () => ({}) };
    if (url === "/api/products/9") return { ok: true, status: 200, json: async () => ({ product: { variants } }) };
    return { ok: true, status: 200, json: async () => ({}) };
  }));

  render(<ToastProvider><AdminPage /></ToastProvider>);
  await act(async () => {});
  fireEvent.click(screen.getAllByRole("button").find((n) => /^(box)?Produk$/.test(n.textContent?.trim() ?? ""))!);
  await act(async () => {});

  fireEvent.click(screen.getAllByRole("button").find((n) => (n.textContent ?? "").includes("Edit Produk & Varian"))!);
  await act(async () => {});

  // Kedua varian tampil di editor — termasuk yang nonaktif (toggle "Mati").
  expect(document.getElementById("product-editor-title")?.textContent).toMatch(/Edit Produk/);
  expect(screen.queryByText(/jangan simpan sebelum varian tampil/i)).toBeNull();
  expect(screen.getByDisplayValue("Mati")).toBeTruthy();
});
