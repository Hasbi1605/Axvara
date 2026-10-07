// @vitest-environment jsdom
//
// Dashboard Fase 1 render: kartu periode default Minggu + Untung Produk +
// grafik + tabel supplier/channel tampil tanpa crash.
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { AdminOverview, EMPTY_ADMIN_OVERVIEW } from "@/components/admin/AdminOverview";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => cleanup());

const data = {
  ...EMPTY_ADMIN_OVERVIEW,
  total_orders: 10,
  pending_orders: 2,
  orders_week: 4,
  revenue_week: 100000,
  cost_week: 60000,
  profit_week: 40000,
  profit_by_supplier: {
    wr: { orders: 2, revenue: 50000, cost: 30000, profit: 20000 },
    sk: { orders: 1, revenue: 30000, cost: 20000, profit: 10000 },
    manual: { orders: 1, revenue: 20000, cost: 10000, profit: 10000 },
  },
  top_profit_products: [{ name: "Netflix", qty: 2, revenue: 50000, cost: 30000, profit: 20000 }],
  profit_by_channel: {
    web: { orders: 2, revenue: 50000, profit: 20000 },
    telegram: { orders: 2, revenue: 50000, profit: 20000 },
    whatsapp: { orders: 0, revenue: 0, profit: 0 },
  },
  daily_series: [
    { date: "2026-10-06", orders: 1, revenue: 50000, cost: 30000, profit: 20000 },
    { date: "2026-10-07", orders: 3, revenue: 50000, cost: 30000, profit: 20000 },
  ],
  low_stock: 3,
};

it("default periode Minggu: Untung Produk + margin + supplier + grafik tampil", async () => {
  render(<AdminOverview data={data} loading={false} />);
  await act(async () => {});
  // Switcher periode + default Minggu aktif.
  expect(screen.getByRole("tab", { name: "Minggu ini" }).getAttribute("aria-selected")).toBe("true");
  // Kartu Untung Produk minggu = 40rb (formatRupiah = "Rp" + NBSP + angka).
  expect(screen.getByText("Untung Produk")).toBeTruthy();
  expect(screen.getByText((_, el) => el?.textContent?.replace(/\s/g, "") === "Rp40.000")).toBeTruthy();
  expect(screen.getByText("40.0%")).toBeTruthy();
  // Tabel supplier + top produk + grafik.
  expect(screen.getByText("Untung per supplier")).toBeTruthy();
  expect(screen.getByText("Netflix")).toBeTruthy();
  expect(screen.getByText("Omzet vs Untung — 30 hari")).toBeTruthy();
  expect(document.querySelector("svg")).toBeTruthy();
  // 3 card legacy terhapus dari Ringkasan.
  expect(screen.queryByText("Perlu tindakan")).toBeNull();
  expect(screen.queryByText("Kinerja toko")).toBeNull();
  expect(screen.queryByText("Kesehatan sistem")).toBeNull();
  // Teks rumus terhapus.
  expect(screen.queryByText(/Belum termasuk biaya operasional/)).toBeNull();
});

it("grafik interaktif: toggle chip + tooltip harian", async () => {
  render(<AdminOverview data={data} loading={false} />);
  await act(async () => {});
  // Chip toggle Order (mati default) bisa dinyalakan.
  const orderChip = screen.getByRole("button", { name: /Order/ });
  expect(orderChip.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(orderChip);
  await act(async () => {});
  expect(orderChip.getAttribute("aria-pressed")).toBe("true");
  // Tooltip harian muncul (ambil titik pertama via title svg).
  const zones = document.querySelectorAll("svg rect");
  expect(zones.length).toBeGreaterThan(0);
  fireEvent.click(zones[0]);
  await act(async () => {});
  expect(screen.getByRole("status")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("2026-10-06");
});

it("ganti ke Hari ini mengubah angka kartu", async () => {
  render(<AdminOverview data={{ ...data, orders_today: 1, revenue_today: 25000, cost_today: 10000, profit_today: 15000 }} loading={false} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("tab", { name: "Hari ini" }));
  await act(async () => {});
  expect(screen.getByText((_, el) => el?.textContent?.replace(/\s/g, "") === "Rp15.000")).toBeTruthy();
});

it("badge Stok menipis memanggil onLowStock (filter ikut ke Produk)", async () => {
  const onLowStock = vi.fn();
  render(<AdminOverview data={data} loading={false} onLowStock={onLowStock} />);
  await act(async () => {});
  const badge = screen.getByRole("button", { name: /Stok menipis/ });
  fireEvent.click(badge);
  expect(onLowStock).toHaveBeenCalledTimes(1);
});
