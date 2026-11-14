// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CrossAppTransition } from "@/components/ui/CrossAppTransition";
import { SITE } from "@/lib/site";

afterEach(cleanup);

describe("CrossAppTransition — AXVARA Games (14 Nov 2026)", () => {
  it("shows the Games loader when a link points to the Games host", () => {
    render(<><CrossAppTransition /><a href={`${SITE.gamesUrl}/`} onClick={(e) => e.preventDefault()}>Games</a></>);
    expect(screen.queryByTestId("cross-app-transition")).toBeNull();
    fireEvent.click(screen.getByText("Games"));
    expect(screen.getByTestId("cross-app-transition").textContent).toContain("Memuat AXVARA Games");
    expect(document.querySelector('[data-testid="cross-app-transition"] img')!.getAttribute("src")).toBe(SITE.gamesMark);
  });
});
