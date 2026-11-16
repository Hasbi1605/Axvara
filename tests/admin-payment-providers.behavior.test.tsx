// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { render } from "./setup/admin-render";
import { PaymentReconciliation } from "@/components/admin/PaymentReconciliation";
import { PaymentMethodsManager } from "@/components/admin/PaymentMethodsManager";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });

function stubEvents(provider?: "dana" | "gopay") {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    events: [{ id: 1, amount: 10100, provider: "gopay", status: "ignored", created_at: "2026-10-15 10:00:00" },
      { id: 2, amount: 10200, status: "matched", created_at: "2026-10-14 10:00:00" }],
    health: { provider, enabled: true, payload_configured: true, webhook_configured: true,
      webhook_url: `https://axvara.tech/api/webhook/${provider || "dana"}`, secret_header: provider === "gopay" ? "X-Poller-Secret" : "X-Webhook-Secret", mode: "dynamic-qris" },
  }) })));
}

it("shows GoBiz server guidance and event-owned providers, not Android setup for active GoPay", async () => {
  stubEvents("gopay");
  render(<PaymentReconciliation />);
  expect(await screen.findByText("Poller GoBiz server (GoPay)")).toBeTruthy();
  expect(screen.getByText("Rekonsiliasi QRIS")).toBeTruthy();
  expect(screen.queryByText("Setup aplikasi QRIS Hook")).toBeNull();
  expect(screen.queryByText(/Optional secret/)).toBeNull();
  expect(screen.getByText("Terkonfigurasi")).toBeTruthy();
  expect(screen.queryByText("Siap")).toBeNull();
  expect(screen.getByText(/bukan kesehatan poller, sesi GoBiz/)).toBeTruthy();
  expect(screen.getByText("GoPay")).toBeTruthy();
  expect(screen.getByText("DANA")).toBeTruthy();
  expect(screen.getByText(/Cocokkan mutasi merchant GoPay/)).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Coba cocokkan/ })); });
  expect(vi.mocked(fetch).mock.calls[1][1]).toMatchObject({ method: "POST", body: JSON.stringify({ action: "retry_match", event_id: 1 }) });
});

it("retains legacy DANA setup when old health responses omit provider", async () => {
  stubEvents();
  render(<PaymentReconciliation />);
  expect(await screen.findByText("Setup aplikasi QRIS Hook")).toBeTruthy();
  expect(screen.getByText(/itu hanya nama variabel, bukan nilainya/)).toBeTruthy();
  expect(screen.queryByText("Poller GoBiz server (GoPay)")).toBeNull();
});

it("keeps payment method copy rail-neutral with a separate MDR request and no health request", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url === "/api/admin/payment-fees" ? { mdr_bps: { gopay: 0, klikqris: 0, dana: 0 } } : ({ payment_methods: [
    { id: "qris", label: "QRIS", account_name: "Merchant", account_number: "", is_active: true, sort_order: 1 },
  ] }) })));
  render(<PaymentMethodsManager />);
  expect(await screen.findByText(/merchant QRIS yang aktif/)).toBeTruthy();
  expect(screen.queryByText(/DANA Business/)).toBeNull();
  expect(screen.queryByText(/melalui QRIS Hook/)).toBeNull();
  expect(screen.queryByLabelText(/Nama pemilik/)).toBeNull();
  expect(screen.getByLabelText("QRIS aktif di checkout")).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetch).mock.calls.map(([url]) => url).sort()).toEqual(["/api/admin/payment-fees", "/api/payment-methods?all=1"]);
});

it("keeps a persistent retryable error instead of claiming zero events on 503", async () => {
  const request = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Service unavailable" }) }).mockResolvedValue({ ok: true, json: async () => ({ events: [], counts: {} }) });
  vi.stubGlobal("fetch", request);
  render(<PaymentReconciliation />);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Status belum diketahui"));
  expect(screen.queryByText("Tidak ada event pada filter ini.")).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Coba lagi" })); });
  expect(await screen.findByText("Tidak ada event pada filter ini.")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("legacy bank records are read-only and cannot be added from the checkout settings", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url === "/api/admin/payment-fees" ? { mdr_bps: { gopay: 0, klikqris: 0, dana: 0 } } : ({ payment_methods: [{ id: "bca", label: "BCA", account_name: "Legacy", account_number: "123", is_active: true }] }) })));
  render(<PaymentMethodsManager />);
  expect(await screen.findByText("Rekening transfer lama")).toBeTruthy();
  expect(screen.getByText(/· 123/)).toBeTruthy();
  expect(screen.queryByDisplayValue("123")).toBeNull();
  expect(screen.getByRole("button", { name: "Simpan" })).toHaveProperty("disabled", true);
  expect(screen.queryByRole("button", { name: /Tambah bank/ })).toBeNull();
});
