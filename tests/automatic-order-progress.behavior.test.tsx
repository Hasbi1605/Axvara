// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AutomaticOrderProgress } from "@/components/storefront/AutomaticOrderProgress";
import type { AutomaticProgressItem } from "@/lib/warung-rebahan/progress";
afterEach(cleanup);
const item: AutomaticProgressItem = {label:"Scribd — 30 Hari",stage:"queued",queuePosition:3,total:1,ready:0,updatedAt:null};

it("shows actual queue state without inventing a single-account percentage or exposing supplier branding", () => {
  render(<AutomaticOrderProgress items={[item]} />);
  expect(screen.getByText("Menunggu giliran")).toBeTruthy();
  expect(screen.getByText("Urutan antrean: 3")).toBeTruthy();
  expect(screen.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(false);
  expect(document.body.textContent).not.toMatch(/Jaspay|Warung|12 jam|\d+%/i);
});
it("uses real counts for multiple accounts and reserves 100% for confirmed readiness", () => {
  const {rerender}=render(<AutomaticOrderProgress items={[{...item,stage:"running",total:5,ready:2}]} />);
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
  expect(screen.getByText("2 dari 5 siap")).toBeTruthy();
  rerender(<AutomaticOrderProgress items={[{...item,stage:"running",total:5,ready:5}]} />);
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("99");
  expect(screen.queryByText("100%")).toBeNull();
  rerender(<AutomaticOrderProgress items={[{...item,stage:"ready",total:5,ready:5}]} />);
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  expect(screen.getByText("Produk siap")).toBeTruthy();
});
it("stops the loading animation on partial/error and explains follow-up without asking for a repurchase", () => {
  render(<AutomaticOrderProgress items={[{...item,stage:"needs_check",ready:1,total:2}]} />);
  expect(screen.getByText("Produk sedang diperiksa")).toBeTruthy();
  expect(screen.getByText(/tidak perlu memesan ulang/)).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(document.querySelector('.animate-spin')).toBeNull();
});
it("supports English and reduced motion while preserving text feedback", () => {
  render(<AutomaticOrderProgress items={[{...item,stage:"running"}]} locale="en" />);
  expect(screen.getByText("Creating your product")).toBeTruthy();
  expect(screen.getByRole("progressbar").firstElementChild?.className).toContain("motion-safe:animate-");
});
