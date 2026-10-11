// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PediaManager } from "@/components/admin/PediaManager";

const product = { id: 1, name: "Followers Instagram", slug: "followers-instagram", platform: "instagram", metric: "followers", target_kind: "profile", tagline: "Ramai", description_md: "Deskripsi", checklist_json: '[{"id":"public","label":"Publik","help":"Bantuan"}]', packages_json: "[100,250]", step: 10, sort_order: 0, is_active: 1, is_featured: 0 };
const tier = { id: 1, product_id: 1, tier: "standar", label_note: "Indonesia", supplier_service_id: 86, backup_service_id: null, price_group: "G3", markup_pct: 20, min_profit_rp: 1000, refill_days: 30, eta_start: "5 menit", eta_finish: "1 jam", package_prices_json: '{"100":5000,"250":12000}', is_active: 1, auto_disabled_reason: null, live_rate: 30000, live_min: 100, live_max: 1000, live_present: 1, live_type: "Default" };
let catalog: { products: typeof product[]; tiers: typeof tier[] };
let writes: { url: string; body: Record<string, unknown> }[];
let failWrite = false;
let failRead = "";
let orderRows: Record<string, unknown>[] = [];
const settings = { pedia_markup_g1: 150, pedia_markup_g2: 60, pedia_markup_g3: 20, pedia_min_profit_g1: 500, pedia_min_profit_g2: 2000, pedia_min_profit_g3: 1000, pedia_min_order_rp: 1000, pedia_balance_alert_rp: 100000 };
beforeEach(() => {
  window.history.replaceState(null, "", "/admin?section=pedia&keep=1");
  catalog = { products: [{ ...product }, { ...product, id: 2, name: "Views TikTok", slug: "views-tiktok", platform: "tiktok" }], tiers: [{ ...tier }] };
  writes = []; failWrite = false; failRead = ""; orderRows = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method) {
      const body = JSON.parse(String(init.body)); writes.push({ url, body });
      if (failWrite) return Response.json({ error: "save_failed" }, { status: 500 });
      if (url.endsWith("products")) {
        if (body.kind === "tier") catalog.tiers = catalog.tiers.map((t) => t.id === body.id ? { ...t, ...body } : t);
        else catalog.products = catalog.products.map((p) => p.id === body.id ? { ...p, ...body } : p);
      }
      return Response.json({ ok: true, credit_code: "PDK-TEST-1234" });
    }
    if (failRead && url.includes(failRead)) return Response.json({ error: "load_failed" }, { status: 500 });
    if (url.includes("products")) return Response.json({ ok: true, ...catalog });
    if (url.includes("services")) return Response.json({ ok: true, total: 51, diff: {}, rows: [{ service_id: 99, name: "Instagram Indonesia", rate_idr_per_1k: 50000, min_qty: 100, max_qty: 1000, present: 1, type: "Default" }] });
    if (url.includes("orders")) return Response.json({ ok: true, rows: orderRows });
    if (url.includes("credits")) return Response.json({ ok: true, rows: [] });
    return Response.json({ ok: true, settings, balance_history: [] });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("compact listing has honest readiness, search, filters and explicit actions", async () => {
  render(<PediaManager />);
  await screen.findByRole("button", { name: "Edit Followers Instagram" });
  expect(within(screen.getByRole("list")).getByText("Siap dijual")).toBeTruthy();
  expect(within(screen.getByRole("list")).getByText("Belum siap")).toBeTruthy();
  expect(screen.queryByRole("form", { name: "Edit produk" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Cari produk"), { target: { value: "86" } });
  expect(screen.queryByRole("button", { name: "Edit Views TikTok" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Hapus filter" }));
  fireEvent.change(screen.getByLabelText("Ketersediaan"), { target: { value: "Belum siap" } });
  expect(screen.queryByRole("button", { name: "Edit Followers Instagram" })).toBeNull();
  expect(screen.getByRole("button", { name: "Edit Views TikTok" })).toBeTruthy();
});

it.each([
  { is_active: 0 }, { live_present: 0 }, { package_prices_json: "{}" },
  { live_min: 500 }, { live_type: "Custom Comments" }, { live_rate: null },
])("does not call an unusable active product ready: %j", async (patch) => {
  catalog.tiers = [{ ...tier, ...patch } as typeof tier];
  render(<PediaManager />);
  await screen.findByRole("button", { name: "Edit Followers Instagram" });
  expect(within(screen.getByRole("list")).queryByText("Siap dijual")).toBeNull();
});

it("focused editor saves all existing product fields and rejects invalid packages", async () => {
  render(<PediaManager />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Followers Instagram" }));
  const form = screen.getByRole("form", { name: "Edit produk" });
  fireEvent.change(within(form).getByLabelText("Nama produk"), { target: { value: "Followers Baru" } });
  fireEvent.change(within(form).getByLabelText(/Paket jumlah/), { target: { value: "105" } });
  fireEvent.submit(form);
  expect(await screen.findByRole("alert")).toBeTruthy(); expect(writes).toHaveLength(0);
  fireEvent.change(within(form).getByLabelText(/Paket jumlah/), { target: { value: "100, 500" } });
  fireEvent.click(within(form).getByLabelText("Produk unggulan"));
  fireEvent.submit(form);
  await screen.findByText("Produk tersimpan.");
  expect(writes[0].body).toMatchObject({ id: 1, name: "Followers Baru", packages_json: "[100,500]", is_featured: 1, step: 10, target_kind: "profile", description_md: "Deskripsi" });
  expect(JSON.parse(String(writes[0].body.checklist_json))[0].help).toBe("Bantuan");
});

it("tier order is Hemat, Standar, Premium and tier edits use PUT fields", async () => {
  catalog.tiers = [{ ...tier, id: 3, tier: "premium" }, tier, { ...tier, id: 2, tier: "hemat" }];
  render(<PediaManager />); fireEvent.click(await screen.findByRole("button", { name: "Edit Followers Instagram" }));
  const summaries = Array.from(document.querySelectorAll("summary")).map((el) => el.textContent);
  expect(summaries[0]).toMatch(/hemat/); expect(summaries[1]).toMatch(/standar/); expect(summaries[2]).toMatch(/premium/);
  const form = screen.getByRole("form", { name: "Edit tingkat standar" });
  fireEvent.change(within(form).getByLabelText("Markup (%)"), { target: { value: "50" } });
  fireEvent.change(within(form).getByLabelText("ID layanan cadangan"), { target: { value: "99" } });
  fireEvent.submit(form); await screen.findByText(/Tingkat standar tersimpan/);
  expect(writes[0].body).toMatchObject({ kind: "tier", id: 1, markup_pct: 50, backup_service_id: 99, refill_days: 30, eta_start: "5 menit", eta_finish: "1 jam" });
});

it("checklist points can be added and removed without editing JSON or losing existing help", async () => {
  render(<PediaManager />); fireEvent.click(await screen.findByRole("button", { name: "Edit Followers Instagram" }));
  fireEvent.click(screen.getByRole("button", { name: "Tambah poin checklist" }));
  fireEvent.change(screen.getByLabelText("Poin checklist 2"), { target: { value: "Jangan ganti username" } });
  fireEvent.submit(screen.getByRole("form", { name: "Edit produk" }));
  await screen.findByText("Produk tersimpan.");
  const checks = JSON.parse(String(writes[0].body.checklist_json));
  expect(checks[0]).toMatchObject({ id: "public", label: "Publik", help: "Bantuan" });
  expect(checks[1].label).toBe("Jangan ganti username");
  fireEvent.click(screen.getByRole("button", { name: "Hapus poin checklist 2" }));
  expect(screen.queryByLabelText("Poin checklist 2")).toBeNull();
});

it("failed toggle is visible and does not pretend status changed", async () => {
  failWrite = true; render(<PediaManager />);
  fireEvent.click(await screen.findByRole("button", { name: "Nonaktifkan Followers Instagram" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Perubahan gagal disimpan");
  expect(screen.getByRole("button", { name: "Nonaktifkan Followers Instagram" })).toBeTruthy();
  expect(screen.queryByText(/dinonaktifkan\./)).toBeNull();
});

it("tab navigation preserves other query parameters and responds to back and new props", async () => {
  const view = render(<PediaManager />);
  fireEvent.click(screen.getByRole("button", { name: "Kredit" }));
  await screen.findByText("Belum ada kode kredit.");
  expect(window.location.search).toContain("tab=credits"); expect(window.location.search).toContain("keep=1");
  window.history.replaceState(null, "", "/admin?section=pedia&tab=orders"); fireEvent.popState(window);
  expect(screen.getByLabelText("Status pesanan")).toBeTruthy();
  view.rerender(<PediaManager initialTab="settings" />);
  expect(await screen.findByLabelText("Markup G1 (%)")).toBeTruthy();
});

it("supplier explorer pages, filters and assigns a selected service to an existing tier", async () => {
  render(<PediaManager initialTab="services" />);
  fireEvent.click(await screen.findByRole("button", { name: "Pakai layanan 99" }));
  fireEvent.change(screen.getByLabelText("Produk tujuan"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Tingkat tujuan"), { target: { value: "1" } });
  fireEvent.submit(screen.getByRole("form", { name: "Hubungkan layanan" }));
  await screen.findByRole("form", { name: "Edit produk" });
  expect(writes[0].body).toEqual({ kind: "tier", id: 1, supplier_service_id: 99 });
  fireEvent.click(screen.getByRole("button", { name: "Layanan Supplier" }));
  fireEvent.click(await screen.findByRole("button", { name: "Berikutnya" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("page=2"), expect.anything()));
  fireEvent.click(screen.getByLabelText("Indonesia"));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("indonesia=1"), expect.anything()));
});

it.each(["services", "orders", "credits", "settings"])("%s exposes failed reads instead of an empty success", async (tab) => {
  failRead = tab; render(<PediaManager initialTab={tab} />);
  expect((await screen.findByRole("alert")).textContent).toContain("Data gagal dimuat");
  expect(screen.queryByText("Belum ada kode kredit.")).toBeNull();
});

it("settings failure remains visible and confirmation does not silently succeed", async () => {
  render(<PediaManager initialTab="settings" />); await screen.findByLabelText("Markup G1 (%)");
  fireEvent.submit(screen.getByRole("form", { name: "Pengaturan Pedia" }));
  failWrite = true; fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Simpan" }));
  await screen.findByRole("alert"); expect(screen.queryByText("Pengaturan tersimpan.")).toBeNull();
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("manual credit has explicit confirmation and shows the returned code", async () => {
  render(<PediaManager initialTab="credits" />); await screen.findByText("Belum ada kode kredit.");
  fireEvent.change(screen.getByLabelText("Email penerima"), { target: { value: "buyer@example.com" } });
  fireEvent.change(screen.getByLabelText("Jumlah kredit (Rp)"), { target: { value: "5000" } });
  fireEvent.change(screen.getByLabelText("Alasan kredit"), { target: { value: "Kompensasi order" } });
  fireEvent.submit(screen.getByRole("form", { name: "Kredit manual" })); expect(writes).toHaveLength(0);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Terbitkan" }));
  await screen.findByText("PDK-TEST-1234");
  expect(writes[0].body).toEqual({ email: "buyer@example.com", amount: 5000, reason: "Kompensasi order" });
});

it("resubmission requires both supplier checks and uses no native prompt or confirm", async () => {
  orderRows = [{ order_code: "AXP-TEST", status: "needs_check", product_name: "Followers", quantity: 100, total: 5000, target_normalized: "https://instagram.com/test" }];
  const confirm = vi.spyOn(window, "confirm"), prompt = vi.spyOn(window, "prompt");
  render(<PediaManager initialTab="orders" />);
  fireEvent.click(await screen.findByRole("button", { name: "Kirim ulang" }));
  const form = screen.getByRole("form", { name: "Verifikasi tindakan pesanan" });
  fireEvent.submit(form); expect(writes).toHaveLength(0);
  fireEvent.click(screen.getByLabelText(/memastikan pesanan belum ada/)); fireEvent.click(screen.getByLabelText(/risiko tagihan ganda/));
  fireEvent.submit(form); await screen.findByText("Tindakan pesanan tersimpan.");
  expect(writes[0].body).toMatchObject({ action: "resubmit", confirm: true });
  expect(confirm).not.toHaveBeenCalled(); expect(prompt).not.toHaveBeenCalled();
  confirm.mockRestore(); prompt.mockRestore();
});
