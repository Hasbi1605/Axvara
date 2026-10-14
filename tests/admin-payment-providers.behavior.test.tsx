// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PaymentReconciliation } from "@/components/admin/PaymentReconciliation";
import { PaymentMethodsManager } from "@/components/admin/PaymentMethodsManager";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

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

it("keeps payment method copy rail-neutral without an extra health request", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ payment_methods: [
    { id: "qris", label: "QRIS", account_name: "Merchant", account_number: "", is_active: true, sort_order: 1 },
  ] }) })));
  render(<PaymentMethodsManager />);
  expect(await screen.findByText(/merchant QRIS yang aktif/)).toBeTruthy();
  expect(screen.queryByText(/DANA Business/)).toBeNull();
  expect(screen.queryByText(/melalui QRIS Hook/)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});
