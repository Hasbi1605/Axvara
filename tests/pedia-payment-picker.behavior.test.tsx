// @vitest-environment jsdom
// Fase B (2026-11-07): pemilih metode Pedia memakai PaymentMethodPicker Market.
// QRIS tetap bawaan; daftar metode dimuat dari quote bertanda tangan hanya saat
// pembeli membuka pilihan; create mengirim metode terpilih. Kegagalan rail
// (error_code payment_method_unavailable) mengembalikan pilihan ke QRIS dan
// memuat ulang daftar metode.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// `location.assign` jsdom tidak bisa di-spy; rekam tujuan navigasi lewat helper
// `orderCheckoutPath` (dipakai persis sebelum `location.assign`) tanpa mengubah
// perilaku aslinya.
const nav = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock("@/lib/order-access-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/order-access-client")>();
  return {
    ...actual,
    orderCheckoutPath: (path: string, code: string, sessionOrLegacy?: unknown, maybeSession?: unknown) => {
      nav.paths.push(String(path));
      return actual.orderCheckoutPath(path, code, sessionOrLegacy, maybeSession);
    },
  };
});

import { OrderClient } from "@/app/pedia/o/[slug]/order-client";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

vi.mock("@/components/pedia/usePediaPrices", () => ({ usePediaPrices: vi.fn(() => null) }));

const product: PediaCatalogProduct = {
  slug: "followers-instagram", name: "Followers Instagram", platform: "instagram", metric: "followers", target_kind: "profile",
  tagline: null, packages: [250], step: 1, is_featured: 0, min_price: 25000, image: null,
  checklist: [{ id: "public", label: "Akun publik" }],
  tiers: [{
    id: 1, tier: "standar", label_note: null, public_name: "Followers Global HQ", region: "global", quality: "hq",
    drop_risk: "rendah", refill_days: 0, eta_start: null, eta_finish: null, prices: { "250": 25000 }, price_per_1k: 25000,
    quick_quantities: [250], min_qty: 250, max_qty: 1000,
  }],
};

const methods = [
  { id: "qris", kind: "qris", label: "QRIS", account_number: "qris", account_name: "QRIS", currency: "IDR", available: true },
  {
    id: "sekalipay_gateway:SHOPEEPAY", kind: "gateway", label: "ShopeePay", sublabel: "Estimasi biaya pembayaran",
    account_number: "", currency: "IDR", available: true, group: "ewallet", limits: { min: 1000, max: 10000000 },
    gateway: { channel: "SHOPEEPAY", estimated_fee: 500, estimated_total: 25500, idr_subtotal: 25000 },
  },
];

const reply = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  nav.paths.length = 0;
  fetchMock = vi.fn(async () => reply({ quote_token: "signed-price", total: 25000, payable: 25000, paymentMethods: methods }));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function mount() {
  render(<OrderClient product={product} initialTarget="https://instagram.com/customer" ordersEnabled />);
}
function complete() {
  fireEvent.click(screen.getByRole("radio", { name: /Followers Global HQ/ }));
  fireEvent.change(screen.getByLabelText("Jumlah yang dipesan"), { target: { value: "250" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Lanjut: isi target" })[0]);
  fireEvent.click(screen.getByRole("checkbox", { name: /Akun publik/ }));
  fireEvent.click(screen.getAllByRole("button", { name: "Lanjut: kontak" })[0]);
  fireEvent.change(screen.getByLabelText("Nomor WhatsApp"), { target: { value: "081234567890" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Saya setuju/ }));
}

describe("Pedia payment method picker (fase B)", () => {
  it("QRIS bawaan; membuka pilihan memuat metode dari quote dan create mengirim metode terpilih", async () => {
    mount(); complete();
    expect(screen.getByText(/QRIS dipilih/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pilih metode lain" }));
    // Grup E-Wallet adalah akordeon (pola Market): buka dulu, lalu pilih kanal.
    fireEvent.click(await screen.findByRole("button", { name: /E-Wallet/ }));
    const gateway = await screen.findByRole("radio", { name: /ShopeePay/ });
    fireEvent.click(gateway);
    expect((gateway as HTMLInputElement).checked).toBe(true);
    // Quote prefetch (metode) dipakai ulang; create gagal sengaja agar navigasi jsdom tidak dijalankan.
    fetchMock.mockRejectedValueOnce(new Error("stop-navigation"));
    fireEvent.click(screen.getAllByRole("button", { name: /^(Lanjut ke pembayaran|Lanjut bayar)$/ })[0]);
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/pedia/orders"))).toBe(true));
    const ordersCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/api/pedia/orders"));
    expect(JSON.parse(String((ordersCall![1] as RequestInit).body))).toMatchObject({
      customer_wa: "081234567890",
      customer_email: "buyer@example.com",
      quote_token: "signed-price",
      payment_method: "sekalipay_gateway:SHOPEEPAY",
    });
  });

  it("503 payment_method_unavailable tanpa order: kembali ke QRIS dan memuat ulang daftar metode", async () => {
    mount(); complete();
    fireEvent.click(screen.getByRole("button", { name: "Pilih metode lain" }));
    // Grup E-Wallet adalah akordeon (pola Market): buka dulu, lalu pilih kanal.
    fireEvent.click(await screen.findByRole("button", { name: /E-Wallet/ }));
    const gateway = await screen.findByRole("radio", { name: /ShopeePay/ });
    fireEvent.click(gateway);
    fetchMock.mockResolvedValueOnce(reply({
      error: "Metode pembayaran ini sedang gangguan. Silakan coba metode pembayaran lain.",
      error_code: "payment_method_unavailable",
    }, 503));
    fireEvent.click(screen.getAllByRole("button", { name: /^(Lanjut ke pembayaran|Lanjut bayar)$/ })[0]);
    await screen.findByRole("alert");
    // Daftar metode dimuat ulang dan pilihan kembali ke QRIS (bukan diam-diam ke rail berbiaya).
    await waitFor(() => expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("/api/pedia/quote")).length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect((screen.getByRole("radio", { name: /QRIS/ }) as HTMLInputElement).checked).toBe(true));
  });

  it("503 payment_method_unavailable dengan kode order: TIDAK pindah halaman; metode gagal tidak dipilih ulang, quote BARU + metode lain → order baru", async () => {
    let quoteN = 0;
    fetchMock.mockImplementation(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/api/pedia/quote")) {
        quoteN += 1;
        return reply({ quote_token: `signed-price-${quoteN}`, total: 25000, payable: 25000, paymentMethods: methods });
      }
      throw new Error(`unexpected ${target}`);
    });
    mount(); complete();
    fireEvent.click(screen.getByRole("button", { name: "Pilih metode lain" }));
    fireEvent.click(await screen.findByRole("button", { name: /E-Wallet/ }));
    fireEvent.click(await screen.findByRole("radio", { name: /ShopeePay/ }));
    // Ronde 1: rail gagal SETELAH order Pedia tersimpan (`code` ada).
    fetchMock.mockResolvedValueOnce(reply({
      error: "Metode pembayaran ini sedang gangguan. Silakan coba metode pembayaran lain.",
      error_code: "payment_method_unavailable",
      code: "AXP-20261107-AAAAAAAA",
    }, 503));
    fireEvent.click(screen.getAllByRole("button", { name: /^(Lanjut ke pembayaran|Lanjut bayar)$/ })[0]);
    expect((await screen.findByRole("alert")).textContent).toContain("Metode pembayaran ini sedang gangguan");
    // Tidak pindah ke halaman pesanan (metode di sana terkunci).
    expect(nav.paths).toHaveLength(0);
    // Daftar metode dimuat ulang dengan quote baru; metode gagal TIDAK terpilih lagi.
    await waitFor(() => expect(quoteN).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect((screen.getByRole("radio", { name: /QRIS/ }) as HTMLInputElement).checked).toBe(true));
    // Metode yang gagal tidak terpilih ulang (grup bisa tertutup setelah daftar dimuat ulang).
    const failedRadio = screen.queryAllByRole("radio", { hidden: true }).find((r) => /ShopeePay/.test(r.closest("label")?.textContent ?? "")) as HTMLInputElement | undefined;
    expect(failedRadio?.checked ?? false).toBe(false);
    // Ronde 2: metode lain (QRIS) dengan quote BARU → 201 → halaman order baru.
    fetchMock.mockResolvedValueOnce(reply({ code: "AXP-20261107-BBBBBBBB", buyer_access_session: "sess" }, 201));
    fireEvent.click(screen.getAllByRole("button", { name: /^(Lanjut ke pembayaran|Lanjut bayar)$/ })[0]);
    await waitFor(() => expect(nav.paths).toHaveLength(1));
    const ordersCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/api/pedia/orders"));
    expect(ordersCalls).toHaveLength(2);
    const first = JSON.parse(String((ordersCalls[0][1] as RequestInit).body));
    const second = JSON.parse(String((ordersCalls[1][1] as RequestInit).body));
    expect(first).toMatchObject({ payment_method: "sekalipay_gateway:SHOPEEPAY" });
    expect(second).toMatchObject({ payment_method: "qris" });
    // Token quote BARU (bukan token order yang gagal).
    expect(second.quote_token).not.toBe(first.quote_token);
    expect(String(second.quote_token)).toMatch(/^signed-price-\d+$/);
    expect(String(nav.paths[0] ?? "")).toContain("AXP-20261107-BBBBBBBB");
  });
});
