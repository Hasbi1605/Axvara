// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GameStatus } from "@/app/games/pesanan/[code]/status-client";
import { GamesTrack } from "@/app/games/lacak/track-client";
import { GamesInformation } from "@/components/games/GamesInformation";
import { DisplayPreferencesProvider } from "@/hooks/useDisplayPrices";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("@/hooks/usePaymentConsent", () => ({ usePaymentConsent: () => ({ busy: false, error: null, stale: false, approve: vi.fn() }) }));
const code = "AXG-20261109-ABCDEFGH";
const order = { code, game: { slug: "free-fire", name: "Free Fire" }, product_name: "140 Diamond", customer_no: "12345678", customer_nickname: null, total: 20000, payment_method: "qris", sn: "SN123", supplier_message: null, payment: null, qris: null };
beforeEach(() => { sessionStorage.clear(); nav.push.mockClear(); vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.cookie = "axv_locale=; max-age=0; path=/"; });

describe("Games status and help", () => {
  it.each([["awaiting_payment", "Selesaikan pembayaran"], ["processing", "Top up sedang diproses"], ["success", "Top up berhasil"], ["needs_admin", "Perlu pengecekan admin"], ["expired", "Pesanan kedaluwarsa"]])("renders honest %s status", async (status, title) => {
    sessionStorage.setItem(`axp-contact:${code}`, JSON.stringify({ contact: "buyer@example.com", until: Date.now() + 10000 }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ order: { ...order, games_status: status } }) })));
    render(<GameStatus code={code} />);
    expect(await screen.findByRole("heading", { name: new RegExp(title) })).toBeTruthy();
    expect(Boolean(screen.queryByText("SN123"))).toBe(status === "success");
  });
  it("copies success SN and does not schedule terminal polling", async () => {
    sessionStorage.setItem(`axp-contact:${code}`, JSON.stringify({ contact: "buyer@example.com", until: Date.now() + 10000 }));
    const copy = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    const intervals = vi.spyOn(window, "setInterval");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ order: { ...order, games_status: "success" } }) })));
    render(<GameStatus code={code} />); await screen.findByText("SN123");
    fireEvent.click(screen.getByRole("button", { name: "Salin" }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith("SN123")); expect(intervals.mock.calls.filter((call) => Number(call[1]) >= 1000)).toHaveLength(0); intervals.mockRestore();
  });
  it("asks for contact and reports wrong contact", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    render(<GameStatus code="AXG-20261109-WRONG123" />);
    fireEvent.change(await screen.findByLabelText("WhatsApp atau email"), { target: { value: "wrong@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Lacak pesanan" }));
    expect((await screen.findByRole("alert")).textContent).toContain("tidak ditemukan");
  });
  it("shows countdown, WIB deadline, QRIS label and never marks success early", async () => {
    sessionStorage.setItem(`axp-contact:${code}`, JSON.stringify({ contact: "buyer@example.com", until: Date.now() + 10000 }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ order: { ...order, games_status: "awaiting_payment", qris: { image_url: "/qris", payable_amount: 20123, unique_code: 123, expires_at: "2099-11-09T14:45:00Z", status: "pending" } } }) })));
    render(<GameStatus code={code} />);
    expect(await screen.findByRole("heading", { name: "Selesaikan pembayaran" })).toBeTruthy();
    expect(screen.getByText(/^Berlaku/)).toBeTruthy();
    expect(screen.getAllByText("Rp 20.123").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Cek Pembayaran" })).toBeTruthy();
    expect(screen.getByText("QRIS", { selector: "dd" })).toBeTruthy();
    expect(screen.queryByText("Top up berhasil")).toBeNull();
    expect(screen.queryByRole("button", { name: "Perbarui status" })).toBeNull();
  });
  it("shows human payment label and support link with code", async () => {
    sessionStorage.setItem(`axp-contact:${code}`, JSON.stringify({ contact: "buyer@example.com", until: Date.now() + 10000 }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ order: { ...order, games_status: "needs_admin", payment_method: "gateway:DANA", payment: { kind: "gateway", state: "pending", label: "DANA Realtime", channel: "DANA", subtotal: 20000 } } }) })));
    render(<GameStatus code={code} />);
    expect(await screen.findByText("DANA", { selector: "dd" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Hubungi admin via WhatsApp" }).getAttribute("href")).toContain(code);
  });
  it("shows the crypto asset and its network", async () => {
    sessionStorage.setItem(`axp-contact:${code}`, JSON.stringify({ contact: "buyer@example.com", until: Date.now() + 10000 }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ order: { ...order, games_status: "success", payment_method: "nowpayments:usdtbsc", payment: { kind: "crypto", state: "paid", label: "USDT", symbol: "USDT", network_label: "BSC" } } }) })));
    render(<GameStatus code={code} />);
    expect(await screen.findByText("USDT (BSC)", { selector: "dd" })).toBeTruthy();
  });
  it("validates and redirects lookup without placing contact in URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ order }) })));
    render(<GamesTrack />); fireEvent.click(screen.getByRole("button", { name: "Lacak pesanan" }));
    expect(screen.getByText("Format kode pesanan tidak valid.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Kode pesanan AXG"), { target: { value: code } });
    fireEvent.change(screen.getByLabelText("WhatsApp atau email"), { target: { value: "buyer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Lacak pesanan" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/games/pesanan/${code}`));
    expect(String((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).not.toContain("buyer@example.com");
    expect(JSON.parse(localStorage.getItem("axg-track-recent") || "[]")[0].code).toBe(code);
  });
  it("remembers opened orders and lists them under Orders on this device", async () => {
    localStorage.clear();
    sessionStorage.setItem(`axp-contact:${code}`, JSON.stringify({ contact: "buyer@example.com", until: Date.now() + 10000 }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ order: { ...order, games_status: "processing", paid_at: "2026-11-16T13:17:36Z" } }) })));
    render(<GameStatus code={code} />);
    expect(await screen.findByRole("heading", { name: "Top up sedang diproses" })).toBeTruthy();
    expect(screen.getByText("Dibayar 16 Nov 2026, 20.17 WIB")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Perbarui status" })).toBeTruthy();
    cleanup();
    render(<GamesTrack />);
    const link = await screen.findByRole("link", { name: /Free Fire — 140 Diamond/ });
    expect(link.getAttribute("href")).toBe(`/games/pesanan/${code}`);
    expect(screen.getByText("Pesanan di perangkat ini")).toBeTruthy();
  });
  it("keeps the paid QRIS amount (with unique code) as total after payment", async () => {
    sessionStorage.setItem(`axp-contact:${code}`, JSON.stringify({ contact: "buyer@example.com", until: Date.now() + 10000 }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ order: { ...order, total: 15600, games_status: "success", qris: { image_url: "/qris", payable_amount: 15657, unique_code: 57, expires_at: "2026-11-16T13:31:31Z", status: "paid" } } }) })));
    render(<GameStatus code={code} />);
    expect(await screen.findByText("Rp 15.657")).toBeTruthy();
    expect(screen.queryByText("Rp 15.600")).toBeNull();
  });
  it("renders help and terms in English from cookie", async () => {
    document.cookie = "axv_locale=en; path=/";
    const rendered = render(<DisplayPreferencesProvider><GamesInformation kind="help" /></DisplayPreferencesProvider>);
    expect(await screen.findByRole("heading", { name: "Games help" })).toBeTruthy();
    rendered.rerender(<DisplayPreferencesProvider><GamesInformation kind="terms" /></DisplayPreferencesProvider>);
    expect(screen.getByRole("heading", { name: "Games terms" })).toBeTruthy();
  });
});
