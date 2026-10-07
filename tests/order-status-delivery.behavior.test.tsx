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
import OrderStatusPage from "@/app/(shop)/pesanan/[code]/page";

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

  it("credentials_ready=false + queued (C1 Made By Order) → judul sendiri, <1 jam + plafon 12 jam, TANPA alasan stok & TANPA jam layanan", async () => {
    mockFetch(orderPayload({ queued_delivery: true }));
    render(<OrderStatusPage />);
    await waitFor(() => expect(screen.getByText("Pesanan Made By Order")).toBeTruthy());
    expect(screen.getByText(/disiapkan admin setelah pembayaran masuk/)).toBeTruthy();
    expect(screen.getByText(/kurang dari 1 jam/)).toBeTruthy();
    expect(screen.getByText(/maksimal 12 jam/)).toBeTruthy();
    // C1 manual by design: tidak boleh pakai alasan stok habis (itu milik C2)
    // dan tidak boleh janji jam layanan / 5–15 menit WR.
    expect(screen.queryByText(/Stok otomatis habis/)).toBeNull();
    expect(screen.queryByText(/pada jam layanan/)).toBeNull();
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
    // Copy 2026-10-07 (permintaan owner): order ber-email memakai kalimat email
    // + halaman ini — tanpa menampilkan lagi alamat emailnya di blok ini.
    const line = screen.getByText(/Detail pesanan akan otomatis dikirimkan/).textContent ?? "";
    expect(line).toContain("email saat order");
    expect(line).toContain("tampil di halaman ini");
    expect(line).not.toContain("WhatsApp");
    expect(screen.queryByText("h***@gmail.com")).toBeNull();
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

  it("belum terkirim (A: fase menyiapkan) → skeleton tanpa teks pengiriman; poll 2 dtk memunculkan detail tanpa muat ulang", async () => {
    sessionStorage.setItem(`axvara-checkout-contact:${CODE}`, "081234567890");
    const state = { order: { instant_delivery: true, fulfillment_status: "not_required", customer_email: "r***@gmail.com" } as Record<string, unknown> };
    const gets = stubLiveOrder(state);
    render(<OrderStatusPage />);
    await advance(50);
    // Tidak ada teks pengiriman yang bisa hilang sepersekian detik kemudian —
    // hanya skeleton + satu baris mikro yang tidak mengklaim apa-apa.
    expect(screen.getByText("Menyiapkan detail produkmu…")).toBeTruthy();
    expect(screen.queryByText("Pengiriman Otomatis")).toBeNull();
    expect(screen.queryByText("Mengirim otomatis…")).toBeNull();
    expect(screen.queryByText(/Detail produk/)).toBeNull();
    expect(screen.queryByText(/disiapkan admin/)).toBeNull();
    expect(screen.queryByText(/Stok otomatis habis/)).toBeNull();
    expect(screen.queryByText(/maksimal 12 jam/)).toBeNull();
    expect(screen.queryByText(/5–15 menit/)).toBeNull();
    // Produk selesai terkirim sesaat setelah halaman melihat "lunas".
    state.order = { ...state.order, credentials_ready: true, fulfillment_status: "delivered" };
    await advance(1_000);
    expect(screen.queryByRole("link", { name: "https://canva.com/join/ABC" })).toBeNull();
    await advance(1_200);
    expect(screen.getByRole("link", { name: "https://canva.com/join/ABC" })).toBeTruthy();
    expect(gets).toHaveLength(2);
  });

  it("jendela cepat habis tanpa hasil (B) → 2 dtk ×5, 5 dtk ×4, lalu 20 dtk; teks berganti jujur, tetap tanpa admin/12 jam", async () => {
    const gets = stubLiveOrder({ order: { instant_delivery: true, fulfillment_status: "not_required" } });
    render(<OrderStatusPage />);
    await advance(50);
    expect(gets).toHaveLength(1);
    await advance(10_100);
    expect(gets).toHaveLength(6);
    expect(screen.getByText("Menyiapkan detail produkmu…")).toBeTruthy();
    await advance(20_000);
    expect(gets).toHaveLength(10);
    expect(screen.queryByText("Menyiapkan detail produkmu…")).toBeNull();
    expect(screen.getByText("Pengiriman Otomatis")).toBeTruthy();
    expect(screen.getByText(/butuh waktu lebih lama dari biasanya/)).toBeTruthy();
    expect(screen.queryByText(/disiapkan admin/)).toBeNull();
    expect(screen.queryByText(/maksimal 12 jam/)).toBeNull();
    expect(screen.queryByText(/5–15 menit/)).toBeNull();
    await advance(15_000);
    expect(gets).toHaveLength(10);
    await advance(6_000);
    expect(gets).toHaveLength(11);
  });

  it("kirim otomatis diserahkan ke admin (C2 manual_required) → judul sendiri + alasan stok + <1 jam/12 jam, tanpa poll cepat & tanpa janji jam layanan", async () => {
    const gets = stubLiveOrder({ order: { instant_delivery: true, fulfillment_status: "manual_required", customer_email: "r***@gmail.com" } });
    render(<OrderStatusPage />);
    await advance(50);
    expect(screen.getByText("Pengiriman oleh Admin")).toBeTruthy();
    // Copy 2026-10-07: C2 ber-email memakai kalimat email + halaman ini
    // (bukan lagi alamat emailnya di dalam lead).
    expect(screen.getByText(/Stok otomatis habis, jadi admin menyiapkan manual/).textContent).toContain("email saat order");
    expect(screen.getByText(/kurang dari 1 jam/)).toBeTruthy();
    expect(screen.getByText(/maksimal 12 jam/)).toBeTruthy();
    expect(screen.queryByText(/pada jam layanan/)).toBeNull();
    expect(screen.queryByText(/Tidak perlu menunggu halaman ini terbuka/)).toBeNull();
    expect(screen.queryByText("Menyiapkan detail produkmu…")).toBeNull();
    expect(screen.queryByText("Mengirim otomatis…")).toBeNull();
    expect(screen.queryByText(/Made By Order/)).toBeNull();
    expect(screen.queryByText(/5–15 menit/)).toBeNull();
    await advance(15_000);
    expect(gets).toHaveLength(1);
    await advance(120_000);
    expect(gets).toHaveLength(4);
  });

  it("order ber-email sudah terkirim tanpa detail di halaman → copy email + halaman ini, bukan 'sedang diproses'", async () => {
    stubLiveOrder({ order: { fulfillment_status: "delivered", customer_email: "r***@gmail.com" } });
    render(<OrderStatusPage />);
    await advance(50);
    expect(screen.getByText(/Detail pesanan akan otomatis dikirimkan/).textContent).toContain("tampil di halaman ini");
    expect(screen.getByText(/Cek juga folder spam/)).toBeTruthy();
    expect(screen.queryByText(/sedang diproses/)).toBeNull();
    expect(screen.queryByText(/5–15 menit/)).toBeNull();
  });

  it("order lama tanpa email yang sudah terkirim → 'Produk sudah dikirim ke WhatsApp', bukan copy email", async () => {
    stubLiveOrder({ order: { fulfillment_status: "delivered", customer_email: null } });
    render(<OrderStatusPage />);
    await advance(50);
    expect(screen.getByText(/Produk sudah dikirim ke/).textContent).toContain("08213");
    expect(screen.queryByText(/Cek juga folder spam/)).toBeNull();
    expect(screen.queryByText(/sedang diproses/)).toBeNull();
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
