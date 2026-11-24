// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CheckoutPage from "@/app/(shop)/checkout/page";
import { QuickVariantModal } from "@/components/storefront/QuickVariantModal";
import { useCart } from "@/stores/cart";
import type { Product } from "@/lib/products";
import type { StorefrontVariant } from "@/lib/product-copy/resolve";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => nav.params,
}));
vi.mock("@/lib/payment-maintenance", () => ({ isPaymentMaintenanceEnabled: () => false }));

const winnerProduct: Product = {
  id: "394",
  slug: "chatgpt-plus-sb",
  name: "ChatGPT Plus",
  description: "ChatGPT Plus 1 Bulan",
  price: 103400,
  minPrice: 103400,
  maxPrice: 128000,
  variantCount: 2,
  categorySlug: "ai-chatbot",
  image: "/r2/products/chatgpt.webp",
  stock: 47,
};

const mergedAivaultVariant: StorefrontVariant = {
  id: 17401,
  product_id: 174,
  label: "Plus 1 Bulan (Full Garansi)",
  label_duration: null,
  warranty_type: "full",
  warranty_value: 30,
  warranty_unit: "day",
  warranty_label: null,
  price: 128000,
  compare_price: null,
  stock: 15,
  min_qty: 1,
  max_qty: null,
  buyer_field_key: null,
  fulfillment_mode: "manual",
  is_active: 1,
  bulk_pricing_enabled: false,
  bulk_pricing_tiers: [],
  bulk_pricing_invalid: false,
  inventory_available: null,
  terms: null,
  delivery_terms: null,
  supplier_variant: false,
  delivery_kind: "instant",
  automatic_delivery: true,
  copy: null,
  copy_en: null,
};

beforeEach(() => {
  window.scrollTo = vi.fn();
  nav.push.mockClear();
  nav.replace.mockClear();
  nav.params = new URLSearchParams();
  localStorage.clear();
  sessionStorage.clear();
  useCart.setState({ items: [], drawerOpen: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("merge_variants storefront & checkout UI", () => {
  it("QuickVariantModal adds merged member variant with true owner product_id while keeping winner slug", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith("/api/catalog?slug=")) {
        return new Response(JSON.stringify({
          product: { id: 394, slug: "chatgpt-plus-sb", merged_variants: true, variants: [mergedAivaultVariant] },
          variantsEnabled: true,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const onClose = vi.fn();
    render(
      <QuickVariantModal
        product={winnerProduct}
        mode="cart"
        onClose={onClose}
        variants={[mergedAivaultVariant]}
        initialVariantId={17401}
      />,
    );
    const agree = document.getElementById("quick-modal-agree") as HTMLInputElement;
    expect(agree).toBeTruthy();
    fireEvent.click(agree);
    const confirm = await screen.findByRole("button", { name: /Tambah ke Keranjang/i });
    fireEvent.click(confirm);
    expect(onClose).toHaveBeenCalled();
    expect(useCart.getState().items).toEqual([
      expect.objectContaining({
        id: "174",
        slug: "chatgpt-plus-sb",
        variantId: 17401,
        price: 128000,
        qty: 1,
      }),
    ]);
  });

  it("direct checkout accepts merged_variants member variant and posts canonical owner product_id to /api/orders", async () => {
    nav.params = new URLSearchParams("buy=chatgpt-plus-sb&variant=17401&qty=1");
    const orderPosts: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("/api/products?active=1&slug=chatgpt-plus-sb")) {
        return new Response(JSON.stringify({ products: [winnerProduct] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (u.startsWith("/api/catalog?slug=chatgpt-plus-sb")) {
        return new Response(JSON.stringify({
          product: { id: 394, slug: "chatgpt-plus-sb", merged_variants: true, variants: [mergedAivaultVariant] },
          variantsEnabled: true,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (u === "/api/checkout/quote") {
        return new Response(JSON.stringify({
          ok: true,
          items: [{ product_id: 174, variant_id: 17401, name: "ChatGPT Plus — Plus 1 Bulan (Full Garansi)", price: 128000, qty: 1, stock: 15, image: "/r2/products/chatgpt.webp", queued_delivery: false }],
          subtotal: 128000,
          quoteToken: "merged-quote-token-fixture-1234567890",
          paymentMethods: [{ id: "qris", kind: "qris", label: "QRIS", sublabel: null, account_number: "", account_name: "", qris_url: null, currency: "IDR", available: true }],
          locale: "id",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (u === "/api/orders") {
        orderPosts.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({
          code: "AXV-20261124-MERGED01",
          subtotal: 128000,
          status: "pending",
          locale: "id",
          qris: null,
          buyer_access_session: "p1.x",
          checkout_credential_grant: "g.x",
        }), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    render(<CheckoutPage />);
    await waitFor(() => expect(screen.getAllByText(/Plus 1 Bulan \(Full Garansi\)/i).length).toBeGreaterThan(0));
    fireEvent.change(document.getElementById("checkout-wa")!, { target: { value: "081234567890" } });
    fireEvent.change(document.getElementById("checkout-email")!, { target: { value: "buyer@example.com" } });
    const boxes = ["checkout-agree-mobile", "checkout-agree"].map((id) => document.getElementById(id)).filter(Boolean) as HTMLInputElement[];
    fireEvent.click(boxes[0]);
    const payButtons = screen.getAllByRole("button").filter((b) => /Bayar|Buat Pesanan/i.test(b.textContent ?? ""));
    fireEvent.click(payButtons[payButtons.length - 1]);
    await waitFor(() => expect(orderPosts).toHaveLength(1));
    expect(orderPosts[0]).toMatchObject({
      items: [{ product_id: 174, variant_id: 17401, qty: 1 }],
      payment_method: "qris",
    });
  });

  it("direct checkout still rejects mismatched variant_id when product is NOT merged_variants", async () => {
    nav.params = new URLSearchParams("buy=chatgpt-plus-sb&variant=17401&qty=1");
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith("/api/products?active=1&slug=chatgpt-plus-sb")) {
        return new Response(JSON.stringify({ products: [winnerProduct] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (u.startsWith("/api/catalog?slug=chatgpt-plus-sb")) {
        return new Response(JSON.stringify({
          product: { id: 394, slug: "chatgpt-plus-sb", variants: [mergedAivaultVariant] },
          variantsEnabled: true,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    render(<CheckoutPage />);
    await screen.findByText(/Varian tidak cocok dengan produk/i);
  });
});
