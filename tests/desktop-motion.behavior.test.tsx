// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Spotlight } from "@/components/ui/Spotlight";
import { ScrollRope } from "@/components/storefront/ScrollRope";

const WIDTH = "(min-width: 768px)";
const POINTER = "(pointer: fine)";
const HOVER = "(hover: hover)";
const REDUCED = "(prefers-reduced-motion: reduce)";
let media: Map<string, { matches: boolean; listeners: Set<() => void> }>;
let frames: Map<number, FrameRequestCallback>;

beforeEach(() => {
  media = new Map([WIDTH, POINTER, HOVER, REDUCED].map((query) => [query, { matches: query !== REDUCED, listeners: new Set<() => void>() }]));
  frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal("matchMedia", (query: string) => {
    const value = media.get(query)!;
    return {
      get matches() { return value.matches; },
      addEventListener: (_event: string, listener: () => void) => value.listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => value.listeners.delete(listener),
    };
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("innerHeight", 1000);
  vi.stubGlobal("scrollY", 0);
  vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(3000);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function move(x = 650, y = 360) {
  const event = new Event("pointermove");
  Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y } });
  fireEvent(window, event);
}
function frame() {
  act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(16)); });
}
function settle() {
  for (let i = 0; frames.size && i < 500; i++) frame();
  expect(frames.size).toBe(0);
}
function change(query: string, matches: boolean) {
  act(() => { const value = media.get(query)!; value.matches = matches; value.listeners.forEach((listener) => listener()); });
}

describe("shared desktop decorations", () => {
  it("coalesces pointer movement into one frame and hides the glow on leave", () => {
    const { container } = render(<Spotlight />);
    const glow = container.firstElementChild as HTMLElement;
    expect(frames.size).toBe(0);
    move(100, 200); move(650, 360);
    expect(frames.size).toBe(1);
    frame();
    expect(glow.style.transform).toContain("650px, 360px");
    expect(glow.style.opacity).toBe("1");
    expect(frames.size).toBe(0);
    move();
    fireEvent(window, new Event("pointerleave"));
    expect(glow.style.opacity).toBe("0");
    expect(frames.size).toBe(0);
  });

  it("extends the rope with scroll progress and stops requesting frames after sway settles", () => {
    render(<ScrollRope />);
    const rope = screen.getByTitle("Tarik talinya!");
    settle();
    expect(rope.style.height).toBe("60px");
    vi.stubGlobal("scrollY", 1000);
    fireEvent.scroll(window);
    expect(rope.style.height).toBe("290px");
    settle();
    const before = rope.querySelector("path")!.getAttribute("d");
    fireEvent.click(rope);
    frame();
    expect(rope.querySelector("path")!.getAttribute("d")).not.toBe(before);
    settle();
  });

  it.each([[WIDTH, false], [POINTER, false], [HOVER, false], [REDUCED, true]] as const)("disables all triggers when %s is %s", (query, matches) => {
    media.get(query)!.matches = matches;
    const { container } = render(<><Spotlight /><ScrollRope /></>);
    const glow = container.firstElementChild as HTMLElement;
    const rope = screen.getByTitle("Tarik talinya!");
    const before = rope.querySelector("path")!.getAttribute("d");
    move(); fireEvent.scroll(window); fireEvent.mouseEnter(rope); fireEvent.mouseMove(rope); fireEvent.click(rope);
    expect(glow.style.display).toBe("none");
    expect(rope.style.display).toBe("none");
    expect(rope.querySelector("path")!.getAttribute("d")).toBe(before);
    expect(frames.size).toBe(0);
  });

  it("cancels active effects when reduced motion changes and re-enables them without remounting", () => {
    const { container } = render(<><Spotlight /><ScrollRope /></>);
    const glow = container.firstElementChild as HTMLElement;
    const rope = screen.getByTitle("Tarik talinya!");
    move(); fireEvent.mouseEnter(rope);
    expect(frames.size).toBe(2);
    change(REDUCED, true);
    expect(frames.size).toBe(0);
    expect(glow.style.display).toBe("none");
    expect(rope.style.display).toBe("none");
    move(); fireEvent.click(rope);
    expect(frames.size).toBe(0);
    change(REDUCED, false);
    settle(); move(); frame();
    expect(glow.style.opacity).toBe("1");
    expect(rope.style.display).not.toBe("none");
  });

  it("removes listeners and pending frames when the page unmounts", () => {
    const { unmount } = render(<><Spotlight /><ScrollRope /></>);
    move();
    expect(frames.size).toBe(2);
    unmount();
    expect(frames.size).toBe(0);
    expect([...media.values()].every((value) => value.listeners.size === 0)).toBe(true);
    move(); fireEvent.scroll(window);
    expect(frames.size).toBe(0);
  });
});
