// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrbitHero } from "@/components/storefront/OrbitHero";
import { PediaOrbit } from "@/components/pedia/PediaOrbit";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each([["Market", OrbitHero, "ChatGPT"], ["Pedia", PediaOrbit, "TikTok"]] as const)("%s orbit", (_name, Component, planet) => {
  it.each([true, false])("reacts to motion changes and cleans up (initial reduce: %s)", (initial) => {
    let reduced = initial;
    let hidden = false;
    let intersection: (entries: { isIntersecting: boolean }[]) => void = () => {};
    const listeners = new Set<() => void>();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const motion = {
      get matches() { return reduced; },
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    };
    vi.stubGlobal("matchMedia", (query: string) => query.includes("reduced-motion") ? motion : { matches: false });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++nextFrame, cb); return nextFrame; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const disconnect = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(cb: typeof intersection) { intersection = cb; }
      observe() {}
      disconnect() { disconnect(); }
    });
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 100 } as DOMRect);

    const { getByTitle, unmount } = render(<Component />);
    const element = getByTitle(planet);
    expect(element.style.transform).toContain("px");
    expect(frames.size).toBe(initial ? 0 : 1);
    const setMotion = (value: boolean) => act(() => { reduced = value; listeners.forEach((cb) => cb()); });
    setMotion(true);
    expect(frames.size).toBe(0);
    const position = element.style.transform;
    act(() => intersection([{ isIntersecting: false }]));
    setMotion(false);
    expect(frames.size).toBe(0);
    act(() => intersection([{ isIntersecting: true }]));
    expect(frames.size).toBe(1);
    act(() => {
      const [id, callback] = [...frames.entries()][0];
      frames.delete(id);
      callback(100);
    });
    expect(element.style.transform).not.toBe(position);
    const animatedPosition = element.style.transform;
    setMotion(true);
    expect(frames.size).toBe(0);
    expect(element.style.transform).toBe(animatedPosition);
    hidden = true;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    setMotion(false);
    expect(frames.size).toBe(0);
    hidden = false;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
    expect(listeners.size).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
