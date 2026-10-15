// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrderSuccessPage from "@/app/(shop)/pesanan/[code]/page";
import { DEFAULT_STORE_SETTINGS } from "@/lib/site";
import { formatRupiah } from "@/lib/utils";

const CODE = "AXV-20261015-COMPACT1";
const IMAGE = `/api/payments/qris/${CODE}/image`;
vi.mock("next/navigation", () => ({ useParams: () => ({ code: CODE }) }));
vi.mock("@/hooks/useStoreSettings", () => ({ useStoreSettings: () => DEFAULT_STORE_SETTINGS }));
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fixture(overrides: Record<string, unknown> = {}) {
  const future = new Date(Date.now() + 900000).toISOString();
  return {
    code: CODE, customer_name: "Buyer", customer_wa: "081234567890", payment_method: "qris", status: "pending",
    subtotal: 12300, expires_at: future, credentials_ready: false, qris_reissue_allowed: false,
    items: [{ name: "Paket panjang Google AI Pro / Antigravity — Invite 18 Bulan", price: 10000, qty: 1 }, { name: "Tools", price: 2300, qty: 1 }],
    qris: { image_url: IMAGE, payable_amount: 12445, unique_code: 145, expires_at: future, status: "pending" },
    ...overrides,
  };
}
function api(order = fixture()) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/cancel")) order.status = "dibatalkan";
    if (String(url).endsWith("/reissue")) order.qris.expires_at = new Date(Date.now() + 900000).toISOString();
    if (init?.method === "POST") return { ok: true, status: 200, json: async () => ({ ok: true }) };
    return { ok: true, status: 200, json: async () => ({ order }) };
  });
  vi.stubGlobal("fetch", fetch);
  return { order, fetch };
}

describe("compact pending QRIS payment", () => {
  it("keeps exact payment amount and full QR visible while summary details start collapsed and keyboard-accessible", async () => {
    const user = userEvent.setup(); api(); render(<OrderSuccessPage />);
    await screen.findByRole("heading", { name: "Pembayaran QRIS" });
    const payment = screen.getByRole("region", { name: "QRIS dinamis" });
    const paymentStatus = within(payment).getByText("Menunggu bayar");
    expect(paymentStatus.compareDocumentPosition(within(payment).getByText("Total bayar")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(payment).getByText(formatRupiah(12445).replace(/\s/g, " "))).toBeTruthy();
    expect(within(payment).getByText("+145")).toBeTruthy();
    expect(within(payment).getByText(/Berlaku \d\d:\d\d/)).toBeTruthy();
    expect(within(payment).getByAltText(`QRIS dinamis pesanan ${CODE}`).getAttribute("src")).toBe(IMAGE);
    const summary = screen.getByRole("button", { name: /Ringkasan.*2 produk/ });
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(summary.getAttribute("aria-controls")!);
    expect(panel?.hidden).toBe(true);
    summary.focus(); await user.keyboard("{Enter}");
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.hidden).toBe(false);
    expect(within(panel!).getByText(/Paket panjang Google AI Pro/)).toBeTruthy();
    expect(within(panel!).getByText(formatRupiah(12445).replace(/\s/g, " "))).toBeTruthy();
  });

  it("groups save/check actions, preserves download destination and manually wakes the payment poller", async () => {
    const { fetch } = api(); render(<OrderSuccessPage />);
    const save = await screen.findByRole("link", { name: "Simpan QRIS" });
    const check = screen.getByRole("button", { name: "Cek Pembayaran" });
    expect(save.parentElement).toBe(check.parentElement);
    expect(save.getAttribute("href")).toBe(IMAGE);
    expect(save.getAttribute("download")).toBe(`AXVARA-${CODE}-QRIS.png`);
    expect(screen.queryByRole("link", { name: "Lacak Status" })).toBeNull();
    expect(screen.getByRole("link", { name: "Lanjut Belanja" }).getAttribute("href")).toBe("/");
    expect(screen.getByText("Butuh bantuan?").classList.contains("sr-only")).toBe(false);
    fireEvent.click(check);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/orders?code=${CODE}&wake=1`, expect.objectContaining({ cache: "no-store" })));
    await screen.findByText(/terakhir dicek/);
  });

  it("retains buyer verification and explicit confirmation before cancelling a pending order", async () => {
    const { fetch } = api(); render(<OrderSuccessPage />);
    const cancel = await screen.findByRole("button", { name: "Batalkan Pesanan" });
    expect(cancel.parentElement).toBe(screen.getByRole("link", { name: "Lanjut Belanja" }).parentElement);
    fireEvent.click(cancel);
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/cancel"))).toBe(false);
    const dialog = screen.getByRole("dialog", { name: "Konfirmasi pembatalan pesanan" });
    fireEvent.change(within(dialog).getByLabelText("No. WA atau email checkout *"), { target: { value: "buyer@example.test" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ya, Batalkan" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/orders/${CODE}/cancel`, expect.objectContaining({ method: "POST", body: JSON.stringify({ contact: "buyer@example.test" }) })));
    await screen.findByRole("heading", { name: "Pesanan Dibatalkan" });
    expect(screen.queryByRole("button", { name: "Cek Pembayaran" })).toBeNull();
  });

  it.each([false, true])("keeps expired QR unpayable and only offers reissue when allowed (%s)", async (allowed) => {
    const order = fixture(); order.qris.expires_at = new Date(Date.now() - 1000).toISOString(); order.qris_reissue_allowed = allowed;
    const { fetch } = api(order); render(<OrderSuccessPage />);
    await screen.findByText("QRIS sudah kedaluwarsa");
    expect(screen.getByText("QRIS hangus")).toBeTruthy();
    expect(screen.queryByText("Menunggu bayar")).toBeNull();
    expect(screen.queryByAltText(`QRIS dinamis pesanan ${CODE}`)).toBeNull();
    expect(screen.queryByRole("link", { name: "Simpan QRIS" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cek Pembayaran" })).toBeNull();
    if (!allowed) expect(screen.queryByRole("button", { name: "Minta QRIS Baru" })).toBeNull();
    else {
      fireEvent.click(screen.getByRole("button", { name: "Minta QRIS Baru" }));
      await screen.findByAltText(`QRIS dinamis pesanan ${CODE}`);
      expect(fetch).toHaveBeenCalledWith(`/api/payments/qris/${CODE}/reissue`, expect.objectContaining({ method: "POST" }));
      expect(screen.getByRole("link", { name: "Simpan QRIS" }).getAttribute("href")).toBe(IMAGE);
    }
  });

  it("switches to the paid layout and visible summary after payment confirmation", async () => {
    const { order } = api(); render(<OrderSuccessPage />);
    const check = await screen.findByRole("button", { name: "Cek Pembayaran" });
    order.status = "lunas"; fireEvent.click(check);
    await screen.findByRole("heading", { name: "Pembayaran Dikonfirmasi! 🎉" });
    expect(screen.queryByRole("button", { name: /Ringkasan/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Simpan QRIS" })).toBeNull();
    expect(screen.getByRole("link", { name: "Lacak Status" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Syarat klaim garansi" })).toBeTruthy();
  });
});
