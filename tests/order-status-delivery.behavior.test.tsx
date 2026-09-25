// @vitest-environment jsdom
//
// tests/order-status-delivery.behavior.test.tsx — Halaman /pesanan/[code]
// pernah menampilkan panel "Detail Akun Digital" untuk SETIAP order lunas,
// termasuk produk fulfillment manual yang tidak pernah punya kredensial WR.
// Akibatnya pembeli baru bayar langsung disuguhi form verifikasi WA yang pasti
// berakhir "Detail akun belum tersedia". Test ini merender halaman sungguhan
// untuk kedua cabang: siap → form retrieval, belum siap → info pengiriman.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, cleanup, waitFor } from "@testing-library/react";
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
    // Order lama TANPA email: nomor WA tersamar jadi satu-satunya tujuan.
    expect(screen.getByText(/Detail produk dikirim ke/).textContent).toContain("WhatsApp");
    expect(screen.getByText("08213****7434")).toBeTruthy();
    // Form mati tidak boleh ada lagi.
    expect(screen.queryByText("Detail Akun Digital")).toBeNull();
    expect(screen.queryByRole("button", { name: "Tampilkan" })).toBeNull();
    expect(screen.queryByLabelText("No. WA atau email checkout")).toBeNull();
  });

  it("status akhir dari server dicatat ke salinan lokal (titik tab Pesanan ikut hilang)", async () => {
    localStorage.setItem("axvara-orders", JSON.stringify([{ code: CODE, status: "pending", createdAt: new Date().toISOString() }]));
    mockFetch(orderPayload());
    render(<OrderStatusPage />);
    await waitFor(() => expect(JSON.parse(localStorage.getItem("axvara-orders") || "[]")[0]?.status).toBe("lunas"));
  });

  it("credentials_ready=true → panel retrieval kredensial tampil", async () => {
    mockFetch(orderPayload({ credentials_ready: true }));
    render(<OrderStatusPage />);
    await waitFor(() => expect(screen.getByText("Detail Akun Digital")).toBeTruthy());
    // Sejak 2026-09-25 verifikasi menerima No. WA atau email checkout.
    expect(screen.getByLabelText("No. WA atau email checkout")).toBeTruthy();
    expect(screen.getByText(/Terdaftar: 08213\*\*\*\*7434/)).toBeTruthy();
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

  it("credentials_ready=false + queued → teks Made By Order dengan plafon 12 jam, TANPA janji 5–15 menit", async () => {
    mockFetch(orderPayload({ queued_delivery: true }));
    render(<OrderStatusPage />);
    await waitFor(() => expect(screen.getByText("Pengiriman Produk")).toBeTruthy());
    expect(screen.getByText(/Made By Order/)).toBeTruthy();
    expect(screen.getByText(/maksimal 12 jam pada jam layanan/)).toBeTruthy();
    expect(screen.queryByText(/5–15 menit/)).toBeNull();
  });

  it("credentials_ready=false + WR kirim otomatis (bukan stok sendiri) → tetap 5–15 menit", async () => {
    mockFetch(orderPayload({ queued_delivery: false, instant_delivery: false }));
    render(<OrderStatusPage />);
    await waitFor(() => expect(screen.getByText("Pengiriman Produk")).toBeTruthy());
    expect(screen.getByText(/Estimasi 5–15 menit/)).toBeTruthy();
    expect(screen.queryByText(/maksimal 12 jam/)).toBeNull();
  });

  it("email checkout menjadi tujuan kabar; WhatsApp tidak lagi dijanjikan (bot WA mati)", async () => {
    mockFetch(orderPayload({ customer_email: "h***@gmail.com" }));
    render(<OrderStatusPage />);
    await waitFor(() => expect(screen.getByText("Pengiriman Produk")).toBeTruthy());
    expect(screen.getByText("h***@gmail.com")).toBeTruthy();
    const line = screen.getByText(/Detail produk dikirim ke/).textContent ?? "";
    expect(line).toContain("email");
    expect(line).not.toContain("WhatsApp");
    expect(screen.queryByText("08213****7434")).toBeNull();
  });
});

// Laporan owner 2026-09-25 (Canva Invite 1 Bulan, kirim otomatis): produk
// terkirim 4 dtk setelah lunas, tetapi halaman menampilkan "Estimasi 5–15
// menit" dan baru memeriksa lagi 20 dtk kemudian, sehingga pembeli me-refresh.
describe("/pesanan/[code] — kirim otomatis dari stok sendiri", () => {
  const CREDENTIAL = "Link undangan: https://canva.com/join/ABC";
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  /** GET pesanan membaca `state.order` saat itu; POST kredensial (panel) selalu berhasil. */
  function stubLiveOrder(state: { order: Record<string, unknown> }) {
    const gets: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/credentials")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, credentials: [{ label: "Canva Pro — Invite 1 Bulan", details: CREDENTIAL, completed_at: null }], capability_token: "a".repeat(64) }) };
      }
      gets.push(Date.now());
      return { ok: true, status: 200, json: async () => orderPayload(state.order) };
    }));
    return gets;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("belum terkirim → 'Mengirim produkmu…' tanpa 5–15 menit; poll 2 dtk memunculkan detail tanpa muat ulang", async () => {
    sessionStorage.setItem(`axvara-checkout-contact:${CODE}`, "081234567890");
    const state = { order: { instant_delivery: true, fulfillment_status: "not_required", customer_email: "r***@gmail.com" } as Record<string, unknown> };
    const gets = stubLiveOrder(state);
    render(<OrderStatusPage />);
    await advance(50);
    expect(screen.getByText("Mengirim produkmu…")).toBeTruthy();
    expect(screen.getByText(/Tidak perlu memuat ulang halaman/)).toBeTruthy();
    expect(screen.getByText(/Detail produk tampil di sini/).textContent).toContain("r***@gmail.com");
    expect(screen.queryByText(/5–15 menit/)).toBeNull();
    // Produk selesai terkirim sesaat setelah halaman melihat "lunas".
    state.order = { ...state.order, credentials_ready: true, fulfillment_status: "delivered" };
    await advance(1_000);
    expect(screen.queryByText(CREDENTIAL)).toBeNull();
    await advance(1_200);
    expect(screen.getByText(CREDENTIAL)).toBeTruthy();
    expect(gets).toHaveLength(2);
  });

  it("jendela cepat habis tanpa hasil → 2 dtk ×5, 5 dtk ×4, lalu 20 dtk; teks berganti jujur", async () => {
    const gets = stubLiveOrder({ order: { instant_delivery: true, fulfillment_status: "not_required" } });
    render(<OrderStatusPage />);
    await advance(50);
    expect(gets).toHaveLength(1);
    await advance(10_100);
    expect(gets).toHaveLength(6);
    expect(screen.getByText("Mengirim produkmu…")).toBeTruthy();
    await advance(20_000);
    expect(gets).toHaveLength(10);
    expect(screen.queryByText("Mengirim produkmu…")).toBeNull();
    expect(screen.getByText(/Pengiriman butuh waktu lebih lama dari biasanya/)).toBeTruthy();
    expect(screen.queryByText(/5–15 menit/)).toBeNull();
    await advance(15_000);
    expect(gets).toHaveLength(10);
    await advance(6_000);
    expect(gets).toHaveLength(11);
  });

  it("kirim otomatis diserahkan ke admin (manual_required) → teks admin + plafon 12 jam, tanpa poll cepat", async () => {
    const gets = stubLiveOrder({ order: { instant_delivery: true, fulfillment_status: "manual_required", customer_email: "r***@gmail.com" } });
    render(<OrderStatusPage />);
    await advance(50);
    expect(screen.getByText(/Produkmu sedang disiapkan admin/)).toBeTruthy();
    expect(screen.getByText(/maksimal 12 jam pada jam layanan/)).toBeTruthy();
    expect(screen.queryByText("Mengirim produkmu…")).toBeNull();
    expect(screen.queryByText(/5–15 menit/)).toBeNull();
    await advance(15_000);
    expect(gets).toHaveLength(1);
    await advance(120_000);
    expect(gets).toHaveLength(4);
  });

  it("sudah terkirim tanpa detail di halaman → 'Produk sudah dikirim', bukan 'sedang diproses'", async () => {
    stubLiveOrder({ order: { fulfillment_status: "delivered", customer_email: "r***@gmail.com" } });
    render(<OrderStatusPage />);
    await advance(50);
    expect(screen.getByText(/Produk sudah dikirim ke/).textContent).toContain("r***@gmail.com");
    expect(screen.getByText(/Cek juga folder spam/)).toBeTruthy();
    expect(screen.queryByText(/sedang diproses/)).toBeNull();
    expect(screen.queryByText(/5–15 menit/)).toBeNull();
  });

  it("WR kirim otomatis tetap memakai jadwal lama: tidak ada poll cepat", async () => {
    const gets = stubLiveOrder({ order: { instant_delivery: false } });
    render(<OrderStatusPage />);
    await advance(50);
    expect(screen.getByText(/Estimasi 5–15 menit/)).toBeTruthy();
    await advance(19_000);
    expect(gets).toHaveLength(1);
    await advance(2_000);
    expect(gets).toHaveLength(2);
  });
});
