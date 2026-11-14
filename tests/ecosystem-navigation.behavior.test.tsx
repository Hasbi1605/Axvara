// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServicesMenu } from "@/components/shared/ServicesMenu";
import { CrossServicePromo } from "@/components/shared/CrossServicePromo";
import { CommunityBar } from "@/components/storefront/CommunityBar";
import { PediaServiceCards } from "@/components/pedia/PediaServiceCards";
import { Footer } from "@/components/storefront/Footer";
import { AXVARA_SERVICES, DEFAULT_STORE_SETTINGS, SITE, TG_BOT_HREF, WA_GROUP_HREF } from "@/lib/site";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname, useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/hooks/useStoreSettings", () => ({ useStoreSettings: () => DEFAULT_STORE_SETTINGS }));

beforeEach(() => {
  route.pathname = "/";
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ categories: [{ id: 1, name: "Tools", slug: "tools" }] }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("shared service navigation", () => {
  it.each(["market", "pedia", "games"] as const)("opens using keyboard, navigates links and restores focus on Escape (%s)", async (active) => {
    const user = userEvent.setup();
    render(<ServicesMenu active={active} />);
    const button = screen.getByRole("button", { name: "Layanan AXVARA" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("navigation")).toBeNull();
    button.focus();
    await user.keyboard("{Enter}");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const links = within(screen.getByRole("navigation")).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(AXVARA_SERVICES.map((service) => service.href));
    expect(links[AXVARA_SERVICES.findIndex(service => service.id === active)].getAttribute("aria-current")).toBe("true");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(links[0]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(links[1]);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(links[0]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(links[2]);
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(button);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(links).toHaveLength(3);
  });

  it.each(AXVARA_SERVICES)("keeps native menu and promo clicks host-correct from $href", async current => {
    const user = userEvent.setup();
    const base = document.createElement("base"); base.href = current.href; document.head.append(base);
    try {
      render(<><ServicesMenu active={current.id} />{AXVARA_SERVICES.filter(target => target.id !== current.id).map(target => <CrossServicePromo key={target.id} current={current.id} target={target.id} />)}</>);
      for (const target of AXVARA_SERVICES) {
        await user.click(screen.getByRole("button", { name: "Layanan AXVARA" }));
        const menuLink = within(screen.getByRole("navigation")).getByRole("link", { name: new RegExp(target.name) });
        expect((menuLink as HTMLAnchorElement).href).toBe(target.href);
        const clicked = vi.fn((event: Event) => event.preventDefault()); menuLink.addEventListener("click", clicked);
        await user.click(menuLink); expect(clicked).toHaveBeenCalledOnce();
        expect(screen.queryByRole("navigation")).toBeNull();
        if (target.id === current.id) continue;
        const promo = screen.getByRole("link", { name: new RegExp(target.name) });
        const url = new URL((promo as HTMLAnchorElement).href);
        expect(`${url.origin}${url.pathname}`).toBe(target.href);
        expect(url.searchParams.get("utm_source")).toBe(current.id === "market" ? "axvara" : current.id);
        promo.addEventListener("click", clicked); await user.click(promo); expect(clicked).toHaveBeenCalledTimes(2);
      }
    } finally { base.remove(); }
  });

  it("allows native Tab movement and dismisses on focus leaving or outside pointer", async () => {
    const user = userEvent.setup();
    render(<><ServicesMenu active="market" /><button>Outside</button></>);
    const trigger = screen.getByRole("button", { name: "Layanan AXVARA" });
    await user.click(trigger);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: /AXVARA Market/ }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: /AXVARA Pedia/ }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: /AXVARA Games/ }));
    await user.tab();
    expect(screen.queryByRole("navigation")).toBeNull();
    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it.each(["market", "pedia"] as const)("promotes only the other live service compact without eyebrow (%s)", (current) => {
    render(<CrossServicePromo current={current} />);
    const service = AXVARA_SERVICES.find((item) => item.id !== current)!;
    const link = screen.getByRole("link");
    expect(link.textContent).toContain(service.name);
    // 2026-10-12: eyebrow "Layanan AXVARA" dihapus agar kartu ramping.
    expect(link.textContent).not.toContain("Layanan AXVARA");
    const url = new URL(link.getAttribute("href")!);
    expect(`${url.origin}${url.pathname}`).toBe(service.href);
    expect(url.searchParams.get("utm_medium")).toBe("cross_promo");
    expect(url.searchParams.get("utm_source")).toBe(current === "market" ? "axvara" : "pedia");
  });

  it("Market shows Pedia and Games compact cards without Telegram", () => {
    render(<CommunityBar />);
    expect(screen.getByRole("link", { name: /AXVARA Games/ }).getAttribute("href")).toBe(`${SITE.gamesUrl}/?utm_source=axvara&utm_medium=cross_promo`);
    expect(screen.queryByRole("link", { name: /Telegram/ })).toBeNull();
    // 2026-10-12: eyebrow dihapus dari kedua kartu (compact) — tidak ada lagi
    // "LAYANAN AXVARA" / "Kanal order Market" di beranda Market.
    expect(screen.queryByText("Kanal order Market")).toBeNull();
    expect(screen.queryByText("Layanan AXVARA")).toBeNull();
    expect(screen.queryByText("Grup WhatsApp")).toBeNull();
    expect(screen.getByRole("link", { name: /AXVARA Pedia/ })).toBeTruthy();
  });

  it("Pedia promotes Market and Games (no Telegram bot card)", () => {
    render(<PediaServiceCards />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([`${SITE.webUrl}/?utm_source=pedia&utm_medium=cross_promo`, `${SITE.gamesUrl}/?utm_source=pedia&utm_medium=cross_promo`]);
    expect(screen.queryByText(/Telegram/)).toBeNull();
  });

  it("uses Games as the source when promoting another service", () => {
    render(<CrossServicePromo current="games" target="pedia" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe(`${SITE.pediaUrl}/?utm_source=games&utm_medium=cross_promo`);
  });

  // 2026-11-02 (koreksi owner): dua kartu tetap kanan-kiri di mobile, sama
  // seperti Pedia; judul dibungkus (tanpa terpotong), ikon 28px di mobile.
  it.each([
    ["Market", () => render(<CommunityBar />).container.firstElementChild!.firstElementChild!],
    ["Pedia", () => render(<PediaServiceCards />).container.firstElementChild!],
  ])("%s keeps both promo cards side by side with wrapping titles and 28px mobile icons", (_name, getRow) => {
    const row = getRow();
    expect(row.className).toMatch(/(^|\s)flex-row(\s|$)/);
    expect(row.className).not.toContain("flex-col");
    const cards = Array.from(row.querySelectorAll(":scope > a"));
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.className).toContain("min-h-[64px]");
      expect(card.className).toContain("min-w-0");
      expect(card.className).toContain("flex-1");
      expect(card.querySelector(".truncate")).toBeNull();
      expect(card.querySelector(".break-words")).toBeTruthy();
      expect(card.querySelector("[class*='h-7'][class*='w-7'][class*='sm:h-9'][class*='sm:w-9']")).toBeTruthy();
      expect(card.querySelector("[class*='text-[11px]']")).toBeTruthy();
    }
  });
});

describe("shared footer", () => {
  it("has identical content and host-correct destinations on Market and Pedia", () => {
    const market = render(<Footer />);
    const content = screen.getByRole("contentinfo").innerHTML;
    market.unmount();
    route.pathname = "/pedia";
    render(<Footer />);
    expect(screen.getByRole("contentinfo").innerHTML).toBe(content);
    const expected = {
      "AXVARA Market": `${SITE.webUrl}/`,
      "AXVARA Pedia": `${SITE.pediaUrl}/?utm_source=axvara&utm_medium=footer`,
      "AXVARA Games": `${SITE.gamesUrl}/`,
      "Lacak pesanan Pedia": `${SITE.pediaUrl}/lacak`,
      "Lacak pesanan market": `${SITE.webUrl}/lacak-pesanan`,
      "Bantuan Pedia": `${SITE.pediaUrl}/bantuan`,
      "Ketentuan Pedia": `${SITE.pediaUrl}/ketentuan`,
      "Refill Pedia": `${SITE.pediaUrl}/refill`,
      "Ketentuan Market": `${SITE.webUrl}/garansi-replace`,
      "WhatsApp AXVARA": "https://axvara.tech/wa?pesan=Halo%20AXVARA",
      "Grup WA": WA_GROUP_HREF,
      "Bot Order Telegram Market": TG_BOT_HREF,
    };
    for (const [name, href] of Object.entries(expected)) expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(href);
    expect(content).not.toMatch(/Bergaransi|Aktivasi 5/);
  });

  it("footer tidak lagi memuat baris/sheet bahasa & mata uang (pemicu tunggal di header)", () => {
    const market = render(<Footer />);
    expect(screen.queryByRole("button", { name: /bahasa dan mata uang|language and currency/i })).toBeNull();
    expect(screen.getByRole("contentinfo").textContent).not.toMatch(/Bahasa & mata uang|Ubah/);
    market.unmount();
    render(<Footer pediaLayout />);
    expect(screen.queryByRole("button", { name: /bahasa dan mata uang/i })).toBeNull();
  });

  // 2026-11-01: "Cara order" di footer Pedia menuju cara order Pedia, bukan halaman Market.
  it("points Cara order to the Pedia guide only inside the Pedia layout", () => {
    route.pathname = "/bantuan";
    const pedia = render(<Footer pediaLayout />);
    expect(screen.getByRole("link", { name: "Cara order" }).getAttribute("href")).toBe(`${SITE.pediaUrl}/bantuan#cara-order`);
    pedia.unmount();
    route.pathname = "/";
    render(<Footer />);
    expect(screen.getByRole("link", { name: "Cara order" }).getAttribute("href")).toBe(`${SITE.webUrl}/cara-order`);
  });

  it.each(["/", "/pedia"])("shows only ecosystem services and help without fetching categories (%s)", (pathname) => {
    route.pathname = pathname;
    render(<Footer />);
    const services = screen.getByRole("navigation", { name: "Layanan AXVARA" });
    expect(within(services).getAllByRole("link").map((link) => link.textContent)).toEqual(AXVARA_SERVICES.map((service) => service.name));
    expect(within(screen.getByRole("navigation", { name: "Bantuan AXVARA" })).getAllByRole("link")).toHaveLength(10);
    expect(screen.queryByText("Tools")).toBeNull();
    expect(screen.queryByRole("link", { name: "Semua produk" })).toBeNull();
    expect(screen.queryByRole("link", { name: "AI & teknologi" })).toBeNull();
    expect(screen.queryByText(/Chat WA|09.00/)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("places icon-only WhatsApp after Facebook and community pills below the icons", () => {
    render(<Footer />);
    const facebook = screen.getByRole("link", { name: "Facebook AXVARA" });
    const whatsapp = screen.getByRole("link", { name: "WhatsApp AXVARA" });
    expect(facebook.nextElementSibling).toBe(whatsapp);
    expect(whatsapp.textContent?.trim()).toBe("");
    expect(whatsapp.querySelector("img")).toBeNull();
    expect(whatsapp.querySelector("svg")?.getAttribute("fill")).toBe("currentColor");
    expect(whatsapp.querySelector("svg")?.getAttribute("class")).toBe(facebook.querySelector("svg")?.getAttribute("class"));
    expect(whatsapp.className).toContain("text-white/60");
    expect(whatsapp.className).toContain("hover:border-[#00E5FF]/40");
    const group = screen.getByRole("link", { name: "Grup WA" });
    const bot = screen.getByRole("link", { name: "Bot Order Telegram Market" });
    expect(whatsapp.parentElement?.nextElementSibling).toBe(group.parentElement);
    expect(group.parentElement).toBe(bot.parentElement);
    expect(group.querySelector("img")?.getAttribute("src")).toBe("/brand/whatsapp.svg");
    expect(bot.querySelector("img")?.getAttribute("src")).toBe("/brand/telegram.svg");
    for (const link of [whatsapp, group, bot]) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noreferrer");
    }
    for (const link of [group, bot]) expect(link.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(whatsapp.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it.each(["/admin", "/link", "/wa"])("stays hidden without category requests on focused routes (%s)", (pathname) => {
    route.pathname = pathname;
    render(<Footer />);
    expect(screen.queryByRole("contentinfo")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["/", "/pedia"])("submits newsletter same-origin and shows success (%s)", async (pathname) => {
    route.pathname = pathname;
    render(<Footer />);
    fireEvent.change(screen.getByRole("textbox", { name: "Email untuk update AXVARA" }), { target: { value: "buyer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Langganan" }));
    await screen.findByText("Email berhasil didaftarkan.");
    expect(fetch).toHaveBeenCalledWith("/api/subscribers", expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "buyer@example.com" }) }));
  });

  it("preserves input and explains failed subscriptions", async () => {
    render(<Footer />);
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Coba lagi nanti" }) } as Response);
    const input = screen.getByRole("textbox", { name: "Email untuk update AXVARA" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "buyer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Langganan" }));
    await screen.findByText("Coba lagi nanti");
    expect(input.value).toBe("buyer@example.com");
    await waitFor(() => expect((screen.getByRole("button", { name: "Langganan" }) as HTMLButtonElement).disabled).toBe(false));
  });
});
