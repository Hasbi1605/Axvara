// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextRequest } from "next/server";
import { isPediaOrderFlow, pediaRoutePath } from "@/lib/pedia/route-path";
import { PediaBottomNav } from "@/components/pedia/PediaBottomNav";
import { ServicesMenu } from "@/components/shared/ServicesMenu";

let path = "/";
vi.mock("next/navigation", () => ({ usePathname: () => path }));
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Pedia route path (owner 2026-11-01: subdomain order flow)", () => {
  it.each([
    ["/", "/pedia"], ["/p/instagram", "/pedia/p/instagram"], ["/o/x", "/pedia/o/x"],
    ["/pedia", "/pedia"], ["/pedia/p/instagram", "/pedia/p/instagram"], ["", ""], [null, ""],
  ])("normalizes %s to %s", (input, out) => expect(pediaRoutePath(input)).toBe(out));

  it("recognizes only the order flow", () => {
    expect(isPediaOrderFlow("/pedia/p/tiktok")).toBe(true);
    expect(isPediaOrderFlow("/pedia/o/likes")).toBe(true);
    expect(isPediaOrderFlow("/pedia/pesanan/AXP-1")).toBe(false);
    expect(isPediaOrderFlow("/pedia")).toBe(false);
  });

  it.each(["/p/instagram", "/o/followers-instagram", "/pedia/p/instagram"])("hides the bottom nav on %s so it cannot cover the order bar", (p) => {
    path = p;
    expect(render(<PediaBottomNav />).container.querySelector("nav")).toBeNull();
  });

  it("keeps the bottom nav with the right active tab on subdomain pages", () => {
    path = "/lacak";
    render(<PediaBottomNav />);
    expect(screen.getByRole("link", { name: /Pesanan/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /Beranda/ }).getAttribute("aria-current")).toBeNull();
  });
});

describe("services menu label", () => {
  // 2026-11-02 (owner): label terlihat "Layanan" di Market maupun Pedia, semua ukuran; nama aksesibel tetap lengkap.
  it.each(["pedia", "market"] as const)("shows only Layanan visibly but keeps the full accessible name (%s)", (active) => {
    render(<ServicesMenu active={active} />);
    const button = screen.getByRole("button", { name: "Layanan AXVARA" });
    expect(button.textContent).toBe("Layanan");
    expect(button.getAttribute("aria-label")).toBe("Layanan AXVARA");
    expect(button.querySelector(".max-sm\\:sr-only")).toBeNull();
    expect(button.querySelector(".whitespace-nowrap")?.textContent).toBe("Layanan");
  });
});

describe("axvara.tech/pedia redirect", () => {
  it.each([["/pedia/p/instagram", "https://pedia.axvara.tech/p/instagram"], ["/pedia", "https://pedia.axvara.tech/"], ["/pedia/", "https://pedia.axvara.tech/"]])("redirects %s to %s without a double slash", async (p, location) => {
    vi.stubGlobal("DB", { prepare: () => ({ first: async () => ({ key: "store_name" }) }) });
    const { middleware } = await import("@/middleware");
    const response = await middleware(new NextRequest(`https://axvara.tech${p}`, { headers: { host: "axvara.tech" } }));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(location);
  });
});
