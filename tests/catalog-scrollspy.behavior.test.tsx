// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HomeClient } from "@/app/(shop)/home-client";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(window.location.search) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });
const categories = [{ id: 1, name: "AI & Chatbot", slug: "ai-chatbot", sort_order: 10 }, { id: 2, name: "Desain & Video", slug: "desain-video", sort_order: 20 }];
const media = (reduced = false) => vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }));

it("renders the legacy query filter on catalog arrival and clears it when the URL drops the query", () => {
  media();
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  const products = categories.map((cat, i) => ({ id: String(i), slug: cat.slug, name: `Fixture ${cat.slug}`, description: "", price: 10000, categorySlug: cat.slug, image: "" }));
  window.history.replaceState(null, "", "/?category=ai-gateway#katalog");
  const { rerender } = render(<HomeClient initialCategories={categories} initialProducts={products} />);
  expect(screen.getByRole("heading", { name: "Fixture ai-chatbot" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Fixture desain-video" })).toBeNull();
  window.history.pushState(null, "", "/#katalog");
  rerender(<HomeClient initialCategories={categories} initialProducts={products} />);
  expect(screen.getByRole("heading", { name: "Fixture desain-video" })).toBeTruthy();
});

it("keeps pills in normal flow without an outer surface or divider, and reveals section icons without tinting pills", () => {
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
  const strip = screen.getByLabelText("Kategori produk");
  expect(container.querySelector("#katalog")!.firstElementChild).toBe(screen.getByRole("heading", { name: "Katalog Premium" }));
  expect(screen.getByRole("heading", { name: "Katalog Premium" }).nextElementSibling).toBe(strip.parentElement);
  expect(strip.parentElement!.className).toBe("mt-4");
  expect(strip.parentElement!.getAttribute("style")).toBeNull();
  expect(strip.className).toContain("-mx-4 px-4 sm:mx-0 sm:px-0");
  expect(strip.className).toContain("pb-2");
  expect(pill.className).toContain("focus-visible:-outline-offset-2");
  const groups = [...container.querySelectorAll("[data-catalog-category]")];
  expect(groups[0].className).toContain("mt-3 sm:mt-4");
  expect(groups[1].className).toContain("mt-10 sm:mt-14");
  expect(groups[0].firstElementChild!.className).toContain("mb-4");
  unmount();
  expect(observer.disconnect).toHaveBeenCalled();
  nav.remove();
});

it("filters and resets pagination without scrolling on category/All clicks; the category sheet still scrolls", () => {
  media();
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  const { container } = render(<HomeClient initialCategories={categories} initialProducts={Array.from({ length: 20 }, (_, index) => ({ id: String(index + 1), slug: `product-${index + 1}`, name: `Product ${index + 1}`, description: "", price: 10000, categorySlug: index < 18 ? "ai-chatbot" : "desain-video", image: "" }))} />);
  const scroll = vi.fn();
  container.querySelector<HTMLElement>("#katalog")!.scrollIntoView = scroll;
  const ai = screen.getByRole("button", { name: "AI & Chatbot" });
  fireEvent.click(ai);
  expect(ai.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(16);
  expect(screen.queryByText(/\d+ produk • tampil \d+/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Tampilkan semua/ }));
  expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(18);
  fireEvent.click(screen.getByRole("button", { name: "Desain & Video" }));
  expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Semua" }));
  expect(container.querySelectorAll("[data-catalog-category]")).toHaveLength(2);
  fireEvent.click(ai);
  expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(16);
  expect(scroll).not.toHaveBeenCalled();
  vi.useFakeTimers();
  try {
    act(() => window.dispatchEvent(new CustomEvent("axvara:category", { detail: "desain-video" })));
    act(() => vi.advanceTimersByTime(60));
    expect(scroll).toHaveBeenCalledOnce();
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
  } finally { vi.useRealTimers(); }
});
