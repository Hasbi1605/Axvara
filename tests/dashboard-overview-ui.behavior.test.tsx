// @vitest-environment jsdom
//
// Dashboard Fase 1 render: kartu periode default Minggu + Untung Produk +
// grafik + tabel supplier/channel tampil tanpa crash.
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { AdminOverview, EMPTY_ADMIN_OVERVIEW, ProfitChart } from "@/components/admin/AdminOverview";
import type { PeriodReport } from "@/lib/dashboard-report";
import { emptySelectedReport } from "@/lib/dashboard-report";

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
  expect(screen.getByText("Omzet vs Untung — Minggu ini")).toBeTruthy();
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

it("summary omits operational pills and cost-estimate notices without losing report figures", () => {
  const report = emptySelectedReport("week");
  report.estimated_orders = 151;
  report.orders = 202; report.revenue = 2563172; report.cost = 1546775; report.profit = 1016397;
  render(<AdminOverview data={{ ...data, selected_report: report }} selection="week" loading={false} />);
  expect(screen.queryByText(/Stok menipis|Senin–Minggu|Pending|memakai estimasi modal/)).toBeNull();
  expect(screen.getByText("202")).toBeTruthy();
  expect(screen.getByText("Untung Produk")).toBeTruthy();
});

it("switching period updates the chart, top products, supplier amounts and composition together", () => {
  const report = (name:string,amount:number,date:string):PeriodReport => ({
    orders:1,revenue:amount,cost:10000,profit:amount-10000,estimated_orders:0,
    series:[{date,orders:1,revenue:amount,cost:10000,profit:amount-10000}],
    suppliers:{wr:{orders:0,revenue:0,cost:0,profit:0},sk:{orders:0,revenue:0,cost:0,profit:0},manual:{orders:1,revenue:amount,cost:10000,profit:amount-10000},pedia:{orders:0,revenue:0,cost:0,profit:0}},
    channels:{web:{orders:1,revenue:amount,cost:10000,profit:amount-10000},telegram:{orders:0,revenue:0,cost:0,profit:0},whatsapp:{orders:0,revenue:0,cost:0,profit:0}},
    top_products:[{name,qty:1,revenue:amount,cost:10000,profit:amount-10000}],
  });
  render(<AdminOverview data={{...data,period_reports:{today:report('Today service',15000,'09:00'),week:report('Week service',20000,'2026-10-13'),month:report('Month service',30000,'2026-10-01')}}} loading={false}/>);
  expect(screen.getByText('Week service')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab',{name:'Bulan ini'}));
  expect(screen.queryByText('Week service')).toBeNull(); expect(screen.getByText('Month service')).toBeTruthy();
  expect(screen.getByText('Omzet vs Untung — Bulan ini')).toBeTruthy();
  expect(screen.getByRole('img',{name:/Stok sendiri 100.0%/})).toBeTruthy();
  fireEvent.click(screen.getByRole('tab',{name:'Hari ini'}));
  expect(screen.getByText('Today service')).toBeTruthy(); expect(screen.getByText('09:00')).toBeTruthy();
});

it("losses remain inside the plot and orders have an explicit separate scale", () => {
  render(<ProfitChart series={[{date:'2026-10-13',orders:1,revenue:10000,cost:15000,profit:-5000},{date:'2026-10-14',orders:2,revenue:10000,cost:15000,profit:-5000}]} loading={false}/>);
  const coords = [...document.querySelector('[data-series="profit"]')!.getAttribute('d')!.matchAll(/[ML]([\d.]+),([\d.]+)/g)];
  expect(coords).toHaveLength(2);
  for(const coord of coords) { expect(Number(coord[2])).toBeGreaterThanOrEqual(18);expect(Number(coord[2])).toBeLessThanOrEqual(220); }
  expect(screen.getByTestId('profit-zero-line')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Order'}));
  expect(screen.getByText(/Sumbu kanan: jumlah order/)).toBeTruthy();
});

it("failed finance load shows a retry action rather than zero profit metrics", () => {
  const retry=vi.fn();
  render(<AdminOverview data={EMPTY_ADMIN_OVERVIEW} loading={false} error='Ringkasan belum berhasil dimuat.' onRetry={retry}/>);
  expect(screen.getByRole('alert').textContent).toContain('belum berhasil dimuat');
  expect(screen.queryByText('Untung Produk')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Muat ulang ringkasan'}));
  expect(retry).toHaveBeenCalledTimes(1);
});

it("month and complete date edits apply automatically while invalid ranges preserve the report", () => {
  const change = vi.fn();
  render(<AdminOverview data={data} loading={false} selection="week" onSelectionChange={change} />);
  fireEvent.change(screen.getByLabelText("Bulan historis"), { target: { value: "2024-02" } });
  expect(change).toHaveBeenLastCalledWith({ date_from: "2024-02-01", date_to: "2024-02-29" });
  fireEvent.change(screen.getByLabelText("Tanggal awal"), { target: { value: "2024-03-01" } });
  expect(change).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.change(screen.getByLabelText("Tanggal akhir"), { target: { value: "2024-02-29" } });
  expect(screen.getByRole("alert").textContent).toContain("Tanggal awal");
  expect(change).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Tanggal awal"), { target: { value: "2024-02-20" } });
  expect(change).toHaveBeenLastCalledWith({ date_from: "2024-02-20", date_to: "2024-02-29" });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: /Terapkan/ })).toBeNull();
  expect(screen.queryByText(/Maksimal 366 hari/)).toBeNull();
  fireEvent.change(screen.getByLabelText("Bulan historis"), { target: { value: "2099-01" } });
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(change).toHaveBeenCalledTimes(2);
  fireEvent.change(screen.getByLabelText("Tanggal awal"), { target: { value: "2022-01-01" } });
  expect(screen.getByRole("alert").textContent).toContain("366");
  expect(change).toHaveBeenCalledTimes(2);
});

it("selected historical report scopes all financial content and exposes exports only when ready", () => {
  const selection = { date_from: "2024-02-01", date_to: "2024-02-29" };
  const report = emptySelectedReport(selection, new Date("2026-10-15T10:00:00Z"));
  const actions = vi.fn(() => <button>Export fixture</button>);
  const view = render(<AdminOverview data={{ ...data, selected_report: report }} selection={selection} onSelectionChange={vi.fn()} loading={false} renderReportActions={actions} />);
  expect(screen.queryByText("Netflix")).toBeNull();
  expect(screen.getByText("Belum ada transaksi pada periode ini")).toBeTruthy();
  expect(screen.queryByText(/Dibuat/)).toBeNull(); // Metadata belongs to the session header.
  expect(actions).toHaveBeenLastCalledWith({ report, disabled: false });
  const toolbar = screen.getByRole("group", { name: "Filter dan unduhan laporan" });
  expect(within(toolbar).getByLabelText("Bulan historis")).toBeTruthy();
  expect(within(toolbar).getByLabelText("Tanggal akhir")).toBeTruthy();
  expect(within(toolbar).getByRole("button", { name: "Export fixture" })).toBeTruthy();
  view.rerender(<AdminOverview data={{ ...data, selected_report: report }} selection={selection} onSelectionChange={vi.fn()} loading={true} renderReportActions={actions} />);
  expect(screen.queryByText("Untung Produk")).toBeNull();
  expect(screen.queryByText("Netflix")).toBeNull();
  expect(screen.queryByText("Export fixture")).toBeNull();
  view.rerender(<AdminOverview data={{ ...data, selected_report: report }} selection={selection} onSelectionChange={vi.fn()} loading={false} error="Gagal memuat periode baru" renderReportActions={actions} />);
  expect(screen.queryByText("Untung Produk")).toBeNull();
  expect(screen.queryByText("Netflix")).toBeNull();
  expect(screen.queryByText("Export fixture")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("Gagal memuat periode baru");
  expect(screen.getByLabelText("Tanggal awal")).toBeTruthy();
});
