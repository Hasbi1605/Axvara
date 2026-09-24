// @vitest-environment jsdom
// F-H2 diuji sebagai PERILAKU, bukan sekadar isi berkas: order lunas dengan
// `fulfillment_status='failed'` harus benar-benar merender badge status DAN
// tombol "Serahkan manual" di panel admin yang dirender sungguhan.
//
// Sebelum perbaikan, order seperti ini adalah jalan buntu total: pembeli sudah
// bayar, pengiriman gagal permanen, dan admin tidak punya satu pun tombol.
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

const failedOrder = {
  code: "AXV-20260922-FAILED01",
  customer_name: "Pembeli Gagal Kirim",
  customer_wa: "628111222333",
  customer_email: "",
  payment_method: "qris",
  items: [{ product_id: 1, variant_id: 1, name: "CapCut Pro", price: 7500, qty: 1 }],
  subtotal: 7500,
  payment_amount: 7500,
  status: "lunas",
  payment_status: "paid",
  // Status yang dulu tidak punya aksi apa pun di UI.
  fulfillment_status: "failed",
  sales_channel: "web",
  created_at: "2026-09-22 10:00:00",
};

function stubAdminApi() {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    const body = url === "/api/auth/me" ? { authed: true, email: "fixture@example.test" }
      : url.startsWith("/api/admin/orders") ? { orders: [failedOrder], total: 1 }
        : url === "/api/products" ? { products: [] }
          : url.startsWith("/api/categories") ? { categories: [] }
            : url === "/api/admin/overview" ? {} : {};
    return { ok: true, status: 200, json: async () => body };
  }));
}

async function openOrdersTab() {
  stubAdminApi();
  render(<ToastProvider><AdminPage /></ToastProvider>);
  await act(async () => {});
  const tab = screen.getAllByRole("button").find((node) => (node.textContent ?? "").includes("Pesanan"));
  fireEvent.click(tab!);
  await act(async () => {});
}

it("order lunas yang gagal kirim tetap bisa diserahkan manual dari daftar", async () => {
  await openOrdersTab();
  // Badge status pengiriman terlihat (dulu fulfillment_status di-parse lalu dibuang).
  expect(screen.getAllByText("Kirim GAGAL").length).toBeGreaterThan(0);
  // Aksi pemulihan tersedia — inilah jalan keluar yang dulu hilang.
  // Tombolnya bernama "Kirim ke pembeli" sejak 2026-09-25 (isi ikut terkirim).
  expect(screen.getAllByText(/Kirim ke pembeli/).length).toBeGreaterThan(0);
});

it("modal Detail juga menyediakan serah terima manual, bukan hanya baris daftar", async () => {
  await openOrdersTab();
  const detail = screen.getAllByRole("button").find((node) => (node.textContent ?? "").trim() === "Detail");
  fireEvent.click(detail!);
  await act(async () => {});
  // Alur wajar admin: buka Detail untuk memeriksa dulu, lalu bertindak.
  expect(screen.getAllByText(/Kirim ke pembeli/).length).toBeGreaterThan(0);
});
