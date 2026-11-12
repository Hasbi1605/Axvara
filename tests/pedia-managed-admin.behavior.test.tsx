// @vitest-environment jsdom
// tests/pedia-managed-admin.behavior.test.tsx — PSMM-P5 (2026-11-12).
// Mengunci panel admin: ringkasan diagnostik, label alasan manusiawi, resync
// resumable berurutan (cursor/done, anti-loop, error mempertahankan cursor),
// filter kelayakan, dan "jeda penjualan" yang tidak merusak sumber otomatis.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PediaManager } from "@/components/admin/PediaManager";

const product = { id: 1, name: "Followers Instagram", slug: "psmm-86", platform: "instagram", metric: "followers", target_kind: "profile", tagline: null, description_md: null, checklist_json: "[]", packages_json: "[100,250]", step: 1, sort_order: 0, is_active: 1, is_featured: 0, managed: "auto" };
const managedTier = {
  id: 1, product_id: 1, supplier: "providersmm", tier: "standar", label_note: null,
  supplier_service_id: 86, backup_service_id: null, price_group: "G2", markup_pct: 60,
  min_profit_rp: 2000, refill_days: 0, eta_start: null, eta_finish: null,
  package_prices_json: '{"100":4000,"250":9000}', is_active: 0,
  auto_disabled_reason: "terms_conflict", live_rate: 20000, live_min: 20, live_max: 10000,
  live_present: 1, live_type: "Default", managed: "auto",
};
type Body = Record<string, unknown>;
let writes: { url: string; body: Body }[];
let resyncCalls: Body[];
let overview: Body;

beforeEach(() => {
  window.history.replaceState(null, "", "/admin?section=pedia");
  writes = []; resyncCalls = [];
  overview = {
    ok: true,
    counts: { services: 620, managed_tiers: 610, managed_active: 590, managed_blocked: 20 },
    catalog: { blocked: [{ reason: "terms_conflict", count: 6 }, { reason: "description_missing", count: 14 }], blocked_total: 20, queue_pending: 3, description_fresh_at: "2026-11-12 10:00:00" },
    providers: [],
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method) {
      const body = JSON.parse(String(init.body)) as Body;
      if (String(url).includes("services")) {
        resyncCalls.push(body);
        const cursor = Number(body.cursor ?? 0);
        // Dua potongan: 0 -> 25, 25 -> selesai.
        if (cursor === 0) return Response.json({ ok: true, total: 30, cursor: 25, done: false, managed: { processed: 25, remaining: 5 } });
        return Response.json({ ok: true, total: 30, cursor: 30, done: true, managed: { processed: 5, remaining: 0 } });
      }
      writes.push({ url, body });
      return Response.json({ ok: true, id: 1 });
    }
    if (url.includes("products")) return Response.json({ ok: true, products: [{ ...product }], tiers: [{ ...managedTier }] });
    if (url.includes("services")) return Response.json({ ok: true, total: 1, diff: { pedia_diff_last_at: "2026-11-12 10:00:00", pedia_psmm_desc_last_at: "2026-11-12 10:00:00" }, rows: [{ supplier: "providersmm", service_id: 86, name: "IG Followers", rate_idr_per_1k: 20000, min_qty: 20, max_qty: 10000, present: 1, type: "Default", tier_managed: "auto", tier_active: 0, tier_disabled_reason: "terms_conflict", description_status: "ok" }] });
    if (url.includes("overview")) return Response.json(overview);
    if (url.includes("orders")) return Response.json({ ok: true, rows: [] });
    if (url.includes("credits")) return Response.json({ ok: true, rows: [] });
    return Response.json({ ok: true, settings: {}, balance_history: [] });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows an honest managed-catalog summary with human reason labels", async () => {
  render(<PediaManager />);
  const summary = await screen.findByRole("region", { name: "Ringkasan katalog otomatis" });
  expect(within(summary).getByText("620")).toBeTruthy();
  expect(within(summary).getByText("610")).toBeTruthy();
  expect(within(summary).getByText("590")).toBeTruthy();
  expect(within(summary).getByText("20")).toBeTruthy();
  expect(within(summary).getByText("3")).toBeTruthy();
  // Alasan tidak di-dump mentah.
  expect(summary.textContent).toContain("Syarat refill saling bertentangan");
  expect(summary.textContent).toContain("Deskripsi resmi belum tersedia");
  expect(summary.textContent).not.toContain("terms_conflict");
  expect(summary.textContent).not.toContain("description_missing");
});

it("never shows a 0 for data the server did not report", async () => {
  overview = { ok: true, providers: [] };
  render(<PediaManager />);
  const summary = await screen.findByRole("region", { name: "Ringkasan katalog otomatis" });
  await waitFor(() => expect(summary.textContent).toContain("Belum tersedia"));
  expect(within(summary).getAllByText("Belum tersedia").length).toBeGreaterThan(0);
});

it("drives resync by cursor until done, sequentially, with progress and no auto-run", async () => {
  render(<PediaManager initialTab="services" />);
  // Tidak ada resync otomatis saat panel dibuka.
  expect(resyncCalls).toHaveLength(0);
  fireEvent.click(await screen.findByRole("button", { name: /Tarik ulang/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Tarik ulang" }));
  await waitFor(() => expect(resyncCalls).toHaveLength(2));
  expect(resyncCalls[0]).toMatchObject({ action: "resync", supplier: "providersmm", cursor: 0, refresh: true });
  expect(resyncCalls[1]).toMatchObject({ cursor: 25, refresh: false });
  await waitFor(() => expect(screen.getByText(/30 \/ 30|diproses/)).toBeTruthy());
});

it("stops on a malformed/non-advancing cursor instead of looping", async () => {
  vi.mocked(fetch).mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method && String(url).includes("services")) {
      resyncCalls.push(JSON.parse(String(init.body)));
      return Response.json({ ok: true, total: 10, cursor: 0, done: false, managed: { processed: 0, remaining: 10 } });
    }
    if (String(url).includes("products")) return Response.json({ ok: true, products: [{ ...product }], tiers: [{ ...managedTier }] });
    if (String(url).includes("services")) return Response.json({ ok: true, total: 1, diff: {}, rows: [] });
    if (String(url).includes("overview")) return Response.json(overview);
    return Response.json({ ok: true, rows: [], settings: {}, balance_history: [] });
  });
  render(<PediaManager initialTab="services" />);
  fireEvent.click(await screen.findByRole("button", { name: /Tarik ulang/ }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Tarik ulang" }));
  await waitFor(() => expect(resyncCalls.length).toBeGreaterThan(0));
  // Guard: tidak boleh ratusan request.
  await new Promise((r) => setTimeout(r, 50));
  expect(resyncCalls.length).toBeLessThanOrEqual(2);
});

it("surfaces partial resync failure without claiming success", async () => {
  vi.mocked(fetch).mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method && String(url).includes("services")) {
      resyncCalls.push(JSON.parse(String(init.body)));
      return Response.json({ ok: false, errors: ["sync_partial"] }, { status: 500 });
    }
    if (String(url).includes("products")) return Response.json({ ok: true, products: [{ ...product }], tiers: [{ ...managedTier }] });
    if (String(url).includes("services")) return Response.json({ ok: true, total: 1, diff: {}, rows: [] });
    if (String(url).includes("overview")) return Response.json(overview);
    return Response.json({ ok: true, rows: [], settings: {}, balance_history: [] });
  });
  render(<PediaManager initialTab="services" />);
  fireEvent.click(await screen.findByRole("button", { name: /Tarik ulang/ }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Tarik ulang" }));
  await waitFor(() => expect(screen.getByText(/berhasil sebagian/)).toBeTruthy());
  expect(resyncCalls).toHaveLength(1);
  expect(screen.queryByText(/selesai disinkronkan/)).toBeNull();
});

it("labels each managed row and shows manual/auto reasons in the eligibility column", async () => {
  render(<PediaManager initialTab="services" />);
  const table = await screen.findByRole("table", { name: "Layanan supplier" });
  expect(within(table).getByText("Ditahan")).toBeTruthy();
  expect(within(table).getByText("Syarat refill saling bertentangan (nama vs deskripsi)")).toBeTruthy();
  expect(within(table).getByText(/Deskripsi: tersedia/)).toBeTruthy();
});

it("filters rows by managed eligibility on the server (admin only)", async () => {
  render(<PediaManager initialTab="services" />);
  await screen.findByRole("table", { name: "Layanan supplier" });
  // FINAL-PATCH E: filter diteruskan ke server (SQL sebelum COUNT/LIMIT),
  // bukan menyaring 50 baris di klien. Mock mengembalikan baris yang sama
  // untuk semua state; yang diuji adalah kontrak request + render ulang.
  fireEvent.change(screen.getByLabelText("Kelayakan otomatis"), { target: { value: "active" } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("managed=active"))).toBe(true));
  fireEvent.change(screen.getByLabelText("Kelayakan otomatis"), { target: { value: "blocked" } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("managed=blocked"))).toBe(true));
  expect(await screen.findByRole("table", { name: "Layanan supplier" })).toBeTruthy();
});

it("pauses a managed row with a distinguishable human reason and never rewrites its source", async () => {
  render(<PediaManager />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Followers Instagram" }));
  const form = await screen.findByRole("form", { name: "Edit tingkat standar" });
  // Field sumber otomatis dinonaktifkan.
  expect((within(form).getByLabelText("Nama layanan publik") as HTMLInputElement).disabled).toBe(true);
  expect((within(form).getByLabelText("ID layanan utama") as HTMLInputElement).disabled).toBe(true);
  // Admin tetap bisa mengubah harga.
  fireEvent.change(within(form).getByLabelText("Markup (%)"), { target: { value: "75" } });
  const pause = within(form).getByLabelText(/Jual layanan ini/);
  fireEvent.click(pause); // fixture mulai nonaktif → klik = aktif
  fireEvent.click(pause); // klik kedua = jeda (uncheck)
  fireEvent.submit(form);
  await waitFor(() => expect(writes).toHaveLength(1));
  const body = writes[0].body;
  expect(body).toMatchObject({ kind: "tier", id: 1, is_active: 0, markup_pct: 75 });
  // Mapping/salinan sumber tidak dikirim ulang untuk baris otomatis.
  expect(body.supplier).toBeUndefined();
  expect(body.supplier_service_id).toBeUndefined();
  expect(body.public_name).toBeUndefined();
  expect(body.description_md).toBeUndefined();
});
