// @vitest-environment jsdom
// UI Pengeluaran + MDR + refund/replace (16 November 2026).
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { render } from "./setup/admin-render";
import { AdminPortalContext } from "@/components/admin/ui/portal";
import { ToastProvider } from "@/components/ui/Toast";
import { ExpenseFormSheet } from "@/components/admin/finance/ExpenseFormSheet";
import { ExpensesManager } from "@/components/admin/finance/ExpensesManager";
import { PaymentFeesCard } from "@/components/admin/finance/PaymentFeesCard";
import { OrdersManager } from "@/components/admin/OrdersManager";
import { emptyExpenseTotals, type Expense, type ExpenseListResponse } from "@/lib/finance/types";
import { todayWibDateString } from "@/lib/revenue";

// Radix Switch measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState(null, "", "/"); });
const wrap = (node: React.ReactNode) => render(<AdminPortalContext.Provider value={document.body}><ToastProvider>{node}</ToastProvider></AdminPortalContext.Provider>);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const today = todayWibDateString();
const expense = (over: Partial<Expense> = {}): Expense => ({ id: 1, spent_on: today, category: "hosting", amount: 150000, note: "Cloudflare Workers Paid", order_code: null, recurring_id: null, created_at: "", updated_at: "", ...over });

it("form requires a category and amount, then posts a monthly recurring hosting expense", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => json({ expense: expense(JSON.parse(String(init?.body))), recurring: { id: 9 } }, 201));
  vi.stubGlobal("fetch", fetchMock);
  const saved = vi.fn();
  wrap(<ExpenseFormSheet open onOpenChange={() => {}} onSaved={saved} />);
  expect(screen.getByText("Isi nominal yang dibayar.")).toBeTruthy();
  expect(screen.queryByText(/benar-benar terpotong|Nominal bulan tertentu/)).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Simpan" }));
  expect(screen.getByRole("alert").textContent).toContain("Pilih kategori");
  expect(fetchMock).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("radio", { name: "Hosting & server" }));
  expect(screen.queryByLabelText(/Kode order/)).toBeNull();
  await userEvent.type(screen.getByLabelText("Jumlah (Rp)"), "150000");
  expect((screen.getByLabelText("Jumlah (Rp)") as HTMLInputElement).value).toBe("150.000");
  await userEvent.type(screen.getByLabelText(/Keterangan/), "Cloudflare");
  await userEvent.click(screen.getByRole("switch", { name: "Berulang tiap bulan" }));
  await userEvent.click(screen.getByRole("button", { name: "Simpan" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/admin/expenses");
  expect(init?.method).toBe("POST");
  expect(JSON.parse(String(init?.body))).toEqual({ spent_on: today, category: "hosting", amount: 150000, note: "Cloudflare", order_code: null, repeat_monthly: true });
});

it("refund draft from an order shows the order code field, hides recurring and surfaces order_not_found", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ error: "order_not_found" }, 400)));
  wrap(<ExpenseFormSheet open onOpenChange={() => {}} draft={{ category: "refund", order_code: "AXV-20261116-ABCD1234", amount: 25000 }} />);
  expect(screen.getByRole("radio", { name: "Refund ke pembeli" })).toHaveProperty("checked", true);
  expect((screen.getByLabelText(/Kode order/) as HTMLInputElement).value).toBe("AXV-20261116-ABCD1234");
  expect(screen.queryByRole("switch", { name: "Berulang tiap bulan" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Simpan" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Kode order tidak ditemukan.");
});

it("records a refund from order details and refreshes the parent overview", async () => {
  const order = { code: "AXV-20261116-ABCD1234", customer_name: "Fixture", customer_wa: "628000000001", items: [{ name: "Fixture product", price: 25000, qty: 1 }], subtotal: 25000, payment_amount: 25123, payment_method: "qris", status: "lunas", payment_status: "paid", fulfillment_status: "delivered", sales_channel: "web", created_at: today };
  const request = vi.fn(async (url: string, init?: RequestInit) => url === "/api/admin/expenses"
    ? json({ expense: expense(JSON.parse(String(init?.body))) }, 201)
    : String(url).startsWith("/api/admin/orders?") ? json({ orders: [order], pagination: { page: 1, total: 1, pages: 1 } }) : json({}));
  vi.stubGlobal("fetch", request);
  const changed = vi.fn();
  wrap(<OrdersManager onChanged={changed} />);
  await userEvent.click(await screen.findByRole("button", { name: "Detail" }));
  await userEvent.click(screen.getByRole("button", { name: "Catat refund/replace" }));
  const form = screen.getByRole("dialog", { name: "Catat pengeluaran" });
  expect(within(form).getByLabelText(/Kode order/)).toHaveProperty("value", order.code);
  expect(within(form).getByLabelText("Jumlah (Rp)")).toHaveProperty("value", "25.123");
  await userEvent.click(within(form).getByRole("button", { name: "Simpan" }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(JSON.parse(String(request.mock.calls.find(([url]) => url === "/api/admin/expenses")?.[1]?.body))).toMatchObject({ category: "refund", amount: 25123, order_code: order.code });
});

it("rejects a future date before calling the API", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  wrap(<ExpenseFormSheet open onOpenChange={() => {}} draft={{ category: "ads", amount: 5000, spent_on: "2999-01-01" }} />);
  await userEvent.click(screen.getByRole("button", { name: "Simpan" }));
  expect(screen.getByRole("alert").textContent).toContain("masa depan");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("uses native category radios and restores the opener after Escape", async () => {
  function Fixture() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Open expenses</button><ExpenseFormSheet open={open} onOpenChange={setOpen} /></>;
  }
  wrap(<Fixture />);
  const opener = screen.getByRole("button", { name: "Open expenses" });
  await userEvent.click(opener);
  await userEvent.click(screen.getByRole("radio", { name: "Hosting & server" }));
  expect(screen.getByRole("radio", { name: "Hosting & server" })).toHaveProperty("checked", true);
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

it("expenses page groups by day, filters by category chip, edits and pauses recurring", async () => {
  const totals = { ...emptyExpenseTotals(), hosting: 150000, refund: 25000 };
  const list: ExpenseListResponse = { from: `${today.slice(0, 7)}-01`, to: today, total: 175000, totals,
    expenses: [expense(), expense({ id: 2, category: "refund", amount: 25000, note: null, order_code: "AXV-20261116-ABCD1234" })],
    recurring: [{ id: 9, category: "hosting", amount: 150000, note: "Cloudflare Workers Paid", day_of_month: 16, start_month: today.slice(0, 7), active: true, last_generated_month: today.slice(0, 7), created_at: "", updated_at: "" }] };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") return json({ recurring: { ...list.recurring[0], active: false } });
    return json(list);
  });
  vi.stubGlobal("fetch", fetchMock);
  const changed = vi.fn();
  wrap(<ExpensesManager onChanged={changed} />);
  expect(await screen.findByText("Total", { exact: false })).toBeTruthy();
  expect(String(fetchMock.mock.calls[0][0])).toMatch(/^\/api\/admin\/expenses\?month=\d{4}-\d{2}$/);
  const listSection = screen.getByRole("region", { name: "Daftar pengeluaran" });
  expect(within(listSection).getByText("AXV-20261116-ABCD1234")).toBeTruthy();
  expect(screen.getByText(/termasuk refund & replace/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: /Refund ke pembeli ·/ }));
  expect(within(listSection).queryByText("Cloudflare Workers Paid")).toBeNull();
  expect(within(listSection).getByText("AXV-20261116-ABCD1234")).toBeTruthy();
  await userEvent.click(screen.getByRole("switch", { name: /Jeda Cloudflare Workers Paid/ }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => u === "/api/admin/expenses/recurring/9" && i?.method === "PATCH" && JSON.parse(String(i.body)).active === false)).toBe(true));
  expect(changed).toHaveBeenCalled();
});

it("empty month offers a call to action", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ from: "", to: "", total: 0, totals: emptyExpenseTotals(), expenses: [], recurring: [] })));
  wrap(<ExpensesManager />);
  expect(await screen.findByText(/Belum ada pengeluaran di/)).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "+ Catat pengeluaran" }).length).toBe(2);
});

it("drills down using the exact report range and includes both refund and replace", async () => {
  history.replaceState(null, "", "/admin?section=expenses&from=2026-10-26&to=2026-11-01&category=refund_replace");
  const request = vi.fn<(...args: [string]) => Promise<Response>>(async () => json({ from: "2026-10-26", to: "2026-11-01", total: 180000,
    totals: { ...emptyExpenseTotals(), hosting: 150000, refund: 25000, replace: 5000 }, recurring: [],
    expenses: [expense(), expense({ id: 2, category: "refund", amount: 25000, note: "Refund fixture" }), expense({ id: 3, category: "replace", amount: 5000, note: "Replace fixture" })] }));
  vi.stubGlobal("fetch", request);
  wrap(<ExpensesManager />);
  const list = await screen.findByRole("region", { name: "Daftar pengeluaran" });
  expect(request.mock.calls[0][0]).toBe("/api/admin/expenses?from=2026-10-26&to=2026-11-01");
  expect(within(list).queryByText("Cloudflare Workers Paid")).toBeNull();
  expect(within(list).getByText("Refund fixture")).toBeTruthy();
  expect(within(list).getByText("Replace fixture")).toBeTruthy();
  expect(screen.getByText(/Periode Ringkasan: 2026-10-26 – 2026-11-01/)).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText("Kategori"), "operational");
  expect(within(list).getByText("Cloudflare Workers Paid")).toBeTruthy();
  expect(within(list).queryByText("Refund fixture")).toBeNull();
});

it("keeps the latest month when an older expense response arrives late", async () => {
  let finishOld!: (response: Response) => void;
  const request = vi.fn((url: string) => String(url).includes("month=2026-09")
    ? new Promise<Response>(resolve => { finishOld = resolve; })
    : Promise.resolve(json({ from: "2026-10-01", to: "2026-10-31", total: 5000, totals: { ...emptyExpenseTotals(), other: 5000 }, recurring: [], expenses: [expense({ category: "other", amount: 5000, note: "Latest month" })] })));
  history.replaceState(null, "", "/admin?section=expenses&month=2026-09");
  vi.stubGlobal("fetch", request);
  wrap(<ExpensesManager />);
  fireEvent.change(screen.getByLabelText("Bulan"), { target: { value: "2026-10" } });
  expect(await screen.findByText("Latest month")).toBeTruthy();
  await act(async () => { finishOld(json({ total: 0, totals: emptyExpenseTotals(), recurring: [], expenses: [] })); });
  expect(screen.getByText("Latest month")).toBeTruthy();
});

it("MDR card loads, validates percent and saves basis points", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "PUT" ? json(JSON.parse(String(init.body))) : json({ mdr_bps: { gopay: 0, klikqris: 70, dana: 0 } }));
  vi.stubGlobal("fetch", fetchMock);
  wrap(<PaymentFeesCard />);
  const klik = await screen.findByLabelText("KlikQRIS") as HTMLInputElement;
  expect(klik.value).toBe("0,7");
  expect(screen.getByRole("button", { name: /Simpan/ }).hasAttribute("disabled")).toBe(true);
  await userEvent.clear(klik); await userEvent.type(klik, "abc");
  expect(screen.getByText(/maks 2 desimal/)).toBeTruthy();
  await userEvent.clear(klik); await userEvent.type(klik, "0,75");
  await userEvent.click(screen.getByRole("button", { name: /Simpan/ }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === "PUT")).toBe(true));
  const put = fetchMock.mock.calls.find(([, i]) => i?.method === "PUT")!;
  expect(JSON.parse(String(put[1]!.body))).toEqual({ mdr_bps: { gopay: 0, klikqris: 75, dana: 0 } });
});
