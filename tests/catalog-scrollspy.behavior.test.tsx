// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { HomeClient } from "@/app/(shop)/home-client";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const categories = [{ id: 1, name: "AI & Chatbot", slug: "ai-chatbot", sort_order: 10 }, { id: 2, name: "Desain & Video", slug: "desain-video", sort_order: 20 }];
const media = (reduced = false) => vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }));

it("measures navbar for sticky pills, reveals section icons once, and never tints pills while scrolling", () => {
  media();
  const observers: { callback: IntersectionObserverCallback; options?: IntersectionObserverInit; observed: Element[]; unobserved: Element[]; disconnect: () => void }[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    observer: typeof observers[number];
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { this.observer = { callback, options, observed: [], unobserved: [], disconnect: vi.fn() }; observers.push(this.observer); }
    observe(element: Element) { this.observer.observed.push(element); }
    unobserve(element: Element) { this.observer.unobserved.push(element); }
    disconnect() { this.observer.disconnect(); }
  });
  const nav = document.createElement("header");
  nav.dataset.storeNavbar = "true";
  nav.getBoundingClientRect = () => ({ height: 92 }) as DOMRect;
  document.body.append(nav);
  const { container, unmount } = render(<HomeClient initialCategories={categories} initialProducts={categories.map((category, index) => ({ id: String(index + 1), slug: category.slug, name: category.name, description: "", price: 10000, categorySlug: category.slug, image: "" }))} />);
  const observer = observers.findLast(item => item.observed.some(element => element.hasAttribute("data-catalog-category")))!;
  const section = container.querySelector('[data-catalog-category="desain-video"]')!;
  act(() => observer.callback([{ target: section, isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver));
  expect((section as HTMLElement).dataset.revealed).toBe("true");
  expect(observer.unobserved).toContain(section);
  const pill = screen.getByRole("button", { name: "Desain & Video" });
  expect(pill.className).not.toMatch(/(bg|border|text)-\[#00E5FF\]/);
  expect(pill.getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByRole("button", { name: "Semua" }).getAttribute("aria-pressed")).toBe("true");
  expect((container.querySelector(".sticky") as HTMLElement).style.top).toBe("92px");
  unmount();
  expect(observer.disconnect).toHaveBeenCalled();
  nav.remove();
});
