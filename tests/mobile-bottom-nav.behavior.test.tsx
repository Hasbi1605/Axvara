// @vitest-environment jsdom
//
// tests/mobile-bottom-nav.behavior.test.tsx — Bottom nav mobile Beranda ·
// Keranjang · Pesanan · Bantuan (keputusan owner 2026-09-25) + daftar
// "Pesanan di perangkat ini" yang menjadi tujuan tab Pesanan.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCart } from "@/stores/cart";
import { LOCAL_ORDERS_KEY, freshPendingCodes, readLocalOrders, settleLocalOrder } from "@/lib/local-orders";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { MobileBottomNav } from "@/components/storefront/MobileBottomNav";
import { DeviceOrders, DEVICE_ORDERS_MAX } from "@/components/storefront/DeviceOrders";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
function seedLocal(orders: Record<string, unknown>[]) {
  localStorage.setItem(LOCAL_ORDERS_KEY, JSON.stringify(orders));
}

beforeEach(() => {
  nav.pathname = "/";
  localStorage.clear();
  sessionStorage.clear();
  useCart.setState({ items: [], drawerOpen: false });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const bar = () => screen.getByRole("navigation", { name: "Navigasi Bawah" });

describe("bottom nav mobile", () => {
  it("empat tab: Beranda, Keranjang, Pesanan, Bantuan (tanpa Cara Order/Katalog/Artikel)", () => {
    render(<MobileBottomNav />);
    const labels = [...bar().querySelectorAll("a, button")].map((el) => el.textContent?.trim());
    expect(labels).toEqual(["Beranda", "Keranjang", "Pesanan", "Bantuan"]);
    expect(within(bar()).getByRole("link", { name: "Beranda" }).getAttribute("href")).toBe("/");
    expect(within(bar()).getByRole("link", { name: "Pesanan" }).getAttribute("href")).toBe("/lacak-pesanan");
  });

  it("Keranjang membuka drawer dan menampilkan jumlah baris", () => {
    useCart.setState({ items: [{ id: "1", slug: "a", name: "A", price: 1, qty: 3 } as never, { id: "2", slug: "b", name: "B", price: 1, qty: 1 } as never] });
    render(<MobileBottomNav />);
    const cart = within(bar()).getByRole("button", { name: "Keranjang, 2 barang" });
    expect(cart.textContent).toContain("2");
    fireEvent.click(cart);
    expect(useCart.getState().drawerOpen).toBe(true);
  });

  it("titik Pesanan hanya untuk pesanan pending yang masih hidup, hilang setelah status tercatat", async () => {
    seedLocal([
      { code: "AXV-20260925-OLD00001", status: "pending", createdAt: minutesAgo(90) },
      { code: "AXV-20260925-PAID0001", status: "lunas", createdAt: minutesAgo(5) },
    ]);
    const { unmount } = render(<MobileBottomNav />);
    expect(within(bar()).getByRole("link", { name: "Pesanan" })).toBeTruthy();
    unmount();

    seedLocal([{ code: "AXV-20260925-NEW00001", status: "pending", createdAt: minutesAgo(5) }]);
    render(<MobileBottomNav />);
    await waitFor(() => expect(within(bar()).getByRole("link", { name: "Pesanan, ada pesanan belum dibayar" })).toBeTruthy());
    act(() => settleLocalOrder("AXV-20260925-NEW00001", "lunas"));
    await waitFor(() => expect(within(bar()).getByRole("link", { name: "Pesanan" })).toBeTruthy());
  });

  it("Bantuan membuka panel berisi WA, Telegram, Cara Order, Garansi, Artikel; Escape menutup", () => {
    render(<MobileBottomNav />);
    const help = within(bar()).getByRole("button", { name: "Bantuan" });
    expect(help.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(help);
    const dialog = screen.getByRole("dialog", { name: "Bantuan" });
    expect(help.getAttribute("aria-expanded")).toBe("true");
    expect(within(dialog).getByRole("link", { name: /WA Admin/ }).getAttribute("href")).toMatch(/^https:\/\/wa\.me\//);
    expect(within(dialog).getByRole("link", { name: "Telegram @axvara_support" }).getAttribute("href")).toBe("https://t.me/axvara_support");
    expect(within(dialog).getByRole("link", { name: /^Cara Order/ }).getAttribute("href")).toBe("/cara-order");
    expect(within(dialog).getByRole("link", { name: /^Garansi & Replace/ }).getAttribute("href")).toBe("/garansi-replace");
    expect(within(dialog).getByRole("link", { name: /^Artikel/ }).getAttribute("href")).toBe("/artikel");
    expect(within(dialog).getAllByRole("link")).toHaveLength(5);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Bantuan" })).toBeNull();
  });

  it("tab aktif mengikuti rute; tersembunyi di PDP, checkout, dan admin", () => {
    nav.pathname = "/pesanan/AXV-20260925-AAAA0001";
    const { rerender } = render(<MobileBottomNav />);
    expect(within(bar()).getByRole("link", { name: "Pesanan" }).getAttribute("aria-current")).toBe("page");
    expect(within(bar()).getByRole("link", { name: "Beranda" }).getAttribute("aria-current")).toBeNull();
    for (const path of ["/produk/claude-pro", "/checkout", "/admin"]) {
      nav.pathname = path;
      rerender(<MobileBottomNav />);
      expect(screen.queryByRole("navigation", { name: "Navigasi Bawah" })).toBeNull();
    }
  });
});

describe("Pesanan di perangkat ini (/lacak-pesanan)", () => {
  function stubStatuses(map: Record<string, { status: number; order?: Record<string, unknown> }>) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const code = new URL(String(input), "http://x").searchParams.get("code") ?? "";
      calls.push(code);
      const hit = map[code] ?? { status: 500 };
      return { ok: hit.status === 200, status: hit.status, json: async () => ({ order: hit.order }) };
    }));
    return calls;
  }

  it("status dari server: pending → Bayar sekarang, selesai → Lihat pesanan; 404 disembunyikan; batal tidak dicek ulang", async () => {
    seedLocal([
      { code: "AXV-20260925-PEND0001", status: "pending", createdAt: minutesAgo(3), items: [{ name: "Claude Pro — 28 - 30 September", qty: 1 }], subtotal: 24_000 },
      { code: "AXV-20260924-DONE0001", status: "pending", createdAt: minutesAgo(600), items: [{ name: "Canva Pro — Invite 1 Bulan", qty: 1 }], subtotal: 2_000 },
      { code: "AXV-20260924-GONE0001", status: "pending", createdAt: minutesAgo(700), items: [], subtotal: 1_000 },
      { code: "AXV-20260923-BTAL0001", status: "dibatalkan", createdAt: minutesAgo(2000), items: [{ name: "Netflix", qty: 1 }], subtotal: 30_000 },
      { code: "AXV-20260801-LAMA0001", status: "pending", createdAt: minutesAgo(60 * 24 * 40), items: [], subtotal: 1 },
    ]);
    const calls = stubStatuses({
      "AXV-20260925-PEND0001": { status: 200, order: { status: "pending", subtotal: 24_000, qris: { payable_amount: 24_037 } } },
      "AXV-20260924-DONE0001": { status: 200, order: { status: "lunas", fulfillment_status: "delivered", subtotal: 2_000 } },
      "AXV-20260924-GONE0001": { status: 404 },
    });
    render(<DeviceOrders />);
    const section = await screen.findByRole("region", { name: "Pesanan di perangkat ini" });
    await waitFor(() => expect(within(section).getByText("Menunggu pembayaran")).toBeTruthy());
    await waitFor(() => expect(within(section).getByText("Selesai")).toBeTruthy());
    await waitFor(() => expect(within(section).queryByText("AXV-20260924-GONE0001")).toBeNull());
    expect(within(section).getByText("Dibatalkan")).toBeTruthy();
    expect(within(section).queryByText("AXV-20260801-LAMA0001")).toBeNull();
    expect(within(section).getByRole("link", { name: "Bayar sekarang" }).getAttribute("href")).toBe("/pesanan/AXV-20260925-PEND0001");
    expect(within(section).getAllByRole("link", { name: "Lihat pesanan" }).map((a) => a.getAttribute("href")))
      .toEqual(["/pesanan/AXV-20260924-DONE0001", "/pesanan/AXV-20260923-BTAL0001"]);
    expect(calls.sort()).toEqual(["AXV-20260924-DONE0001", "AXV-20260924-GONE0001", "AXV-20260925-PEND0001"]);
    const local = Object.fromEntries(readLocalOrders().map((o) => [o.code, o.status]));
    expect(local["AXV-20260924-DONE0001"]).toBe("lunas");
    expect(local["AXV-20260924-GONE0001"]).toBe("missing");
    expect(local["AXV-20260925-PEND0001"]).toBe("pending");
  });

  it(`maksimal ${DEVICE_ORDERS_MAX} pesanan terbaru; tombol sembunyikan menghapus dari perangkat`, async () => {
    seedLocal(Array.from({ length: 7 }, (_, i) => ({ code: `AXV-20260925-MANY000${i}`, status: "kadaluarsa", createdAt: minutesAgo(10 + i), items: [], subtotal: 1_000 })));
    const calls = stubStatuses({});
    render(<DeviceOrders />);
    const section = await screen.findByRole("region", { name: "Pesanan di perangkat ini" });
    expect(within(section).getAllByRole("listitem")).toHaveLength(DEVICE_ORDERS_MAX);
    expect(calls).toEqual([]);
    fireEvent.click(within(section).getByRole("button", { name: "Sembunyikan AXV-20260925-MANY0000 dari perangkat ini" }));
    expect(readLocalOrders().some((o) => o.code === "AXV-20260925-MANY0000")).toBe(false);
  });

  it("tanpa pesanan lokal, bagian ini tidak tampil", () => {
    render(<DeviceOrders />);
    expect(screen.queryByRole("region", { name: "Pesanan di perangkat ini" })).toBeNull();
  });
});

describe("local-orders", () => {
  it("freshPendingCodes: pending < 75 menit, terbaru dulu, bisa dikecualikan", () => {
    seedLocal([
      { code: "A", status: "pending", createdAt: minutesAgo(10) },
      { code: "B", status: "pending", createdAt: minutesAgo(2) },
      { code: "C", status: "pending", createdAt: minutesAgo(80) },
      { code: "D", status: "lunas", createdAt: minutesAgo(1) },
    ]);
    expect(freshPendingCodes(Date.now())).toEqual(["B", "A"]);
    expect(freshPendingCodes(Date.now(), new Set(["B"]))).toEqual(["A"]);
  });
});
