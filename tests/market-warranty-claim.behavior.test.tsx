// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrderStatusPage from "@/app/(shop)/pesanan/[code]/page";
import LacakPesananClient from "@/app/(shop)/lacak-pesanan/lacak-pesanan-client";
import RefundPage from "@/app/(shop)/kalkulator-refund/page";
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
});

const items = [{ name: "Produk Market A", price: 10000, qty: 1 }, { name: "Produk Market B", price: 15000, qty: 1 }];
function stubOrder(overrides: Record<string, unknown> = {}) {
  const order = {
    code: CODE, customer_name: "Pembeli", customer_wa: "081234567890", customer_email: "buyer@example.test",
    items, subtotal: 25000, payment_method: "qris", status: "lunas", buyer_pin_required: false, credentials_ready: true,
    fulfillment_status: "delivered", ...overrides,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => String(init?.body ?? "").includes('"device"') ? ({
    ok: false, status: 404, json: async () => ({ error: "device_unrecognized" }),
  }) : ({
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

const WARRANTY_ACCORDION_ID = "Syarat klaim garansi (khusus produk bergaransi)";
const WARRANTY_ACCORDION_EN = "Warranty claim terms (eligible products only)";

function expectAccountWarranty() {
  const account = screen.getByRole("region", { name: "Detail akun digital" });
  const buttons = within(account).getAllByRole("button");
  expect(buttons.map(button => button.textContent)).toEqual([
    "Salin akun 1", "Salin akun 2", "Cara Penggunaan / Aktivasi", "Syarat & Ketentuan",
    WARRANTY_ACCORDION_ID,
  ]);
  // Garansi tetap satu per pesanan, setelah panduan terakhir dan sebelum catatan simpan.
  const warranty = within(account).getByRole("button", { name: WARRANTY_ACCORDION_ID });
  expect(screen.getAllByRole("button", { name: WARRANTY_ACCORDION_ID })).toHaveLength(1);
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
    const button = await screen.findByRole("button", { name: WARRANTY_ACCORDION_ID });
    expect(screen.getAllByRole("button", { name: WARRANTY_ACCORDION_ID })).toHaveLength(1);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(button.getAttribute("aria-controls")!);
    expect(panel?.hidden).toBe(true);
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expectPolicy(screen.getByRole("region", { name: WARRANTY_ACCORDION_ID }));
  });

  it.each(["pending", "cancelled", "expired"])("does not show the post-payment accordion for %s orders", async (status) => {
    stubOrder({ status, buyer_pin_required: false, credentials_ready: false, expires_at: new Date(Date.now() + 600000).toISOString() });
    render(<OrderStatusPage />);
    await screen.findByText("Ringkasan");
    expect(screen.queryByRole("button", { name: WARRANTY_ACCORDION_ID })).toBeNull();
  });

  it("also nests the accordion after activation inside the verified tracking account card", async () => {
    nav.params = new URLSearchParams({ code: CODE, email: "buyer@example.test" });
    stubOrder();
    render(<LacakPesananClient />);
    await screen.findByRole("region", { name: "Detail akun digital" });
    const button = expectAccountWarranty();
    fireEvent.click(button);
    expectPolicy(screen.getByRole("region", { name: WARRANTY_ACCORDION_ID }));
  });

  it("keeps one warranty accordion inside the account card before contact verification", async () => {
    stubOrder({ buyer_pin_required: true });
    render(<OrderStatusPage />);
    const account = await screen.findByRole("region", { name: "Ambil detail akun" });
    const button = within(account).getByRole("button", { name: WARRANTY_ACCORDION_ID });
    expect(screen.getAllByRole("button", { name: WARRANTY_ACCORDION_ID })).toHaveLength(1);
    fireEvent.click(button);
    expectPolicy(within(account).getByRole("region", { name: WARRANTY_ACCORDION_ID }));
  });

  it.each([
    [false, "id", WARRANTY_ACCORDION_ID, "Cek Estimasi Refund", "/kalkulator-refund"],
    [false, "en", WARRANTY_ACCORDION_EN, "Check refund estimate", "/kalkulator-refund"],
    [true, "id", WARRANTY_ACCORDION_ID, "Hitung Refund", "/admin/refund"],
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
    const button = screen.getByRole("button", { name: WARRANTY_ACCORDION_ID });
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard("{Enter}");
    expectPolicy(screen.getByRole("region", { name: WARRANTY_ACCORDION_ID }));
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
  lines: [{ id: 0, name: "Paket Demo 30 Hari", qty: 1, status: "ready", duration: 2592000, remaining: 1728000, amount: 20000, price: 30000, rate: 10000,
    start: 1794000000, end: 1796592000, warrantyEnd: 1796592000, claim: 1794864000 }],
};
const refundPage = (code?: string | string[]) => RefundPage({ searchParams: Promise.resolve({ code }) });

function expectVisibleEstimate(container: HTMLElement) {
  const card = within(screen.getByText("Paket Demo 30 Hari").closest("li")!);
  for (const [label, value] of [["Harga produk", "Rp30.000"], ["Durasi paket", "30 hari"], ["Sisa masa aktif", "20 hari"], ["Rate refund", "100%"]]) {
    expect(card.getByText(label, { selector: "dt" }).nextElementSibling?.textContent).toBe(value);
  }
  for (const label of ["Mulai", "Berakhir", "Garansi hingga", "Laporan diterima"]) {
    expect(card.getByText(label, { selector: "dt" }).nextElementSibling?.textContent).toContain("WIB");
  }
  expect(card.getByText("Rp20.000")).toBeTruthy();
  expect(container.querySelector("details")).toBeNull();
}

const publicRequest = (invoice = CODE) => expect.objectContaining({
  method: "POST", cache: "no-store", credentials: "omit", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: invoice }),
});

describe("Buyer refund invoice lookup", () => {
  it("loads a deep-linked invoice automatically without buyer proof", async () => {
    const fetch = vi.fn(async () => Response.json({ estimate, locale: "id" }));
    vi.stubGlobal("fetch", fetch);
    const { container } = render(await refundPage(CODE.toLowerCase()));
    expect(screen.getByRole("button", { name: "Dari Pesanan", pressed: true })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Memuat…");
    await screen.findByText("Paket Demo 30 Hari");
    expectVisibleEstimate(container);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/refund", publicRequest());
  });

  it("accepts a typed invoice as the only input, with no verification step", async () => {
    const fetch = vi.fn(async () => Response.json({ estimate }));
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    const { container } = render(await refundPage());
    expect(fetch).not.toHaveBeenCalled();
    const code = screen.getByRole("textbox", { name: "Nomor invoice AXVARA" });
    await user.type(code, ` ${CODE.toLowerCase()} {Enter}`);
    await screen.findByText("Paket Demo 30 Hari");
    expect(screen.getAllByRole("textbox")).toEqual([code]);
    expectVisibleEstimate(container);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/refund", publicRequest());
    await user.click(screen.getByRole("button", { name: "Simulasi Refund" }));
    expect(screen.getByLabelText("Harga produk (Rp)")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Dari Pesanan" }));
    expect(screen.getByText("Paket Demo 30 Hari")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("handles missing invoices and clears the previous result when editing", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ estimate }))
      .mockResolvedValueOnce(Response.json({ error: "not_found" }, { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    render(await refundPage(CODE));
    await screen.findByText("Paket Demo 30 Hari");
    const unknown = "AXV-20261015-UNKNOWN1";
    fireEvent.change(screen.getByLabelText("Nomor invoice AXVARA"), { target: { value: unknown } });
    expect(screen.queryByText("Paket Demo 30 Hari")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cek Invoice" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Invoice Market tidak ditemukan. Cek lagi nomornya.");
    expect(fetch).toHaveBeenLastCalledWith("/api/refund", publicRequest(unknown));
  });

  it("can retry a temporary error without reentering the invoice", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ estimate }));
    vi.stubGlobal("fetch", fetch);
    render(await refundPage(CODE));
    fireEvent.click(await screen.findByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("Paket Demo 30 Hari")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([[undefined], ["AXP-20261015-CLAIM001"], [[CODE, CODE]]])("renders an empty invoice lookup without a single valid Market invoice (%s)", async (code) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(await refundPage(code));
    expect(screen.getByRole("button", { name: "Dari Pesanan", pressed: true })).toBeTruthy();
    const input = screen.getByRole("textbox", { name: "Nomor invoice AXVARA" });
    expect(input.getAttribute("value")).toBe("");
    fireEvent.change(input, { target: { value: "not an invoice" } });
    fireEvent.click(screen.getByRole("button", { name: "Cek Invoice" }));
    expect(screen.getByRole("alert").textContent).toBe("Masukkan nomor invoice AXV yang valid.");
    expect(fetch).not.toHaveBeenCalled();
  });
});
