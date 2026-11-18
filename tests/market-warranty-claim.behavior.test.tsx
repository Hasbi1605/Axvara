// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrderStatusPage from "@/app/(shop)/pesanan/[code]/page";
import LacakPesananClient from "@/app/(shop)/lacak-pesanan/lacak-pesanan-client";
import RefundPage from "@/app/(shop)/kalkulator-refund/page";
import { forgetBuyerAccessSession, forgetCheckoutCredentialGrant, forgetOrderContact, rememberBuyerAccessSession, rememberCheckoutCredentialGrant, rememberOrderContact } from "@/lib/order-access-client";
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
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  forgetBuyerAccessSession(CODE); forgetCheckoutCredentialGrant(CODE); forgetOrderContact(CODE);
});

const items = [{ name: "Produk Market A", price: 10000, qty: 1 }, { name: "Produk Market B", price: 15000, qty: 1 }];
function stubOrder(overrides: Record<string, unknown> = {}) {
  const order = {
    code: CODE, customer_name: "Pembeli", customer_wa: "081234567890", customer_email: "buyer@example.test",
    items, subtotal: 25000, payment_method: "qris", status: "lunas", buyer_pin_required: false, credentials_ready: true,
    fulfillment_status: "delivered", ...overrides,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true, status: 200, json: async () => String(url).includes("/credentials")
      ? { credentials: items.map(item => ({
        label: item.name, details: "Email: akun@example.test", completed_at: null,
        terms: { sections: [{ kind: "aturan", items: ["Gunakan sesuai paket."] }], activation: [{ title: "Aktivasi", steps: ["Masuk ke akun."] }], notes: [] },
      })), capability_token: null }
      : { order: String(url).includes("/lookup") ? { ...order, items: JSON.stringify(items) } : order },
  })));
}

function expectPolicy(container: HTMLElement, size: "sm" | "xs" = "xs") {
  const ui = within(container);
  if (size === "xs") {
    const intro = ui.getByText("Ajukan klaim selama garansi masih berlaku. Sertakan invoice dan screenshot kendala.");
    expect(intro.parentElement!.classList.contains("text-xs")).toBe(true);
    expect(intro.parentElement!.classList.contains("leading-relaxed")).toBe(true);
    expect(Array.from(intro.parentElement!.children, node => node.tagName)).toEqual(["P", "UL", "P"]);
    expect(ui.getAllByRole("listitem").map(item => item.textContent)).toEqual([
      "Proses garansi 1–3 hari, tergantung antrean, stok akun pengganti, atau gangguan dari pihak terkait.",
      "Jika klaim memenuhi syarat dan kendala belum teratasi setelah 3 hari, kami akan mengembalikan dana sesuai nilai sisa masa aktif produk saat laporan diterima.",
    ]);
    expect(intro.parentElement!.lastElementChild?.textContent).toBe("Contoh: Paket Rp30.000 untuk 30 hari, sisa 20 hari → estimasi refund Rp20.000.");
    return;
  }
  const eligibility = ui.getByText("pengajuan garansi hanya untuk produk bergaransi");
  expect(eligibility.parentElement!.classList.contains("text-sm")).toBe(true);
  expect(eligibility.parentElement!.classList.contains("leading-6")).toBe(true);
  for (const text of [...marketWarrantyClaim.requirements, ...marketWarrantyClaim.notes, marketWarrantyClaim.closing]) {
    expect(ui.getByText(text)).toBeTruthy();
  }
  expect(container.textContent).not.toMatch(/1[x×]24 jam kerja|BUKAN refund dana|Refund hanya jika stok/);
}

function expectAccountWarranty() {
  const account = screen.getByRole("region", { name: "Detail akun digital" });
  const buttons = within(account).getAllByRole("button");
  expect(buttons.map(button => button.textContent)).toEqual([
    "Salin akun 1", "Salin akun 2", "Syarat & Ketentuan", "Cara Penggunaan / Aktivasi",
    "Syarat klaim garansi",
  ]);
  // Garansi tetap satu per pesanan, setelah panduan terakhir dan sebelum catatan simpan.
  const warranty = within(account).getByRole("button", { name: "Syarat klaim garansi" });
  expect(screen.getAllByRole("button", { name: "Syarat klaim garansi" })).toHaveLength(1);
  expect(warranty.className).toBe(within(account).getByRole("button", { name: "Syarat & Ketentuan" }).className);
  expect(warranty.parentElement!.className).toBe(within(account).getByRole("button", { name: "Syarat & Ketentuan" }).parentElement!.className);
  expect(warranty.compareDocumentPosition(within(account).getByText(/Simpan detail ini/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  return warranty;
}

describe("Market warranty claim guidance", () => {
  it.each([
    ["stok sendiri", {}],
    ["WR", { supplier_owned: true }],
    ["SK", { supplier_owned: true, instant_delivery: true }],
    ["manual", { buyer_pin_required: false, credentials_ready: false, queued_delivery: true }],
    ["supplier masih berjalan", { buyer_pin_required: false, credentials_ready: false, supplier_owned: true, supplier_running: true }],
    ["pengiriman gagal", { buyer_pin_required: false, credentials_ready: false, fulfillment_status: "failed" }],
  ])("shows one collapsed claim accordion inside the account card or below delivery for paid %s orders", async (_kind, overrides) => {
    stubOrder(overrides as Record<string, unknown>);
    sessionStorage.setItem(`axvara-checkout-contact:${CODE}`, "buyer@example.test");
    render(<OrderStatusPage />);
    if ((overrides as Record<string, unknown>).credentials_ready !== false) {
      await screen.findByRole("region", { name: "Detail akun digital" });
      expectAccountWarranty();
    }
    const button = await screen.findByRole("button", { name: "Syarat klaim garansi" });
    expect(screen.getAllByRole("button", { name: "Syarat klaim garansi" })).toHaveLength(1);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(button.getAttribute("aria-controls")!);
    expect(panel?.hidden).toBe(true);
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expectPolicy(screen.getByRole("region", { name: "Syarat klaim garansi" }));
  });

  it.each(["pending", "cancelled", "expired"])("does not show the post-payment accordion for %s orders", async (status) => {
    stubOrder({ status, buyer_pin_required: false, credentials_ready: false, expires_at: new Date(Date.now() + 600000).toISOString() });
    render(<OrderStatusPage />);
    await screen.findByText("Ringkasan");
    expect(screen.queryByRole("button", { name: "Syarat klaim garansi" })).toBeNull();
  });

  it("also nests the accordion after activation inside the verified tracking account card", async () => {
    nav.params = new URLSearchParams({ code: CODE, email: "buyer@example.test" });
    stubOrder();
    render(<LacakPesananClient />);
    await screen.findByRole("region", { name: "Detail akun digital" });
    const button = expectAccountWarranty();
    fireEvent.click(button);
    expectPolicy(screen.getByRole("region", { name: "Syarat klaim garansi" }));
  });

  it("keeps one warranty accordion inside the account card before contact verification", async () => {
    stubOrder({ buyer_pin_required: true });
    render(<OrderStatusPage />);
    const account = await screen.findByRole("region", { name: "Ambil detail akun" });
    const button = within(account).getByRole("button", { name: "Syarat klaim garansi" });
    expect(screen.getAllByRole("button", { name: "Syarat klaim garansi" })).toHaveLength(1);
    fireEvent.click(button);
    expectPolicy(within(account).getByRole("region", { name: "Syarat klaim garansi" }));
  });

  it.each([
    [false, "id", "Syarat klaim garansi", "Cek Estimasi Refund", "/kalkulator-refund"],
    [false, "en", "Warranty claim terms", "Check refund estimate", "/kalkulator-refund"],
    [true, "id", "Syarat klaim garansi", "Hitung Refund", "/admin/refund"],
  ] as const)("keeps the invoice link inside the accordion (admin: %s, locale: %s)", (adminView, locale, title, label, path) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<WarrantyClaimAccordion code={CODE} adminView={adminView} locale={locale} />);
    expect(screen.queryByRole("link", { name: label })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: title }));
    const panel = within(screen.getByRole("region", { name: title }));
    const link = panel.getByRole("link", { name: label });
    expect(link.getAttribute("href")).toBe(`${path}?code=${CODE}`);
    expect(link.hasAttribute("aria-expanded")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
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
    expectPolicy(heading.parentElement!, "sm");
    expect(document.body.textContent).not.toMatch(/1[x×]24 jam kerja|BUKAN refund dana|Refund hanya jika stok/);
  });
});

const estimate = {
  state: "ready", asOf: 1794864000,
  lines: [{ id: 0, name: "Paket Demo 30 Hari", qty: 1, status: "ready", duration: 2592000, remaining: 1728000, amount: 20000, price: 30000, rate: 10000 }],
};
const refundPage = (code?: string | string[]) => RefundPage({ searchParams: Promise.resolve({ code }) });

describe("Buyer calculator deep link", () => {
  it.each(["status", "checkout"])("automatically loads the products using the existing %s proof", async (proof) => {
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const sig = "a".repeat(43);
    const headers = proof === "status"
      ? { "x-order-contact": "buyer@example.test", "x-buyer-access-session": `p1.${expiry}.${sig}` }
      : { "x-checkout-credential-grant": `c1.${expiry}.${sig}` };
    if (proof === "status") {
      rememberOrderContact(CODE, headers["x-order-contact"]);
      rememberBuyerAccessSession(CODE, headers["x-buyer-access-session"]);
    } else rememberCheckoutCredentialGrant(CODE, headers["x-checkout-credential-grant"]);
    const fetch = vi.fn(async () => Response.json({ estimate, locale: "id" }));
    vi.stubGlobal("fetch", fetch);
    render(await refundPage(CODE.toLowerCase()));
    expect(screen.getByRole("button", { name: "Dari Pesanan", pressed: true })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Memuat…");
    expect(await screen.findByText("Paket Demo 30 Hari")).toBeTruthy();
    expect(screen.getByText("20 hari", { selector: "p" })).toBeTruthy();
    expect(screen.getAllByText("Rp20.000").length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/refund", expect.objectContaining({
      method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ code: CODE }),
    }));
  });

  it("offers tracking with the invoice prefilled when access is denied", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "access" }, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    render(await refundPage(CODE));
    expect((await screen.findByRole("alert")).textContent).toBe("Verifikasi pesanan untuk melihat estimasi.");
    expect(screen.getByRole("link", { name: "Lacak Pesanan" }).getAttribute("href")).toBe(`/lacak-pesanan?code=${CODE}`);
    expect(screen.queryByText("Paket Demo 30 Hari")).toBeNull();
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/refund", expect.objectContaining({
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: CODE }),
    }));
  });

  it("can retry a temporary error and still access the manual modes", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ estimate }));
    vi.stubGlobal("fetch", fetch);
    render(await refundPage(CODE));
    fireEvent.click(await screen.findByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("Paket Demo 30 Hari")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Simulasi Refund" }));
    expect(screen.getByLabelText("Harga produk (Rp)")).toBeTruthy();
  });

  it.each([[undefined], ["AXP-20261015-CLAIM001"], [[CODE, CODE]]])("defaults to the manual calculator without a single valid Market invoice (%s)", async (code) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(await refundPage(code));
    expect(screen.getByRole("button", { name: "Hitung Sisa Hari", pressed: true })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dari Pesanan" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
