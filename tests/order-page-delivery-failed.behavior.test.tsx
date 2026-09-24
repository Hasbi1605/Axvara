// @vitest-environment jsdom
// Audit ronde 4 (W-H1): /pesanan/[code] — halaman yang paling sering dibuka
// setelah bayar (redirect checkout) — dulu tetap merayakan "Pembayaran
// Dikonfirmasi 🎉 … estimasi 5–15 menit" untuk order yang gagal dikirim.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const CODE = "AXV-20260924-FAILPAGE";
vi.mock("next/navigation", () => ({
  useParams: () => ({ code: CODE }),
  usePathname: () => `/pesanan/${CODE}`,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import OrderSuccessPage from "@/app/pesanan/[code]/page";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

function stubPaidOrder(fulfillmentStatus: string) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      order: {
        code: CODE, customer_name: "Budi", customer_wa: "62812****7890", customer_email: "b***@example.test",
        items: [{ name: "CapCut Pro — 7 Hari", price: 7500, qty: 1 }], subtotal: 7500, payment_method: "qris",
        status: "lunas", credentials_ready: false, queued_delivery: false, qris: null,
        fulfillment_status: fulfillmentStatus,
      },
    }),
  })));
}

it("lunas tapi gagal kirim: tidak merayakan dan tidak menjanjikan 5–15 menit", async () => {
  stubPaidOrder("failed");
  render(<OrderSuccessPage />);
  expect(await screen.findByText("Pengiriman Produk Bermasalah")).toBeTruthy();
  expect(screen.getByText("Lunas — Perlu Bantuan")).toBeTruthy();
  // Panel merah berisi langkah lanjut menggantikan panel "Pengiriman Produk".
  expect(screen.getByRole("region", { name: "Pengiriman bermasalah" }).textContent).toContain("hubungi admin");
  expect(screen.queryByRole("region", { name: "Pengiriman produk" })).toBeNull();
  expect(screen.queryByText(/Pembayaran Dikonfirmasi/)).toBeNull();
  expect(screen.queryByText(/Estimasi 5–15 menit/)).toBeNull();
});

it("lunas dan pengiriman berjalan: tampilan lama tidak berubah", async () => {
  stubPaidOrder("queued");
  render(<OrderSuccessPage />);
  expect(await screen.findByText(/Pembayaran Dikonfirmasi/)).toBeTruthy();
  expect(screen.getByText(/Estimasi 5–15 menit/)).toBeTruthy();
  expect(screen.queryByText("Pengiriman Produk Bermasalah")).toBeNull();
});
