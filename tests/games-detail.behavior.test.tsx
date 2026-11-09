// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { GameClient } from "@/app/games/[slug]/game-client";
import { publicGamesGame, gamesRegistryGame } from "@/lib/games/registry";
import type { GamesDetail } from "@/lib/games/catalog";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
const detail: GamesDetail = { game: publicGamesGame(gamesRegistryGame("mobile-legends")!), products: [
  { buyer_sku_code: "a", name: "86 Diamond (77+8)", group: "bestseller", price: 12000, available: true, display_order: 1 },
  { buyer_sku_code: "b", name: "172 Diamond", group: "all", price: 24000, available: false, display_order: 2 },
] };
beforeEach(() => { vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} })); Element.prototype.scrollIntoView = vi.fn(); localStorage.clear(); navigation.push.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Games detail", () => {
  it("keeps a registered game's header without checkout or nickname requests when amounts are empty", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("games-id:mobile-legends", JSON.stringify({ userId: "123456", zoneId: "1234" }));
    render(<GameClient detail={{ ...detail, products: [] }} orderingOpen />);
    expect(screen.getByRole("heading", { name: "Mobile Legends", level: 1 })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Nominal segera tersedia");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Bayar|Pilih nominal/ })).toBeNull();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("validates both Mobile Legends IDs, folds amounts and preserves unavailable SKUs", () => {
    render(<GameClient detail={detail} orderingOpen={false} />);
    const fields = screen.getAllByRole("textbox");
    fireEvent.blur(fields[0]);
    expect(screen.getAllByText("Periksa format ID ini.")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Lihat semua (1)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Lihat semua (1)" }));
    expect(screen.getByRole("radio", { name: /172 Diamond/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByRole("button", { name: "Pemesanan segera dibuka" })).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/rating|ulasan/i);
  });
  it("filters by range and search", () => {
    render(<GameClient detail={detail} orderingOpen={false} />);
    fireEvent.click(screen.getByRole("button", { name: "100–500" }));
    expect(screen.queryByRole("radio", { name: /86 Diamond/ })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Cari nominal" }), { target: { value: "172" } });
    expect(screen.getByRole("button", { name: "Lihat semua (1)" })).toBeTruthy();
  });
  it("selects enabled amounts with arrow keys and space", () => {
    const data: GamesDetail = { ...detail, products: [...detail.products, { ...detail.products[0], buyer_sku_code: "c", name: "200 Diamond", group: "bestseller" }] };
    render(<GameClient detail={data} orderingOpen={false} />);
    const first = screen.getByRole("radio", { name: /86 Diamond/ }) as HTMLInputElement;
    first.focus(); fireEvent.keyDown(first, { key: " " });
    expect(first.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Lihat semua (1)" }));
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect((screen.getByRole("radio", { name: /200 Diamond/ }) as HTMLInputElement).checked).toBe(true);
  });
  it("loads server methods without contact and does not block on unavailable nickname", async () => {
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes("nickname") ? { status: "unavailable" } : { ok: true, quote_id: "fixture-id", quote_token: "signed", total: 12000, payable: 12000, currency: "IDR", locale: "id", game: { slug: "mobile-legends", name: "Mobile Legends", publisher: "Moonton" }, sku: { buyer_sku_code: "a", name: "86 Diamond (77+8)", price: 12000 }, paymentMethods: [{ id: "qris", kind: "qris", label: "QRIS", available: true }] } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<GameClient detail={detail} orderingOpen />);
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Zone ID"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("radio", { name: /86 Diamond/ }));
    await waitFor(() => expect(screen.getByText("Nickname belum bisa dicek, pastikan ID benar")).toBeTruthy());
    await waitFor(() => expect(within(document.getElementById("game-payment")!).getAllByText(/QRIS/).length).toBeGreaterThan(0));
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/games/quote")).toBe(true);
  });
  it.each(["free-fire", "pubg-mobile"])("validates %s ID and preview never quotes", async (slug) => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: false, json: async () => ({}) })); vi.stubGlobal("fetch", fetchMock);
    const data = { ...detail, game: publicGamesGame(gamesRegistryGame(slug)!) };
    render(<GameClient detail={data} orderingOpen={false} />);
    const input = screen.getByLabelText("Player ID");
    fireEvent.change(input, { target: { value: "123" } }); fireEvent.blur(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "12345678" } });
    expect(input.getAttribute("aria-invalid")).toBe("false");
    fireEvent.click(screen.getByRole("radio", { name: /86 Diamond/ }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 700)); });
    expect(fetchMock.mock.calls.every(([url]) => url !== "/api/games/quote" && url !== "/api/games/orders")).toBe(true);
  });
  it("reuses the same quote after an ambiguous order failure and locks in flight", async () => {
    let orderResolve: ((value: unknown) => void) | undefined;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("nickname")) return Promise.resolve({ ok: true, json: async () => ({ status: "unavailable" }) });
      if (url.includes("quote")) return Promise.resolve({ ok: true, json: async () => ({ ok: true, quote_id: "fixture-id", quote_token: "same-token", total: 12000, payable: 12000, currency: "IDR", locale: "id", game: { slug: "mobile-legends", name: "Mobile Legends", publisher: "Moonton" }, sku: { buyer_sku_code: "a", name: "86 Diamond (77+8)", price: 12000 }, paymentMethods: [{ id: "qris", kind: "qris", label: "QRIS", available: true }] }) });
      if (url.includes("orders")) return new Promise((resolve) => { orderResolve = resolve; });
      return Promise.reject(new Error(`unexpected ${url} ${init?.method}`));
    }); vi.stubGlobal("fetch", fetchMock);
    render(<GameClient detail={detail} orderingOpen />);
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Zone ID"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("radio", { name: /86 Diamond/ }));
    await waitFor(() => expect(within(document.getElementById("game-payment")!).getAllByText(/QRIS/).length).toBeGreaterThan(0));
    fireEvent.click(within(document.getElementById("game-payment")!).getByRole("radio"));
    fireEvent.change(screen.getByLabelText("Nomor WhatsApp"), { target: { value: "081234567890" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Bayar sekarang" })[0]);
    expect(screen.getAllByRole("button", { name: "Memproses…" })[0].hasAttribute("disabled")).toBe(true);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes("orders"))).toHaveLength(1);
    orderResolve!({ ok: false, status: 503, json: async () => ({ error: "temporary" }) });
    await screen.findByRole("alert");
    fireEvent.click(screen.getAllByRole("button", { name: "Bayar sekarang" })[0]);
    const requests = fetchMock.mock.calls.filter(([url]) => url.includes("orders"));
    expect(requests).toHaveLength(2);
    expect(requests[0][1]?.body).toBe(requests[1][1]?.body);
    orderResolve!({ ok: true, status: 201, json: async () => ({ code: "AXG-20261109-ABCDEFGH", status_url: "/games/pesanan/AXG-20261109-ABCDEFGH", status: "pending", total: 12000, qris: null, reused: false }) });
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/games/pesanan/AXG-20261109-ABCDEFGH"));
  });
  it("shows gateway total and reloads methods without reselecting an unavailable method", async () => {
    let quotes = 0;
    const options = [{ id: "qris", kind: "qris", label: "QRIS", available: true }, { id: "sekalipay_gateway:BANK", currency: "IDR", kind: "gateway", group: "va", label: "Bank Test", available: true, gateway: { channel: "BANK", idr_subtotal: 12000, estimated_fee: 2000, estimated_total: 14000 } }];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("nickname")) return { ok: true, status: 200, json: async () => ({ status: "unavailable" }) };
      if (url.includes("quote")) return { ok: true, status: 200, json: async () => ({ ok: true, quote_id: "fixture-id", quote_token: `token-${++quotes}`, total: 12000, payable: 12000, currency: "IDR", locale: "id", game: { slug: "mobile-legends", name: "Mobile Legends", publisher: "Moonton" }, sku: { buyer_sku_code: "a", name: "86 Diamond (77+8)", price: 12000 }, paymentMethods: options }) };
      return { ok: false, status: 503, json: async () => ({ error_code: "payment_method_unavailable", error: "Kanal sementara tutup" }) };
    }); vi.stubGlobal("fetch", fetchMock);
    render(<GameClient detail={detail} orderingOpen />);
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Zone ID"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("radio", { name: /86 Diamond/ }));
    const payment = document.getElementById("game-payment")!;
    await waitFor(() => expect(within(payment).getAllByText(/QRIS/).length).toBeGreaterThan(0));
    fireEvent.click(within(payment).getByRole("button", { name: /Virtual Account/i }));
    expect(within(payment).getByText(/14\.000/)).toBeTruthy();
    fireEvent.click(within(payment).getByRole("radio", { name: /Bank Test/i }));
    fireEvent.change(screen.getByLabelText("Nomor WhatsApp"), { target: { value: "081234567890" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Bayar sekarang" })[0]);
    expect((await screen.findByRole("alert")).textContent).toContain("Kanal sementara tutup");
    await waitFor(() => expect(quotes).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(within(payment).getByRole("button", { name: /Virtual Account/i })).toBeTruthy());
    fireEvent.click(within(payment).getByRole("button", { name: /Virtual Account/i }));
    expect((within(payment).getByRole("radio", { name: /Bank Test/i }) as HTMLInputElement).disabled).toBe(true);
    expect((within(payment).getByRole("radio", { name: /QRIS/i }) as HTMLInputElement).checked).toBe(false);
  });
});
