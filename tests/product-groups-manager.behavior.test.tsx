// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "./setup/admin-render";
import { ProductGroupsManager } from "@/components/admin/ProductGroupsManager";
import { AdminPortalContext } from "@/components/admin/ui/portal";
import { ToastProvider } from "@/components/ui/Toast";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const endpoint = "/api/admin/product-groups";
const products = [
  { id: 1, name: "Netflix WR", slug: "netflix-wr", supplier: "WR", stock: -1, isActive: true },
  { id: 2, name: "Netflix SK", slug: "netflix-sk", supplier: "SK", stock: 0, isActive: false },
  { id: 3, name: "Netflix TUNVN", slug: "netflix-tunvn", supplier: "TUNVN", stock: 4, isActive: true },
  { id: 4, name: "Netflix Manual", slug: "netflix-own", supplier: "Manual", stock: 2, isActive: true },
  { id: 5, name: "Netflix AIVault", slug: "netflix-ai", supplier: "AIVault", stock: 8, isActive: true },
  { id: 6, name: "Netflix Arsip", slug: "arsip", supplier: "Manual", stock: 1, isActive: false, archivedAt: "2026-11-15" },
].map(product => ({ ...product, image: "" }));
const member = (id: number) => {
  const product = products.find(item => item.id === id)!;
  return { product_id: id, name: product.name, slug: product.slug, image: "", supplier: product.supplier, is_active: product.isActive, archived: !!product.archivedAt, live: id === 1, stock: product.stock, modal_per_30d: id === 2 ? null : 12000, position: id };
};
const initialGroup = { id: 7, name: "Netflix", prefer_product_id: null as number | null, prefer_margin: 0, winner_product_id: 1, reason: "Produk dengan stok tersedia", decided_at: "2026-11-16T07:00:00Z", members: [member(1), member(2)], slots: [] as { id: number; name: string; winner_variant_id: number | null; reason: string | null; decided_at: string | null; sort_order: number; variant_ids: number[] }[] };

function setup({ empty = false, writeError = "", status = 409, catalog = products } = {}) {
  let groups = empty ? [] : [structuredClone(initialGroup)];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = JSON.parse(String(init?.body ?? "{}"));
    const result = (data: unknown, code = 200) => ({ ok: code < 400, status: code, json: async () => data });
    if (method === "GET") return result(url === "/api/products" ? { products: catalog } : { groups });
    if (writeError) return result({ error: writeError, group_id: 9 }, status);
    if (url === `${endpoint}/decide`) return result({ decided: groups.length, changed: 1 });
    if (url === endpoint && method === "POST") {
      const group = { ...initialGroup, id: 8, name: body.name, mode: body.mode ?? "winner", members: body.product_ids.map(member) };
      groups = [...groups, group];
      return result({ group });
    }
    const group = groups.find(item => item.id === 7)!;
    if (url.endsWith("/slots") && method === "PUT") {
      group.slots = body.slots.map((s: { name: string; variant_ids: number[] }, idx: number) => ({
        id: idx + 1,
        name: s.name,
        winner_variant_id: s.variant_ids[0] ?? null,
        reason: "modal/30 hari StoreBat Rp69.300 < AIVault Rp72.600",
        decided_at: "2026-11-24T09:00:00Z",
        sort_order: idx,
        variant_ids: s.variant_ids,
      }));
      return result({ group: structuredClone(group) });
    }
    if (method === "PATCH") {
      Object.assign(group, body);
      return result({ group: structuredClone(group) });
    }
    if (url.includes("/members") && method === "POST") {
      group.members.push(member(body.product_id));
      return result({ group: structuredClone(group) });
    }
    if (url.includes("/members") && method === "DELETE") {
      group.members = group.members.filter(item => item.product_id !== Number(new URL(url, "http://fixture").searchParams.get("product_id")));
      if (group.members.length >= 2) return result({ group: structuredClone(group) });
      groups = [];
      return result({ ok: true, deleted: true });
    }
    if (method === "DELETE") { groups = []; return result({ ok: true }); }
    throw new Error(`Unhandled ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<AdminPortalContext.Provider value={document.body}><ToastProvider><ProductGroupsManager /></ToastProvider></AdminPortalContext.Provider>);
  return fetchMock;
}
async function manage() {
  await userEvent.click(await screen.findByRole("button", { name: "Kelola grup Netflix" }));
  return screen.getByRole("dialog", { name: "Kelola grup produk" });
}

describe("ProductGroupsManager", () => {
  it("shows loading/error with retry instead of treating an unreadable group list as empty", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Jaringan terputus")).mockResolvedValue({ ok: true, json: async () => ({ groups: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminPortalContext.Provider value={document.body}><ToastProvider><ProductGroupsManager /></ToastProvider></AdminPortalContext.Provider>);
    expect(screen.getByRole("button", { name: "Grup baru" })).toHaveProperty("disabled", true);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Jaringan terputus"));
    expect(screen.queryByText("Belum ada grup")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    await screen.findByText("Belum ada grup");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("caps selection at ten and allows deselecting to choose a replacement", async () => {
    const catalog = Array.from({ length: 11 }, (_, index) => ({ ...products[0], id: index + 20, name: `Produk ${index + 20}`, slug: `p-${index + 20}` }));
    setup({ empty: true, catalog });
    await screen.findByText("Belum ada grup");
    await userEvent.click(screen.getByRole("button", { name: "Grup baru" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("checkbox", { name: "Pilih Produk 20" });
    for (let id = 20; id < 30; id++) await userEvent.click(within(dialog).getByRole("checkbox", { name: `Pilih Produk ${id}` }));
    expect(within(dialog).getByRole("checkbox", { name: "Pilih Produk 30" })).toHaveProperty("disabled", true);
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Pilih Produk 20" }));
    expect(within(dialog).getByRole("checkbox", { name: "Pilih Produk 30" })).toHaveProperty("disabled", false);
  });

  it("renders supplier members, winner, stock, modal, statuses, decision and group search", async () => {
    setup();
    const group = await screen.findByLabelText("Grup Netflix");
    const winner = within(group).getByText("Netflix WR").closest("li")!;
    expect(within(winner).getByText("Tampil di toko")).toBeTruthy();
    expect(within(winner).getByText("Stok ∞")).toBeTruthy();
    expect(within(winner).getByText(/Modal\/30 hari Rp/)).toBeTruthy();
    const hidden = within(group).getByText("Netflix SK").closest("li")!;
    expect(within(hidden).getByText("Disembunyikan")).toBeTruthy();
    expect(within(hidden).getByText("Nonaktif")).toBeTruthy();
    expect(within(hidden).getByText("Modal/30 hari —")).toBeTruthy();
    expect(within(group).getByText("Produk dengan stok tersedia")).toBeTruthy();
    expect(within(group).getByText(/WIB$/)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Cari grup produk" }), { target: { value: "missing" } });
    expect(screen.getByText("Tidak ada grup yang cocok.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Cari grup produk" }), { target: { value: "netflix-sk" } });
    expect(screen.getByLabelText("Grup Netflix")).toBeTruthy();
  });

  it("creates a cross-supplier group, excludes archive and blocks already grouped candidates", async () => {
    const fetchMock = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Grup baru" }));
    const dialog = screen.getByRole("dialog", { name: "Grup produk baru" });
    await within(dialog).findByRole("checkbox", { name: "Pilih Netflix Manual" });
    expect(within(dialog).queryByText("Netflix Arsip")).toBeNull();
    expect(within(dialog).getByRole("checkbox", { name: "Pilih Netflix WR" })).toHaveProperty("disabled", true);
    expect(within(dialog).getAllByText("Sudah di grup Netflix")).toHaveLength(2);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Nama grup" }), { target: { value: "  Netflix lokal  " } });
    expect(within(dialog).getByRole("button", { name: "Buat grup" })).toHaveProperty("disabled", true);
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Pilih Netflix TUNVN" }));
    expect(within(dialog).getByRole("button", { name: "Buat grup" })).toHaveProperty("disabled", true);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Cari produk anggota" }), { target: { value: "netflix-own" } });
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Pilih Netflix Manual" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Buat grup" }));
    await screen.findByLabelText("Grup Netflix lokal");
    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Netflix lokal", product_ids: [3, 4] }) }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([[409, "already_grouped", /Produk sudah di grup lain \(#9\)/], [400, "Minimal 2 produk diperlukan", /Minimal 2 produk diperlukan/]] as const)("shows %s errors without losing the group draft", async (status, writeError, message) => {
    setup({ empty: true, writeError, status });
    await screen.findByText("Belum ada grup");
    await userEvent.click(screen.getByRole("button", { name: "Grup baru" }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("checkbox", { name: "Pilih Netflix WR" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Nama grup" }), { target: { value: "Draft" } });
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Pilih Netflix WR" }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Pilih Netflix SK" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Buat grup" }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(within(dialog).getByRole("textbox", { name: "Nama grup" })).toHaveProperty("value", "Draft");
    expect(within(dialog).getByRole("checkbox", { name: "Pilih Netflix WR" }).getAttribute("data-state")).toBe("checked");
  });

  it("adds and removes members, including automatic group deletion below two", async () => {
    const fetchMock = setup();
    let dialog = await manage();
    await userEvent.click(await within(dialog).findByRole("button", { name: "Tambahkan Netflix TUNVN" }));
    await within(dialog).findByRole("button", { name: "Keluarkan Netflix TUNVN" });
    expect(fetchMock).toHaveBeenCalledWith(`${endpoint}/7/members`, expect.objectContaining({ method: "POST", body: JSON.stringify({ product_id: 3 }) }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Keluarkan Netflix TUNVN" }));
    let confirm = screen.getByRole("alertdialog", { name: "Keluarkan anggota?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Keluarkan anggota" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(`${endpoint}/7/members?product_id=3`, expect.objectContaining({ method: "DELETE" }));
    dialog = screen.getByRole("dialog", { name: "Kelola grup produk" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Keluarkan Netflix SK" }));
    confirm = screen.getByRole("alertdialog", { name: "Keluarkan anggota?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Keluarkan anggota" }));
    await screen.findByText("Belum ada grup");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText(/Grup dihapus karena tersisa kurang dari 2 anggota/)).toBeTruthy();
  });

  it("renames and sets/clears preference with a Rupiah margin via PATCH", async () => {
    const fetchMock = setup();
    const dialog = await manage();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Nama grup" }), { target: { value: "Netflix baru" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Preferensi anggota" }), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Margin preferensi (Rupiah)" }), { target: { value: "1000001" } });
    expect(within(dialog).getByRole("alert").textContent).toContain("Rp0–1.000.000");
    expect(within(dialog).getByRole("button", { name: "Simpan pengaturan" })).toHaveProperty("disabled", true);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Margin preferensi (Rupiah)" }), { target: { value: "2500" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Simpan pengaturan" }));
    await screen.findByLabelText("Grup Netflix baru");
    expect(fetchMock).toHaveBeenCalledWith(`${endpoint}/7`, expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Netflix baru", prefer_product_id: 2, prefer_margin: 2500 }) }));
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Preferensi anggota" }), { target: { value: "" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Simpan pengaturan" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${endpoint}/7`, expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Netflix baru", prefer_product_id: null, prefer_margin: 2500 }) })));
  });

  it("confirms group deletion and recalculates all groups", async () => {
    const fetchMock = setup();
    await screen.findByLabelText("Grup Netflix");
    await userEvent.click(screen.getByRole("button", { name: "Hitung ulang" }));
    expect(await screen.findByText("Pemenang dihitung: 1 grup, 1 berubah.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`${endpoint}/decide`, expect.objectContaining({ method: "POST" }));
    const dialog = await manage();
    await userEvent.click(within(dialog).getByRole("button", { name: "Hapus grup" }));
    const confirm = screen.getByRole("alertdialog", { name: "Hapus grup?" });
    expect(within(confirm).getByText(/anggota akan tampil sendiri-sendiri lagi/)).toBeTruthy();
    await userEvent.click(within(confirm).getByRole("button", { name: "Batal" }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Hapus grup" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Hapus grup" }));
    await screen.findByText("Belum ada grup");
    expect(fetchMock).toHaveBeenCalledWith(`${endpoint}/7`, expect.objectContaining({ method: "DELETE" }));
  });

  it("supports creating and toggling merge_variants mode with merged member badges", async () => {
    const fetchMock = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Grup baru" }));
    let dialog = screen.getByRole("dialog", { name: "Grup produk baru" });
    await within(dialog).findByRole("checkbox", { name: "Pilih Netflix TUNVN" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Nama grup" }), { target: { value: "Netflix Gabung" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Mode tampilan" }), { target: { value: "merge_variants" } });
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Pilih Netflix TUNVN" }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Pilih Netflix Manual" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Buat grup" }));
    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "Netflix Gabung", product_ids: [3, 4], mode: "merge_variants" }),
    }));
    await screen.findByLabelText("Grup Netflix Gabung");

    // Toggle existing group #7 from winner -> merge_variants via PATCH
    dialog = await manage();
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Mode tampilan" }), { target: { value: "merge_variants" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Simpan pengaturan" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${endpoint}/7`, expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ name: "Netflix", prefer_product_id: null, prefer_margin: 0, mode: "merge_variants" }),
    })));
    const groupCard = await screen.findByLabelText("Grup Netflix");
    expect(within(groupCard).getByText("Gabung varian")).toBeTruthy();
    const winnerRow = within(groupCard).getByText("Netflix WR").closest("li")!;
    expect(within(winnerRow).getByText("Kartu utama")).toBeTruthy();
    // Member #2 is inactive -> still Disembunyikan, NOT Varian digabung
    const inactiveRow = within(groupCard).getByText("Netflix SK").closest("li")!;
    expect(within(inactiveRow).getByText("Disembunyikan")).toBeTruthy();
    // Adding active member #5 shows Varian digabung
    await userEvent.click(within(dialog).getByRole("button", { name: "Tambahkan Netflix AIVault" }));
    const mergedRow = (await within(groupCard).findByText("Netflix AIVault")).closest("li")!;
    expect(within(mergedRow).getByText("Varian digabung")).toBeTruthy();
  });

  it("auto-suggests and saves variant slots in merge_variants mode and validates underfilled slots", async () => {
    const groupWithVariants = {
      ...initialGroup,
      mode: "merge_variants" as const,
      members: [member(1), member(5)],
      slots: [] as { id: number; name: string; winner_variant_id: number | null; reason: string | null; decided_at: string | null; sort_order: number; variant_ids: number[] }[],
      variants: [
        { variant_id: 101, product_id: 1, supplier: "WR" as const, label: "Plus 1 Bulan (Standar)", price: 103400, stock: 32, min_qty: 1, modal_per_30d: 69300, is_active: true, parent_active: true, parent_archived: false, duration_value: 1, duration_unit: "month", duration_label: null, warranty_type: "none", warranty_value: null, warranty_unit: null, slot_id: null },
        { variant_id: 501, product_id: 5, supplier: "AIVault" as const, label: "Plus 1 Bulan", price: 108000, stock: 10, min_qty: 1, modal_per_30d: 72600, is_active: true, parent_active: true, parent_archived: false, duration_value: 1, duration_unit: "month", duration_label: null, warranty_type: "none", warranty_value: null, warranty_unit: null, slot_id: null },
        { variant_id: 502, product_id: 5, supplier: "AIVault" as const, label: "Plus 1 Bulan (Full Garansi)", price: 128000, stock: 15, min_qty: 1, modal_per_30d: 85800, is_active: true, parent_active: true, parent_archived: false, duration_value: 1, duration_unit: "month", duration_label: null, warranty_type: "full", warranty_value: 30, warranty_unit: "day", slot_id: null },
      ],
    };
    let groups = [structuredClone(groupWithVariants)];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = JSON.parse(String(init?.body ?? "{}"));
      const result = (data: unknown, code = 200) => ({ ok: code < 400, status: code, json: async () => data });
      if (method === "GET") return result(url === "/api/products" ? { products } : { groups });
      if (url === `${endpoint}/7/slots` && method === "PUT") {
        groups[0].slots = body.slots.map((s: { name: string; variant_ids: number[] }, idx: number) => ({
          id: idx + 1,
          name: s.name,
          winner_variant_id: s.variant_ids[0] ?? null,
          reason: "modal/30 hari WR Rp69.300 < AIVault Rp72.600",
          decided_at: "2026-11-24T09:00:00Z",
          sort_order: idx,
          variant_ids: s.variant_ids,
        }));
        return result({ group: structuredClone(groups[0]) });
      }
      throw new Error(`Unhandled ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminPortalContext.Provider value={document.body}><ToastProvider><ProductGroupsManager /></ToastProvider></AdminPortalContext.Provider>);

    const dialog = await manage();
    // Creating a single-variant slot manually triggers inline validation and disables Simpan
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Slot untuk Plus 1 Bulan (Full Garansi) (AIVault)" }), { target: { value: "__new__" } });
    expect(within(dialog).getByRole("alert").textContent).toContain("butuh minimal 2 varian");
    expect(within(dialog).getByRole("button", { name: "Simpan pengaturan" })).toHaveProperty("disabled", true);

    // Clicking "Samakan otomatis" cleanly pairs 101 + 501 while leaving Full Garansi (502) separate
    await userEvent.click(within(dialog).getByRole("button", { name: "Samakan otomatis" }));
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(within(dialog).getByRole("combobox", { name: "Slot untuk Plus 1 Bulan (Full Garansi) (AIVault)" })).toHaveProperty("value", "");
    await userEvent.click(within(dialog).getByRole("button", { name: "Simpan pengaturan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`${endpoint}/7/slots`, expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ slots: [{ name: "Plus 1 Bulan", variant_ids: [101, 501] }] }),
    })));
    const groupCard = await screen.findByLabelText("Grup Netflix");
    expect(within(groupCard).getByText(/1 slot/)).toBeTruthy();
    expect(within(groupCard).getByText(/modal\/30 hari WR Rp69\.300/)).toBeTruthy();
  });
});
