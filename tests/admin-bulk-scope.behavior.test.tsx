// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
//
// Harga grosir di editor produk admin (keputusan owner 2026-11-08):
// hanya untuk produk MANUAL. Editor tidak pernah tampil untuk produk supplier
// WR/Sekalipay-SK, dan payload simpan hanya membawa `bulk_pricing` bila admin
// benar-benar mengubahnya. Sebelum ini BulkTierEditor hanya terpasang di
// VariantEditor yang tidak dipakai halaman mana pun, sehingga owner tidak bisa
// mengatur grosir sama sekali.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./setup/admin-render";
import AdminPage from "@/app/(shop)/admin/page";
import { ToastProvider } from "@/components/ui/Toast";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/admin"); });

const variants = [
  { id: 11, sku: "BULK-1", label: "Paket 1", price: 100000, stock: -1, min_qty: 1, is_active: 1, sort_order: 0 },
  { id: 12, sku: "BULK-2", label: "Paket 2", price: 50000, stock: -1, min_qty: 1, is_active: 1, sort_order: 1 },
];

type PutCapture = { url: string; body: { variants?: Record<string, unknown>[] } };

function setup(options: { supplier?: "Manual" | "WR" | "SK" | "AIVault"; wrManaged?: boolean; aivault_family?: string } = {}) {
  const product = {
    id: "7", name: "Fixture Grosir", slug: "fixture-grosir", description: "",
    price: 100000, categorySlug: "ai-chatbot", image: "", images: [],
    soldCount: 0, stock: -1, isActive: true, variantCount: 2,
    supplier: options.supplier ?? "Manual",
  };
  const puts: PutCapture[] = [];
  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/auth/me") return json({ authed: true, email: "fixture@example.test" });
    if (url === "/api/products") return json({ products: [product] });
    if (url.startsWith("/api/categories")) return json({ categories: [] });
    if (url === "/api/admin/overview") return json({});
    if (url === "/api/products/7" && init?.method === undefined) return json({ product: { variants, wrManaged: Boolean(options.wrManaged), aivault_family: options.aivault_family } });
    if (url === "/api/products/7" && init?.method === "PUT") {
      puts.push({ url, body: JSON.parse(String(init.body)) });
      return json({ ok: true });
    }
    return json({});
  }));
  render(<ToastProvider><AdminPage /></ToastProvider>);
  return { puts };
}

async function openEditor() {
  await act(async () => {});
  fireEvent.click(screen.getAllByRole("button").find((n) => /^(box)?Produk$/.test(n.textContent?.trim() ?? ""))!);
  await act(async () => {});
  await waitFor(() => expect(screen.getAllByRole("button").some((n) => (n.textContent ?? "").includes("Edit Produk & Varian"))).toBe(true));
  fireEvent.click(screen.getAllByRole("button").find((n) => (n.textContent ?? "").includes("Edit Produk & Varian"))!);
  await act(async () => {});
  await waitFor(() => expect(document.getElementById("product-editor-title")?.textContent).toMatch(/Edit Produk/));
  // Panel tab lain `hidden` (tidak ada di accessibility tree) — buka tab Varian
  // seperti admin sungguhan sebelum mengakses kontrol harga grosir.
  await userEvent.click(screen.getByRole("tab", { name: /^Varian/ }));
  await act(async () => {});
}

const save = async () => { await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Simpan Produk/ })); }); };

describe("editor harga grosir di modal produk", () => {
  it("AIVault single-variant mode also shows only the markup note", async () => {
    const { puts } = setup({ aivault_family: "gemini" });
    await openEditor();
    await userEvent.click(screen.getByRole("switch", { name: "Variasi Produk" }));
    expect(screen.getAllByText("Harga grosir AIVault otomatis mengikuti markup — atur di menu AIVault → Markup.").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Atur harga grosir/ })).toBeNull();
    await save();
    await waitFor(() => expect(puts.length).toBe(1));
    for (const variant of puts[0].body.variants!) expect(variant).not.toHaveProperty("bulk_pricing");
  });
  it.each(["Manual", "AIVault"] as const)("AIVault family (%s): note replaces fixed-price editor and payload omits bulk", async (supplier) => {
    const { puts } = setup({ supplier, aivault_family: "gemini" });
    await openEditor();
    expect(screen.getAllByText("Harga grosir AIVault otomatis mengikuti markup — atur di menu AIVault → Markup.").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Atur harga grosir/ })).toBeNull();
    await save();
    await waitFor(() => expect(puts.length).toBe(1));
    for (const variant of puts[0].body.variants!) expect(variant).not.toHaveProperty("bulk_pricing");
  });
  it("produk manual: editor harga grosir tampil", async () => {
    setup({ supplier: "Manual" });
    await openEditor();
    expect(screen.queryByText("Harga grosir hanya untuk produk manual.")).toBeNull();
    expect(screen.getAllByText("Harga grosir").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Atur harga grosir/ }).length).toBeGreaterThan(0);
  });

  it("produk WR: editor disembunyikan, hanya catatan manual", async () => {
    setup({ supplier: "WR", wrManaged: true });
    await openEditor();
    expect(screen.queryByText("Harga grosir")).toBeNull();
    expect(screen.queryByRole("button", { name: /Atur harga grosir/ })).toBeNull();
    expect(screen.getAllByText("Harga grosir hanya untuk produk manual.").length).toBeGreaterThan(0);
  });

  it("produk SK: editor disembunyikan, hanya catatan manual", async () => {
    setup({ supplier: "SK" });
    await openEditor();
    expect(screen.queryByText("Harga grosir")).toBeNull();
    expect(screen.queryByRole("button", { name: /Atur harga grosir/ })).toBeNull();
    expect(screen.getAllByText("Harga grosir hanya untuk produk manual.").length).toBeGreaterThan(0);
  });

  it("payload menyertakan bulk_pricing hanya untuk varian yang disentuh", async () => {
    const { puts } = setup({ supplier: "Manual" });
    await openEditor();
    // Buka disclosure varian pertama lalu aktifkan grosir (membuat 1 baris).
    fireEvent.click(screen.getAllByRole("button", { name: /Atur harga grosir/ })[0]);
    const toggles = screen.getAllByLabelText("Harga grosir") as HTMLInputElement[];
    fireEvent.click(toggles[0]);
    fireEvent.change(screen.getAllByLabelText(/^Min\. jumlah/)[0], { target: { value: "10" } });
    fireEvent.change(screen.getAllByLabelText(/^Harga \/ pcs/)[0], { target: { value: "90000" } });
    await save();
    await waitFor(() => expect(puts.length).toBe(1));
    const sent = puts[0].body.variants!;
    expect(sent[0].bulk_pricing).toEqual({ enabled: true, tiers: [{ min_qty: 10, unit_price: 90000 }] });
    expect("bulk_pricing" in sent[1]).toBe(false);
    expect(puts[0].body).not.toHaveProperty("bulk");
  });

  it("bulk_pricing tidak dikirim bila admin tidak menyentuhnya", async () => {
    const { puts } = setup({ supplier: "Manual" });
    await openEditor();
    await save();
    await waitFor(() => expect(puts.length).toBe(1));
    for (const variant of puts[0].body.variants!) expect("bulk_pricing" in variant).toBe(false);
  });

  it("isian grosir tidak valid memblokir simpan dan fokus ke field pertama", async () => {
    const { puts } = setup({ supplier: "Manual" });
    await openEditor();
    fireEvent.click(screen.getAllByRole("button", { name: /Atur harga grosir/ })[0]);
    fireEvent.click((screen.getAllByLabelText("Harga grosir") as HTMLInputElement[])[0]);
    await save();
    await waitFor(() => expect(screen.getAllByText(/Perbaiki \d+ isian harga grosir sebelum menyimpan\./).length).toBeGreaterThan(0));
    expect(puts.length).toBe(0);
    // Modal pindah ke tab Varian dan fokus ke field pertama yang salah.
    await waitFor(() => expect(document.activeElement?.id).toMatch(/-bt\d+-(qty|price)$/));
  });
});
