// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { GamesBottomNav } from "@/components/games/GamesNavbar";
const route = vi.hoisted(() => ({ path: "/games" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.path }));
afterEach(() => { cleanup(); window.location.hash = ""; });
describe("Games mobile navigation", () => {
  it.each([["/games", "Beranda"], ["/games/lacak", "Lacak"], ["/bantuan", "Bantuan"], ["/pesanan/AXG-test", "Lacak"]])("marks %s active", (path, label) => {
    route.path = path; render(<GamesBottomNav />);
    const nav = screen.getByRole("navigation", { name: "Navigasi Games" });
    expect(within(nav).getAllByRole("link")).toHaveLength(4);
    expect(within(nav).getByRole("link", { name: label }).getAttribute("aria-current")).toBe("page");
  });
  it.each(["/games/mobile-legends", "/mobile-legends"])("hides on game order page %s", (path) => {
    route.path = path; render(<GamesBottomNav />); expect(screen.queryByRole("navigation")).toBeNull();
  });
  it("Mark Games = analog stick on Pedia frame (bukan prisma Market / Lucide)", () => {
    const src = readFileSync(join(process.cwd(), "src/components/games/GamesNavbar.tsx"), "utf8");
    expect(src).toContain("/brand/games-mark.svg");
    expect(src).toContain("brightness-0 invert");
    expect(src).not.toContain("/brand/axvara-mark.svg");
    expect(src).not.toContain("gamepad");
    const svg = readFileSync(join(process.cwd(), "public/brand/games-mark.svg"), "utf8");
    expect(svg).toContain('viewBox="0 0 144 128"');
    expect(svg).toContain('fill="currentColor"');
  });
});
