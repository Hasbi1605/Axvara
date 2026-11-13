// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render } from "./setup/admin-render";
import { afterEach, expect, it, vi } from "vitest";
import { PaymentReconciliation } from "@/components/admin/PaymentReconciliation";
import BotAutomationManager from "@/components/admin/BotAutomationManager";
import AdminPage from "@/app/(shop)/admin/page";
import { ToastProvider } from "@/components/ui/Toast";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/admin"); });
const event = { id: 1, status: "ignored", amount: 18000, provider: "sekalipay_gateway", created_at: "2026-11-13 00:00:00", last_error: "sekalipay_gateway_manual_review" };
it("never guesses provider health or zero attention while loading", async () => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(r => { resolve = r; })));
  render(<ToastProvider><PaymentReconciliation /></ToastProvider>);
  expect(screen.queryByText(/DANA/)).toBeNull(); expect(screen.queryByText("0")).toBeNull();
  await act(async () => resolve(Response.json({ events: [], attention: 7 })));
  expect(screen.getByText("7")).toBeTruthy();
});
it("uses attention, requires a trimmed note, shows API errors, refreshes badges, and hides reviewed actions", async () => {
  let reviewed = false, reject = true;
  const changed = vi.fn(), requests: object[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method) { requests.push(JSON.parse(String(init.body))); if (reject) { reject = false; return Response.json({ error: "event_not_actionable" }, { status: 409 }); } reviewed = true; return Response.json({ ok: true }); }
    return Response.json({ attention: reviewed ? 0 : 7, counts: { ignored: 999 }, events: [{ ...event, reviewed_by: reviewed ? "admin@test" : null }] });
  }));
  render(<ToastProvider><PaymentReconciliation onChanged={changed} /></ToastProvider>);
  await screen.findByText("7"); expect(screen.queryByText("999")).toBeNull();
  expect(screen.getByText("Butuh verifikasi manual (gateway)").getAttribute("title")).toBe(event.last_error);
  fireEvent.click(screen.getByRole("button", { name: "Tandai sudah dicek" }));
  const dialog = await screen.findByRole("dialog", { name: "Tandai sudah dicek" });
  const submit = within(dialog).getByRole("button", { name: "Tandai sudah dicek" });
  fireEvent.change(within(dialog).getByLabelText("Catatan pemeriksaan"), { target: { value: "   ok   " } });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(within(dialog).getByLabelText("Catatan pemeriksaan"), { target: { value: "  Mutasi sudah diperiksa  " } });
  fireEvent.click(submit); await within(dialog).findByRole("alert"); expect(changed).not.toHaveBeenCalled();
  expect(within(dialog).getByRole("alert").textContent).toContain("sudah cocok");
  fireEvent.click(submit); await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(requests).toEqual(Array(2).fill({ action: "mark_reviewed", event_id: 1, note: "Mutasi sudah diperiksa" }));
  expect(screen.getByText("Sudah dicek")).toBeTruthy(); expect(screen.queryByRole("button", { name: "Tandai sudah dicek" })).toBeNull();
});
it("replaces raw queues/retired WA switches with actionable orders, and handles retry/empty", async () => {
  let fail = true, empty = false;
  vi.stubGlobal("fetch", vi.fn(async () => fail ? (fail = false, Response.json({}, { status: 503 })) : Response.json({ bot_configured: true, bot_enabled: true, whatsapp_configured: true, whatsapp_enabled: true, fulfillment_action: { orders: empty ? [] : [{ code: "AXV-FIXTURE", product: "Produk macet", status: "failed", updated_at: "2026-11-13 00:00:00" }], total: 1, whatsapp_outbox_failed_7d: 3 } })));
  render(<ToastProvider><BotAutomationManager /></ToastProvider>);
  await screen.findByRole("alert"); fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
  const link = await screen.findByRole("link", { name: "AXV-FIXTURE" }); expect(link.getAttribute("href")).toBe("/admin?section=orders&q=AXV-FIXTURE");
  expect(screen.getByText("Pesan WhatsApp gagal 7 hari: 3")).toBeTruthy();
  for (const text of ["Pencarian", "Pembayaran", "Bukti manual", "Fulfillment jobs", "WhatsApp outbox"]) expect(screen.queryByText(text, { exact: true })).toBeNull();
  expect(screen.getByText(/pembelian via WA dipensiunkan/)).toBeTruthy();
  empty = true; fireEvent.click(screen.getByRole("button", { name: "Muat ulang" })); await screen.findByText("Tidak ada pengiriman yang macet");
});
it("fetches shell attention counts once even when entering a non-summary section", async () => {
  window.history.replaceState(null, "", "/admin?section=orders");
  const fetcher = vi.fn(async (url: string) => Response.json(url === "/api/auth/me" ? { authed: true } : url.startsWith("/api/admin/overview") ? { payment_attention: 7, pending_orders: 2 } : { orders: [], stats: {} })); vi.stubGlobal("fetch", fetcher);
  render(<ToastProvider><AdminPage /></ToastProvider>);
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.startsWith("/api/admin/overview"))).toHaveLength(1));
  expect(screen.getByRole("button", { name: /Metode & Rekonsiliasi.*7/ })).toBeTruthy();
});
