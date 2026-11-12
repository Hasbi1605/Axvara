// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { GameClient } from "@/app/games/[slug]/game-client";
import type { GamesDetail } from "@/lib/games/catalog";
import type { GamesSkContractField } from "@/lib/games/registry";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

const noteField: GamesSkContractField = { key: "note", label: "User ID", required: true, input: "text", min: 1, max: 50 };
const zoneField: GamesSkContractField = { key: "zone_id", label: "Zone ID", required: true, input: "text", min: 1, max: 20 };
const game: GamesDetail["game"] = { slug: "mobile-legends", name: "Mobile Legends", publisher: "Moonton", currency: "diamond", icon: null, banner: null, fields: [] };
const product = (over: Partial<GamesDetail["products"][number]>) => ({
  buyer_sku_code: "sk:1", name: "86 Diamond", group: "bestseller" as const, price: 12000, available: true,
  display_order: 1, fields: [noteField, zoneField], unsupported_reason: null, availability_reason: null,
  description: "Region ID only", product_type_name: "Membership", ...over,
});
const detail: GamesDetail = {
  game,
  products: [
    product({ buyer_sku_code: "sk:1", name: "86 Diamond", product_type_name: "Membership" }),
    product({ buyer_sku_code: "sk:2", name: "172 Diamond", group: "all", price: 24000, available: false, availability_reason: "stock_empty", description: "Stok kosong sementara" }),
    product({ buyer_sku_code: "sk:3", name: "86 Diamond", group: "all", price: 12000, product_type_name: "Region SG", description: "ALL REGION KECUALI MY/SG" }),
    product({ buyer_sku_code: "sk:4", name: "Open Denom", group: "all", price: 15000, available: false, availability_reason: "open_denom", fields: [], unsupported_reason: "open_denom" }),
  ],
};

const quoteResponse = (code = "sk:1") => ({
  ok: true,
  json: async () => ({
    ok: true, quote_id: "fixture-id", quote_token: "signed", total: 12000, payable: 12000, currency: "IDR", locale: "id",
    game: { slug: "mobile-legends", name: "Mobile Legends", publisher: "Moonton" },
    sku: { buyer_sku_code: code, name: "86 Diamond", price: 12000 },
    paymentMethods: [{ id: "qris", kind: "qris", label: "QRIS", available: true }],
  }),
});

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  navigation.push.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Games detail (selected SKU contract)", () => {
  it("uses intentional placeholders for null icon/banner (no empty img src)", () => {
    render(<GameClient detail={detail} orderingOpen={false} />);
    expect(document.querySelectorAll('img[src=""]').length).toBe(0);
    expect(screen.getAllByText("ML").length).toBeGreaterThan(0);
  });

  it("keeps the header without checkout/nickname requests when amounts are empty", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<GameClient detail={{ ...detail, products: [] }} orderingOpen />);
    expect(screen.getByRole("heading", { name: "Mobile Legends", level: 1 })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Nominal segera tersedia");
    expect(screen.queryByRole("textbox")).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("derives fields from the selected SKU, keeps every region/type variant distinct, and blocks unsupported rows", () => {
    render(<GameClient detail={detail} orderingOpen={false} />);
    // Kontrak varian pertama otomatis terpilih.
    expect(screen.getByLabelText("User ID")).toBeTruthy();
    expect(screen.getByLabelText("Zone ID")).toBeTruthy();
    expect(screen.getByText("Jenis: Membership")).toBeTruthy();
    expect(screen.getByText(/Region ID only/)).toBeTruthy();
    fireEvent.blur(screen.getByLabelText("User ID"));
    expect(screen.getAllByText("Periksa format ID ini.")).toHaveLength(2);

    // Nominal/nama sama tetap dua baris berbeda (region/type tidak digabung).
    expect(screen.getAllByRole("radio", { name: /86 Diamond/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Lihat semua (3)" }));
    expect(screen.getAllByRole("radio", { name: /86 Diamond/ })).toHaveLength(2);
    expect(screen.getByRole("radio", { name: /172 Diamond/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Stok habis")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Open Denom/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Belum didukung")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/rating|ulasan/i);
  });

  it("switching SKU invalidates stale target/quote/nickname and sends the new buyer_sku_code only", async () => {
    const second = product({ buyer_sku_code: "sk:3", name: "86 Diamond Region SG", group: "all", product_type_name: "Region SG", fields: [{ ...noteField, label: "Riot ID", max: 50 }], description: "Riot #tag supported" });
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("nickname")) return { ok: true, json: async () => ({ status: "unavailable" }) };
      if (url.includes("quote")) return quoteResponse();
      return { ok: false, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GameClient detail={{ ...detail, products: [product({ buyer_sku_code: "sk:1" }), second] }} orderingOpen />);
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "12345" } });
    fireEvent.change(screen.getByLabelText("Zone ID"), { target: { value: "6789" } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/games/quote")).toBe(true));
    const firstQuote = fetchMock.mock.calls.find(([url]) => url === "/api/games/quote")!;
    expect(JSON.parse(String((firstQuote[1] as RequestInit).body))).toMatchObject({ buyer_sku_code: "sk:1", fields: { note: "12345", zone_id: "6789" } });

    fireEvent.click(screen.getByRole("button", { name: "Lihat semua (1)" }));
    fireEvent.click(screen.getByRole("radio", { name: /Region SG/ }));
    expect(screen.getByLabelText("Riot ID")).toBeTruthy();
    expect(screen.queryByLabelText("Zone ID")).toBeNull();
    fireEvent.change(screen.getByLabelText("Riot ID"), { target: { value: "Player#SG" } });
    await waitFor(() => {
      const quotes = fetchMock.mock.calls.filter(([url]) => url === "/api/games/quote");
      const last = JSON.parse(String((quotes.at(-1)![1] as RequestInit).body));
      expect(last).toMatchObject({ buyer_sku_code: "sk:3", fields: { note: "Player#SG" } });
      expect(last.fields).not.toHaveProperty("zone_id");
    });
    await waitFor(() => {
      const bodies = fetchMock.mock.calls.filter(([url]) => url === "/api/games/nickname").map(([, init]) => JSON.parse(String((init as RequestInit).body)));
      expect(bodies.at(-1)).toMatchObject({ buyer_sku_code: "sk:3", fields: { note: "Player#SG" } });
      expect(bodies.at(-1).fields).not.toHaveProperty("zone_id");
    });
  });

  it("only restores saved IDs allowed by the selected contract", async () => {
    const noteOnly = product({ buyer_sku_code: "sk:9", fields: [{ ...noteField, label: "Riot ID" }], group: "all" });
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.includes("nickname") ? { ok: true, json: async () => ({ status: "unavailable" }) } : quoteResponse("sk:9"));
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("games-id:mobile-legends", JSON.stringify({ note: "Saved#One", zone_id: "9999", evil: "x" }));
    render(<GameClient detail={{ ...detail, products: [noteOnly] }} orderingOpen />);
    const input = (await screen.findByLabelText("Riot ID")) as HTMLInputElement;
    expect(input.value).toBe("Saved#One");
    await waitFor(() => {
      const bodies = fetchMock.mock.calls.filter(([url]) => url === "/api/games/nickname").map(([, init]) => JSON.parse(String((init as RequestInit).body)));
      expect(bodies.at(-1).fields).toEqual({ note: "Saved#One" });
    });
  });

  it("validates optional text fields and accepts Riot #tag/Unicode/named server", async () => {
    const optional = product({ buyer_sku_code: "sk:8", group: "all", fields: [{ ...zoneField, label: "Server", required: false, max: 20 }, { ...noteField, label: "Riot ID", max: 50 }] });
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.includes("nickname") ? { ok: true, json: async () => ({ status: "unavailable" }) } : quoteResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(<GameClient detail={{ ...detail, products: [optional] }} orderingOpen />);
    const server = screen.getByLabelText(/Server/);
    const riot = screen.getByLabelText("Riot ID");
    expect(server.getAttribute("inputmode")).toBe("text");
    fireEvent.change(riot, { target: { value: "Παίκτης#SG" } });
    expect(riot.getAttribute("aria-invalid")).toBe("false");
    fireEvent.change(riot, { target: { value: "bad\u0001id" } });
    expect(riot.getAttribute("aria-invalid")).toBe("false");
    fireEvent.blur(riot);
    expect(riot.getAttribute("aria-invalid")).toBe("true");
    // Optional kosong tidak memblokir.
    fireEvent.change(riot, { target: { value: "Player#SG" } });
    fireEvent.blur(server);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/games/quote")).toBe(true));
  });

  it("filters by range/search without collapsing equal nominal variants", () => {
    render(<GameClient detail={detail} orderingOpen={false} />);
    fireEvent.click(screen.getByRole("button", { name: "100–500" }));
    expect(screen.queryByRole("radio", { name: /86 Diamond/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Semua" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Cari nominal" }), { target: { value: "Open" } });
    fireEvent.click(screen.getByRole("button", { name: "Lihat semua (1)" }));
    expect(screen.getByRole("radio", { name: /Open Denom/ }).hasAttribute("disabled")).toBe(true);
  });

  it("loads payment methods without contact and does not block on unavailable nickname", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.includes("nickname") ? { ok: true, json: async () => ({ status: "unavailable" }) } : quoteResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(<GameClient detail={detail} orderingOpen />);
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Zone ID"), { target: { value: "1234" } });
    await waitFor(() => expect(screen.getByText("Nickname belum bisa dicek, pastikan ID benar")).toBeTruthy());
    await waitFor(() => expect(within(document.getElementById("game-payment")!).getAllByText(/QRIS/).length).toBeGreaterThan(0));
    const nicknameBody = fetchMock.mock.calls.filter(([url]) => url === "/api/games/nickname").map(([, init]) => JSON.parse(String((init as RequestInit).body))).at(-1);
    expect(nicknameBody).toMatchObject({ buyer_sku_code: "sk:1", fields: { note: "123456", zone_id: "1234" } });
  });

  it("preview never quotes or orders", async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: false, json: async () => ({}) })); vi.stubGlobal("fetch", fetchMock);
    render(<GameClient detail={detail} orderingOpen={false} />);
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "12345678" } });
    fireEvent.change(screen.getByLabelText("Zone ID"), { target: { value: "2001" } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 700)); });
    expect(fetchMock.mock.calls.every(([url]) => url !== "/api/games/quote" && url !== "/api/games/orders")).toBe(true);
  });

  it("reuses the same quote after an ambiguous order failure and locks in flight", async () => {
    let orderResolve: ((value: unknown) => void) | undefined;
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url.includes("nickname")) return Promise.resolve({ ok: true, json: async () => ({ status: "unavailable" }) });
      if (url.includes("quote")) return Promise.resolve(quoteResponse());
      if (url.includes("orders")) return new Promise((resolve) => { orderResolve = resolve; });
      return Promise.reject(new Error(`unexpected ${url}`));
    }); vi.stubGlobal("fetch", fetchMock);
    render(<GameClient detail={detail} orderingOpen />);
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Zone ID"), { target: { value: "1234" } });
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
    orderResolve!({ ok: true, status: 201, json: async () => ({ code: "AXG-20261112-ABCDEFGH", status_url: "/games/pesanan/AXG-20261112-ABCDEFGH", status: "pending", total: 12000, qris: null, reused: false }) });
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/games/pesanan/AXG-20261112-ABCDEFGH"));
  });

  it("shows gateway total and reloads methods without reselecting an unavailable method", async () => {
    let quotes = 0;
    const options = [{ id: "qris", kind: "qris", label: "QRIS", available: true }, { id: "sekalipay_gateway:BANK", currency: "IDR", kind: "gateway", group: "va", label: "Bank Test", available: true, gateway: { channel: "BANK", idr_subtotal: 12000, estimated_fee: 2000, estimated_total: 14000 } }];
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("nickname")) return { ok: true, status: 200, json: async () => ({ status: "unavailable" }) };
      if (url.includes("quote")) return { ok: true, status: 200, json: async () => ({ ...(await quoteResponse().json()), quote_token: `token-${++quotes}`, paymentMethods: options }) };
      return { ok: false, status: 503, json: async () => ({ error_code: "payment_method_unavailable", error: "Kanal sementara tutup" }) };
    }); vi.stubGlobal("fetch", fetchMock);
    render(<GameClient detail={detail} orderingOpen />);
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Zone ID"), { target: { value: "1234" } });
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
