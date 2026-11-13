// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PediaManager } from "@/components/admin/PediaManager";

let rows: Record<string, unknown>[];
beforeEach(() => {
  window.history.replaceState(null, "", "/admin?section=pedia&keep=1"); rows = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("products")) return Response.json({ ok: true, products: [], tiers: [] });
    if (url.includes("services")) return Response.json({ ok: true, total: 0, rows: [], diff: {} });
    if (url.includes("overview")) return Response.json({ ok: true, providers: [] });
    if (url.includes("orders")) return Response.json({ ok: true, rows });
    return Response.json({ ok: true, settings: { pedia_markup_g1: 150 }, balance_history: [] });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([["orders", "Perlu tindakan"], ["products", "Produk"], ["services", "Layanan IndoSMM"], ["curation", "Layanan IndoSMM"], ["credits", "Produk"], ["settings", "Pengaturan"], ["action", "Perlu tindakan"]])("maps legacy tab %s and exposes exactly four navigation choices", async (initialTab, label) => {
  render(<PediaManager initialTab={initialTab} />); const nav = await screen.findByRole("tablist", { name: "Bagian Pedia" }); expect(within(nav).getAllByRole("tab").map(e => e.textContent)).toEqual(["Perlu tindakan", "Produk", "Layanan IndoSMM", "Pengaturan"]); expect(within(nav).getByRole("tab", { name: label }).getAttribute("aria-current")).toBe("page");
  if (initialTab === "curation") expect(await screen.findByLabelText("Kebutuhan produk")).toBeTruthy();
});

it("defaults to products without needs-action orders", async () => { render(<PediaManager />); await screen.findByText("Muat kurasi awal"); expect(screen.getByRole("tab", { name: "Produk" }).getAttribute("aria-current")).toBe("page"); });
it("defaults to orders for open followups even on a completed order", async () => { rows = [{ order_code: "AXP-FOLLOW", status: "completed", followup_state: "open" }]; render(<PediaManager />); expect(await screen.findByText("Perlu tindakan (1)")).toBeTruthy(); });

it("preserves query parameters, maps URL-only curation, and follows back/forward and props", async () => {
  window.history.replaceState(null, "", "/admin?section=pedia&tab=curation&keep=1"); const view = render(<PediaManager />); expect(await screen.findByLabelText("Kebutuhan produk")).toBeTruthy();
  await userEvent.click(screen.getByRole("tab", { name: "Pengaturan" })); expect(window.location.search).toContain("tab=settings"); expect(window.location.search).toContain("keep=1");
  window.history.replaceState(null, "", "/admin?section=pedia&tab=credits"); fireEvent.popState(window); expect(await screen.findByText("Muat kurasi awal")).toBeTruthy();
  window.history.replaceState(null, "", "/admin?section=pedia&tab=orders"); fireEvent.popState(window); expect(await screen.findByText(/Perlu tindakan \(/)).toBeTruthy();
  view.rerender(<PediaManager initialTab="settings" />); expect(await screen.findByLabelText("Markup G1 (%)")).toBeTruthy();
});

it("needs-action tab only lists actionable orders and links full history", async () => { rows = [{ order_code: "AXP-CHECK", status: "needs_check", can_resubmit: false }, { order_code: "AXP-DONE", status: "completed" }]; render(<PediaManager initialTab="products" />); await waitFor(() => expect(screen.getByRole("tab", { name: "Perlu tindakan" })).toBeTruthy()); await userEvent.click(screen.getByRole("tab", { name: "Perlu tindakan" })); await waitFor(() => expect(window.location.search).toContain("tab=action")); expect(await screen.findByText(/Perlu tindakan \(1\)/)).toBeTruthy(); expect(screen.queryByText(/AXP-DONE/)).toBeNull(); expect(screen.getByRole("link", { name: "Pesanan" }).getAttribute("href")).toBe("/admin?section=orders&kind=pedia"); });

it.each(["products", "services", "orders", "settings", "curation"])("%s has no retired supplier, sync, or internal jargon", async initialTab => {
  render(<PediaManager initialTab={initialTab} />); await waitFor(() => expect(screen.queryAllByText("Memuat data...")).toHaveLength(0));
  expect(document.body.textContent).not.toMatch(/ProviderSMM|Katalog otomatis|otomatis|managed|\bauto\b|Tarik ulang|Antrean sinkron|Deskripsi resmi|\(riwayat\)|\btier\b|\bmirror\b|\bsnapshot\b/i);
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method)).toBe(true);
});

it.each(["orders", "settings"])("%s renders its own response while catalog never resolves", async initialTab => {
  const original = vi.mocked(fetch).getMockImplementation()!; vi.mocked(fetch).mockImplementation((input, init) => String(input).includes("products") ? new Promise(() => {}) : original(input, init));
  render(<PediaManager initialTab={initialTab} />); expect(await (initialTab === "orders" ? screen.findByText(/Perlu tindakan \(/) : screen.findByLabelText("Markup G1 (%)"))).toBeTruthy(); expect(screen.queryByText("Memuat Pedia…")).toBeNull();
});
