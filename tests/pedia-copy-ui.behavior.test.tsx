// @vitest-environment jsdom
// Copy 3 Nov 2026 (UI): Instant Start chip/Start time, refill wording, single tracking refill block,
// live in_progress → completed without pressing refresh. Fixture saja, tanpa produksi.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PediaCatalogTier } from "@/app/api/pedia/catalog/route";

const route = vi.hoisted(() => ({ code: "AXP-20261103-35D31DA7" }));
vi.mock("next/navigation", () => ({ useParams: () => route, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/" }));
vi.mock("@/components/storefront/StoreWhatsAppLink", () => ({ StoreWhatsAppLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

import { ServiceChips, shortServiceName } from "@/components/pedia/ServicePicker";
import { ServiceInfoCard } from "@/components/pedia/ServiceInfoCard";
import BuyerPage from "@/app/pedia/pesanan/[code]/page";

const tier = (over: Partial<PediaCatalogTier> = {}): PediaCatalogTier => ({
  id: 1, tier: "standar", label_note: null, public_name: "Followers Global HQ · Akun berpostingan · Instant Start", region: "global", quality: "hq",
  drop_risk: "rendah", refill_days: 365, refill_anchor: "created", refill_mode: "api", eta_start: null, eta_finish: null, prices: { "100": 2000 },
  min_qty: 10, max_qty: 1000, quantity_step: 10, description: "Followers Instagram global dari akun HQ berpostingan.", terms: "", ...over,
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Instant Start", () => {
  it("lifts the name segment into a chip and strips it from the display name", () => {
    const t = tier();
    expect(shortServiceName("Followers Instagram", "followers", t)).toBe("Followers Global HQ · Akun berpostingan");
    render(<ServiceChips t={t} eta productName="Followers Instagram" />);
    expect(screen.getByText("Instant Start")).toBeTruthy();
    expect(screen.queryByText(/^Start /)).toBeNull();
  });
  it("never invents a range: no eta_start → Instant Start only; with eta_start both facts appear", () => {
    const { container, rerender } = render(<ServiceChips t={tier()} eta productName="x" />);
    expect(container.textContent).not.toMatch(/\d\s*[–-]\s*\d/);
    rerender(<ServiceChips t={tier({ eta_start: "0–1 jam" })} eta productName="x" />);
    expect(container.textContent).toContain("Instant Start");
    expect(container.textContent).toContain("Start 0–1 jam");
    rerender(<ServiceChips t={tier({ public_name: "Followers Global HQ", eta_start: null })} eta productName="x" />);
    expect(container.textContent).not.toContain("Instant Start");
  });
  it("Start time row: eta_start, else Instant Start from the name, else the existing fallback; Speed/Avg stay separate", () => {
    const row = (t: PediaCatalogTier) => { const { container, unmount } = render(<ServiceInfoCard t={t} productName="x" />); const dd = [...container.querySelectorAll("dt")].find((n) => n.textContent === "Start time")!.nextElementSibling!.textContent; unmount(); return dd; };
    expect(row(tier())).toBe("Instant Start");
    expect(row(tier({ eta_start: "0–3 jam" }))).toBe("0–3 jam");
    expect(row(tier({ public_name: "Followers Global HQ" }))).toBe("Mengikuti antrean");
    const { container } = render(<ServiceInfoCard t={tier({ speed_per_day: "100K/hari", avg_time: "19 menit" })} productName="x" />);
    expect(container.textContent).toContain("Speed100K/hari");
    expect(container.textContent).toContain("Avg time19 menit per 1.000");
  });
});

describe("Service info wording", () => {
  it("states the refill promise with the real anchor and no AXVARA attribution", () => {
    const { container, rerender } = render(<ServiceInfoCard t={tier({ refill_days: 30, refill_anchor: "completed" })} productName="x" />);
    expect(container.textContent).toContain("Refill 30 hari sejak pesanan selesai, selama layanan masih tersedia.");
    expect(container.textContent).toContain("Bisa diajukan 1× per 24 jam dari halaman pesanan, diproses otomatis.");
    rerender(<ServiceInfoCard t={tier({ refill_days: 30, refill_anchor: undefined, refill_mode: "manual" })} productName="x" />);
    expect(container.textContent).toContain("Refill 30 hari, selama layanan masih tersedia.");
    expect(container.textContent).toContain("diproses admin, biasanya dalam 1×24 jam.");
    expect(container.textContent).not.toMatch(/dari AXVARA|lewat AXVARA|garansi AXVARA|label Real|karakter akun|kelas (?:Real|HQ)/);
  });
  it("shows glossary lines for the characteristic in the name and leaks no supplier terms", () => {
    const { container } = render(<ServiceInfoCard t={tier({ public_name: "Followers Global Real People · Akun berpostingan · Instant Start", quality: "real" })} productName="x" />);
    for (const text of ["Akun Real People, bukan akun campuran.", "Akun pengirim sudah memiliki postingan.", "Pesanan langsung masuk antrean kirim setelah pembayaran terkonfirmasi."]) expect(container.textContent).toContain(text);
    expect(container.textContent).not.toMatch(/indosmm|supplier|penyedia|providersmm/i);
  });
});

const CODE = route.code;
const base = {
  code: CODE, order_kind: "pedia", product_name: "Followers Instagram", product_slug: "followers-instagram", service_name: "Followers Global HQ · Instant Start", tier_name: "Premium", tier_note: null,
  quantity: 100, target: "https://instagram.com/buyer", status: "in_progress", start_count: 8177, remains: 73, done: 27, percent: 27, eta_start: "0–1 jam", eta_finish: null,
  paid_at: "2026-11-03 12:20:00", qris: null, refill_days: 30, refill_eligible: false,
  refill: { mode: "api", days: 30, eligible: false, reason: "not_completed", ends_at: null, next_at: null, status: null, status_label: null, last_at: null },
};
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const refill = (over: Record<string, unknown>, eligible = false) => ({ ...base, status: "completed", done: 100, percent: 100, remains: 0, refill_eligible: eligible, refill: { ...base.refill, ...over } });
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe("tracking refill block", () => {
  const show = async (order: Record<string, unknown>) => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ order })));
    const view = render(<BuyerPage />);
    const block = await screen.findByRole("region", { name: "Refill" });
    return { block, view };
  };
  const cta = (block: HTMLElement) => within(block).getByRole("button", { name: "Ajukan Refill" }) as HTMLButtonElement;

  it("not completed: explains, CTA disabled", async () => {
    const { block } = await show({ ...base });
    expect(block.textContent).toContain("Refill 30 Days · bisa diajukan setelah pesanan selesai.");
    expect(cta(block).disabled).toBe(true);
    expect(within(block).getAllByRole("button", { name: "Ajukan Refill" })).toHaveLength(1);
  });
  it("eligible: one CTA, expiry from the API ends_at, contact dialog, secondary guide link", async () => {
    const { block } = await show(refill({ eligible: true, reason: null, ends_at: "2026-12-03T00:00:00.000Z" }, true));
    expect(block.textContent).toContain("bisa diajukan sampai 3 Des 2026");
    expect(cta(block).disabled).toBe(false);
    fireEvent.click(cta(block));
    expect(screen.getByRole("dialog", { name: "Verifikasi refill" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ajukan Refill" })).toBeNull();
    expect((within(block).getByRole("link", { name: /Cara kerja & aturan refill/ }) as HTMLAnchorElement).getAttribute("href")).toBe(`/pedia/refill?code=${CODE}`);
    expect(block.textContent).not.toMatch(/PIN/);
  });
  it("cooldown keeps a disabled CTA; in_progress and expired hide it; no_supplier_order offers admin", async () => {
    let r = await show(refill({ reason: "cooldown", next_at: "2026-11-04T05:00:00.000Z", status: "completed", status_label: "Refill selesai" }));
    expect(r.block.textContent).toContain("bisa diajukan lagi 4 Nov 2026");
    expect(cta(r.block).disabled).toBe(true);
    cleanup();
    r = await show(refill({ reason: "in_progress", status: "submitted", status_label: "Refill sedang diproses" }));
    expect(r.block.textContent).toContain("Refill sedang diproses.");
    expect(within(r.block).queryByRole("button", { name: "Ajukan Refill" })).toBeNull();
    cleanup();
    r = await show(refill({ reason: "expired", ends_at: "2026-11-02T00:00:00.000Z" }));
    expect(r.block.textContent).toContain("masa refill berakhir 2 Nov 2026");
    expect(within(r.block).queryByRole("button", { name: "Ajukan Refill" })).toBeNull();
    cleanup();
    r = await show(refill({ reason: "no_supplier_order" }));
    expect(r.block.textContent).toContain("Pesanan belum siap direfill. Hubungi admin.");
    expect(within(r.block).getByRole("link", { name: "Tanya admin" })).toBeTruthy();
  });
  it("api refill is labeled automatic, manual refill admin-processed", async () => {
    const { block } = await show(refill({ mode: "api", eligible: true, reason: null, ends_at: "2026-12-03T00:00:00.000Z" }, true));
    expect(block.textContent).toContain("Diproses otomatis.");
    expect(block.textContent).not.toContain("Diproses admin");
  });
  it("manual refill is labeled as admin-processed; No Refill orders show no refill block", async () => {
    const { block } = await show(refill({ mode: "manual", eligible: true, reason: null, ends_at: "2026-12-03T00:00:00.000Z" }, true));
    expect(block.textContent).toContain("Diproses admin, biasanya dalam 1×24 jam.");
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => json({ order: { ...base, refill_days: 0, refill: { ...base.refill, mode: "none", days: 0, reason: "no_refill" } } })));
    render(<BuyerPage />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("region", { name: "Refill" })).toBeNull();
  });
});

describe("live status", () => {
  it("fixture in_progress → completed updates the page and unlocks refill without pressing refresh", async () => {
    vi.useFakeTimers();
    let current: Record<string, unknown> = { ...base };
    const fetcher = vi.fn(async (_url?: string) => json({ order: current }));
    vi.stubGlobal("fetch", fetcher);
    render(<BuyerPage />);
    await act(async () => {});
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Pesanan Berjalan");
    expect(screen.getByRole("button", { name: "Ajukan Refill" }).hasAttribute("disabled")).toBe(true);
    current = refill({ eligible: true, reason: null, ends_at: "2026-12-03T00:00:00.000Z" }, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toBe("Pesanan Berjalan");
    expect(screen.getByRole("button", { name: "Ajukan Refill" }).hasAttribute("disabled")).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps retrying after a failed poll and the status recovers", async () => {
    vi.useFakeTimers();
    let current: Record<string, unknown> = { ...base };
    const fetcher = vi.fn(async (_url?: string) => json({ order: current }));
    vi.stubGlobal("fetch", fetcher);
    render(<BuyerPage />);
    await act(async () => {});
    fetcher.mockRejectedValueOnce(new Error("Koneksi terputus"));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByRole("alert").textContent).toContain("Koneksi terputus");
    current = refill({ eligible: true, reason: null }, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Ajukan Refill" }).hasAttribute("disabled")).toBe(false);
  });
});
