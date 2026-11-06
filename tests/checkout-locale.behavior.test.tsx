// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CheckoutPage from "@/app/(shop)/checkout/page";
import { DisplayPreferencesProvider } from "@/hooks/useDisplayPrices";
import { useCart, type CartItem } from "@/stores/cart";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/payment-maintenance", () => ({ isPaymentMaintenanceEnabled: () => false }));
const item = { id: "1", slug: "owner", name: "Owner product name", description: "", categorySlug: "ai", image: "/x.png", price: 10000, qty: 1, variantId: 11 } as CartItem;
const qris = { id: "qris", kind: "qris", label: "QRIS", available: true, account_number: "", account_name: "", qris_url: null };
const clearCookies = () => document.cookie.split(";").forEach(c => { document.cookie = `${c.split("=")[0].trim()}=; Max-Age=0; Path=/`; });
beforeEach(() => {
  window.scrollTo = vi.fn(); Element.prototype.scrollIntoView = vi.fn();
  clearCookies(); useCart.setState({ items: [item] });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearCookies(); });

it.each([["en", "IDR"], ["id", "USD"]] as const)("renders checkout in %s independently of %s", async (locale, currency) => {
  document.cookie = `axv_locale=${locale}; Path=/`;
  document.cookie = `axv_currency=${currency}; Path=/`;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, items: [{ product_id: 1, variant_id: 11, name: item.name, price: 10000, qty: 1, stock: -1, image: "/x.png" }], subtotal: 10000, quoteToken: "fixture", paymentMethods: [qris], locale, displayPreferences: { locale, currency, usdAvailable: false, usdCents: null } }))));
  render(<DisplayPreferencesProvider><CheckoutPage /></DisplayPreferencesProvider>);
  await waitFor(() => expect((screen.getByRole("radio", { name: /QRIS/ }) as HTMLInputElement).checked).toBe(true));
  expect(screen.getAllByText("Owner product name").length).toBeGreaterThan(0);
  expect(screen.getAllByText(locale === "en" ? "Order Summary" : "Ringkasan Pesanan").length).toBeGreaterThan(0);
  expect(screen.getByText(locale === "en" ? "② Buyer Details" : "② Data Pembeli")).toBeTruthy();
  expect(screen.getByLabelText(locale === "en" ? "Active WhatsApp number *" : "No WA aktif *")).toBeTruthy();
  expect(screen.getByText(locale === "en" ? "Fastest" : "Paling cepat")).toBeTruthy();
  if (locale === "en") {
    expect(screen.queryByText("② Data Pembeli")).toBeNull();
    expect(screen.queryByText("Pilih pembayaran, isi data, lalu selesaikan pesanan.")).toBeNull();
  }
  expect(screen.getAllByText(locale === "en" ? "service and warranty terms" : "ketentuan layanan & garansi").length).toBeGreaterThan(0);
  expect(screen.getAllByText(locale === "en" ? /Pay Rp/ : /Bayar Rp/).length).toBeGreaterThan(0);
});

it("uses quote locale when automatic defaults are unresolved", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/display-prices") throw new Error("unavailable");
    return new Response(JSON.stringify({ ok: true, items: [{ product_id: 1, variant_id: 11, name: item.name, price: 10000, qty: 1, stock: -1, image: "/x.png" }], subtotal: 10000, quoteToken: "fixture", paymentMethods: [qris], locale: "en" }));
  }));
  render(<DisplayPreferencesProvider><CheckoutPage /></DisplayPreferencesProvider>);
  await waitFor(() => expect(screen.getAllByText("Order Summary").length).toBeGreaterThan(0));
});

it("localizes a known minimum issue without translating owner names", async () => {
  document.cookie = "axv_locale=en; Path=/"; document.cookie = "axv_currency=IDR; Path=/";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, issues: [{ product_id: 1, variant_id: 11, type: "below_minimum", min_qty: 50, message: "Owner product name minimal pembelian 50" }] }), { status: 409 })));
  render(<DisplayPreferencesProvider><CheckoutPage /></DisplayPreferencesProvider>);
  expect(await screen.findByRole("dialog", { name: "Adjust Purchase Quantity" })).toBeTruthy();
  expect(screen.getByText("Owner product name: Minimum purchase: 50.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Adjust to minimum" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Adjust manually" }));
});

it("localizes empty, loading and retry states", async () => {
  document.cookie = "axv_locale=en; Path=/"; document.cookie = "axv_currency=IDR; Path=/";
  useCart.setState({ items: [] });
  const view = render(<DisplayPreferencesProvider><CheckoutPage /></DisplayPreferencesProvider>);
  expect(await screen.findByText("Your cart is empty")).toBeTruthy();
  cleanup();
  useCart.setState({ items: [item] });
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  view.unmount();
  render(<DisplayPreferencesProvider><CheckoutPage /></DisplayPreferencesProvider>);
  await screen.findByText("Loading prices and payment methods…");
  finish(new Response(JSON.stringify({ error: "Gagal memuat harga" }), { status: 500 }));
  expect(await screen.findByText("Could not load prices")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
});

it("localizes a price-change dialog and buyer validation", async () => {
  document.cookie = "axv_locale=en; Path=/"; document.cookie = "axv_currency=IDR; Path=/";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, items: [{ product_id: 1, variant_id: 11, name: item.name, price: 11000, qty: 1, stock: -1, image: "/x.png" }], subtotal: 11000, quoteToken: "fixture", paymentMethods: [qris], locale: "en", changes: [{ product_id: 1, variant_id: 11, name: item.name, previous_price: 10000, current_price: 11000 }] }))));
  render(<DisplayPreferencesProvider><CheckoutPage /></DisplayPreferencesProvider>);
  expect(await screen.findByRole("dialog", { name: "Price / Stock Changed" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Accept new price" }));
  await waitFor(() => expect((screen.getByRole("radio", { name: /QRIS/ }) as HTMLInputElement).checked).toBe(true));
  fireEvent.click(screen.getAllByRole("button", { name: /Pay Rp/ })[0]);
  expect(await screen.findByText("WhatsApp number is required.")).toBeTruthy();
  expect(screen.getByText("Enter an active email address for order and product details.")).toBeTruthy();
});
