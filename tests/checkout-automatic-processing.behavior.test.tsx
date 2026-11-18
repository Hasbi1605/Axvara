// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CheckoutPage from "@/app/(shop)/checkout/page";
import { useCart } from "@/stores/cart";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/payment-maintenance", () => ({ isPaymentMaintenanceEnabled: () => false }));

const automatic = {
  product_id: 1, variant_id: 11, name: "Paket Otomatis", price: 10_000,
  qty: 1, stock: -1, image: "/brand/axvara-mark.svg", queued_delivery: true,
  automatic_processing: true,
};
const manual = { ...automatic, product_id: 2, variant_id: 22, name: "Paket Manual", automatic_processing: undefined };

function renderQuote(items: (typeof automatic | typeof manual)[]) {
  useCart.setState({ items: items.map((item) => ({
    id: String(item.product_id), slug: `fixture-${item.product_id}`, variantId: item.variant_id,
    name: item.name, price: item.price, qty: item.qty, image: item.image, description: "", categorySlug: "fixture",
  })) });
  const fetch = vi.fn(async (url: string | URL | Request) => {
    expect(String(url)).toBe("/api/checkout/quote");
    return new Response(JSON.stringify({
      ok: true, items, subtotal: 10_000 * items.length, quoteToken: "fixture",
      paymentMethods: [{ id: "qris", label: "QRIS", account_number: "", account_name: "", qris_url: null }],
    }), { headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetch);
  render(<CheckoutPage />);
  return fetch;
}

beforeEach(() => { localStorage.clear(); useCart.setState({ items: [] }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("checkout: antrean otomatis dan manual dibedakan dari quote server", () => {
  it("otomatis memakai waktu antrean tanpa judul manual/estimasi12jam atau transaksi nyata", async () => {
    const fetch = renderQuote([automatic]);
    const heading = await screen.findByRole("heading", { name: "Diproses otomatis" });
    expect(heading.parentElement?.textContent).toContain("Paket Otomatis");
    expect(heading.parentElement?.textContent).toContain("Estimasi 15 menit–1 jam");
    expect(heading.parentElement?.textContent).not.toMatch(/Made By Order|admin|12 jam|Jaspay|Warung/);
    expect(screen.queryByRole("heading", { name: "Made By Order" })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keranjang campuran memisahkan pemberitahuan, tanpa memberi plafon manual ke produk otomatis", async () => {
    renderQuote([automatic, manual]);
    const auto = await screen.findByRole("heading", { name: "Diproses otomatis" });
    const mbo = screen.getByRole("heading", { name: "Made By Order" });
    expect(auto.parentElement?.textContent).toContain("Paket Otomatis");
    expect(auto.parentElement?.textContent).not.toContain("Paket Manual");
    expect(auto.parentElement?.textContent).not.toContain("12 jam");
    expect(mbo.parentElement?.textContent).toContain("Paket Manual");
    expect(mbo.parentElement?.textContent).not.toContain("Paket Otomatis");
  });

  it("quote lama tanpa penanda otomatis tetap mempertahankan pemberitahuan manual", async () => {
    renderQuote([manual]);
    const heading = await screen.findByRole("heading", { name: "Made By Order" });
    expect(heading.parentElement?.textContent).toContain("maksimal 12 jam");
    expect(screen.queryByRole("heading", { name: "Diproses otomatis" })).toBeNull();
  });
});
