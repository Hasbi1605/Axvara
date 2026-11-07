// @vitest-environment jsdom
// Pedia ID/EN + mata uang tampilan (2026-11-07): switcher yang sama dengan
// Market, teks EN untuk beranda + halaman order, dan harga USD dari
// POST /api/display-prices (fallback Rupiah saat FX tidak tersedia).
// Quote/charge TIDAK diuji di sini — hanya teks tampilan.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";

configure({ asyncUtilTimeout: 4000 });

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/pedia",
  useParams: () => ({ code: "AXP-20261107-ABCD1234" }),
  useSearchParams: () => new URLSearchParams(),
}));

import { DisplayPreferencesProvider } from "@/hooks/useDisplayPrices";
import { preferenceCookie } from "@/lib/i18n/locale";
import { pediaCopy, pediaNumber, pediaServiceName, pediaServiceText } from "@/lib/pedia/copy";
import { pediaDropLabel, pediaTerms, refillPromise } from "@/lib/pedia/terms";
import { PediaNavbar } from "@/components/pedia/PediaNavbar";
import { PediaHomeClient } from "@/app/pedia/home-client";
import { OrderClient } from "@/app/pedia/o/[slug]/order-client";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

const product: PediaCatalogProduct = {
  slug: "followers-instagram", name: "Followers Instagram", platform: "instagram", metric: "followers", target_kind: "profile",
  tagline: null, packages: [100, 250], step: 10, is_featured: 1, min_price: 2000,
  image: null,
  checklist: [{ id: "public", label: "Akun saya publik (tidak dikunci)." }],
  tiers: [
    { id: 2, tier: "standar", label_note: "Global", public_name: "Followers Global HQ", region: "global", quality: "hq", drop_risk: "rendah", refill_days: 30, eta_start: "10 menit", eta_finish: null, prices: { "100": 3000, "250": 7000 }, price_per_1k: 28000, quick_quantities: [100, 250], min_qty: 100, max_qty: 1000 },
  ],
};

const clearCookies = () => document.cookie.split(";").forEach((c) => { const name = c.split("=")[0].trim(); if (name) document.cookie = `${name}=; Max-Age=0; Path=/`; });

/** fetch: display-prices sesuai preferensi, harga Pedia selalu kosong (bukan fokus tes ini). */
function stubFetch(fx: { available: boolean; effectiveAt: string | null }) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/display-prices") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { amounts: number[] };
      return Response.json({
        locale: "id", currency: "USD",
        fx,
        items: (body.amounts ?? []).map((idr) => ({ idr, usdCents: fx.available ? String(Math.round(idr * 0.0614)) : null })),
      });
    }
    return Response.json({ product_slug: product.slug, quantity: 0, prices: [] });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  clearCookies();
  document.documentElement.lang = "id";
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Pedia terjemahan teks layanan (murni)", () => {
  it("menerjemahkan istilah nama tanpa mengubah SMM term/angka; fallback ID bila tak dikenal", () => {
    expect(pediaServiceName("Followers Global HQ · Akun berpostingan · Instant Start", "en")).toBe("Followers Global HQ · Accounts with posts · Instant Start");
    expect(pediaServiceName("Komentar Custom Indonesia Real Human", "en")).toBe("Custom Comments Indonesia Real Human");
    expect(pediaServiceName("Followers Global HQ", "id")).toBe("Followers Global HQ");
    expect(pediaServiceText("Jumlah per pesanan 100–20.000.", "en")).toBe("Quantity per order 100–20,000.");
    expect(pediaServiceText("No Refill: jumlah yang drop tidak diisi ulang.", "en")).toBe("No Refill: dropped quantity is not topped up.");
    expect(pediaServiceText("Refill 30 hari sejak pesanan dibuat, selama layanan masih tersedia.", "en")).toBe("Refill 30 days since the order was created, while the service is still available.");
    expect(pediaServiceText("Kalimat yang belum diterjemahkan.", "en")).toBe("Kalimat yang belum diterjemahkan.");
    expect(pediaNumber(20000, "en")).toBe("20,000");
    expect(pediaNumber(20000, "id")).toBe("20.000");
  });

  it("kebijakan/istilah sama di kedua bahasa dan copy default Indonesia", () => {
    expect(pediaCopy("id").browse).toBe("Lihat layanan");
    expect(pediaCopy("en").browse).toBe("Browse services");
    expect(pediaTerms("en").map((t) => t.term)).toEqual(pediaTerms("id").map((t) => t.term));
    expect(pediaDropLabel("high_drop", "en")).toBe("High Drop");
    expect(refillPromise(30, "created", "en")).toBe("Refill 30 days since the order was created, while the service is still available.");
    expect(refillPromise(30, "created", "id")).toBe("Refill 30 hari sejak pesanan dibuat, selama layanan masih tersedia.");
  });
});

describe("Pedia bahasa + mata uang", () => {
  it("beranda EN: judul, navigasi, dan switcher bahasa/mata uang yang sama dengan Market tampil", async () => {
    document.cookie = preferenceCookie("axv_locale", "en", false);
    document.cookie = preferenceCookie("axv_currency", "IDR", false);
    stubFetch({ available: false, effectiveAt: null });
    render(<DisplayPreferencesProvider><PediaNavbar /><PediaHomeClient products={[product]} /></DisplayPreferencesProvider>);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("One place for"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("social media growth");
    expect(screen.getByRole("button", { name: /Language and currency/ })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Pedia navigation" })).toBeTruthy();
    expect(screen.getAllByText("Browse services").length).toBeGreaterThan(0);
    expect(screen.queryByText("Satu tempat untuk")).toBeNull();
  });

  it("halaman order EN: langkah, judul, label jumlah, dan checklist diterjemahkan tanpa mengubah data", async () => {
    document.cookie = preferenceCookie("axv_locale", "en", false);
    document.cookie = preferenceCookie("axv_currency", "IDR", false);
    stubFetch({ available: false, effectiveAt: null });
    render(<DisplayPreferencesProvider><OrderClient product={product} initialTarget="" ordersEnabled /></DisplayPreferencesProvider>);
    await waitFor(() => expect(screen.getByRole("heading", { name: "What do you want to grow?" })).toBeTruthy());
    expect(screen.getByLabelText("Quantity to order")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Next: target" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Step 1: Service" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Followers Global HQ/i }));
    fireEvent.change(screen.getByLabelText("Quantity to order"), { target: { value: "250" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Next: target" })[0]);
    await waitFor(() => expect(screen.getByText("My account is public (not locked).")).toBeTruthy());
  });

  it("USD: harga Pedia tampil dalam US$ dari server; tanpa FX kembali ke Rupiah", async () => {
    document.cookie = preferenceCookie("axv_locale", "id", false);
    document.cookie = preferenceCookie("axv_currency", "USD", false);
    const fetchMock = stubFetch({ available: true, effectiveAt: new Date().toISOString() });
    const view = render(<DisplayPreferencesProvider><OrderClient product={product} initialTarget="" ordersEnabled /></DisplayPreferencesProvider>);
    fireEvent.click(await screen.findByRole("radio", { name: /Followers Global HQ/i }));
    await waitFor(() => expect(screen.getAllByText(/US\$/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/US\$/).some((el) => el.textContent?.includes("US$"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/display-prices")).toBe(true);
    view.unmount();

    cleanup();
    clearCookies();
    document.cookie = preferenceCookie("axv_locale", "id", false);
    document.cookie = preferenceCookie("axv_currency", "USD", false);
    stubFetch({ available: false, effectiveAt: null });
    render(<DisplayPreferencesProvider><OrderClient product={product} initialTarget="" ordersEnabled /></DisplayPreferencesProvider>);
    fireEvent.click(await screen.findByRole("radio", { name: /Followers Global HQ/i }));
    await waitFor(() => expect(screen.queryAllByText(/US\$/).length).toBe(0));
    expect(document.body.textContent).toContain("Rp");
  });
});
