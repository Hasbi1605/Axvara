// @vitest-environment jsdom
//
// tests/payment-loading.behavior.test.tsx — jalur uang tidak boleh terlihat
// error saat jaringan lambat (permintaan owner 2026-09-24):
// - setelah Bayar, layar "Pesanan dibuat · Membuka halaman pembayaran"
//   bertahan sampai /pesanan tampil (dulu tombol aktif lagi + "Keranjang
//   kosong" berkedip);
// - putus jaringan saat membuat pesanan dijelaskan (aman diulang, tidak dobel);
// - /pesanan langsung menampilkan QR dari respons create, dan salinan lokal
//   lama tidak lagi memunculkan "Pesanan Diterima! Admin akan memverifikasi".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCart } from "@/stores/cart";
import type { Product } from "@/lib/products";

const CODE = "AXV-20260924-LOADING";
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ code: "AXV-20260924-LOADING" }),
  usePathname: () => "/checkout",
}));

import CheckoutPage from "@/app/checkout/page";
import OrderSuccessPage from "@/app/pesanan/[code]/page";

const cartProduct = {
  id: "7", name: "Canva Pro", slug: "canva-pro", price: 10_000, categorySlug: "design", description: "",
  image: "/brand/axvara-mark.svg", stock: -1,
} as unknown as Product;

const qris = { payable_amount: 10_123, unique_code: 123, image_url: `/api/payments/qris/${CODE}/image`, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() };

function stubCheckoutApi(orderResponse: () => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input);
    if (url === "/api/checkout/quote") {
      return {
        ok: true, status: 200,
        json: async () => ({
          items: [{ product_id: 7, name: "Canva Pro", price: 10_000, qty: 1, stock: -1, image: "/brand/axvara-mark.svg" }],
          subtotal: 10_000,
          paymentMethods: [{ id: "qris", label: "QRIS", account_number: "-", account_name: "AXVARA", qris_url: null }],
          quoteToken: "q".repeat(40),
          changes: [],
        }),
      };
    }
    if (url === "/api/orders") return orderResponse();
    throw new Error(`unexpected fetch ${url}`);
  }));
}

async function fillAndPay() {
  render(<CheckoutPage />);
  await waitFor(() => expect(screen.getAllByRole("button", { name: /Bayar Rp/ })[0]).toBeTruthy());
  await waitFor(() => expect((screen.getAllByRole("button", { name: /Bayar Rp/ })[0] as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText(/No WA aktif/), { target: { value: "081234567890" } });
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "budi@example.test" } });
  fireEvent.click(document.getElementById("checkout-agree-mobile")!);
  fireEvent.click(screen.getAllByRole("button", { name: /Bayar Rp/ })[0]);
}

beforeEach(() => {
  nav.push.mockClear();
  localStorage.clear();
  useCart.setState({ items: [{ ...cartProduct, qty: 1 }], drawerOpen: false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Checkout → pembayaran", () => {
  it("setelah pesanan dibuat: layar membuka pembayaran, bukan form aktif lagi / keranjang kosong", async () => {
    stubCheckoutApi(async () => ({ ok: true, status: 201, json: async () => ({ code: CODE, subtotal: 10_000, status: "pending", qris }) }));
    await fillAndPay();
    expect(await screen.findByText("Pesanan dibuat")).toBeTruthy();
    expect(screen.getByText(CODE)).toBeTruthy();
    expect(screen.getByText(/Membuka halaman pembayaran QRIS/)).toBeTruthy();
    expect(screen.queryByText("Keranjang kosong")).toBeNull();
    expect(screen.queryByRole("button", { name: /Bayar Rp/ })).toBeNull();
    expect(nav.push).toHaveBeenCalledWith(`/pesanan/${CODE}`);
    expect(useCart.getState().items).toHaveLength(0);
    // QR dari respons create ikut disimpan agar /pesanan tampil tanpa menunggu.
    const local = JSON.parse(localStorage.getItem("axvara-orders")!)[0];
    expect(local.qris.image_url).toBe(qris.image_url);
    expect(local).not.toHaveProperty("wa");
  });

  it("putus jaringan saat membuat pesanan: dijelaskan aman diulang, tombol aktif lagi", async () => {
    stubCheckoutApi(async () => { throw new TypeError("Failed to fetch"); });
    await fillAndPay();
    // Pesan error dirender di rail desktop + area mobile.
    const notices = await screen.findAllByText(/Koneksi terputus saat membuat pesanan/);
    expect(notices[0].textContent).toContain("tidak dibuat dobel");
    expect((screen.getAllByRole("button", { name: /Bayar Rp/ })[0] as HTMLButtonElement).disabled).toBe(false);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("selama membuat pesanan tombol menjelaskan proses, bukan sekadar Memproses", async () => {
    stubCheckoutApi(() => new Promise(() => undefined));
    await fillAndPay();
    const buttons = await screen.findAllByRole("button", { name: /Membuat pesanan/ });
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("/pesanan/[code] saat memuat", () => {
  it("baru dari checkout: QR dari respons create tampil sebelum GET pertama selesai", () => {
    localStorage.setItem("axvara-orders", JSON.stringify([{ code: CODE, name: "Budi", method: "qris", items: [{ name: "Canva Pro", price: 10_000, qty: 1 }], subtotal: 10_000, status: "pending", createdAt: new Date().toISOString(), qris }]));
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    render(<OrderSuccessPage />);
    expect(screen.getByText("Selesaikan Pembayaran QRIS")).toBeTruthy();
    expect(screen.getByAltText(`QRIS dinamis pesanan ${CODE}`)).toBeTruthy();
    expect(screen.getByText("Memuat QRIS…")).toBeTruthy();
    expect(screen.queryByText(/Admin akan memverifikasi bukti/)).toBeNull();
  });

  it("salinan lokal lama tanpa QR tidak ditampilkan: skeleton sampai server menjawab", () => {
    localStorage.setItem("axvara-orders", JSON.stringify([{ code: CODE, name: "Budi", method: "qris", items: [], subtotal: 10_000, status: "pending", createdAt: new Date(Date.now() - 3 * 3600_000).toISOString() }]));
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    render(<OrderSuccessPage />);
    expect(screen.queryByText("Pesanan Diterima!")).toBeNull();
    expect(screen.getByText("Memuat pesanan…")).toBeTruthy();
  });

  it("QR gagal dimuat: tombol Muat ulang QRIS memuat ulang gambar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ order: { code: CODE, customer_name: "Budi", customer_wa: "62812****7890", items: [], subtotal: 10_000, payment_method: "qris", status: "pending", qris: { ...qris, status: "pending" } } }),
    })));
    render(<OrderSuccessPage />);
    const img = await screen.findByAltText(`QRIS dinamis pesanan ${CODE}`);
    fireEvent.error(img);
    fireEvent.click(await screen.findByRole("button", { name: "Muat ulang QRIS" }));
    await waitFor(() => expect(screen.getByAltText(`QRIS dinamis pesanan ${CODE}`).getAttribute("src")).toContain("retry=1"));
    fireEvent.load(screen.getByAltText(`QRIS dinamis pesanan ${CODE}`));
    expect(screen.queryByText("Memuat QRIS…")).toBeNull();
  });
});
