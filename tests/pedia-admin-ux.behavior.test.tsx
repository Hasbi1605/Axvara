// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render } from "./setup/admin-render";
import { PediaManager } from "@/components/admin/PediaManager";

const product = { id: 1, name: "Followers Instagram", slug: "followers-instagram", platform: "instagram", metric: "followers", target_kind: "profile", tagline: "Ramai", description_md: "Deskripsi", checklist_json: '[{"id":"public","label":"Publik","help":"Bantuan"}]', packages_json: "[100,250]", step: 10, sort_order: 0, is_active: 1, is_featured: 0 };
const tier = { id: 1, product_id: 1, supplier: "indosmm", tier: "standar", label_note: "Indonesia", supplier_service_id: 86, backup_service_id: null, price_group: "G3", markup_pct: 20, min_profit_rp: 1000, refill_days: 30, eta_start: "5 menit", eta_finish: "1 jam", package_prices_json: '{"100":5000,"250":12000}', is_active: 1, auto_disabled_reason: null, live_rate: 30000, live_min: 100, live_max: 1000, live_present: 1, live_type: "Default" };
const settings = { pedia_markup_g1: 150, pedia_markup_g2: 60, pedia_markup_g3: 20, pedia_min_profit_g1: 500, pedia_min_profit_g2: 2000, pedia_min_profit_g3: 1000, pedia_min_order_rp: 1000, pedia_balance_alert_rp: 100000 };
let catalog: { products: typeof product[]; tiers: typeof tier[] }, writes: { url: string; body: Record<string, unknown>; method: string }[], orderRows: Record<string, unknown>[], failWrite: boolean, failRead: string, partialWrite: boolean;
beforeEach(() => {
  window.history.replaceState(null, "", "/admin?section=pedia&keep=1");
  catalog = { products: [{ ...product }, { ...product, id: 2, name: "Views TikTok", slug: "views-tiktok", platform: "tiktok" }], tiers: [{ ...tier }] };
  writes = []; orderRows = []; failWrite = false; failRead = ""; partialWrite = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method) {
      const body = JSON.parse(String(init.body)); writes.push({ url, body, method: init.method });
      if (failWrite) return Response.json({ error: "save_failed" }, { status: 500 });
      if (url.endsWith("products")) {
        if (init.method === "POST" && body.kind === "tier") catalog.tiers.push({ ...tier, ...body, id: 3 });
        else if (init.method === "POST") catalog.products.push({ ...product, ...body, id: 3 });
        else if (body.kind === "tier") catalog.tiers = catalog.tiers.map(t => t.id === body.id ? { ...t, ...body } : t);
        else catalog.products = catalog.products.map(p => p.id === body.id ? { ...p, ...body } : p);
      }
      if (partialWrite) return Response.json({ error: "reprice_failed", saved: true, id: 3 }, { status: 500 });
      return Response.json({ ok: true, id: 3 });
    }
    if (failRead && url.includes(failRead)) return Response.json({ error: "load_failed" }, { status: 500 });
    if (url.includes("products")) return Response.json({ ok: true, ...catalog });
    if (url.includes("services")) return Response.json({ ok: true, total: 51, diff: {}, rows: [{ supplier: "indosmm", service_id: 99, name: "Instagram Indonesia", rate_idr_per_1k: 50000, min_qty: 100, max_qty: 1000, present: 1, type: "Default" }] });
    if (url.includes("overview")) return Response.json({ ok: true, providers: [{ supplier: "indosmm", balance: { value: 50000, stale: false, history: [{ created_at: "2026-11-13 10:00:00" }] }, pricing_verified: true, error: null, last_sync_at: "2026-11-13 10:00:00" }] });
    if (url.includes("orders")) return Response.json({ ok: true, rows: orderRows });
    return Response.json({ ok: true, settings, balance_history: [] });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const editProduct = async () => { const table = await screen.findByRole("table", { name: "Produk Pedia" }); fireEvent.click(within(table).getByRole("button", { name: "Edit Followers Instagram" })); };
const editVariant = () => fireEvent.click(screen.getByRole("button", { name: "Edit varian standar" }));

it("shows compact variant counts, not supplier IDs, consistent states and mobile cards", async () => {
  render(<PediaManager />);
  const table = await screen.findByRole("table", { name: "Produk Pedia" });
  expect(within(table).getAllByRole("columnheader").map(e => e.textContent)).toEqual(["Produk", "Varian", "Harga mulai", "Status", "Aksi"]);
  expect(within(table).getByText("1 aktif / 1")).toBeTruthy(); expect(table.textContent).not.toContain("#86");
  expect(within(table).getByText("Siap dijual")).toBeTruthy(); expect(within(table).getByText("Aktif, belum bisa dijual")).toBeTruthy();
  expect(within(table).getByText("Belum ada varian aktif")).toBeTruthy();
  expect(screen.getByLabelText("Kartu produk Pedia").className).toContain("md:hidden");
  expect(within(screen.getByLabelText("Kartu produk Pedia")).getByRole("button", { name: "Edit Followers Instagram" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Cari produk"), { target: { value: "86" } });
  expect(within(table).queryByText("Views TikTok")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Hapus filter" }));
  fireEvent.change(screen.getByLabelText("Status produk"), { target: { value: "attention" } });
  expect(within(table).queryByText("Followers Instagram")).toBeNull();
});

it.each([{ is_active: 0 }, { live_present: 0 }, { package_prices_json: "{}" }, { live_min: 500 }, { live_type: "Custom Comments" }, { live_rate: null }])("never calls unusable active products ready: %j", async patch => {
  catalog.tiers = [{ ...tier, ...patch } as typeof tier]; render(<PediaManager />);
  const table = await screen.findByRole("table", { name: "Produk Pedia" }); expect(within(table).queryByText("Siap dijual")).toBeNull();
});

it("inactive publication is never presented as sellable and its switch stays off", async () => {
  catalog.products[0].is_active = 0; render(<PediaManager />);
  const table = await screen.findByRole("table", { name: "Produk Pedia" }); expect(within(table).getByRole("switch", { name: "Aktifkan Followers Instagram" }).getAttribute("aria-checked")).toBe("false"); expect(within(table).getByText("Nonaktif")).toBeTruthy();
});

it("saves the exact product payload and preserves checklist metadata", async () => {
  render(<PediaManager />); await editProduct(); const form = screen.getByRole("form", { name: "Edit produk" });
  fireEvent.change(within(form).getByLabelText("Nama produk"), { target: { value: "Followers Baru" } });
  fireEvent.change(within(form).getByLabelText(/Paket jumlah/), { target: { value: "105" } }); fireEvent.submit(form); expect(await screen.findByRole("alert")).toBeTruthy(); expect(writes).toHaveLength(0);
  fireEvent.change(within(form).getByLabelText(/Paket jumlah/), { target: { value: "100,500" } }); fireEvent.submit(form); await screen.findByText("Produk tersimpan.");
  expect(writes[0]).toEqual({ url: "/api/admin/pedia/products", method: "PUT", body: { id: 1, name: "Followers Baru", slug: product.slug, platform: "instagram", metric: "followers", target_kind: "profile", tagline: "Ramai", description_md: "Deskripsi", packages_json: "[100,500]", checklist_json: product.checklist_json, step: 10, sort_order: 0, is_active: 1, is_featured: 0 } });
});

it("variant essential fields precede collapsed advanced fields and save the unchanged full payload", async () => {
  render(<PediaManager />); await editProduct(); editVariant(); const form = screen.getByRole("form", { name: "Edit varian standar" });
  expect(within(form).getByLabelText("Kelompok harga").closest("details")).toBeNull();
  expect(within(form).getByLabelText("Minimum untung (Rp)").closest("details")).toBeNull();
  expect(within(form).getByLabelText("ID layanan cadangan").closest("details")?.hasAttribute("open")).toBe(false);
  fireEvent.change(within(form).getByLabelText("Markup (%)"), { target: { value: "50" } });
  fireEvent.change(within(form).getByLabelText("ID layanan cadangan"), { target: { value: "99" } }); fireEvent.submit(form); await screen.findByText(/Varian standar tersimpan/);
  expect(writes[0].body).toEqual({ kind: "tier", id: 1, is_active: 1, supplier: "indosmm", label_note: "Indonesia", price_group: "G3", eta_start: "5 menit", eta_finish: "1 jam", public_name: "", description_md: "", terms_md: "", instructions_md: "", recommendation_note: "", speed_per_day: "", drop_label: "unknown", region: "global", quality: "standar", input_kind: "", supplier_service_id: 86, refill_days: 30, min_qty_override: null, max_qty_override: null, target_format: "url", refill_anchor: "created", backup_service_id: 99, markup_pct: 50, min_profit_rp: 1000, quantity_step: 1 });
});

it("checklist points can be added and removed without JSON editing", async () => {
  render(<PediaManager />); await editProduct(); fireEvent.click(screen.getByRole("button", { name: "Tambah poin checklist" })); fireEvent.change(screen.getByLabelText("Poin checklist 2"), { target: { value: "Jangan ganti username" } }); fireEvent.submit(screen.getByRole("form", { name: "Edit produk" })); await screen.findByText("Produk tersimpan.");
  expect(JSON.parse(String(writes[0].body.checklist_json))[0]).toMatchObject({ id: "public", help: "Bantuan" }); fireEvent.click(screen.getByRole("button", { name: "Hapus poin checklist 2" })); expect(screen.queryByLabelText("Poin checklist 2")).toBeNull();
});

it("toggle sends only status and failed mutations do not pretend success", async () => {
  failWrite = true; render(<PediaManager />); const table = await screen.findByRole("table", { name: "Produk Pedia" }); fireEvent.click(within(table).getByRole("switch", { name: "Nonaktifkan Followers Instagram" })); await screen.findByRole("alert");
  expect(within(table).getByRole("switch", { name: "Nonaktifkan Followers Instagram" }).getAttribute("aria-checked")).toBe("true"); expect(writes[0].body).toEqual({ id: 1, is_active: 0 }); expect(screen.queryByText("Followers Instagram dinonaktifkan.")).toBeNull();
});

it("supplier explorer fixes supplier, pages, filters and preserves assignment payload", async () => {
  render(<PediaManager initialTab="services" />); const table = await screen.findByRole("table", { name: "Layanan IndoSMM" });
  expect(screen.queryByLabelText("Supplier")).toBeNull(); expect(screen.getByLabelText("Kartu layanan IndoSMM").className).toContain("md:hidden");
  fireEvent.click(within(table).getByRole("button", { name: "Tambahkan layanan 99 ke produk" })); fireEvent.change(screen.getByLabelText("Produk tujuan"), { target: { value: "1" } }); fireEvent.change(screen.getByLabelText("Varian tujuan"), { target: { value: "1" } }); fireEvent.submit(screen.getByRole("form", { name: "Hubungkan layanan" })); await screen.findByRole("form", { name: "Edit produk" });
  expect(writes[0].body).toEqual({ kind: "tier", id: 1, supplier: "indosmm", supplier_service_id: 99, backup_service_id: null });
  fireEvent.click(screen.getByRole("button", { name: "Layanan IndoSMM" })); fireEvent.click(await screen.findByRole("button", { name: "Berikutnya" })); await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("page=2"), expect.anything())); fireEvent.click(screen.getByLabelText("Indonesia")); await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("indonesia=1"), expect.anything()));
});

it.each(["products", "services", "orders", "settings"])("%s exposes failed reads", async tab => {
  failRead = tab; render(<PediaManager initialTab={tab} />); expect((await screen.findByRole("alert")).textContent).toContain("Data gagal dimuat");
});

it("settings bounds are read-only and save only six unchanged price-group fields", async () => {
  render(<PediaManager initialTab="settings" />); await screen.findByLabelText("Markup G1 (%)"); expect(screen.queryByRole("spinbutton", { name: /Minimum order|Ambang saldo/ })).toBeNull(); expect(screen.getAllByText("dari konfigurasi server")).toHaveLength(2);
  fireEvent.submit(screen.getByRole("form", { name: "Pengaturan Pedia" })); fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Simpan" })); await screen.findByText("Pengaturan tersimpan.");
  const { pedia_min_order_rp: _min, pedia_balance_alert_rp: _alert, ...prices } = settings; void _min; void _alert; expect(writes[0].body).toEqual(prices);
});

it("settings failure retains the confirmation", async () => {
  failWrite = true; render(<PediaManager initialTab="settings" />); await screen.findByLabelText("Markup G1 (%)"); fireEvent.submit(screen.getByRole("form", { name: "Pengaturan Pedia" })); fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Simpan" })); await screen.findByRole("alert"); expect(screen.getByRole("alertdialog")).toBeTruthy(); expect(screen.queryByText("Pengaturan tersimpan.")).toBeNull();
});

it("empty settings do not expose a price form with invented defaults", async () => {
  const originalFetch = fetch;
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => url.endsWith("/settings") && !init?.method ? Promise.resolve(Response.json({ ok: true, settings: {}, balance_history: [] })) : originalFetch(url, init)));
  render(<PediaManager initialTab="settings" />);
  await screen.findByText(/Belum ada pengaturan harga/);
  expect(screen.queryByRole("form", { name: "Pengaturan Pedia" })).toBeNull(); expect(writes).toHaveLength(0);
});

it("resubmit retains both required acknowledgments and original request body", async () => {
  orderRows = [{ order_code: "AXP-TEST", supplier: "indosmm", can_resubmit: true, status: "needs_check", product_name: "Followers", quantity: 100, total: 5000 }]; render(<PediaManager initialTab="orders" />); fireEvent.click(await screen.findByRole("button", { name: "Kirim ulang" })); const form = screen.getByRole("form", { name: "Verifikasi tindakan pesanan" }); fireEvent.submit(form); expect(writes).toHaveLength(0); fireEvent.click(screen.getByLabelText(/memastikan pesanan belum ada/)); fireEvent.click(screen.getByLabelText(/risiko tagihan ganda/)); fireEvent.submit(form); await screen.findByText("Tindakan pesanan tersimpan."); expect(writes[0].body).toEqual({ action: "resubmit", confirm: true, checked_supplier: true, accept_charge: true });
});

it("needs-action orders precede completed ones, blocked actions explain why, details start collapsed", async () => {
  orderRows = [{ order_code: "DONE", supplier: "indosmm", status: "completed", product_name: "Followers", quantity: 100, total: 5000 }, { order_code: "AMB", supplier: "indosmm", supplier_service_id: 6209, status: "needs_check", can_resubmit: false, product_name: "Followers", quantity: 100, total: 5000 }]; render(<PediaManager />);
  const retry = await screen.findByRole("button", { name: "Kirim ulang" }); expect((retry as HTMLButtonElement).disabled).toBe(true); expect((screen.getByRole("button", { name: "Batalkan & tindak lanjuti" }) as HTMLButtonElement).disabled).toBe(true); expect(screen.getByText(/Kirim ulang dan pembatalan dinonaktifkan:/)).toBeTruthy(); expect(screen.getAllByRole("article").map(e => e.getAttribute("aria-label"))).toEqual(["Pesanan AMB", "Pesanan DONE"]); expect(screen.getAllByText("Detail pesanan")[0].parentElement?.hasAttribute("open")).toBe(false); expect(screen.queryByLabelText("Tindakan DONE")).toBeNull(); fireEvent.click(retry); expect(writes).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("ID order supplier"), { target: { value: "22666147" } }); fireEvent.submit(screen.getByRole("form", { name: "Tandai sudah dibuat AMB" })); fireEvent.submit(screen.getByRole("form", { name: "Verifikasi tindakan pesanan" })); await screen.findByText("Tindakan pesanan tersimpan."); expect(writes[0].body).toEqual({ action: "mark_submitted", supplier_order_id: "22666147", confirm: true });
});

it("creation keeps original fields and starts inactive", async () => {
  render(<PediaManager />); await screen.findByRole("table", { name: "Produk Pedia" }); fireEvent.click(screen.getByRole("button", { name: "Buat produk" })); fireEvent.change(screen.getByLabelText("Nama produk"), { target: { value: "Likes Instagram" } }); fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "likes-instagram" } }); fireEvent.submit(screen.getByRole("form", { name: "Edit produk" })); await screen.findByText("Edit Likes Instagram"); expect(writes[0].body).toMatchObject({ name: "Likes Instagram", is_active: 0, is_featured: 0 }); expect(writes[0].body.id).toBeUndefined();
  fireEvent.click(screen.getByText("Buat varian", { selector: "summary" })); const form = screen.getByRole("form", { name: "Buat varian" }); fireEvent.change(within(form).getByLabelText("ID layanan varian baru"), { target: { value: "86" } }); fireEvent.submit(form); await screen.findByText(/Varian dibuat/); expect(writes[1].body).toEqual({ kind: "tier", product_id: 3, tier: "hemat", supplier: "indosmm", supplier_service_id: 86, price_group: "G1", markup_pct: 20, min_profit_rp: 1000, refill_days: 0, is_active: 0 });
});

it("saved-but-not-repriced reloads persistence without claiming success", async () => {
  render(<PediaManager />); await editProduct(); editVariant(); partialWrite = true; const form = screen.getByRole("form", { name: "Edit varian standar" }); fireEvent.change(within(form).getByLabelText("Markup (%)"), { target: { value: "45" } }); fireEvent.submit(form); expect((await screen.findByRole("alert")).textContent).toContain("Perubahan tersimpan, tetapi harga"); expect(screen.queryByText(/Varian standar tersimpan/)).toBeNull(); expect((screen.getByLabelText("Markup (%)") as HTMLInputElement).value).toBe("45");
});

it("product list paginates 120 products and resets on search", async () => {
  catalog.products = Array.from({ length: 120 }, (_, i) => ({ ...product, id: i + 1, name: `Produk ${i + 1}`, slug: `produk-${i + 1}` })); render(<PediaManager />); const table = await screen.findByRole("table", { name: "Produk Pedia" }); expect(within(table).getAllByRole("row")).toHaveLength(51); fireEvent.click(screen.getByRole("button", { name: "Berikutnya" })); expect(within(table).getByText("Produk 51")).toBeTruthy(); fireEvent.change(screen.getByLabelText("Cari produk"), { target: { value: "Produk 120" } }); expect(within(table).getByText("Produk 120")).toBeTruthy(); expect(screen.getByText(/Halaman 1 \/ 1/)).toBeTruthy();
});

it("does not reset a newly selected services page when the initial search debounce settles", async () => {
  render(<PediaManager initialTab="services" />); await screen.findByRole("table", { name: "Layanan IndoSMM" });
  await waitFor(() => expect((screen.getByRole("button", { name: "Berikutnya" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Berikutnya" })); await screen.findByText("Halaman 2 / 2 · 51 hasil");
  await new Promise(resolve => setTimeout(resolve, 350)); expect(screen.getByText("Halaman 2 / 2 · 51 hasil")).toBeTruthy();
});

it("saved storefront preview stays private and does not follow unsaved edits or issue order requests", async () => {
  catalog.products[0].is_active = 0; catalog.tiers[0].is_active = 0;
  render(<PediaManager />); await editProduct();
  fireEvent.click(screen.getByText("Pratinjau tersimpan", { selector: "summary" }));
  fireEvent.click(screen.getByText("Pratinjau detail & pesanan tersimpan", { selector: "summary" }));
  const preview = screen.getByRole("region", { name: "Pratinjau produk" });
  fireEvent.change(screen.getByLabelText("Nama produk"), { target: { value: "Unsaved name" } });
  expect(preview.textContent).not.toContain("Unsaved name"); expect(within(preview).getByRole("heading", { name: product.name })).toBeTruthy();
  const count = vi.mocked(fetch).mock.calls.length;
  expect(fireEvent.click(within(preview).getByRole("link", { name: /lihat paket/ }))).toBe(false);
  for (const button of within(preview).getAllByRole("button", { name: "Lanjut: isi target" })) expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(count); expect(writes).toHaveLength(0); expect(preview.querySelector(".fixed")).toBeNull(); expect(preview.textContent).not.toMatch(/IndoSMM|ProviderSMM/);
});
