// @vitest-environment jsdom
//
// tests/navigation-feedback.behavior.test.tsx — klik yang memicu navigasi
// tidak boleh "bisu" di jaringan lambat (permintaan owner 2026-09-24).
// Dulu RouteLoading baru menyala SETELAH halaman baru tampil, tombol
// Checkout/Beli Sekarang tidak berubah setelah diklik, dan modal varian
// langsung tertutup sehingga pembeli kembali melihat katalog diam.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Product } from "@/lib/products";

const nav = vi.hoisted(() => ({ pathname: "/", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: nav.push, back: vi.fn(), replace: vi.fn() }),
}));

import { NavigationProgress, SHOW_DELAY_MS } from "@/components/ui/NavigationProgress";
import { internalNavigationTarget, useNavigation } from "@/stores/navigation";
import { fetchWithTimeout, FetchTimeoutError } from "@/lib/fetch-timeout";
import { useLoadingStage } from "@/hooks/useLoadingStage";
import { ProductCard } from "@/components/storefront/ProductCard";
import { QuickVariantModal } from "@/components/storefront/QuickVariantModal";
import { routeSkeletonKind } from "@/components/storefront/Skeletons";

beforeEach(() => {
  nav.pathname = "/";
  nav.push.mockClear();
  useNavigation.getState().done();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Links() {
  // jsdom tidak mengimplementasikan navigasi anchor; cegah di fase target
  // (setelah listener capture NavigationProgress berjalan).
  const stop = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div>
      <a href="/produk/netflix-premium" onClick={stop}>produk</a>
      <a href="#katalog" onClick={stop}>hash</a>
      <a href="/#katalog" onClick={stop}>hash-root</a>
      <a href="https://wa.me/6281" onClick={stop}>wa</a>
      <a href="/cara-order" target="_blank" onClick={stop}>tab</a>
      <a href="/qris.png" download onClick={stop}>unduh</a>
    </div>
  );
}

describe("internalNavigationTarget", () => {
  it("hanya navigasi antar-halaman di origin yang sama", () => {
    expect(internalNavigationTarget("/produk/a")?.pathname).toBe("/produk/a");
    expect(internalNavigationTarget("/checkout?buy=a")?.search).toBe("?buy=a");
    expect(internalNavigationTarget("#katalog")).toBeNull();
    expect(internalNavigationTarget("/#katalog")).toBeNull();
    expect(internalNavigationTarget("/")).toBeNull();
    expect(internalNavigationTarget("https://wa.me/6281")).toBeNull();
  });

  it("memilih skeleton sesuai rute tujuan", () => {
    expect(routeSkeletonKind("/")).toBe("home");
    expect(routeSkeletonKind("/produk/netflix")).toBe("product");
    expect(routeSkeletonKind("/checkout")).toBe("checkout");
    expect(routeSkeletonKind("/pesanan/AXV-1")).toBe("order");
    expect(routeSkeletonKind("/artikel/tips")).toBe("content");
    expect(routeSkeletonKind("/admin")).toBeNull();
  });
});

describe("NavigationProgress", () => {
  it("klik Link internal langsung memberi bar + skeleton rute tujuan, sebelum server menjawab", () => {
    vi.useFakeTimers();
    render(<><NavigationProgress /><Links /></>);
    fireEvent.click(screen.getByText("produk"));
    expect(useNavigation.getState()).toMatchObject({ active: true, href: "/produk/netflix-premium" });
    // Navigasi instan (sudah prefetch) tidak berkedip.
    expect(screen.queryByTestId("route-skeleton")).toBeNull();
    act(() => { vi.advanceTimersByTime(SHOW_DELAY_MS + 10); });
    const overlay = screen.getByTestId("route-skeleton");
    expect(overlay.textContent).toContain("Memuat detail produk");
    expect(screen.getByText("Memuat halaman…")).toBeTruthy();
  });

  it("berhenti begitu pathname berubah (rute baru sudah dirender)", () => {
    vi.useFakeTimers();
    const { rerender } = render(<><NavigationProgress /><Links /></>);
    fireEvent.click(screen.getByText("produk"));
    act(() => { vi.advanceTimersByTime(SHOW_DELAY_MS + 10); });
    expect(screen.getByTestId("route-skeleton")).toBeTruthy();
    nav.pathname = "/produk/netflix-premium";
    rerender(<><NavigationProgress /><Links /></>);
    expect(useNavigation.getState().active).toBe(false);
    expect(screen.queryByTestId("route-skeleton")).toBeNull();
  });

  it("tidak menyala untuk hash, link eksternal, tab baru, unduhan, atau klik dengan modifier", () => {
    render(<><NavigationProgress /><Links /></>);
    for (const label of ["hash", "hash-root", "wa", "tab", "unduh"]) {
      fireEvent.click(screen.getByText(label));
      expect(useNavigation.getState().active).toBe(false);
    }
    fireEvent.click(screen.getByText("produk"), { ctrlKey: true });
    expect(useNavigation.getState().active).toBe(false);
  });

  it("8 dtk: kabar koneksi lambat; 20 dtk: Coba lagi / Batal", () => {
    vi.useFakeTimers();
    render(<><NavigationProgress /><Links /></>);
    fireEvent.click(screen.getByText("produk"));
    act(() => { vi.advanceTimersByTime(8_100); });
    expect(screen.getByText(/Koneksi lambat — halaman masih dimuat/)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(12_000); });
    expect(screen.getByText("Halaman belum terbuka.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    expect(useNavigation.getState().active).toBe(false);
    expect(screen.queryByTestId("route-skeleton")).toBeNull();
  });

  it("navigasi terprogram tanpa overlay (checkout → pesanan) hanya memakai bar", () => {
    vi.useFakeTimers();
    render(<NavigationProgress />);
    act(() => { useNavigation.getState().start("/pesanan/AXV-1", { overlay: false }); });
    act(() => { vi.advanceTimersByTime(SHOW_DELAY_MS + 10); });
    expect(screen.queryByTestId("route-skeleton")).toBeNull();
    expect(screen.getByText("Memuat halaman…")).toBeTruthy();
  });
});

describe("fetchWithTimeout + useLoadingStage", () => {
  it("membatalkan permintaan yang menggantung dan melempar FetchTimeoutError", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const pending = fetchWithTimeout("/api/x", {}, 1_000);
    const assertion = expect(pending).rejects.toBeInstanceOf(FetchTimeoutError);
    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;
  });

  it("abort dari pemanggil tetap AbortError, bukan timeout", async () => {
    vi.stubGlobal("fetch", vi.fn((_: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const controller = new AbortController();
    const pending = fetchWithTimeout("/api/x", { signal: controller.signal }, 10_000);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("tahap tunggu naik sesuai ambang dan kembali 0 saat selesai", () => {
    vi.useFakeTimers();
    function Probe({ active }: { active: boolean }) {
      return <span data-testid="stage">{useLoadingStage(active, [1_000, 3_000])}</span>;
    }
    const { rerender } = render(<Probe active />);
    expect(screen.getByTestId("stage").textContent).toBe("0");
    act(() => { vi.advanceTimersByTime(1_001); });
    expect(screen.getByTestId("stage").textContent).toBe("1");
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(screen.getByTestId("stage").textContent).toBe("2");
    rerender(<Probe active={false} />);
    expect(screen.getByTestId("stage").textContent).toBe("0");
  });
});

const simpleProduct = {
  id: "p-1", name: "Canva Pro", slug: "canva-pro", price: 10_000, categorySlug: "design", description: "",
  image: "/brand/axvara-mark.svg", stock: -1, variantCount: 0,
} as unknown as Product;

describe("CTA menuju checkout", () => {
  it("tombol Checkout kartu berputar + nonaktif sampai checkout tampil", () => {
    render(<ProductCard product={simpleProduct} />);
    const button = screen.getByRole("button", { name: /Checkout/ });
    fireEvent.click(button);
    expect(nav.push).toHaveBeenCalledWith("/checkout?buy=canva-pro");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(useNavigation.getState()).toMatchObject({ active: true, href: "/checkout?buy=canva-pro" });
  });

  it("modal varian mode checkout tetap terbuka dengan spinner, bukan langsung tertutup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ product: { variants: [{ id: 11, label: "1 Bulan", price: 25_000, stock: 5, is_active: 1, warranty_type: "none" }] } }),
    }));
    const onClose = vi.fn();
    render(<QuickVariantModal product={simpleProduct} mode="checkout" onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: /1 Bulan/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Beli Sekarang/ }));
    expect(nav.push).toHaveBeenCalledWith("/checkout?buy=canva-pro&variant=11&qty=1");
    expect(onClose).not.toHaveBeenCalled();
    const cta = screen.getByRole("button", { name: /Membuka checkout/ }) as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });

  it("modal varian: skeleton saat memuat, lalu Coba lagi setelah gagal", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ product: { variants: [{ id: 11, label: "1 Bulan", price: 25_000, stock: 5, is_active: 1, warranty_type: "none" }] } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<QuickVariantModal product={simpleProduct} mode="cart" onClose={vi.fn()} />);
    expect(screen.getByRole("status", { name: "Memuat pilihan paket" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Coba lagi" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: /1 Bulan/ })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
