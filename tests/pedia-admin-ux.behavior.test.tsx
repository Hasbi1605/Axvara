// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PediaManager } from "@/components/admin/PediaManager";

const product = { id: 1, name: "Followers Instagram", slug: "followers-instagram", platform: "instagram", metric: "followers", target_kind: "profile", tagline: "Ramai", description_md: "Deskripsi", checklist_json: '[{"id":"public","label":"Publik","help":"Bantuan"}]', packages_json: "[100,250]", step: 10, sort_order: 0, is_active: 1, is_featured: 0 };
const tier = { id: 1, product_id: 1, supplier: "providersmm", tier: "standar", label_note: "Indonesia", supplier_service_id: 86, backup_service_id: null, price_group: "G3", markup_pct: 20, min_profit_rp: 1000, refill_days: 30, eta_start: "5 menit", eta_finish: "1 jam", package_prices_json: '{"100":5000,"250":12000}', is_active: 1, auto_disabled_reason: null, live_rate: 30000, live_min: 100, live_max: 1000, live_present: 1, live_type: "Default" };
let catalog: { products: typeof product[]; tiers: typeof tier[] };
let writes: { url: string; body: Record<string, unknown> }[];
let failWrite = false;
let failRead = "";
let partialWrite = false;
let orderRows: Record<string, unknown>[] = [];
const settings = { pedia_markup_g1: 150, pedia_markup_g2: 60, pedia_markup_g3: 20, pedia_min_profit_g1: 500, pedia_min_profit_g2: 2000, pedia_min_profit_g3: 1000, pedia_min_order_rp: 1000, pedia_balance_alert_rp: 100000 };
beforeEach(() => {
  window.history.replaceState(null, "", "/admin?section=pedia&keep=1");
  catalog = { products: [{ ...product }, { ...product, id: 2, name: "Views TikTok", slug: "views-tiktok", platform: "tiktok" }], tiers: [{ ...tier }] };
  writes = []; failWrite = false; failRead = ""; partialWrite = false; orderRows = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method) {
      const body = JSON.parse(String(init.body)); writes.push({ url, body });
      if (failWrite) return Response.json({ error: "save_failed" }, { status: 500 });
      if (url.endsWith("products")) {
        if (init.method === "POST" && body.kind === "tier") catalog.tiers.push({ ...tier, ...body, id: 3 } as typeof tier);
        else if (init.method === "POST") catalog.products.push({ ...product, ...body, id: 3 } as typeof product);
        else if (body.kind === "tier") catalog.tiers = catalog.tiers.map((t) => t.id === body.id ? { ...t, ...body } : t);
        else catalog.products = catalog.products.map((p) => p.id === body.id ? { ...p, ...body } : p);
      }
      if (partialWrite) return Response.json({ error: "reprice_failed", saved: true, id: 3 }, { status: 500 });
      return Response.json({ ok: true, id: 3, credit_code: "PDK-TEST-1234" });
    }
    if (failRead && url.includes(failRead)) return Response.json({ error: "load_failed" }, { status: 500 });
    if (url.includes("products")) return Response.json({ ok: true, ...catalog });
    if (url.includes("services")) return Response.json({ ok: true, total: 51, diff: {}, rows: [{ supplier: new URL(url, "http://localhost").searchParams.get("supplier") || "providersmm", service_id: 99, name: "Instagram Indonesia", rate_idr_per_1k: 50000, min_qty: 100, max_qty: 1000, present: 1, type: "Default" }] });
    if (url.includes("overview")) return Response.json({ ok: true, providers: [] });
    if (url.includes("orders")) return Response.json({ ok: true, rows: orderRows });
    if (url.includes("credits")) return Response.json({ ok: true, rows: [] });
    return Response.json({ ok: true, settings, balance_history: [] });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("compact listing has honest readiness, search, filters and explicit actions", async () => {
  render(<PediaManager />);
  await screen.findByRole("button", { name: "Edit Followers Instagram" });
  expect(within(screen.getByRole("table", { name: "Produk Pedia" })).getByText("Siap dijual")).toBeTruthy();
  expect(within(screen.getByRole("table", { name: "Produk Pedia" })).getByText("Belum siap")).toBeTruthy();
  expect(screen.queryByRole("form", { name: "Edit produk" })).toBeNull();
  const table = screen.getByRole("table", { name: "Produk Pedia" });
  expect(within(table).getAllByRole("columnheader").map(e => e.textContent)).toEqual(["Produk", "Platform", "Layanan supplier", "Harga mulai", "Kesiapan", "Aktif / Aksi"]);
  const actions = screen.getByRole("group", { name: "Aksi Followers Instagram" });
  expect(within(actions).getByRole("switch").nextElementSibling).toBe(within(actions).getByRole("button", { name: "Edit Followers Instagram" }));
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
  expect(within(screen.getByRole("table", { name: "Produk Pedia" })).queryByText("Siap dijual")).toBeNull();
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
   const summaries = Array.from(document.querySelectorAll("summary")).map((el) => el.textContent).filter((text) => /ProviderSMM/.test(text ?? ""));
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
  fireEvent.click(await screen.findByRole("switch", { name: "Nonaktifkan Followers Instagram" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Perubahan gagal disimpan");
  expect(screen.getByRole("switch", { name: "Nonaktifkan Followers Instagram" })).toBeTruthy();
  expect(screen.queryByText(/dinonaktifkan\./)).toBeNull();
  expect(screen.getByRole("switch", { name: "Nonaktifkan Followers Instagram" }).getAttribute("aria-checked")).toBe("true");
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
  fireEvent.click(await screen.findByRole("button", { name: "Pakai layanan providersmm 99" }));
  fireEvent.change(screen.getByLabelText("Produk tujuan"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Tingkat tujuan"), { target: { value: "1" } });
  fireEvent.submit(screen.getByRole("form", { name: "Hubungkan layanan" }));
  await screen.findByRole("form", { name: "Edit produk" });
  expect(writes[0].body).toEqual({ kind: "tier", id: 1, supplier: "providersmm", supplier_service_id: 99, backup_service_id: null });
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
  orderRows = [{ order_code: "AXP-TEST", supplier: "indosmm", can_resubmit: true, status: "needs_check", product_name: "Followers", quantity: 100, total: 5000, target_normalized: "https://instagram.com/test" }];
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

it("supplier editor clears stale IDs on provider change and saves the pair atomically", async () => {
  render(<PediaManager />); fireEvent.click(await screen.findByRole("button", { name: "Edit Followers Instagram" }));
  const form = screen.getByRole("form", { name: "Edit tingkat standar" });
  fireEvent.change(within(form).getByLabelText("Supplier utama"), { target: { value: "indosmm" } });
  expect((within(form).getByLabelText("ID layanan utama") as HTMLInputElement).value).toBe("");
  expect((within(form).getByLabelText("ID layanan cadangan") as HTMLInputElement).value).toBe("");
  fireEvent.change(within(form).getByLabelText("ID layanan utama"), { target: { value: "86" } });
  fireEvent.submit(form); await screen.findByText(/Tingkat standar tersimpan/);
  expect(writes[0].body).toMatchObject({ supplier: "indosmm", supplier_service_id: 86, backup_service_id: null });
});

it("supplier explorer assigns IndoSMM with its own identity and filters", async () => {
  render(<PediaManager initialTab="services" />);
  await screen.findByRole("button", { name: "Pakai layanan providersmm 99" });
  fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "indosmm" } });
  fireEvent.click(await screen.findByRole("button", { name: "Pakai layanan indosmm 99" }));
  fireEvent.change(screen.getByLabelText("Produk tujuan"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Tingkat tujuan"), { target: { value: "1" } });
  fireEvent.submit(screen.getByRole("form", { name: "Hubungkan layanan" }));
  await screen.findByRole("form", { name: "Edit produk" });
  expect(writes[0].body).toMatchObject({ supplier: "indosmm", supplier_service_id: 99, backup_service_id: null });
});

it("publication, featured and process readiness are separate", async () => {
  catalog.products[0].is_active = 0;
  render(<PediaManager />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Followers Instagram" }));
  const preview = screen.getByRole("region", { name: "Pratinjau produk" });
  expect(preview.textContent).toContain("Draf / Katalog penuh / Siap dijual");
  expect(screen.getByLabelText("Terbit")).toBeTruthy();
  expect(preview.textContent).toContain("Refill 30 hari");
  expect(preview.textContent).not.toContain("ProviderSMM");
});

it("previews saved drafts with actual storefront components without navigation or requests", async () => {
  catalog.products[0].is_active = 0;
  catalog.tiers[0].is_active = 0;
  render(<PediaManager />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Followers Instagram" }));
  const preview = screen.getByRole("region", { name: "Pratinjau produk" });
  expect(preview.textContent).toContain("Preview hanya memakai data tersimpan");
  fireEvent.click(within(preview).getByText("Pratinjau detail & pesanan tersimpan"));
  expect(within(preview).getByRole("heading", { name: product.name })).toBeTruthy();
  expect(within(preview).getByText("Deskripsi")).toBeTruthy();
  expect(within(preview).getByLabelText("PublikBantuan")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Nama produk"), { target: { value: "Unsaved name" } });
  fireEvent.change(screen.getByLabelText("Tagline produk publik"), { target: { value: "Unsaved tagline" } });
  fireEvent.change(screen.getByLabelText("Deskripsi produk publik"), { target: { value: "Unsaved description" } });
  expect(preview.textContent).not.toContain("Unsaved");
  // 2026-10-12 (owner): tagline tidak dirender di storefront — preview
  // menampilkan deskripsi kurasi, bukan tagline.
  expect(within(preview).queryByText("Ramai")).toBeNull();
  expect(within(preview).getByText("Deskripsi")).toBeTruthy();
  const calls = vi.mocked(fetch).mock.calls.length;
  expect(fireEvent.click(within(preview).getByRole("link", { name: /lihat paket/ }))).toBe(false);
  expect(window.location.pathname).toBe("/admin");
  fireEvent.click(within(preview).getByRole("radio", { name: /Indonesia/ }));
  fireEvent.change(within(preview).getByLabelText("Jumlah yang dipesan"), { target: { value: "100" } });
  fireEvent.change(within(preview).getByLabelText("Link profil Instagram"), { target: { value: "https://instagram.com/test" } });
  for (const button of within(preview).getAllByRole("button", { name: "Lanjut isi kontak" })) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
  }
  expect(preview.querySelector(".fixed")).toBeNull();
  expect(within(preview).queryByLabelText("Nomor WhatsApp")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(calls);
  expect(writes).toHaveLength(0);
});

it("filters unusable saved packages and refreshes the preview only after saving", async () => {
  catalog.tiers[0].live_max = 100;
  render(<PediaManager />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Followers Instagram" }));
  const preview = screen.getByRole("region", { name: "Pratinjau produk" });
  fireEvent.click(within(preview).getByText("Pratinjau detail & pesanan tersimpan"));
  // 2026-10-14: harga tampil per 1.000 dari tarif tersimpan, chip jumlah
  // difilter batas live (250 di luar live_max=100 tidak ditawarkan).
  expect(preview.textContent).toContain("5.000");
  expect(within(preview).queryByRole("button", { name: "250" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Nama produk"), { target: { value: "Saved new name" } });
  expect(preview.textContent).not.toContain("Saved new name");
  fireEvent.submit(screen.getByRole("form", { name: "Edit produk" }));
  await screen.findByText("Produk tersimpan.");
  expect(within(preview).getByRole("heading", { name: "Saved new name" })).toBeTruthy();
});

it("does not invent prices for saved products without usable packages or preview unsaved products", async () => {
  catalog.tiers[0].live_present = 0;
  render(<PediaManager />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Followers Instagram" }));
  const preview = screen.getByRole("region", { name: "Pratinjau produk" });
  expect(within(preview).getByText("Lihat harga")).toBeTruthy();
  expect(preview.textContent).toContain("Belum ada paket layak");
  expect(within(preview).queryByRole("radio")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Kembali ke daftar" }));
  fireEvent.click(screen.getByRole("button", { name: "Buat produk" }));
  expect(screen.queryByRole("region", { name: "Pratinjau produk" })).toBeNull();
});

it("product and tier creation use existing POST endpoints and start unpublished/inactive", async () => {
  render(<PediaManager />); await screen.findByRole("button", { name: "Edit Followers Instagram" });
  fireEvent.click(screen.getByRole("button", { name: "Buat produk" }));
  const form = screen.getByRole("form", { name: "Edit produk" });
  fireEvent.change(within(form).getByLabelText("Nama produk"), { target: { value: "Likes Instagram" } });
  fireEvent.change(within(form).getByLabelText("Slug"), { target: { value: "likes-instagram" } });
  fireEvent.submit(form); await screen.findByText("Edit Likes Instagram");
  expect(writes[0].body).toMatchObject({ name: "Likes Instagram", is_active: 0, is_featured: 0 });
  expect(writes[0].body.id).toBeUndefined();
  const tierForm = screen.getByRole("form", { name: "Buat tingkat" });
  fireEvent.change(within(tierForm).getByLabelText("Supplier tingkat baru"), { target: { value: "indosmm" } });
  fireEvent.change(within(tierForm).getByLabelText("ID layanan tingkat baru"), { target: { value: "86" } });
  fireEvent.submit(tierForm); await screen.findByText(/Tingkat dibuat/);
  expect(writes[1].body).toMatchObject({ kind: "tier", product_id: 3, supplier: "indosmm", supplier_service_id: 86, is_active: 0 });
});

it("saved-but-not-repriced response reloads persisted data without claiming success", async () => {
  render(<PediaManager />); fireEvent.click(await screen.findByRole("button", { name: "Edit Followers Instagram" }));
  partialWrite = true;
  const form = screen.getByRole("form", { name: "Edit tingkat standar" });
  fireEvent.change(within(form).getByLabelText("Markup (%)"), { target: { value: "45" } });
  fireEvent.submit(form);
  expect((await screen.findByRole("alert")).textContent).toContain("Perubahan tersimpan, tetapi harga");
  expect(screen.queryByText(/Tingkat standar tersimpan/)).toBeNull();
  expect((screen.getByLabelText("Markup (%)") as HTMLInputElement).value).toBe("45");
});

it("ambiguous orders expose original snapshot and disable blind retry/credit", async () => {
  orderRows = [{ order_code: "AXP-AMB", supplier: "indosmm", supplier_service_id: 86, supplier_order_id: null, submit_attempts: 1, can_resubmit: false, status: "needs_check", product_name: "Followers", quantity: 100, total: 5000, last_error: "submit timeout; reconcile before retry" }];
  render(<PediaManager initialTab="orders" />);
  const retry = await screen.findByRole("button", { name: "Kirim ulang" });
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Batalkan + kredit" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Snapshot asal: IndoSMM/)).toBeTruthy();
  expect(screen.getByText(/retry\/kredit diblokir/)).toBeTruthy();
  fireEvent.click(retry); expect(writes).toHaveLength(0);
});

it("inline product status switch saves only status and reflects the refreshed publication", async () => {
  render(<PediaManager />);
  const toggle = await screen.findByRole("switch", { name: "Nonaktifkan Followers Instagram" });
  fireEvent.click(toggle);
  expect((toggle as HTMLButtonElement).disabled).toBe(true);
  const inactive = await screen.findByRole("switch", { name: "Aktifkan Followers Instagram" });
  expect(inactive.getAttribute("aria-checked")).toBe("false");
  expect(writes).toEqual([{ url: "/api/admin/pedia/products", body: { id: 1, is_active: 0 } }]);
});

it.each([
  ["services", "Layanan supplier", "Biaya per 1.000"],
  ["orders", "Pesanan Pedia", "Status"],
  ["credits", "Daftar kredit Pedia", "Sisa kredit"],
])("%s presents its data in a labeled table with column headers", async (tab, title, column) => {
  render(<PediaManager initialTab={tab} />);
  const table = await screen.findByRole("table", { name: title });
  expect(within(table).getByRole("columnheader", { name: column })).toBeTruthy();
  expect(screen.getByRole("region", { name: title }).getAttribute("tabindex")).toBe("0");
});
