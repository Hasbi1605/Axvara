// @vitest-environment jsdom
// Phase 1 Market i18n: EN chrome for order page, category names, and home cards.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DisplayPreferencesProvider } from "@/hooks/useDisplayPrices";
import { CategoryPills } from "@/components/storefront/CategoryPills";
import { CommunityBar } from "@/components/storefront/CommunityBar";
import { ServicesMenu } from "@/components/shared/ServicesMenu";
import { CrossServicePromo } from "@/components/shared/CrossServicePromo";
import { marketCategoryName } from "@/lib/i18n/market-categories";
import OrderPage from "@/app/(shop)/pesanan/[code]/page";

const CODE = "AXV-20261107-I18N0001";
vi.mock("next/navigation", () => ({ useParams: () => ({ code: CODE }), usePathname: () => "/" }));

const future = () => new Date(Date.now() + 14 * 60_000).toISOString();
const qris = (expires = future()) => ({ payable_amount: 250_123, unique_code: 123, image_url: "/qris.png", expires_at: expires, status: "pending" });
const body = (extra: Record<string, unknown> = {}) => ({
  order: {
    code: CODE, customer_name: "Buyer", customer_wa: "0812****7890", customer_email: null,
    items: [{ name: "GPT Plus", price: 250_123, qty: 1 }], subtotal: 250_123,
    payment_method: "qris", status: "pending", locale: "en", expires_at: future(),
    qris: qris(), qris_reissue_allowed: false, buyer_pin_required: true, credentials_ready: false,
    ...extra,
  },
});
function stubOrder(payload: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } })));
}
const text = () => String(document.body.textContent ?? "").replace(/\s+/g, " ");

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("order page EN (order.locale)", () => {
  it("QRIS pending: compact heading + full QRIS chrome in English", async () => {
    stubOrder(body());
    render(<OrderPage />);
    expect(await screen.findByRole("heading", { name: "QRIS Payment" })).toBeTruthy();
    for (const label of ["Scan QRIS", "Amount to pay", "Includes unique code", "Valid for", "Pay exactly the total amount.", "Save QRIS", "Check payment", "Checked automatically — usually confirmed within 30 seconds of payment"]) {
      expect(text(), label).toContain(label);
    }
    expect(text()).not.toMatch(/Simpan QRIS|Cek Pembayaran|Total bayar/);
  });

  it("paid: English confirmation, badge, summary and footer chrome", async () => {
    stubOrder(body({ status: "lunas" }));
    render(<OrderPage />);
    expect(await screen.findByRole("heading", { name: "Payment Confirmed! 🎉" })).toBeTruthy();
    for (const label of ["Paid — Detected Automatically", "Payment for Buyer has been received", "Summary", "Total • QRIS", "Track Status", "Continue Shopping", "Need help?", "warranty claims", "eligible products only", "order PIN"]) {
      expect(text(), label).toContain(label);
    }
    expect(text()).not.toMatch(/Pembayaran Dikonfirmasi|Lunas — Terdeteksi|Ringkasan|Lacak Status/);
  });

  it("expired: English expired heading, badge and lead", async () => {
    stubOrder(body({ expires_at: new Date(Date.now() - 60_000).toISOString() }));
    render(<OrderPage />);
    expect(await screen.findByRole("heading", { name: "Order Expired" })).toBeTruthy();
    expect(text()).toContain("Expired");
    expect(text()).toContain("Do not pay the old QRIS");
    expect(text()).not.toMatch(/Pesanan Kedaluwarsa|Jangan bayar QRIS lama/);
  });

  it("access form before order known follows axv_locale", async () => {
    document.cookie = "axv_locale=en; Path=/";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reason: "access_required" }), { status: 404 })));
    render(<DisplayPreferencesProvider><OrderPage /></DisplayPreferencesProvider>);
    expect(await screen.findByRole("heading", { name: "Open your order" })).toBeTruthy();
    expect(text()).toContain("Checkout WhatsApp number or email");
    expect(text()).toContain("Open order");
    document.cookie = "axv_locale=; Max-Age=0; Path=/";
  });
});

describe("category names EN", () => {
  it("maps production slugs to English and keeps unknown slugs on DB name", () => {
    expect(marketCategoryName("ai-chatbot", "en")).toBe("AI & Chatbot");
    expect(marketCategoryName("streaming-hiburan", "en")).toBe("Streaming & Entertainment");
    expect(marketCategoryName("produktivitas-office", "en")).toBe("Productivity & Office");
    expect(marketCategoryName("desain-video", "en")).toBe("Design & Video");
    expect(marketCategoryName("developer-tools", "en")).toBe("Developer & Tools");
    expect(marketCategoryName("kategori-baru", "en", "Kategori Baru")).toBe("Kategori Baru");
    expect(marketCategoryName("kategori-baru", "id", "Kategori Baru")).toBe("Kategori Baru");
  });

  it("CategoryPills renders EN labels under axv_locale=en", async () => {
    document.cookie = "axv_locale=en; Path=/";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ categories: [
      { slug: "ai-chatbot", name: "AI & Chatbot" },
      { slug: "streaming-hiburan", name: "Streaming & Hiburan" },
    ] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    render(<DisplayPreferencesProvider><CategoryPills active="semua" onChange={() => {}} /></DisplayPreferencesProvider>);
    await waitFor(() => expect(text()).toContain("Streaming & Entertainment"));
    expect(text()).toContain("All");
    expect(text()).toContain("AI & Chatbot");
    expect(text()).not.toContain("Streaming & Hiburan");
    document.cookie = "axv_locale=; Max-Age=0; Path=/";
  });
});

describe("shared services menu / cross promo EN", () => {
  it("ServicesMenu and CrossServicePromo follow axv_locale even when the caller omits locale (Pedia navbar/cards)", async () => {
    document.cookie = "axv_locale=en; Path=/";
    render(<DisplayPreferencesProvider>
      <ServicesMenu active="market" />
      <CrossServicePromo current="pedia" />
    </DisplayPreferencesProvider>);
    await waitFor(() => expect(text()).toContain("Services"));
    fireEvent.click(screen.getByRole("button", { name: "AXVARA services" }));
    expect(text()).toContain("AXVARA Market");
    expect(text()).toContain("Premium apps and AI tools");
    expect(text()).toContain("AXVARA Pedia");
    expect(text()).toContain("Instant social boost");
    expect(text()).not.toMatch(/Layanan|Aplikasi dan tools premium|Boost sosmed instan/);
    document.cookie = "axv_locale=; Max-Age=0; Path=/";
  });
});

describe("home community cards EN", () => {
  it("Games + Pedia cards are English under axv_locale=en while ID stays Indonesian", async () => {
    document.cookie = "axv_locale=en; Path=/";
    const { unmount } = render(<DisplayPreferencesProvider><CommunityBar /></DisplayPreferencesProvider>);
    await waitFor(() => expect(text()).toContain("Instant social boost"));
    expect(text()).toContain("AXVARA Games");
    expect(text()).toContain("Instant game top-ups");
    expect(text()).not.toMatch(/Naikkan followers|Bot Telegram/);
    unmount();
    document.cookie = "axv_locale=; Max-Age=0; Path=/";
    render(<DisplayPreferencesProvider><CommunityBar /></DisplayPreferencesProvider>);
    await waitFor(() => expect(text()).toContain("Boost sosmed instan"));
    expect(text()).toContain("Top up game instan");
  });
});
