// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SupplierTopupManager } from "@/components/admin/SupplierTopupManager";
import { SUPPLIER_ITEMS } from "@/components/admin/SupplierDropdown";
import { money, TOPUPS } from "@/components/admin/supplier-topup/model";
import { render } from "./setup/admin-render";

const address = `0x${"1234567890".repeat(4)}`;
const pending = {
  id: 13, supplier: "tunvn", ref_id: "AXVTU-FIXTURE", currency: "USDT", status: "pending",
  pay_amount: 10.257391, credit_amount: 10, payment: { network: "BEP20", exact_amount: 10.257391, address },
  created_at: Date.now(), expires_at: Date.now() + 120_000,
};
const channels = [
  { service: "off", name: "Transfer Bank", status: "off" },
  { service: "sk-topup", name: "QRIS", status: "on", minimum: 10000, maximum: 1000000, fee_flat: 150, fee_percentage: "0.7" },
];

function setup({ gates = { sekalipay: true, tunvn: true }, items = [] as object[], createError = "", paidImmediately = false } = {}) {
  let miraiReads = 0;
  let checks = 0;
  const respond = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === TOPUPS) {
      if (init?.method === "POST") {
        if (createError) return respond({ ok: false, error: createError }, 429);
        const body = JSON.parse(String(init.body));
        return respond({ ok: true, item: body.supplier === "tunvn" ? pending : {
          ...pending, id: 12, supplier: "sekalipay", currency: "IDR", pay_amount: 50500, credit_amount: 50000, fee_amount: 500,
          payment: { payment_link: "http://not-secure.invalid", payment_url: "https://example.test/pay", qr_link: "javascript:alert(0)" },
        } });
      }
      return respond({ ok: true, items, gates });
    }
    if (url.endsWith("/channels")) return respond({ ok: true, channels });
    if (url.endsWith("/refresh")) return ++checks === 1 && !paidImmediately ? respond({ ok: false, error: "too_soon" }, 429)
      : respond({ ok: true, item: { ...pending, status: "paid" } });
    if (url.includes("/warung/")) return respond({ ok: true, current: { balance: 1234567 }, stale: true });
    if (url.includes("/sekalipay/")) return respond({ ok: true, current: { balance: 150000 } });
    if (url.includes("/pedia/")) return respond({ ok: true, balance: { value: 65000, stale: false } });
    if (url.includes("/mirai/") && ++miraiReads === 1) return respond({ ok: false, error: "balance_unavailable" }, 502);
    return respond({ ok: true, balance: 12.34 });
  });
  vi.stubGlobal("fetch", fetch);
  render(<SupplierTopupManager />);
  return fetch;
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("puts Saldo & Topup first in Supplier and isolates stale/error/retry from other balances", async () => {
  const fetch = setup({ gates: { sekalipay: true, tunvn: false } });
  expect(SUPPLIER_ITEMS[0]).toMatchObject({ id: "topup", label: "Saldo & Topup" });
  const card = (name: string) => within(screen.getByRole("group", { name }));
  expect(await card("Warung Rebahan").findByText("Rp 1.234.567")).toBeTruthy();
  expect(card("Warung Rebahan").getByText(/Saldo terakhir/)).toBeTruthy();
  expect(await card("AIVault").findByText("$12.34")).toBeTruthy();
  expect(await card("IndoSMM").findByText("Rp 65.000")).toBeTruthy();
  expect(await card("Mirai").findByText("Gagal memuat")).toBeTruthy();
  expect((card("TUNVN").getByRole("button", { name: "Topup TUNVN" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(card("Mirai").getByRole("button", { name: "Coba lagi" }));
  expect(await card("Mirai").findByText("12.34 USDT")).toBeTruthy();
  expect(fetch.mock.calls.filter(([url]) => url.includes("/mirai/"))).toHaveLength(2);
  expect(fetch.mock.calls.filter(([url]) => url.includes("/aivault/"))).toHaveLength(1);
});

it("keeps the supplied channel order, blocks off channels, estimates fees, and renders HTTPS only", async () => {
  const fetch = setup();
  const trigger = screen.getByRole("button", { name: "Topup Sekalipay" });
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  trigger.focus(); await userEvent.keyboard("{Enter}");
  const dialog = within(await screen.findByRole("dialog", { name: "Topup Sekalipay" }));
  const off = await dialog.findByRole("option", { name: /Sementara tidak tersedia/ }) as HTMLOptionElement;
  expect(off.disabled).toBe(true);
  expect(dialog.getAllByRole("option").map(option => (option as HTMLOptionElement).value)).toEqual(["", "off", "sk-topup"]);
  fireEvent.change(dialog.getByLabelText("Nominal (IDR)"), { target: { value: "50000" } });
  expect(dialog.getByText("Rp 500")).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "Buat tagihan" }));
  const link = await dialog.findByRole("link", { name: "Buka halaman bayar" });
  expect(link.getAttribute("href")).toBe("https://example.test/pay");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  expect(dialog.queryByRole("img")).toBeNull();
  expect(dialog.getByRole("timer")).toBeTruthy();
  expect(fetch.mock.calls.find(([url, init]) => url === TOPUPS && init?.method === "POST")?.[1]?.body)
    .toBe(JSON.stringify({ supplier: "sekalipay", code: "sk-topup", amount: 50000 }));
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it("validates fractional USDT, preserves exact transfer value, handles manual 429 and reloads only the paid supplier", async () => {
  const fetch = setup();
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "Topup TUNVN" });
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  await user.click(trigger);
  const dialog = within(screen.getByRole("dialog"));
  const input = dialog.getByLabelText("Nominal (USDT)");
  const submit = dialog.getByRole("button", { name: "Buat tagihan" });
  await user.type(input, "10.123"); await user.click(submit);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(fetch.mock.calls.some(([url, init]) => url === TOPUPS && init?.method === "POST")).toBe(false);
  await user.clear(input); await user.type(input, "10,25"); await user.click(submit);
  expect(await dialog.findByText("10.257391 USDT")).toBeTruthy();
  await user.click(dialog.getByRole("button", { name: "Salin nominal" }));
  expect(await dialog.findByText("Disalin")).toBeTruthy();
  expect(await navigator.clipboard.readText()).toBe("10.257391");
  await user.click(dialog.getByRole("button", { name: "Salin alamat" }));
  expect(await navigator.clipboard.readText()).toBe(address);
  await user.click(dialog.getByRole("button", { name: "Cek status" }));
  expect(await dialog.findByText("Tunggu beberapa detik")).toBeTruthy();
  await user.click(dialog.getByRole("button", { name: "Cek status" }));
  expect(await dialog.findByText("Saldo masuk")).toBeTruthy();
  expect(fetch.mock.calls.filter(([url]) => url.endsWith("tunvn/balance"))).toHaveLength(2);
  expect(fetch.mock.calls.filter(([url]) => url.endsWith("sekalipay/saldo"))).toHaveLength(1);
});

it("reopens expired history without showing transfer instructions, allows late recheck or a fresh form", async () => {
  setup({ items: [{ ...pending, status: "expired" }], paidImmediately: true });
  const row = await screen.findByRole("button", { name: /Lihat topup TUNVN/ });
  fireEvent.click(row);
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByText(/setelah kedaluwarsa/)).toBeTruthy();
  expect(dialog.queryByText(address)).toBeNull();
  expect(dialog.getByRole("button", { name: "Buat topup baru" })).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "Cek status" }));
  expect(await dialog.findByText("Saldo masuk")).toBeTruthy();
});

it("offers a manual recheck when an SK link has not arrived", async () => {
  const fetch = setup({ items: [{ ...pending, id: 12, supplier: "sekalipay", currency: "IDR", payment: null }] });
  fireEvent.click(await screen.findByRole("button", { name: /Lihat topup Sekalipay/ }));
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByText("Link pembayaran sedang disiapkan")).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "Cek lagi" }));
  expect(await dialog.findByText("Tunggu beberapa detik")).toBeTruthy();
  expect(fetch.mock.calls.find(([url]) => url.endsWith("/12/refresh"))?.[1]?.method).toBe("POST");
});

it("maps a pending-invoice limit to helpful Indonesian text and reloads history", async () => {
  const fetch = setup({ createError: "too_many_pending" });
  const trigger = screen.getByRole("button", { name: "Topup TUNVN" });
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(trigger);
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Nominal (USDT)"), { target: { value: "10" } });
  fireEvent.click(dialog.getByRole("button", { name: "Buat tagihan" }));
  expect(await dialog.findByText("Masih ada 3 topup menunggu. Selesaikan atau tunggu kedaluwarsa.")).toBeTruthy();
  expect(fetch.mock.calls.filter(([url, init]) => url === TOPUPS && !init?.method)).toHaveLength(2);
});

it("polls a visible pending invoice every 15 s, silently handles auto 429, and stops when hidden or closed", async () => {
  const fetch = setup({ items: [pending] });
  const row = await screen.findByRole("button", { name: /Lihat topup TUNVN/ });
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const checks = () => fetch.mock.calls.filter(([url]) => url.endsWith("/refresh")).length;
  try {
    fireEvent.click(row);
    await act(async () => { await vi.advanceTimersByTimeAsync(14_999); }); expect(checks()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(checks()).toBe(1);
    expect(screen.queryByText("Tunggu beberapa detik")).toBeNull();
    visibility.mockReturnValue(true); fireEvent(document, new Event("visibilitychange"));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); }); expect(checks()).toBe(1);
    visibility.mockReturnValue(false); fireEvent(document, new Event("visibilitychange"));
    fireEvent.click(screen.getByRole("button", { name: "Tutup dialog" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); }); expect(checks()).toBe(1);
  } finally { visibility.mockRestore(); }
});

it("never rounds a TUNVN exact USDT amount in history/balance formatting", () => {
  expect(money(10.1234, "USDT")).toBe("10.1234 USDT");
  expect(money(32.5, "USDT")).toBe("32.50 USDT");
});
