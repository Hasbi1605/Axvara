// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GamesNavbar } from "@/components/games/GamesNavbar";
import { PediaNavbar } from "@/components/pedia/PediaNavbar";
import { GamesTrack } from "@/app/games/lacak/track-client";
import { GAMES_RECENT_KEY } from "@/lib/games/order-copy";
import { BuyerOrderPin } from "@/components/storefront/BuyerOrderPin";
import { OrderTicker } from "@/components/pedia/OrderTicker";
import { usePediaSearch } from "@/stores/pedia-search";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/pedia/lacak", useRouter: () => ({ push }) }));
vi.mock("@/hooks/useDisplayPrices", () => ({ useDisplayLocale: () => "en" }));
vi.mock("@/components/storefront/PreferenceControls", () => ({ PreferenceControls: () => null }));
vi.mock("@/components/shared/ServicesMenu", () => ({ ServicesMenu: () => null }));
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); usePediaSearch.getState().setQ(""); push.mockClear(); vi.unstubAllGlobals(); });

it("closes the Games overlay with Escape and restores focus to the mobile trigger", () => {
  render(<GamesNavbar games={[]} />);
  const trigger = screen.getByRole("button", { name: /search/i });
  fireEvent.click(trigger);
  const input = screen.getAllByRole("searchbox")[1];
  fireEvent.change(input, { target: { value: "does-not-exist" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("Pedia search off the catalog waits for form submission", () => {
  render(<PediaNavbar />);
  const input = screen.getByRole("searchbox");
  fireEvent.change(input, { target: { value: "instagram" } });
  expect(push).not.toHaveBeenCalled();
  fireEvent.submit(input.closest("form")!);
  expect(push).toHaveBeenCalledWith("/pedia/layanan");
});

it("prompts for contact on a Games recent entry without usable proof", () => {
  const code = "AXG-20261121-TEST1234";
  localStorage.setItem(GAMES_RECENT_KEY, JSON.stringify([{ code, contact: "invalid" }]));
  render(<GamesTrack />);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${code}`) }));
  const input = document.getElementById("games-track-contact");
  expect(document.activeElement).toBe(input);
  expect(input?.getAttribute("aria-invalid")).toBe("true");
});

it("shows a non-retrying PIN notice for a denied request", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 403 })));
  render(<BuyerOrderPin code="AXV-20261121-TEST1234" credentialToken="fixture" locale="en" />);
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Could not load the PIN"));
  expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
});

it("localizes the decorative ticker without exposing it to assistive tech", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  render(<OrderTicker items={[{ text: "Instagram" }]} />);
  expect(screen.getByText(/just now: Instagram/i).getAttribute("aria-hidden")).toBe("true");
});
