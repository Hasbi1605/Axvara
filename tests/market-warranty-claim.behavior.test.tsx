// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrderStatusPage from "@/app/(shop)/pesanan/[code]/page";
import LacakPesananClient from "@/app/(shop)/lacak-pesanan/lacak-pesanan-client";
import GaransiReplacePage from "@/app/(shop)/garansi-replace/page";
import { WarrantyClaimAccordion } from "@/components/storefront/WarrantyClaim";
import { DEFAULT_STORE_SETTINGS } from "@/lib/site";
import { marketWarrantyClaim } from "@/lib/warranty-policy";

const CODE = "AXV-20261015-CLAIM001";
const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ code: CODE }), useSearchParams: () => nav.params }));
vi.mock("@/hooks/useStoreSettings", () => ({ useStoreSettings: () => DEFAULT_STORE_SETTINGS }));

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); nav.params = new URLSearchParams();
  vi.stubGlobal("scrollTo", vi.fn());
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Reflect.deleteProperty(Element.prototype, "scrollIntoView"); });

const items = [{ name: "Produk Market A", price: 10000, qty: 1 }, { name: "Produk Market B", price: 15000, qty: 1 }];
function stubOrder(overrides: Record<string, unknown> = {}) {
  const order = {
    code: CODE, customer_name: "Pembeli", customer_wa: "081234567890", customer_email: "buyer@example.test",
    items, subtotal: 25000, payment_method: "qris", status: "lunas", credentials_ready: true,
    fulfillment_status: "delivered", ...overrides,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true, status: 200, json: async () => String(url).includes("/credentials")
      ? { credentials: items.map(item => ({ label: item.name, details: "Email: akun@example.test", completed_at: null })), capability_token: null }
      : { order: String(url).includes("/lookup") ? { ...order, items: JSON.stringify(items) } : order },
  })));
}

function expectPolicy(container: HTMLElement) {
  const ui = within(container);
  for (const text of [...marketWarrantyClaim.requirements, ...marketWarrantyClaim.notes, marketWarrantyClaim.closing]) {
    expect(ui.getByText(text)).toBeTruthy();
  }
  expect(container.textContent).not.toMatch(/1[x×]24 jam kerja|BUKAN refund dana|Refund hanya jika stok/);
}

describe("Market warranty claim guidance", () => {
  it.each([
    ["stok sendiri", {}],
    ["WR", { supplier_owned: true }],
    ["SK", { supplier_owned: true, instant_delivery: true }],
    ["manual", { credentials_ready: false, queued_delivery: true }],
    ["supplier masih berjalan", { credentials_ready: false, supplier_owned: true, supplier_running: true }],
    ["pengiriman gagal", { credentials_ready: false, fulfillment_status: "failed" }],
  ])("shows one collapsed claim accordion below account/delivery details for paid %s orders", async (_kind, overrides) => {
    stubOrder(overrides as Record<string, unknown>);
    sessionStorage.setItem(`axvara-checkout-contact:${CODE}`, "buyer@example.test");
    render(<OrderStatusPage />);
    const button = await screen.findByRole("button", { name: "Syarat klaim garansi" });
    expect(screen.getAllByRole("button", { name: "Syarat klaim garansi" })).toHaveLength(1);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(button.getAttribute("aria-controls")!);
    expect(panel?.hidden).toBe(true);
    const account = document.querySelector('[aria-label="Detail akun digital"]');
    if (account) expect(account.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expectPolicy(screen.getByRole("region", { name: "Syarat klaim garansi" }));
  });

  it.each(["pending", "cancelled", "expired"])("does not show the post-payment accordion for %s orders", async (status) => {
    stubOrder({ status, credentials_ready: false, expires_at: new Date(Date.now() + 600000).toISOString() });
    render(<OrderStatusPage />);
    await screen.findByText("Ringkasan");
    expect(screen.queryByRole("button", { name: "Syarat klaim garansi" })).toBeNull();
  });

  it("also renders the accordion after verified order tracking, below credentials", async () => {
    nav.params = new URLSearchParams({ code: CODE, email: "buyer@example.test" });
    stubOrder();
    render(<LacakPesananClient />);
    const button = await screen.findByRole("button", { name: "Syarat klaim garansi" });
    await screen.findAllByText("Email: akun@example.test");
    expect(screen.getByRole("region", { name: "Detail akun digital" }).compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(button);
    expectPolicy(screen.getByRole("region", { name: "Syarat klaim garansi" }));
  });

  it("can be expanded and collapsed with the keyboard", async () => {
    const user = userEvent.setup();
    render(<WarrantyClaimAccordion />);
    const button = screen.getByRole("button", { name: "Syarat klaim garansi" });
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard("{Enter}");
    expectPolicy(screen.getByRole("region", { name: "Syarat klaim garansi" }));
    await user.keyboard(" ");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("publishes the same requirements, 1–3 day process and conditional refund on the terms page", () => {
    render(<GaransiReplacePage />);
    const heading = screen.getByRole("heading", { name: "Syarat klaim garansi" });
    expectPolicy(heading.parentElement!);
    expect(document.body.textContent).not.toMatch(/1[x×]24 jam kerja|BUKAN refund dana|Refund hanya jika stok/);
  });
});
