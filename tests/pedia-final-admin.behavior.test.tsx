// @vitest-environment jsdom
// tests/pedia-final-admin.behavior.test.tsx — PSMM-FINAL-PATCH D (2026-11-12).
// Mengunci panel resync: 25 sukses → gagal → "Lanjutkan" melanjutkan dari
// cursor 25 (bukan 0), tombol kembali aktif setelah sukses, respons
// malformed/non-advancing = ERROR (bukan "selesai"), dan tidak ada resync
// otomatis saat panel dibuka.
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
let resyncCalls: Body[];
let servicesQueries: string[];

function baseGet(url: string) {
  if (url.includes("products")) return Response.json({ ok: true, products: [{ ...product }], tiers: [{ ...managedTier }] });
  if (url.includes("services")) return Response.json({ ok: true, total: 1, diff: {}, rows: [] });
  if (url.includes("overview")) return Response.json({ ok: true, counts: { services: 620, managed_tiers: 610, managed_active: 590, managed_blocked: 20 }, catalog: { blocked: [], blocked_total: 0, queue_pending: 0, description_fresh_at: null }, providers: [] });
  return Response.json({ ok: true, rows: [], settings: {}, balance_history: [] });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/admin?section=pedia");
  resyncCalls = []; servicesQueries = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method) { resyncCalls.push(JSON.parse(String(init.body))); return Response.json({ ok: true, total: 60, cursor: 25, done: false, managed: { processed: 25, remaining: 35 } }); }
    if (url.includes("services?")) servicesQueries.push(url);
    return baseGet(url);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function startSync() {
  fireEvent.click(await screen.findByRole("button", { name: /Tarik ulang/ }));
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Tarik ulang" }));
}

it("resumes from the failed cursor (25, not 0) on retry and re-enables the button after success", async () => {
  let phase = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method) {
      const body = JSON.parse(String(init.body)) as Body;
      resyncCalls.push(body);
      const cursor = Number(body.cursor ?? 0);
      if (phase === 0) {
        // Potongan pertama sukses 0 → 25, lalu potongan kedua gagal.
        if (cursor === 0) return Response.json({ ok: true, total: 60, cursor: 25, done: false, managed: { processed: 25, remaining: 35 } });
        return Response.json({ ok: false, errors: ["sync_partial"] }, { status: 500 });
      }
      // Retry: harus melanjutkan dari 25 dan menyelesaikan sisa.
      return Response.json({ ok: true, total: 60, cursor: cursor === 25 ? 60 : cursor, done: true, managed: { processed: 35, remaining: 0 } });
    }
    if (url.includes("services?")) servicesQueries.push(url);
    return baseGet(url);
  }));

  render(<PediaManager initialTab="services" />);
  expect(resyncCalls).toHaveLength(0); // tidak ada auto-run saat dibuka
  await startSync();
  await waitFor(() => expect(screen.getByText(/berhasil sebagian/)).toBeTruthy());
  // Run pertama: cursor 0 lalu 25 (gagal). Tidak ada request ketiga.
  expect(resyncCalls.map((c) => c.cursor)).toEqual([0, 25]);
  expect(resyncCalls[0].refresh).toBe(true);

  // Kontrol "Lanjutkan sinkronisasi" tersedia dan tombol utama tetap aktif.
  const resume = await screen.findByRole("button", { name: "Lanjutkan sinkronisasi" });
  phase = 1;
  fireEvent.click(resume);
  await waitFor(() => expect(resyncCalls.length).toBeGreaterThan(2));
  const retried = resyncCalls.slice(2);
  // Retry melanjutkan dari 25, BUKAN mengulang dari 0; `refresh` tidak diulang.
  expect(retried[0]).toMatchObject({ cursor: 25, refresh: false });
  expect(retried.some((c) => Number(c.cursor) === 0)).toBe(false);

  // Setelah sukses, tombol utama kembali bisa dipakai (tidak disabled permanen).
  await waitFor(() => expect(screen.getByText(/selesai/)).toBeTruthy());
  const mainButton = screen.getByRole("button", { name: /Tarik ulang/ }) as HTMLButtonElement;
  await waitFor(() => expect(mainButton.disabled).toBe(false));
});

it("treats a malformed / non-advancing cursor as an error, not a completion", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method) {
      resyncCalls.push(JSON.parse(String(init.body)));
      // Cursor tidak maju dan `done` tidak pernah true.
      return Response.json({ ok: true, total: 60, cursor: 0, done: false, managed: { processed: 0, remaining: 60 } });
    }
    if (url.includes("services?")) servicesQueries.push(url);
    return baseGet(url);
  }));
  render(<PediaManager initialTab="services" />);
  await startSync();
  await waitFor(() => expect(screen.getByText(/tidak valid|tanpa kemajuan/i)).toBeTruthy());
  // Tidak boleh diklaim selesai, dan tidak loop ratusan request.
  expect(screen.queryByText(/selesai/)).toBeNull();
  await new Promise((r) => setTimeout(r, 60));
  expect(resyncCalls.length).toBeLessThanOrEqual(2);
});

it("sends the eligibility filter to the server instead of filtering a single page client-side", async () => {
  render(<PediaManager initialTab="services" />);
  await screen.findByRole("table", { name: "Layanan supplier" });
  fireEvent.change(screen.getByLabelText("Kelayakan otomatis"), { target: { value: "blocked" } });
  await waitFor(() => expect(servicesQueries.some((u) => u.includes("managed=blocked"))).toBe(true));
  // Default (tanpa filter) = `managed=` kosong: admin tetap melihat SELURUH katalog
  // (termasuk Custom Comments / tipe yang diblokir), bukan subset diam-diam.
  fireEvent.change(screen.getByLabelText("Kelayakan otomatis"), { target: { value: "" } });
  await waitFor(() => expect(servicesQueries.some((u) => /[?&]managed=(&|$)/.test(u))).toBe(true));
  expect(servicesQueries.some((u) => /[?&]managed=(active|blocked|unmanaged)/.test(u) && u === servicesQueries[servicesQueries.length - 1])).toBe(false);
});

it("defaults to all types (compatible filter off) so Custom Comments/blocked kinds stay visible", async () => {
  render(<PediaManager initialTab="services" />);
  await screen.findByRole("table", { name: "Layanan supplier" });
  // PSMM-ACCEPTANCE-CLOSE 4: server tidak boleh dipersempit ke type='Default' +
  // kompatibel saat panel dibuka tanpa filter.
  await waitFor(() => expect(servicesQueries.some((u) => u.includes("compatible=0"))).toBe(true));
  expect(servicesQueries.every((u) => !u.includes("compatible=1"))).toBe(true);
  const compatible = screen.getByLabelText(/Kompatibel link/) as HTMLInputElement;
  expect(compatible.checked).toBe(false);
});

it("offers both suppliers on the orders/history filter without enabling new IndoSMM sales", async () => {
  render(<PediaManager initialTab="orders" />);
  const supplier = (await screen.findByLabelText("Supplier")) as HTMLSelectElement;
  const values = [...supplier.options].map((o) => o.value);
  // Riwayat harus bisa difilter per supplier lama untuk diagnosa.
  expect(values).toContain("providersmm");
  expect(values).toContain("indosmm");
  fireEvent.change(supplier, { target: { value: "indosmm" } });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("supplier=indosmm"))).toBe(true));
});
