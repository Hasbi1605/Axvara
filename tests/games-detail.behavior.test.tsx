// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { GameClient } from "@/app/games/[slug]/game-client";
import { ItemIcon } from "@/components/games/detail/ItemIcon";
import type { GamesDetail, GamesDetailGame, GamesDetailProduct } from "@/lib/games/catalog";
import type { GamesSkContractField } from "@/lib/games/registry";
import { gamesEffectiveCategory, gamesRegionCode, gamesTypeLabel } from "@/lib/games/variant-kind";
import { DisplayPreferencesProvider } from "@/hooks/useDisplayPrices";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

const noteField: GamesSkContractField = { key: "note", label: "User ID", required: true, input: "text", min: 1, max: 50 };
const zoneField: GamesSkContractField = { key: "zone_id", label: "Zone ID", required: true, input: "text", min: 1, max: 20 };
const game: GamesDetail["game"] = { slug: "mobile-legends", name: "Mobile Legends", publisher: "Moonton", currency: "diamond", icon: null, banner: null, fields: [], description: "", id_guide: "" };
// Integration (PM): derive B6 fields with the real G-BE helpers unless a test overrides them.
const product = (over: Partial<GamesDetailProduct>): GamesDetailProduct => {
  const base = {
    buyer_sku_code: "sk:1", name: "86 Diamond", group: "all" as const, price: 12000, available: true,
    display_order: 1, fields: [noteField, zoneField], unsupported_reason: null, availability_reason: null,
    description: "Region ID only", product_type_name: "Membership", ...over,
  };
  return {
    type_label: gamesTypeLabel(base.product_type_name),
    region_code: gamesRegionCode(base.product_type_name),
    category: gamesEffectiveCategory({ displayGroup: base.group, productName: base.name, productTypeName: base.product_type_name }),
    validation_available: true,
    ...base,
  };
};
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
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  navigation.push.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.cookie = "axv_locale=; max-age=0; path=/"; });

describe("Games detail (selected SKU contract)", () => {
  it("uses image protection for header/rail and translated metadata guidance and CTA", async () => {
    document.cookie = "axv_locale=en; path=/";
    const metadata: GamesDetailGame = { ...game, icon: "/brand/games/free-fire-icon.webp", banner: "/brand/games/mobile-legends-banner.webp", description: "Play together.", id_guide: "Use your profile ID and zone." };
    render(<DisplayPreferencesProvider><GameClient detail={{ game: metadata, products: detail.products }} orderingOpen /></DisplayPreferencesProvider>);
    expect(await screen.findByText("Use your profile ID and zone.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "About Mobile Legends" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check ID" })).toBeTruthy();
    for (const img of document.querySelectorAll("img")) {
      expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
      expect(img.getAttribute("decoding")).toBe("async");
    }
    const image = document.querySelector('[data-game-header] img[src*="free-fire-icon.webp"]')!;
    fireEvent.error(image);
    expect(document.querySelector('[data-game-header] img[src*="free-fire-icon.webp"]')).toBeNull();
    expect(screen.getAllByText("ML").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Pay now" }).length).toBeGreaterThan(0);
  });

  it("does not warn when a checked account is paired with a Global variant", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("nickname") ? { ok: true, json: async () => ({ status: "ok", nickname: "Player (SG)" }) } : quoteResponse()));
    render(<GameClient detail={{ game, products: [product({ product_type_name: "Global" })] }} orderingOpen />);
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "12345" } });
    fireEvent.change(screen.getByLabelText("Zone ID"), { target: { value: "678" } });
    await screen.findByText(/Nickname terdeteksi:/);
    expect(screen.queryByText(/Akun ini terdeteksi region/)).toBeNull();
  });
  it("orders the four steps, defaults to Indonesia and prefers its cheapest available topup", () => {
    render(<GameClient detail={{ game, products: [
      product({ buyer_sku_code: "sg", product_type_name: "Singapore", group: "bestseller", price: 500 }),
      product({ buyer_sku_code: "id-off", product_type_name: "Indonesia", available: false, price: 100, availability_reason: "supplier_off" }),
      product({ buyer_sku_code: "id-expensive", product_type_name: "Indonesia", group: "bestseller", price: 15000 }),
      product({ buyer_sku_code: "id-cheap", product_type_name: "Indonesia", group: "bestseller", price: 12000 }),
      product({ buyer_sku_code: "id-topup", product_type_name: "Indonesia", group: "all", price: 1000 }),
      product({ buyer_sku_code: "id-topup-expensive", product_type_name: "Indonesia", group: "all", price: 2000 }),
    ] }} orderingOpen />);
    expect(screen.getAllByRole("heading", { level: 2 }).slice(0, 4).map((h) => h.textContent)).toEqual(["1Data akun", "2Pilih nominal", "3Metode pembayaran", "4Kontak"]);
    expect(screen.getByRole("button", { name: "Indonesia (5)" }).getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector<HTMLInputElement>('input[value="id-topup"]')!.checked).toBe(true);
    const card = document.querySelector<HTMLInputElement>('input[value="id-topup"]')!.closest("label")!;
    expect(within(card).getByText("Pengiriman instan")).toBeTruthy();
    const off = document.querySelector<HTMLInputElement>('input[value="id-off"]')!.closest("label")!;
    expect(off.getAttribute("aria-disabled")).toBe("true");
    expect(off.textContent).toContain("Rp100");
    expect(within(off).getByText("Habis")).toBeTruthy();
    expect(within(off).queryByText("Pengiriman instan")).toBeNull();
    expect(screen.queryByText("Belum dipilih")).toBeNull();
  });

  it("falls back to the cheapest available in the first available section, or first variant fields", () => {
    const products = [
      product({ buyer_sku_code: "off", available: false, category: "topup", fields: [noteField] }),
      product({ buyer_sku_code: "later-cheaper", category: "pass", price: 100 }),
      product({ buyer_sku_code: "first-expensive", category: "special", price: 300 }),
      product({ buyer_sku_code: "first-cheapest", category: "special", price: 200 }),
    ];
    const { rerender } = render(<GameClient detail={{ game, products }} orderingOpen={false} />);
    expect(document.querySelector<HTMLInputElement>('input[value="first-cheapest"]')!.checked).toBe(true);
    rerender(<GameClient key="unavailable" detail={{ game, products: products.map((p) => ({ ...p, available: false })) }} orderingOpen={false} />);
    expect((screen.getByLabelText("User ID") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByLabelText("Zone ID")).toBeNull();
    expect(screen.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
  });

  it("offers expand only for actual description overflow, strips emoji, and collapses again", () => {
    let height = 24;
    let resize = () => {};
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => height);
    const computedStyle = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
      const style = computedStyle(element, pseudo);
      style.lineHeight = "24px";
      return style;
    });
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
    const { rerender } = render(<GameClient detail={{ game, products: [product({ description: "⚡ Short text ✅" })] }} orderingOpen={false} />);
    expect(screen.getByRole("complementary").textContent).toContain("Tipe");
    let text = screen.getByText("Short text");
    expect(text.textContent).not.toMatch(/[⚡✅]/);
    expect(screen.queryByRole("button", { name: "Selengkapnya" })).toBeNull();
    height = 48; act(() => resize());
    expect(screen.queryByRole("button", { name: "Selengkapnya" })).toBeNull();
    height = 72;
    const longText = "Only for this region. Check your User ID and server before paying. Other account regions are not supported.";
    rerender(<GameClient detail={{ game, products: [product({ description: `⚡ ${longText} ✅` })] }} orderingOpen={false} />);
    text = screen.getByText(longText);
    fireEvent.click(screen.getByRole("button", { name: "Selengkapnya" }));
    expect(screen.getByRole("button", { name: "Ringkas" }).getAttribute("aria-expanded")).toBe("true");
    expect(text.className).not.toContain("line-clamp-2");
    fireEvent.click(screen.getByRole("button", { name: "Ringkas" }));
    expect(text.className).toContain("line-clamp-2");
    expect(screen.getByRole("button", { name: "Selengkapnya" }).getAttribute("aria-expanded")).toBe("false");
    height = 24; act(() => resize());
    expect(screen.queryByRole("button", { name: "Selengkapnya" })).toBeNull();
  });

  it("frames local art and creates an icon-blurred banner, then a monogram on icon failure", () => {
    render(<GameClient detail={{ game: { ...game, icon: "/brand/games/free-fire-icon.webp" }, products: [] }} orderingOpen={false} />);
    const banner = document.querySelector('[data-game-image="generated-banner"]')!;
    expect(banner.className).toContain("rounded-2xl border border-white/10");
    expect(banner.querySelector("img")!.className).toContain("blur-[48px]");
    fireEvent.error(banner.querySelector("img")!);
    expect(within(banner as HTMLElement).getByText("ML")).toBeTruthy();
    expect(banner.querySelector("img")).toBeNull();
  });

  it("renders every category item without a reveal button and keeps full pass names accessible", () => {
    const products = Array.from({ length: 14 }, (_, i) => product({ buyer_sku_code: `pass-${i}`, name: `Weekly Diamond Pass ${i + 1}x`, group: "all", product_type_name: "Indonesia", price: 1000 + i }));
    render(<GameClient detail={{ game, products }} orderingOpen={false} />);
    const section = screen.getByRole("radiogroup", { name: "Pass & membership" });
    expect(within(section).getAllByRole("radio")).toHaveLength(14);
    expect(screen.queryByRole("button", { name: /Tampilkan semua/ })).toBeNull();
    const name = within(section).getByText("Weekly Diamond Pass 14x");
    expect(name.getAttribute("title")).toBe("Weekly Diamond Pass 14x");
    expect(name.className).toContain("line-clamp-2");
    expect(within(section).getByRole("radio", { name: /Weekly Diamond Pass 14x/ })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Cari nominal" }), { target: { value: "missing" } });
    expect(screen.getByText("Tidak ada nominal cocok")).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("renders filled trust icons, the floating hero card and an accessible instant badge", () => {
    render(<GameClient detail={{ game, products: [product({ category: "topup" })] }} orderingOpen={false} />);
    const header = document.querySelector<HTMLElement>("[data-game-header]")!;
    for (const label of ["Proses instan", "Layanan 24/7", "Pembayaran aman"]) expect(within(header).getByText(label)).toBeTruthy();
    expect(header.querySelectorAll("svg")).toHaveLength(3);
    expect(header.querySelector("[data-game-icon-card]")).toBeTruthy();
    expect(header.firstElementChild!.className).toContain("aspect-[16/9] max-h-[440px] w-full sm:aspect-[21/9]");
    const card = screen.getByRole("radio", { name: /86 Diamond/ }).closest("label")!;
    expect(within(card).getByText("Pengiriman instan").className).toBe("sr-only");
    expect(within(card).getByText("INSTAN").parentElement!.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("radio", { name: /Pengiriman instan/ })).toBeTruthy();
  });

  it("localizes the trust row and instant badge without duplicating its accessible label", async () => {
    document.cookie = "axv_locale=en; path=/";
    render(<DisplayPreferencesProvider><GameClient detail={{ game, products: [product({})] }} orderingOpen={false} /></DisplayPreferencesProvider>);
    expect(await screen.findByText("Instant process")).toBeTruthy();
    expect(screen.getByText("24/7 support")).toBeTruthy();
    expect(screen.getByText("Secure payment")).toBeTruthy();
    const radio = screen.getByRole("radio", { name: /Instant delivery/ });
    expect(radio.closest("label")!.textContent?.match(/Instant delivery/g)).toHaveLength(1);
    expect(screen.getByText("DELIVERY").parentElement!.getAttribute("aria-hidden")).toBe("true");
  });

  it("falls back to a category icon when an item image fails and ranks by price rather than availability", () => {
    render(<GameClient detail={{ game, products: [
      product({ buyer_sku_code: "high", name: "High", category: "topup", price: 3000 }),
      product({ buyer_sku_code: "low", name: "Low", category: "topup", price: 1000, available: false }),
      product({ buyer_sku_code: "middle", name: "Middle", category: "topup", price: 2000 }),
    ] }} orderingOpen={false} />);
    const high = screen.getByRole("radio", { name: /High/ }).closest("label")!;
    const image = high.querySelector<HTMLImageElement>("img")!;
    expect(image.getAttribute("src")).toBe("/brand/games/items/mlbb-diamond-3.webp");
    expect(image.alt).toBe("");
    expect(image.getAttribute("loading")).toBe("lazy");
    fireEvent.error(image);
    expect(high.querySelector("img")).toBeNull();
    expect(high.querySelector("svg[data-item-icon-fallback].lucide-gem")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Low/ }).closest("label")!.querySelector("img")!.getAttribute("src")).toBe("/brand/games/items/mlbb-diamond-1.webp");
  });

  it("handles image failures cached before hydration and retries a different artwork source", () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    const { container, rerender } = render(<ItemIcon src="/missing.webp" category="topup" />);
    expect(container.querySelector("svg[data-item-icon-fallback]")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    complete.mockReturnValue(false);
    rerender(<ItemIcon src="/brand/games/items/mlbb-diamond-1.webp" category="topup" />);
    expect(container.querySelector("img")!.getAttribute("src")).toBe("/brand/games/items/mlbb-diamond-1.webp");
    expect(container.querySelector("svg[data-item-icon-fallback]")).toBeNull();
  });

  it("keeps unavailable account fields visible but disabled and never requests nickname/quote", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<GameClient detail={{ game, products: [product({ available: false, availability_reason: "supplier_off" })] }} orderingOpen />);
    expect((screen.getByLabelText("User ID") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Nominal sedang tidak tersedia")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Bayar sekarang" }).every((b) => b.hasAttribute("disabled"))).toBe(true);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cleans phone labels and provides phone-specific guidance; no Cek ID for unsupported validation", () => {
    render(<GameClient detail={{ game: { ...game, slug: "roblox", name: "Roblox" }, products: [product({ name: "Gift Card Rp50.000", group: "all", fields: [{ ...noteField, label: " No Hp : " }], validation_available: false })] }} orderingOpen={false} />);
    expect(screen.getByLabelText("No Hp")).toBeTruthy();
    expect(screen.getByText("Isi nomor sesuai akun tujuan.")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Lainnya" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cek ID" })).toBeNull();
  });

  it("uses a nickname region as a non-blocking hint and offers its matching chip", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("nickname") ? { ok: true, json: async () => ({ status: "ok", nickname: "Player (SG)" }) } : quoteResponse()));
    render(<GameClient detail={{ game, products: [product({ buyer_sku_code: "id", product_type_name: "Indonesia" }), product({ buyer_sku_code: "sg", product_type_name: "Singapore" })] }} orderingOpen />);
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "12345" } });
    fireEvent.change(screen.getByLabelText("Zone ID"), { target: { value: "678" } });
    fireEvent.click(screen.getByRole("button", { name: "Cek ID" }));
    const hint = await screen.findByRole("button", { name: "Tampilkan nominal Singapura" });
    expect(hint.closest('[role="status"]')!.textContent).toContain("Nominal yang kamu pilih untuk region Indonesia");
    expect(screen.getAllByRole("button", { name: "Bayar sekarang" })[0].hasAttribute("disabled")).toBe(false);
    fireEvent.click(hint);
    expect(screen.getByRole("button", { name: "Singapura (1)" }).getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector<HTMLInputElement>('input[value="sg"]')!.checked).toBe(true);
    expect((screen.getByLabelText("User ID") as HTMLInputElement).value).toBe("12345");
    expect(screen.queryByText(/Akun ini terdeteksi region/)).toBeNull();
  });
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
    expect(within(screen.getByRole("complementary")).getByText("Membership")).toBeTruthy();
    expect(screen.getByText(/Region ID only/)).toBeTruthy();
    fireEvent.blur(screen.getByLabelText("User ID"));
    expect(screen.getAllByText("Periksa format ID ini.")).toHaveLength(2);

    // Nominal/nama sama tetap dua baris berbeda (region/type tidak digabung).
    expect(screen.getAllByRole("radio", { name: /86 Diamond/ })).toHaveLength(2);
    expect(screen.getByRole("radio", { name: /172 Diamond/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Habis")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Open Denom/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Tidak tersedia")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /172 Diamond/ }).closest("label")!.textContent).toContain("Rp24.000");
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

  it("filters by type/search without collapsing equal nominal variants or currency-specific ranges", () => {
    render(<GameClient detail={detail} orderingOpen={false} />);
    expect(screen.queryByRole("button", { name: "100–500" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Region SG (1)" }));
    expect(screen.getAllByRole("radio", { name: /86 Diamond/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Semua (4)" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Cari nominal" }), { target: { value: "Open" } });
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
    fireEvent.click(screen.getAllByRole("button", { name: "Bayar Rp12.000" })[0]);
    expect(screen.getAllByRole("button", { name: "Memproses…" })[0].hasAttribute("disabled")).toBe(true);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes("orders"))).toHaveLength(1);
    orderResolve!({ ok: false, status: 503, json: async () => ({ error: "temporary" }) });
    await screen.findByRole("alert");
    fireEvent.click(screen.getAllByRole("button", { name: "Bayar Rp12.000" })[0]);
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
    expect(within(screen.getByRole("complementary")).getByText("Biaya pembayaran").nextElementSibling!.textContent).toBe("Rp2.000");
    fireEvent.click(screen.getAllByRole("button", { name: "Bayar Rp14.000" })[0]);
    expect((await screen.findByRole("alert")).textContent).toContain("Kanal sementara tutup");
    await waitFor(() => expect(quotes).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(within(payment).getByRole("button", { name: /Virtual Account/i })).toBeTruthy());
    fireEvent.click(within(payment).getByRole("button", { name: /Virtual Account/i }));
    expect((within(payment).getByRole("radio", { name: /Bank Test/i }) as HTMLInputElement).disabled).toBe(true);
    expect((within(payment).getByRole("radio", { name: /QRIS/i }) as HTMLInputElement).checked).toBe(false);
  });
});
