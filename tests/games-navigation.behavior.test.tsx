// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GamesBottomNav } from "@/components/games/GamesNavbar";
import { AXVARA_GAMES_GENRE_EVENT, requestGamesGenre } from "@/components/games/GamesCategorySheet";

const route = vi.hoisted(() => ({ path: "/games", push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => route.path, useRouter: () => ({ push: route.push }) }));
afterEach(() => { cleanup(); route.push.mockReset(); window.location.hash = ""; });

const openSheet = async () => {
  const nav = screen.getByRole("navigation", { name: "Navigasi Games" });
  const kategori = within(nav).getByRole("button", { name: "Kategori" });
  expect(kategori.getAttribute("aria-haspopup")).toBe("dialog");
  await userEvent.click(kategori);
  expect(kategori.getAttribute("aria-expanded")).toBe("true");
  return screen.getByRole("dialog", { name: "Kategori game" });
};

describe("Games mobile navigation", () => {
  it.each([["/games", "Beranda"], ["/games/lacak", "Lacak"], ["/games/bantuan", "Bantuan"], ["/lacak", "Lacak"], ["/bantuan", "Bantuan"]])("marks %s active", (path, label) => {
    route.path = path; render(<GamesBottomNav />);
    const nav = screen.getByRole("navigation", { name: "Navigasi Games" });
    expect(nav.querySelectorAll("a").length).toBe(3);
    expect(nav.querySelector('a[aria-current="page"]')?.textContent).toBe(label);
  });

  it("hides on game order page", () => {
    route.path = "/games/mobile-legends"; render(<GamesBottomNav />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("Kategori is a button (no Game link) that opens the genre sheet and closes with Escape/X", async () => {
    route.path = "/games"; render(<GamesBottomNav />);
    const nav = screen.getByRole("navigation", { name: "Navigasi Games" });
    expect(within(nav).queryByRole("link", { name: /^Game/ })).toBeNull();
    expect(nav.querySelector('a[href*="#games-catalog"]')).toBeNull();
    let dialog = await openSheet();
    for (const label of ["Semua", "MOBA", "RPG & Petualangan"]) expect(within(dialog).getByRole("button", { name: label })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    dialog = await openSheet();
    await userEvent.click(within(dialog).getByRole("button", { name: "Tutup" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("on the homepage, picking a genre dispatches the event and closes the sheet", async () => {
    route.path = "/games"; render(<GamesBottomNav />);
    const handler = vi.fn();
    window.addEventListener(AXVARA_GAMES_GENRE_EVENT, handler);
    const dialog = await openSheet();
    await userEvent.click(within(dialog).getByRole("button", { name: "MOBA" }));
    window.removeEventListener(AXVARA_GAMES_GENRE_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toBe("moba");
    expect(route.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("off the homepage, picking a genre navigates to the filtered catalog", async () => {
    route.path = "/games/lacak"; render(<GamesBottomNav />);
    const dialog = await openSheet();
    await userEvent.click(within(dialog).getByRole("button", { name: "Shooter & Battle Royale" }));
    expect(route.push).toHaveBeenCalledWith("/games?genre=shooter#games-catalog");
  });

  it("lists only genres that have games, like the homepage chips", async () => {
    route.path = "/games"; render(<GamesBottomNav games={[{ slug: "mobile-legends" }, { slug: "unmapped-game" }]} />);
    const dialog = await openSheet();
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent).filter(Boolean)).toEqual(["Semua", "MOBA"]);
  });

  it("requestGamesGenre dispatches the custom event directly", () => {
    const handler = vi.fn();
    window.addEventListener(AXVARA_GAMES_GENRE_EVENT, handler);
    requestGamesGenre("shooter");
    window.removeEventListener(AXVARA_GAMES_GENRE_EVENT, handler);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toBe("shooter");
  });

  it("Mark Games = analog stick on Pedia frame", () => {
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
