// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Footer } from "@/components/storefront/Footer";

let path = "/";
vi.mock("next/navigation", () => ({ usePathname: () => path, useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/hooks/useStoreSettings", () => ({ useStoreSettings: () => ({}) }));
afterEach(cleanup);

describe("Footer in the Pedia order flow (owner 2026-10-31)", () => {
  it.each([
    ["market", "/cara-order", "https://axvara.tech/cara-order", false],
    ["pedia", "/p/instagram", "https://pedia.axvara.tech/bantuan#cara-order", true],
    ["games", "/p/free-fire", "https://games.axvara.tech/bantuan", false],
  ] as const)("points the primary order guide at the correct surface (%s)", (surface, route, href, hidden) => {
    path = route;
    const footer = render(<Footer pediaLayout={surface === "pedia"} gamesLayout={surface === "games"} />).container.querySelector("footer")!;
    expect(screen.getByRole("link", { name: /^Cara Order$/i }).getAttribute("href")).toBe(href);
    expect(footer.classList.contains("max-xl:hidden")).toBe(hidden);
  });
  it.each(["/pedia/p/instagram", "/pedia/o/followers-instagram"])("is hidden below xl on %s", (p) => {
    path = p;
    const footer = render(<Footer />).container.querySelector("footer")!;
    expect(footer.className).toContain("max-xl:hidden");
  });
  // 2026-11-01: on pedia.axvara.tech the browser URL has no /pedia prefix.
  it.each(["/p/instagram", "/o/followers-instagram"])("is hidden below xl on the Pedia subdomain path %s", (p) => {
    path = p;
    const footer = render(<Footer pediaLayout />).container.querySelector("footer")!;
    expect(footer.className).toContain("max-xl:hidden");
  });
  it.each(["/", "/pesanan/AXP-1", "/bantuan"])("stays visible on the Pedia subdomain path %s", (p) => {
    path = p;
    const footer = render(<Footer pediaLayout />).container.querySelector("footer")!;
    expect(footer.className).not.toContain("max-xl:hidden");
  });
  it("does not treat Market paths as Pedia routes", () => {
    path = "/p/instagram";
    const footer = render(<Footer />).container.querySelector("footer")!;
    expect(footer.className).not.toContain("max-xl:hidden");
  });
  it.each(["/", "/pedia", "/pedia/pesanan/AXP-1", "/pedia/bantuan"])("stays visible on %s", (p) => {
    path = p;
    const footer = render(<Footer />).container.querySelector("footer")!;
    expect(footer.className).not.toContain("max-xl:hidden");
  });
});
