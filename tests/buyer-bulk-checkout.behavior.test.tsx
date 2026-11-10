// @vitest-environment jsdom
// Checkout: ringkasan dari quote SERVER (bukan cache keranjang), expected_price
// = harga DASAR, melewati ambang tier tidak memicu dialog harga palsu, dan
// perubahan harga dasar/tier sungguhan tetap tampil di dialog yang sudah ada.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CheckoutPage from "@/app/(shop)/checkout/page";
import { useCart, type CartItem } from "@/stores/cart";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/payment-maintenance", () => ({ isPaymentMaintenanceEnabled: () => false }));

const tiers = [{ min_qty: 10, unit_price: 9000 }, { min_qty: 50, unit_price: 8000 }];
const norm = (text: string | null | undefined) => String(text ?? "").replace(/\s/g, " ");
const qris = { id: "qris", label: "QRIS", account_number: "", account_name: "", qris_url: null };

function line(extra: Record<string, unknown> = {}) {
  return {
    id: "1", slug: "gpt-plus", name: "GPT Plus 1 Bulan", description: "", categorySlug: "ai", image: "/x.png",
    price: 10_000, qty: 9, variantId: 11, variantLabel: "1 Bulan", minQty: 1, bulkTiers: tiers, ...extra,
  } as unknown as CartItem;
}
type Quoted = Record<string, unknown>;
function quoted(qty: number, price: number, extra: Quoted = {}): Quoted {
  return { product_id: 1, variant_id: 11, name: "GPT Plus 1 Bulan", price, qty, stock: -1, image: "/x.png", queued_delivery: false, ...extra };
}
function tierLine(qty: number, price: number, tier: number) {
  return quoted(qty, price, { base_price: 10_000, applied_tier_min_qty: tier });
}

type Handler = (body: { items: Array<{ qty: number; expected_price: number; variant_id?: number }> }) => { status?: number; body: unknown };
function stubQuote(handler: Handler) {
  const bodies: Array<{ items: Array<{ qty: number; expected_price: number; variant_id?: number }> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe("/api/checkout/quote");
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const out = handler(body);
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { "Content-Type": "application/json" } });
  }));
  return bodies;
}
function ok(items: Quoted[], extra: Record<string, unknown> = {}) {
  const subtotal = items.reduce((sum, item) => sum + Number(item.price) * Number(item.qty), 0);
  return { ok: true, items, subtotal, quoteToken: "fixture", paymentMethods: [qris], ...extra };
}
const rail = () => document.querySelector("aside") as HTMLElement;
const dialogTitle = () => screen.queryByText("Perubahan Harga / Stok");

beforeEach(() => { localStorage.clear(); useCart.setState({ items: [] }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("checkout + grosir", () => {
  it("Muse invite input fetches only valid trimmed codes and always requotes changes", async () => {
    const bodies = stubQuote(() => ({ body: ok([quoted(2,1500)]) }));
    useCart.setState({ items:[line({ qty:2,price:1500,buyerFieldKey:"muse_invite_code",maxQty:30,bulkTiers:[] })] });
    render(<CheckoutPage />);
    const input = screen.getByLabelText(/Kode Invite Muse/) as HTMLInputElement;
    expect(bodies).toHaveLength(0);
    fireEvent.change(input,{ target:{ value:"bad" } });
    expect(bodies).toHaveLength(0);
    fireEvent.change(input,{ target:{ value:" Ab12cD " } });
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].items[0]).toMatchObject({ buyer_fields:{ muse_invite_code:"Ab12cD" },qty:2 });
    fireEvent.change(input,{ target:{ value:"XY1234" } });
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].items[0]).toMatchObject({ buyer_fields:{ muse_invite_code:"XY1234" } });
    fireEvent.change(input,{ target:{ value:"" } });
    expect(bodies).toHaveLength(2);
    expect(localStorage.getItem("axvara-cart") ?? "").not.toContain("Ab12cD");
  });
  it("melewati ambang tier: expected_price tetap harga DASAR, tanpa dialog harga; ringkasan memakai satuan/hemat server", async () => {
    const bodies = stubQuote((body) => {
      const qty = body.items[0].qty;
      return { body: ok([qty >= 10 ? tierLine(qty, 9000, 10) : quoted(qty, 10_000)]) };
    });
    useCart.setState({ items: [line()] });
    render(<CheckoutPage />);
    await waitFor(() => expect(norm(rail().textContent)).toContain("Qty 9 × Rp 10.000"));
    expect(bodies[0].items[0]).toMatchObject({ qty: 9, expected_price: 10_000, variant_id: 11 });
    expect(norm(rail().textContent)).not.toMatch(/grosir/i);

    await act(async () => { useCart.getState().setQty("1", 12, 11); });
    await waitFor(() => expect(norm(rail().textContent)).toContain("Qty 12 × Rp 9.000"));
    expect(bodies.at(-1)!.items[0]).toMatchObject({ qty: 12, expected_price: 10_000 }); // tidak pernah 9000
    expect(dialogTitle()).toBeNull();
    const text = norm(rail().textContent);
    expect(text).toContain("Harga grosir 10+"); // baris item hanya info tier, tanpa nominal hemat
    expect(text).not.toContain("Harga grosir 10+ · hemat");
    expect(text).toContain("Rp 108.000");
    expect(text).toContain("Hemat grosir Rp 12.000"); // SATU baris agregat di area total
    expect(text.match(/Rp 12\.000/g)).toHaveLength(1); // nominal hemat tidak diulang
    expect(text).not.toMatch(/Sudah termasuk hemat/);
    expect(text).not.toMatch(/diskon|potongan/i); // tanpa baris pengurang tambahan

    await act(async () => { useCart.getState().setQty("1", 9, 11); });
    await waitFor(() => expect(norm(rail().textContent)).toContain("Qty 9 × Rp 10.000"));
    expect(dialogTitle()).toBeNull();
    expect(norm(rail().textContent)).not.toContain("Hemat grosir"); // 0 hemat: baris disembunyikan
  });

  it("ringkasan memakai quote server, bukan cache keranjang (cache bilang 9000, server 8000 di qty 50 = dilaporkan sebagai perubahan)", async () => {
    stubQuote(() => ({ body: ok([tierLine(12, 8500, 10)]) }));
    useCart.setState({ items: [line({ qty: 12 })] });
    render(<CheckoutPage />);
    await waitFor(() => expect(norm(rail().textContent)).toContain("Qty 12 × Rp 8.500"));
    expect(norm(rail().textContent)).not.toContain("Rp 9.000");
    // Tier server berubah dari yang dilihat pembeli: dialog yang sudah ada muncul dengan angka sebelum -> sesudah.
    expect(dialogTitle()).toBeTruthy();
    expect(norm(document.querySelector("[role=dialog]")!.textContent)).toContain("GPT Plus 1 Bulan: Rp 9.000 → Rp 8.500");
  });

  it("menyetujui perubahan tier menghapus cache tier baris itu sehingga qty berikutnya tidak memunculkan dialog berulang", async () => {
    stubQuote((body) => ({ body: ok([tierLine(body.items[0].qty, 8500, 10)]) }));
    useCart.setState({ items: [line({ qty: 12 })] });
    render(<CheckoutPage />);
    await waitFor(() => expect(dialogTitle()).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Setujui harga baru" }));
    expect(dialogTitle()).toBeNull();
    expect(useCart.getState().items[0].bulkTiers).toBeUndefined();
    expect(useCart.getState().items[0].price).toBe(10_000);
    await act(async () => { useCart.getState().setQty("1", 13, 11); });
    await waitFor(() => expect(norm(rail().textContent)).toContain("Qty 13 × Rp 8.500"));
    expect(dialogTitle()).toBeNull();
  });

  it("perubahan harga DASAR dari server tetap memakai dialog yang ada tanpa digandakan oleh pemeriksaan tier", async () => {
    stubQuote(() => ({ body: ok([tierLine(12, 9900, 10)], { changes: [{ product_id: 1, variant_id: 11, name: "GPT Plus 1 Bulan", previous_price: 10_000, current_price: 11_000, message: "Harga berubah." }] }) }));
    useCart.setState({ items: [line({ qty: 12 })] });
    render(<CheckoutPage />);
    await waitFor(() => expect(dialogTitle()).toBeTruthy());
    const items = Array.from(document.querySelectorAll("[role=dialog] li")).map((li) => norm(li.textContent));
    expect(items).toEqual(["GPT Plus 1 Bulan: Rp 10.000 → Rp 11.000"]);
  });

  it("keranjang lama tanpa cache tier: server menerapkan tier tanpa alarm; hemat tetap tampil dari quote", async () => {
    stubQuote((body) => ({ body: ok([tierLine(body.items[0].qty, 9000, 10)]) }));
    useCart.setState({ items: [line({ qty: 12, bulkTiers: undefined })] });
    render(<CheckoutPage />);
    await waitFor(() => expect(norm(rail().textContent)).toContain("Qty 12 × Rp 9.000"));
    expect(dialogTitle()).toBeNull();
    expect(norm(rail().textContent)).toContain("Hemat grosir Rp 12.000");
  });

  it("varian tanpa tier / quote tanpa base_price: tanpa catatan grosir; harga dasar-cache tidak menimpa quote", async () => {
    stubQuote(() => ({ body: ok([quoted(3, 10_000)]) }));
    useCart.setState({ items: [line({ qty: 3, bulkTiers: [] })] });
    render(<CheckoutPage />);
    await waitFor(() => expect(norm(rail().textContent)).toContain("Qty 3 × Rp 10.000"));
    expect(norm(rail().textContent)).not.toMatch(/grosir/i);
    expect(dialogTitle()).toBeNull();
  });

  it("dua baris quote untuk varian sama menampilkan catatan agregasi", async () => {
    stubQuote(() => ({ body: ok([tierLine(7, 9000, 10), { ...tierLine(5, 9000, 10), product_id: 2 }]) }));
    useCart.setState({ items: [line({ qty: 7 })] });
    render(<CheckoutPage />);
    await waitFor(() => expect(norm(rail().textContent)).toContain("Grosir dihitung dari total 12 pcs varian ini"));
  });

  it("loading: ringkasan menampilkan Memuat…; error quote: isian keranjang tetap, tanpa hemat; empty: keranjang kosong", async () => {
    let release: (value: unknown) => void = () => {};
    const gate = new Promise((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => { await gate; return new Response(JSON.stringify(ok([tierLine(12, 9000, 10)])), { headers: { "Content-Type": "application/json" } }); }));
    useCart.setState({ items: [line({ qty: 12 })] });
    render(<CheckoutPage />);
    await waitFor(() => expect(norm(rail().textContent)).toContain("Memuat"));
    expect(norm(rail().textContent)).not.toContain("Hemat grosir");
    await act(async () => { release(null); });
    await waitFor(() => expect(norm(rail().textContent)).toContain("Hemat grosir"));
    cleanup();

    stubQuote(() => ({ status: 500, body: { error: "boom" } }));
    useCart.setState({ items: [line({ qty: 12 })] });
    render(<CheckoutPage />);
    await waitFor(() => expect(screen.getAllByText(/boom/).length).toBeGreaterThan(0));
    expect(useCart.getState().items[0]).toMatchObject({ qty: 12, price: 10_000, bulkTiers: tiers });
    expect(norm(document.body.textContent)).not.toContain("Hemat grosir");
    cleanup();

    useCart.setState({ items: [] });
    render(<CheckoutPage />);
    expect(norm(document.body.textContent)).toMatch(/kosong/i);
  });
});
