// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { HomeClient } from "@/app/(shop)/home-client";
import { CategoryPills } from "@/components/storefront/CategoryPills";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const categories = [{ id: 1, name: "AI & Chatbot", slug: "ai-chatbot", sort_order: 10 }, { id: 2, name: "Desain & Video", slug: "desain-video", sort_order: 20 }];
const media = (reduced = false) => vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }));

it("measures navbar and highlights the intersecting section without unselecting Semua", () => {
  media();
  const observers: { callback: IntersectionObserverCallback; options?: IntersectionObserverInit; observed: Element[]; disconnect: () => void }[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    observer: typeof observers[number];
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { this.observer = { callback, options, observed: [], disconnect: vi.fn() }; observers.push(this.observer); }
    observe(element: Element) { this.observer.observed.push(element); }
    disconnect() { this.observer.disconnect(); }
  });
  const nav = document.createElement("header");
  nav.dataset.storeNavbar = "true";
  nav.getBoundingClientRect = () => ({ height: 92 }) as DOMRect;
  document.body.append(nav);
  const { container, unmount } = render(<HomeClient initialCategories={categories} initialProducts={categories.map((category, index) => ({ id: String(index + 1), slug: category.slug, name: category.name, description: "", price: 10000, categorySlug: category.slug, image: "" }))} />);
  const observer = observers.findLast(item => item.observed.some(element => element.hasAttribute("data-catalog-category")))!;
  expect(observer.options?.rootMargin).toBe("-92px 0px -55% 0px"); // jsdom: pills offsetHeight=0.
  const section = container.querySelector('[data-catalog-category="desain-video"]')!;
  act(() => observer.callback([{ target: section, isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver));
  const highlighted = screen.getByRole("button", { name: "Desain & Video" });
  expect(highlighted.className).toContain("border-[#00E5FF]/35");
  expect(highlighted.getAttribute("aria-pressed")).toBe("false");
  expect((section as HTMLElement).dataset.revealed).toBe("true");
  expect(screen.getByRole("button", { name: "Semua" }).getAttribute("aria-pressed")).toBe("true");
  expect((container.querySelector(".sticky") as HTMLElement).style.top).toBe("92px");
  unmount();
  expect(observer.disconnect).toHaveBeenCalled();
  nav.remove();
});

it("horizontal reveal only scrolls the pill container, and respects reduced motion", () => {
  media(true);
  const { container, rerender } = render(<CategoryPills categories={categories} active="semua" onChange={() => {}} />);
  const root = container.firstElementChild as HTMLElement;
  Object.defineProperty(root, "scrollWidth", { value: 700 });
  Object.defineProperty(root, "clientWidth", { value: 300 });
  root.getBoundingClientRect = () => ({ left: 0 }) as DOMRect;
  const pill = screen.getByRole("button", { name: "Desain & Video" });
  pill.getBoundingClientRect = () => ({ left: 400 }) as DOMRect;
  Object.defineProperty(pill, "offsetWidth", { value: 100 });
  const scroll = vi.fn();
  root.scrollTo = scroll;
  const pageScroll = vi.spyOn(window, "scrollTo");
  rerender(<CategoryPills categories={categories} active="semua" inView="desain-video" onChange={() => {}} />);
  expect(scroll).toHaveBeenCalledWith({ left: 200, behavior: "auto" });
  expect(pageScroll).not.toHaveBeenCalled();
  pageScroll.mockRestore();
});
