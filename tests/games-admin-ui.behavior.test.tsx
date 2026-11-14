// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GamesManager } from "@/components/admin/GamesManager";
import { AdminWorkspace } from "@/components/admin/AdminWorkspace";
import { BulkMarkupToolbar } from "@/components/admin/BulkMarkupToolbar";
import { ToastProvider } from "@/components/ui/Toast";
import { render } from "./setup/admin-render";
import type { Game, Item, List } from "@/components/admin/games/shared";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }, Toaster: () => null }));
const game: Game = { slug: "mobile-legends", name: "Mobile Legends", publisher: "Moonton", icon: "/brand/games/mobile-legends-icon.webp", banner: null, description: "Top up cepat.", id_guide: "Buka profil.", featured_rank: 2, hidden: false, markup_percent: null, effective_markup_percent: 5, variants_total: 3, sellable_count: 1, supplier_off_count: 2, min_price: 52500 };
const item: Item = { buyer_sku_code: "sk:101", product_name: "86 Diamond", game_brand: "Mobile Legends", sk_product_name: "Mobile Legends", product_type_name: "Indonesia", description: "✅ Proses cepat", supplier_active: 1, stock: 5, min_order: 1, cost: 50000, sell_price: 52500, enabled: 1, display_group: null, display_order: null, contract_supported: true, availability: { available: true, reason: null }, sellable: true, markup_percent: null, effective_markup_percent: 5, markup_fixed: 0, markup_source: "global", region: "ID" };
let data: List, calls: { url: string; method: string; body: Record<string, unknown> }[], failLoad: boolean, failSave: boolean;
function setup(tab = "games", workspace = false) {
  history.replaceState(null, "", `/admin?section=games&tab=${tab}`);
  const node = <GamesManager />;
  return render(workspace ? <AdminWorkspace>{node}</AdminWorkspace> : <ToastProvider>{node}</ToastProvider>);
}
function desktop() { return within(screen.getByRole("region", { name: "Tabel varian game" })); }
beforeEach(() => {
  data = { items: [item, { ...item, buyer_sku_code: "sk:102", product_name: "Weekly Diamond Pass", supplier_active: 0, sellable: false, availability: { available: false, reason: "supplier_off" }, enabled: 0, markup_source: "variant", markup_percent: 8, effective_markup_percent: 8, markup_fixed: 500 }], total: 2, brands: ["Mobile Legends"], limit: 50, offset: 0, games: [{ ...game }], pricing: { markup_percent: 5, rounding: 100 }, sync: { last_sync_at: "2026-11-14T00:00:00Z", counts: { total: 3, sellable: 1, supplier_off: 2 } } };
  calls = []; failLoad = false; failSave = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (!init?.method) return Response.json(failLoad ? { message: "Katalog gagal dimuat." } : data, { status: failLoad ? 503 : 200 });
    if (url === "/api/upload") return Response.json({ urls: ["/r2/banners/fixture.webp"] });
    const body = JSON.parse(String(init.body)); calls.push({ url, method: init.method, body });
    if (failSave) return Response.json({ message: "Koneksi supplier belum tersedia." }, { status: 503 });
    if (init.method === "PUT") data.pricing = body;
    if (url.endsWith("/bulk-markup") && body.display_group !== undefined) return Response.json({ ok: true, updated: 0, changed: (body.skus as string[]).length });
    return Response.json({ ok: true, updated: 3, changed: 3 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); history.replaceState(null, "", "/admin"); });

it("preserves the shared WR/SK/TUNVN toolbar defaults when Games props are omitted", async () => {
  const apply = vi.fn(async () => {}), clear = vi.fn(), confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<BulkMarkupToolbar visibleIds={["one", "two"]} totalCount={99} selected={new Set()} onToggleOne={vi.fn()} onToggleAllVisible={vi.fn()} onClear={clear} onApply={apply} />);
  expect((screen.getByLabelText("Markup persen bulk") as HTMLInputElement).value).toBe("20");
  for (const value of [20, 30, 50]) expect(screen.getByRole("button", { name: `${value}%` })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "3%" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "50%" })); await userEvent.click(screen.getByRole("button", { name: "Set semua tampil" })); await userEvent.click(screen.getByRole("button", { name: "Terapkan ke 2 varian" }));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("total hasil 99")); expect(apply).toHaveBeenCalledWith({ variantIds: ["one", "two"], percent: 50, resetFixed: false }); expect(clear).toHaveBeenCalledOnce();
});

describe("Games page anatomy and honest states", () => {
  it("renders four stats, supplier alert, game metadata and orders link", async () => {
    setup();
    expect(await screen.findByRole("table", { name: "Daftar game" })).toBeTruthy();
    const stats = within(screen.getByRole("region", { name: "Ringkasan Games" }));
    expect(stats.getByText("1 / 3")).toBeTruthy(); expect(stats.getByText("5 %")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Sekalipay menonaktifkan 2 dari 3 varian Game. Periksa status produk H2H di akun Sekalipay.");
    expect(screen.getByRole("link", { name: "Lihat pesanan Games" }).getAttribute("href")).toBe("/admin?section=orders&kind=games");
    expect(screen.getByText("Moonton")).toBeTruthy(); expect(screen.getByText(/Rp\s?52\.500/)).toBeTruthy();
  });
  it("does not warn at exactly 50 percent", async () => {
    data.sync.counts = { total: 4, sellable: 2, supplier_off: 2 }; setup();
    await screen.findByRole("table"); expect(screen.queryByRole("alert")).toBeNull();
  });
  it("shows skeletons, not fake zero/default values, while loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); setup();
    expect(screen.getByRole("status", { name: "Memuat Games" })).toBeTruthy();
    expect(screen.queryByText("Belum pernah")).toBeNull(); expect(screen.queryByText("5 %")).toBeNull(); expect(screen.queryByText("0 / 0")).toBeNull();
  });
  it("retries an initial error and shows an honest empty catalogue", async () => {
    failLoad = true; setup(); expect((await screen.findByRole("alert")).textContent).toContain("Katalog gagal dimuat.");
    expect(screen.queryByText("Belum pernah")).toBeNull();
    failLoad = false; data.games = []; data.items = []; data.sync.counts = { total: 0, sellable: 0, supplier_off: 0 };
    await userEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText(/Belum ada game/)).toBeTruthy();
  });
  it("persists tabs and restores them on popstate", async () => {
    setup(); await screen.findByRole("table");
    await userEvent.click(screen.getByRole("tab", { name: "Harga" }));
    expect(new URLSearchParams(location.search).get("tab")).toBe("pricing"); expect(screen.getByLabelText("Markup default %")).toBeTruthy();
    act(() => { history.replaceState(null, "", "/admin?section=games&tab=variants"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(screen.getByLabelText("Cari kode atau nama varian")).toBeTruthy();
  });
});

describe("Game editor and visibility", () => {
  it.each(["Ikon", "Banner"])("uploads %s through ImageDropzone and PATCHes the returned R2 URL", async field => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 512, height: 512, close: vi.fn() })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new Blob(["webp"], { type: "image/webp" })));
    setup(); await userEvent.click(await screen.findByRole("button", { name: "Edit Mobile Legends" }));
    const icon = screen.getByRole("group", { name: field });
    await userEvent.upload(icon.querySelector('input[type="file"]') as HTMLInputElement, new File(["image"], "icon.png", { type: "image/png" }));
    await waitFor(() => expect(icon.querySelector("img")?.getAttribute("src")).toBe("/r2/banners/fixture.webp"));
    const upload = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => url === "/api/upload");
    expect(upload?.[1].method).toBe("POST"); expect((upload?.[1].body as FormData).get("area")).toBe("banners");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(calls[0].body).toEqual({ slug: "mobile-legends", [field === "Ikon" ? "icon_url" : "banner_url"]: "/r2/banners/fixture.webp" }));
  });
  it("PATCHes visibility, without changing any other field", async () => {
    setup(); await userEvent.click(await screen.findByRole("switch", { name: "Tampilkan Mobile Legends" }));
    await waitFor(() => expect(calls).toContainEqual({ url: "/api/admin/games/games", method: "PATCH", body: { slug: "mobile-legends", hidden: true } }));
  });
  it("edits all text/number fields, counts characters, previews price and saves only changed fields", async () => {
    setup(); await userEvent.click(await screen.findByRole("button", { name: "Edit Mobile Legends" }));
    const sheet = within(screen.getByRole("dialog"));
    expect(sheet.getByRole("group", { name: "Ikon" }).querySelector('input[type="file"]')).toBeTruthy();
    expect(sheet.getByRole("group", { name: "Banner" }).querySelector('input[type="file"]')).toBeTruthy();
    fireEvent.change(sheet.getByLabelText("Nama tampil"), { target: { value: "MLBB" } });
    fireEvent.change(sheet.getByLabelText("Publisher"), { target: { value: "Moonton Games" } });
    fireEvent.change(sheet.getByLabelText(/Deskripsi singkat/), { target: { value: "Pilihan baru" } });
    fireEvent.change(sheet.getByLabelText(/Panduan cari ID/), { target: { value: "Salin ID di profil" } });
    fireEvent.change(sheet.getByLabelText(/Urutan populer/), { target: { value: "3" } });
    fireEvent.change(sheet.getByLabelText(/Markup khusus/), { target: { value: "8.25" } });
    expect(sheet.getByText("12/600 karakter")).toBeTruthy(); expect(sheet.getByText(/Rp\s?54\.200/)).toBeTruthy();
    await userEvent.click(sheet.getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(calls[0].body).toEqual({ slug: "mobile-legends", display_name: "MLBB", publisher: "Moonton Games", description: "Pilihan baru", id_guide: "Salin ID di profil", featured_rank: 3, markup_percent: 8.25 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("validates name, rank and percent without issuing a PATCH", async () => {
    setup(); await userEvent.click(await screen.findByRole("button", { name: "Edit Mobile Legends" }));
    const sheet = within(screen.getByRole("dialog")), save = sheet.getByRole("button", { name: "Simpan" });
    fireEvent.change(sheet.getByLabelText("Nama tampil"), { target: { value: " " } }); await userEvent.click(save); expect(sheet.getByRole("alert").textContent).toContain("Nama tampil wajib");
    fireEvent.change(sheet.getByLabelText("Nama tampil"), { target: { value: "ML" } }); fireEvent.change(sheet.getByLabelText(/Markup khusus/), { target: { value: "4.555" } }); await userEvent.click(save); expect(sheet.getByRole("alert").textContent).toContain("2 desimal");
    fireEvent.change(sheet.getByLabelText(/Markup khusus/), { target: { value: "5" } }); fireEvent.change(sheet.getByLabelText(/Urutan populer/), { target: { value: "100" } }); await userEvent.click(save); expect(sheet.getByRole("alert").textContent).toContain("1–99"); expect(calls).toHaveLength(0);
  });
  it("keeps failed saves in the sheet and confirms discarding dirty changes", async () => {
    failSave = true; setup(); await userEvent.click(await screen.findByRole("button", { name: "Edit Mobile Legends" }));
    fireEvent.change(screen.getByLabelText("Nama tampil"), { target: { value: "MLBB" } });
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Simpan" }));
    expect(await within(screen.getByRole("dialog")).findByText(/Game belum tersimpan/)).toBeTruthy();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Batal" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy(); await userEvent.click(screen.getByRole("button", { name: "Buang perubahan" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("uses useAdminDraft to guard navigation while pricing is dirty", async () => {
    setup("pricing", true); await screen.findByLabelText("Markup default %");
    fireEvent.change(screen.getByLabelText("Markup default %"), { target: { value: "8" } });
    await userEvent.click(screen.getByRole("tab", { name: "Game" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("Ada perubahan yang belum disimpan");
    await userEvent.click(screen.getByRole("button", { name: "Lanjut mengedit" })); expect(screen.getByLabelText("Markup default %")).toBeTruthy();
  });
});

describe("Variant controls, filters, and bulk operations", () => {
  it("shows effective markup/fixed/source and full automatic + eight category labels", async () => {
    setup("variants"); await screen.findByRole("region", { name: "Tabel varian game" });
    const table = desktop(), select = table.getByRole("combobox", { name: "Kategori sk:101" });
    expect(within(select).getAllByRole("option")).toHaveLength(9); expect(select.textContent).toContain("Otomatis (Top up)"); expect(select.textContent).toContain("Paket mingguan/bulanan");
    expect(table.getByText(/8 %/).textContent).toMatch(/\+Rp\s?500/); expect(table.getByText("Default")).toBeTruthy();
    expect(table.getByText("Supplier nonaktif")).toBeTruthy(); expect(table.queryByText("Perlu diperiksa")).toBeNull(); expect(table.queryByText(/✅/)).toBeNull();
    expect((table.getByRole("switch", { name: "Aktifkan sk:102" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("retains mobile category control and activation safety and PATCHes category", async () => {
    setup("variants"); const cards = within(await screen.findByLabelText("Kartu varian game"));
    expect((cards.getByRole("switch", { name: "Aktifkan sk:102" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(cards.getByLabelText("Kategori sk:101"), { target: { value: "promo" } });
    await waitFor(() => expect(calls[0]).toMatchObject({ method: "PATCH", body: { buyer_sku_code: "sk:101", display_group: "promo" } }));
  });
  it("saves percent/fixed markup through the popover and can reset it to inheritance", async () => {
    setup("variants"); await screen.findByRole("region", { name: "Tabel varian game" });
    await userEvent.click(desktop().getByRole("button", { name: "Atur markup sk:101" }));
    fireEvent.change(screen.getByLabelText("Markup khusus %"), { target: { value: "4.5" } }); fireEvent.change(screen.getByLabelText("Rp tetap"), { target: { value: "250" } });
    await userEvent.click(screen.getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(calls[0].body).toEqual({ buyer_sku_code: "sk:101", markup_percent: 4.5, markup_fixed: 250 }));
    await userEvent.click(desktop().getByRole("button", { name: "Atur markup sk:101" })); await userEvent.click(screen.getByRole("button", { name: "Reset ke default" }));
    await waitFor(() => expect(calls[1].body).toEqual({ buyer_sku_code: "sk:101", markup_percent: null, markup_fixed: null }));
  });
  it("rejects invalid percent/fixed values and preserves a failed popover draft", async () => {
    setup("variants"); await screen.findByRole("region", { name: "Tabel varian game" }); await userEvent.click(desktop().getByRole("button", { name: "Atur markup sk:101" }));
    fireEvent.change(screen.getByLabelText("Markup khusus %"), { target: { value: "101" } }); fireEvent.change(screen.getByLabelText("Rp tetap"), { target: { value: "1.5" } });
    await userEvent.click(screen.getByRole("button", { name: "Simpan" })); expect(screen.getAllByRole("alert").some(node => node.textContent?.includes("bilangan bulat"))).toBe(true); expect(calls).toHaveLength(0);
    failSave = true; fireEvent.change(screen.getByLabelText("Markup khusus %"), { target: { value: "5" } }); fireEvent.change(screen.getByLabelText("Rp tetap"), { target: { value: "250" } });
    await userEvent.click(screen.getByRole("button", { name: "Simpan" })); expect(await screen.findByText(/Markup belum tersimpan/)).toBeTruthy(); expect((screen.getByLabelText("Rp tetap") as HTMLInputElement).value).toBe("250");
  });
  it("bulk presets 3/5/8/10 ask confirmation then send one POST with selected SKUs", async () => {
    setup("variants"); await screen.findByRole("region", { name: "Tabel varian game" });
    await userEvent.click(desktop().getByRole("checkbox", { name: "Pilih sk:101" }));
    for (const preset of [3, 5, 8, 10]) expect(screen.getByRole("button", { name: `${preset}%` })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "8%" })); await userEvent.click(screen.getByRole("button", { name: "Terapkan ke 1 varian" }));
    expect(calls).toHaveLength(0); expect(screen.getByRole("alertdialog").textContent).toContain("8%");
    await userEvent.click(screen.getByRole("button", { name: "Terapkan markup" }));
    await waitFor(() => expect(calls).toEqual([{ url: "/api/admin/games/products/bulk-markup", method: "POST", body: { skus: ["sk:101"], markup_percent: 8 } }]));
  });
  it("supports all-visible scope, decimal markup and optional fixed reset", async () => {
    setup("variants"); await screen.findByRole("region", { name: "Tabel varian game" });
    await userEvent.click(screen.getByRole("button", { name: "Set semua tampil" })); fireEvent.change(screen.getByLabelText("Markup persen bulk"), { target: { value: "4.55" } });
    await userEvent.click(screen.getByText("reset Rp ke 0")); await userEvent.click(screen.getByRole("button", { name: "Terapkan ke 2 varian" })); await userEvent.click(screen.getByRole("button", { name: "Terapkan markup" }));
    await waitFor(() => expect(calls[0].body).toEqual({ skus: ["sk:101", "sk:102"], markup_percent: 4.55, markup_fixed: 0 }));
  });
  it("submits percent-only bulk for nonzero fixed markup without sending markup_fixed", async () => {
    setup("variants"); await screen.findByRole("region", { name: "Tabel varian game" });
    await userEvent.click(desktop().getByRole("checkbox", { name: "Pilih sk:102" })); await userEvent.click(screen.getByRole("button", { name: "Terapkan ke 1 varian" })); await userEvent.click(screen.getByRole("button", { name: "Terapkan markup" }));
    await waitFor(() => expect(calls).toEqual([{ url: "/api/admin/games/products/bulk-markup", method: "POST", body: { skus: ["sk:102"], markup_percent: 3 } }]));
    expect(calls[0].body).not.toHaveProperty("markup_fixed");
    await waitFor(() => expect(desktop().getByRole("checkbox", { name: "Pilih sk:102" }).getAttribute("data-state")).toBe("unchecked"));
  });
  it("sets a category for multiple selected rows with one POST, not per-row PATCHes", async () => {
    setup("variants"); await screen.findByRole("region", { name: "Tabel varian game" });
    await userEvent.click(screen.getByText(/Pilih tampil/)); fireEvent.change(screen.getByLabelText("Kategori pilihan"), { target: { value: "pack" } });
    await userEvent.click(screen.getByRole("button", { name: "Set kategori (2)" })); await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Set kategori" }));
    await waitFor(() => expect(calls).toEqual([{ url: "/api/admin/games/products/bulk-markup", method: "POST", body: { skus: ["sk:101", "sk:102"], display_group: "pack" } }]));
    expect(await screen.findByText("2 varian diperbarui")).toBeTruthy();
  });
  it("cancels bulk confirmation and keeps selection after failed bulk", async () => {
    setup("variants"); await screen.findByRole("region", { name: "Tabel varian game" }); await userEvent.click(desktop().getByRole("checkbox", { name: "Pilih sk:101" }));
    await userEvent.click(screen.getByRole("button", { name: "Terapkan ke 1 varian" })); await userEvent.click(screen.getByRole("button", { name: "Batal" })); expect(calls).toHaveLength(0);
    failSave = true; await userEvent.click(screen.getByRole("button", { name: "Terapkan ke 1 varian" })); await userEvent.click(screen.getByRole("button", { name: "Terapkan markup" }));
    await screen.findByText("Koneksi supplier belum tersedia."); expect(desktop().getByRole("checkbox", { name: "Pilih sk:101" }).getAttribute("data-state")).toBe("checked");
  });
  it("keeps sellable sort/filter, game/status/search, pagination, reset and empty state", async () => {
    data.total = 51; setup("variants"); await screen.findByRole("region", { name: "Tabel varian game" });
    fireEvent.change(screen.getByLabelText("Filter bisa dijual"), { target: { value: "1" } }); fireEvent.change(screen.getByLabelText("Status jual"), { target: { value: "1" } }); fireEvent.change(screen.getByLabelText("Game"), { target: { value: "Mobile Legends" } });
    fireEvent.change(screen.getByLabelText("Cari kode atau nama varian"), { target: { value: "86" } });
    await waitFor(() => expect((fetch as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).includes("q=86") && String(url).includes("sellable=1") && String(url).includes("sort=sellable") && String(url).includes("enabled=1"))).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "Berikutnya" })); await waitFor(() => expect((fetch as ReturnType<typeof vi.fn>).mock.lastCall?.[0]).toContain("offset=50"));
    data.items = []; data.total = 0; await userEvent.click(screen.getByRole("button", { name: "Hapus filter" })); expect(await screen.findByText(/Belum ada varian yang cocok/)).toBeTruthy();
  });
});

describe("Global pricing", () => {
  it("previews all sample prices and requires confirmation/count before PUT and toast", async () => {
    setup("pricing"); const preview = within(await screen.findByRole("table", { name: "Pratinjau harga" }));
    for (const price of [/Rp\s?1\.600/, /Rp\s?52\.500/, /Rp\s?337\.200/]) expect(preview.getByText(price)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Simpan & hitung ulang" })); expect(calls).toHaveLength(0); expect(screen.getByRole("alertdialog").textContent).toContain("3 varian akan dihitung ulang");
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Simpan & hitung ulang" }));
    await waitFor(() => expect(calls[0]).toEqual({ url: "/api/admin/games/pricing", method: "PUT", body: { markup_percent: 5, rounding: 100 } })); expect(await screen.findByText("3 harga diperbarui")).toBeTruthy();
    const { toast } = await import("sonner"); expect(toast.success).toHaveBeenCalledWith("3 harga diperbarui");
  });
  it("validates percent, supports all rounding values, and preserves settings after failed save", async () => {
    setup("pricing"); await screen.findByLabelText("Markup default %");
    fireEvent.change(screen.getByLabelText("Markup default %"), { target: { value: "-1" } }); await userEvent.click(screen.getByRole("button", { name: "Simpan & hitung ulang" }));
    expect(screen.getAllByRole("alert").some(node => node.textContent?.includes("2 desimal"))).toBe(true); expect(calls).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Markup default %"), { target: { value: "8.25" } }); const rounding = screen.getByLabelText("Pembulatan harga"); expect(within(rounding).getAllByRole("option")).toHaveLength(4);
    fireEvent.change(rounding, { target: { value: "500" } }); failSave = true; await userEvent.click(screen.getByRole("button", { name: "Simpan & hitung ulang" })); await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Simpan & hitung ulang" }));
    expect(await screen.findByText("Harga belum tersimpan. Coba lagi.")).toBeTruthy(); expect((screen.getByLabelText("Markup default %") as HTMLInputElement).value).toBe("8.25"); expect(calls[0].body).toEqual({ markup_percent: 8.25, rounding: 500 });
  });
});
