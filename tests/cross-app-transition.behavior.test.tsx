// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CrossAppTransition } from "@/components/ui/CrossAppTransition";
import { SITE } from "@/lib/site";
afterEach(cleanup);
it.each([[SITE.pediaUrl, "Pedia"], [SITE.webUrl, "Market"]])("keeps a white destination logo and resets on bfcache for %s", (url, label) => {
  render(<><CrossAppTransition /><a href={url} onClick={e => e.preventDefault()}>Pindah</a></>);
  fireEvent.click(screen.getByRole("link", { name: "Pindah" }));
  const overlay = screen.getByRole("status", { name: `Memuat AXVARA ${label}` });
  expect(overlay.querySelector(".ax-brand-ring")).toBeTruthy();
  expect(overlay.querySelector("img")!.className).toContain("ax-brand-logo");
  expect(overlay.querySelector("img")!.className).not.toContain("animate-spin");
  expect(overlay.querySelector("img")!.className).toContain("brightness-0 invert");
  fireEvent(window, new Event("pageshow"));
  expect(screen.queryByRole("status")).toBeNull();
});
