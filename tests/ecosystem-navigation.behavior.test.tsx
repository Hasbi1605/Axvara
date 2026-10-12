// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServicesMenu } from "@/components/shared/ServicesMenu";
import { CrossServicePromo } from "@/components/shared/CrossServicePromo";
import { CommunityBar } from "@/components/storefront/CommunityBar";
import { Footer } from "@/components/storefront/Footer";
import { AXVARA_SERVICES, DEFAULT_STORE_SETTINGS, SITE, TG_BOT_HREF, WA_GROUP_HREF } from "@/lib/site";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("@/hooks/useStoreSettings", () => ({ useStoreSettings: () => DEFAULT_STORE_SETTINGS }));

beforeEach(() => {
  route.pathname = "/";
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ categories: [{ id: 1, name: "Tools", slug: "tools" }] }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("shared service navigation", () => {
  it.each(["market", "pedia"] as const)("opens using keyboard, navigates links and restores focus on Escape (%s)", async (active) => {
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
    expect(links[active === "market" ? 0 : 1].getAttribute("aria-current")).toBe("true");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(links[0]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(links[1]);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(links[0]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(links[1]);
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(button);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(links).toHaveLength(2);
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

  it("Market retains Telegram compact twin card without eyebrows", () => {
    render(<CommunityBar />);
    expect(screen.getByRole("link", { name: /Bot Telegram/ }).getAttribute("href")).toBe(TG_BOT_HREF);
    // 2026-10-12: eyebrow dihapus dari kedua kartu (compact) — tidak ada lagi
    // "LAYANAN AXVARA" / "Kanal order Market" di beranda Market.
    expect(screen.queryByText("Kanal order Market")).toBeNull();
    expect(screen.queryByText("Layanan AXVARA")).toBeNull();
    expect(screen.queryByText("Grup WhatsApp")).toBeNull();
    expect(screen.getByRole("link", { name: /AXVARA Pedia/ })).toBeTruthy();
  });
});

describe("shared footer", () => {
  it("has identical content and host-correct destinations on Market and Pedia", async () => {
    const market = render(<Footer />);
    await screen.findByRole("link", { name: "Tools" });
    const content = screen.getByRole("contentinfo").innerHTML;
    market.unmount();
    route.pathname = "/pedia";
    render(<Footer />);
    await screen.findByRole("link", { name: "Tools" });
    expect(screen.getByRole("contentinfo").innerHTML).toBe(content);
    const expected = {
      "AXVARA Market": `${SITE.webUrl}/`,
      "AXVARA Pedia": `${SITE.pediaUrl}/pedia?utm_source=axvara&utm_medium=footer`,
      "Lacak pesanan Pedia": `${SITE.pediaUrl}/pedia/lacak`,
      "Lacak pesanan market": `${SITE.webUrl}/lacak-pesanan`,
      "Bantuan Pedia": `${SITE.pediaUrl}/pedia/bantuan`,
      "Ketentuan Pedia": `${SITE.pediaUrl}/pedia/ketentuan`,
      "Ketentuan Market": `${SITE.webUrl}/garansi-replace`,
      "Grup WhatsApp": WA_GROUP_HREF,
      "Bot Telegram Market": TG_BOT_HREF,
      "Tools": `${SITE.webUrl}/?category=tools#katalog`,
    };
    for (const [name, href] of Object.entries(expected)) expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(href);
    expect(screen.getByRole("link", { name: /Chat WA/ }).getAttribute("href")).toMatch(/^https:\/\/axvara.tech\/wa\?pesan=/);
    expect(content).not.toMatch(/Bergaransi|Aktivasi 5/);
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
