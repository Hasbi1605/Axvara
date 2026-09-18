// @vitest-environment jsdom
//
// tests/order-status-delivery.behavior.test.tsx — Halaman /pesanan/[code]
// pernah menampilkan panel "Detail Akun Digital" untuk SETIAP order lunas,
// termasuk produk fulfillment manual yang tidak pernah punya kredensial WR.
// Akibatnya pembeli baru bayar langsung disuguhi form verifikasi WA yang pasti
// berakhir "Detail akun belum tersedia". Test ini merender halaman sungguhan
// untuk kedua cabang: siap → form retrieval, belum siap → info pengiriman.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import OrderStatusPage from "@/app/pesanan/[code]/page";

const CODE = "AXV-20260918-AB12CD34";

vi.mock("next/navigation", () => ({
  useParams: () => ({ code: CODE }),
}));

function orderPayload(overrides: Record<string, unknown> = {}) {
  return {
    order: {
      code: CODE,
      customer_name: "Hasbi",
      customer_wa: "08213****7434",
      customer_email: null,
      items: [{ name: "Apple Music — Premium", price: 5500, qty: 1 }],
      subtotal: 5500,
      payment_method: "qris",
      payment_account: "DANA Business",
      status: "lunas",
      created_at: "2026-09-18T04:00:00.000Z",
      expires_at: null,
      credentials_ready: false,
      qris_reissue_allowed: false,
      qris: null,
      ...overrides,
    },
  };
}

function mockFetch(payload: Record<string, unknown>) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/pesanan/[code] — blok pasca-pembayaran", () => {
  it("credentials_ready=false → info pengiriman ke kontak checkout, TANPA form verifikasi WA", async () => {
    mockFetch(orderPayload());
    render(<OrderStatusPage />);
    await waitFor(() => expect(screen.getByText("Pengiriman Produk")).toBeTruthy());
    // Nomor WA tersamar dari server ikut ditampilkan supaya pembeli tahu tujuan.
    expect(screen.getByText(/Detail akun dikirim ke WhatsApp/)).toBeTruthy();
    expect(screen.getByText("08213****7434")).toBeTruthy();
    // Form mati tidak boleh ada lagi.
    expect(screen.queryByText("Detail Akun Digital")).toBeNull();
    expect(screen.queryByRole("button", { name: "Tampilkan" })).toBeNull();
    expect(screen.queryByLabelText("Nomor WhatsApp checkout")).toBeNull();
  });

  it("credentials_ready=true → panel retrieval kredensial tampil", async () => {
    mockFetch(orderPayload({ credentials_ready: true }));
    render(<OrderStatusPage />);
    await waitFor(() => expect(screen.getByText("Detail Akun Digital")).toBeTruthy());
    expect(screen.getByLabelText("Nomor WhatsApp checkout")).toBeTruthy();
    expect(screen.queryByText("Pengiriman Produk")).toBeNull();
  });

  it("order pending tidak menampilkan blok pasca-pembayaran apa pun", async () => {
    mockFetch(
      orderPayload({
        status: "pending",
        expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      }),
    );
    render(<OrderStatusPage />);
    await waitFor(() => expect(screen.getByText("Ringkasan")).toBeTruthy());
    expect(screen.queryByText("Pengiriman Produk")).toBeNull();
    expect(screen.queryByText("Detail Akun Digital")).toBeNull();
  });

  it("credentials_ready=false + queued → teks antrean dengan plafon 12 jam, TANPA janji 5–15 menit", async () => {
    mockFetch(orderPayload({ queued_delivery: true }));
    render(<OrderStatusPage />);
    await waitFor(() => expect(screen.getByText("Pengiriman Produk")).toBeTruthy());
    expect(screen.getByText(/dikerjakan sesuai antrean/)).toBeTruthy();
    expect(screen.getByText(/maksimal 12 jam pada jam layanan/)).toBeTruthy();
    expect(screen.queryByText(/5–15 menit/)).toBeNull();
  });

  it("credentials_ready=false + instan → tetap 5–15 menit", async () => {
    mockFetch(orderPayload({ queued_delivery: false }));
    render(<OrderStatusPage />);
    await waitFor(() => expect(screen.getByText("Pengiriman Produk")).toBeTruthy());
    expect(screen.getByText(/Estimasi 5–15 menit/)).toBeTruthy();
    expect(screen.queryByText(/maksimal 12 jam/)).toBeNull();
  });

  it("email checkout ikut disebut bila pembeli mengisinya", async () => {
    mockFetch(orderPayload({ customer_email: "h***@gmail.com" }));
    render(<OrderStatusPage />);
    await waitFor(() => expect(screen.getByText("Pengiriman Produk")).toBeTruthy());
    expect(screen.getByText("h***@gmail.com")).toBeTruthy();
  });
});
