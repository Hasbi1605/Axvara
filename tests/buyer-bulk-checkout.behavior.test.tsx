// @vitest-environment jsdom
// Checkout: ringkasan dari quote SERVER (bukan cache keranjang), expected_price
// = harga DASAR, melewati ambang tier tidak memicu dialog harga palsu, dan
// perubahan harga dasar/tier sungguhan tetap tampil di dialog yang sudah ada.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("invite_email input validates on blur, offers same-as-contact shortcut, debounces lowercase quote, and sends buyer_fields on order submit", async () => {
    const quoteBodies: Array<{ items: Array<{ buyer_fields?: { invite_email?: string }; qty: number }> }> = [];
    const orderBodies: Array<{ items: Array<{ buyer_fields?: { invite_email?: string } }> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (target === "/api/checkout/quote") {
        quoteBodies.push(body);
        const emailVal = body.items[0]?.buyer_fields?.invite_email;
        return new Response(
          JSON.stringify(
            ok([
              quoted(1, 18_000, {
                queued_delivery: true,
                buyer_field_key: "invite_email",
                ...(emailVal ? { buyer_fields: { invite_email: emailVal } } : {}),
              }),
            ]),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (target === "/api/orders") {
        orderBodies.push(body);
        return new Response(JSON.stringify({ ok: true, code: "AXV-20261124-INVUI01" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${target}`);
    }));

    useCart.setState({
      items: [line({ qty: 1, price: 18_000, buyerFieldKey: "invite_email", bulkTiers: [] })],
    });
    render(<CheckoutPage />);

    const inviteSection = screen.getByTestId("checkout-invite-email-section");
    const inviteInput = document.getElementById("checkout-invite-email") as HTMLInputElement;
    const contactEmail = document.getElementById("checkout-email") as HTMLInputElement;
    const waInput = document.getElementById("checkout-wa") as HTMLInputElement;

    // Belum kirim quote sebelum email valid
    expect(quoteBodies).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Samakan dengan email kontak/ })).toBeNull();

    // Validasi hanya muncul saat blur setelah input tidak valid
    fireEvent.change(inviteInput, { target: { value: "tidak-valid" } });
    expect(within(inviteSection).queryByText(/Format email yang ingin di-invite tidak valid/i)).toBeNull();
    fireEvent.blur(inviteInput);
    expect(within(inviteSection).getByText(/Format email yang ingin di-invite tidak valid/i)).toBeTruthy();
    expect(inviteInput.getAttribute("aria-invalid")).toBe("true");
    expect(quoteBodies).toHaveLength(0);

    // Isi email kontak valid -> tombol "Samakan dengan email kontak" muncul dan mengisi input
    fireEvent.change(waInput, { target: { value: "081234567890" } });
    fireEvent.change(contactEmail, { target: { value: "User.Invite@Gmail.COM" } });
    const sameBtn = within(inviteSection).getByRole("button", { name: "Samakan dengan email kontak" });
    fireEvent.click(sameBtn);
    expect(inviteInput.value).toBe("User.Invite@Gmail.COM");
    expect(within(inviteSection).queryByText(/Format email yang ingin di-invite tidak valid/i)).toBeNull();

    // Quote dikirim (debounced) dengan lowercase invite_email
    await waitFor(() => expect(quoteBodies).toHaveLength(1), { timeout: 1500 });
    expect(quoteBodies[0].items[0]).toMatchObject({
      qty: 1,
      buyer_fields: { invite_email: "user.invite@gmail.com" },
    });
    expect(localStorage.getItem("axvara-cart") ?? "").not.toContain("User.Invite@Gmail.COM");

    // Centang persetujuan & submit order -> POST /api/orders menyertakan buyer_fields.invite_email
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    const payButtons = screen.getAllByRole("button", { name: /Buat Pesanan/i }) as HTMLButtonElement[];
    await waitFor(() => expect(payButtons.some((btn) => !btn.disabled)).toBe(true));
    fireEvent.click(payButtons.find((btn) => !btn.disabled)!);
    await waitFor(() => expect(orderBodies).toHaveLength(1), { timeout: 1500 });
    expect(orderBodies[0].items[0]).toMatchObject({
      buyer_fields: { invite_email: "user.invite@gmail.com" },
    });
  });

  it("custom buyer fields render separated section like Pixel, toggle password visibility, validate on blur, and submit normalized custom_values", async () => {
    const quoteBodies: Array<{ items: Array<{ buyer_fields?: { custom_values?: Record<string, string> } }> }> = [];
    const orderBodies: Array<{ items: Array<{ buyer_fields?: { custom_values?: Record<string, string> } }> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (target === "/api/checkout/quote") {
        quoteBodies.push(body);
        return new Response(
          JSON.stringify(
            ok([
              quoted(1, 25_000, {
                queued_delivery: true,
                buyer_field_key: "custom",
                buyer_fields: { custom_fingerprint: "a".repeat(64) },
              }),
            ]),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (target === "/api/orders") {
        orderBodies.push(body);
        return new Response(JSON.stringify({ ok: true, code: "AXV-20261124-CUSTUI01" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${target}`);
    }));

    useCart.setState({
      items: [
        line({
          qty: 1,
          price: 25_000,
          buyerFieldKey: "custom",
          customBuyerFields: {
            title: "Data Akun Aktivasi",
            note: "Dipakai sekali oleh admin untuk proses aktivasi.",
            fields: [
              { key: "account_email", label: "Email akun", type: "email", placeholder: "nama@gmail.com", required: true },
              { key: "account_password", label: "Password akun", type: "password", placeholder: "Password login", required: true },
            ],
          },
          bulkTiers: [],
        }),
      ],
    });
    render(<CheckoutPage />);

    const section = screen.getByTestId("checkout-custom-fields-section");
    expect(within(section).getByText("Data Akun Aktivasi")).toBeTruthy();
    const emailInput = document.getElementById("checkout-custom-11-account_email") as HTMLInputElement;
    const passInput = document.getElementById("checkout-custom-11-account_password") as HTMLInputElement;
    const contactWa = document.getElementById("checkout-wa") as HTMLInputElement;
    const contactEmail = document.getElementById("checkout-email") as HTMLInputElement;

    // Contact fields appear above the separated custom section
    expect(Boolean(contactEmail.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    // Invalid email shows error on blur only
    fireEvent.change(emailInput, { target: { value: "salah" } });
    expect(within(section).queryByText(/Format Email akun tidak valid/i)).toBeNull();
    fireEvent.blur(emailInput);
    expect(within(section).getByText(/Format Email akun tidak valid/i)).toBeTruthy();

    // Same-as-contact shortcut fills email
    fireEvent.change(contactWa, { target: { value: "081234567890" } });
    fireEvent.change(contactEmail, { target: { value: "Buyer.Custom@Gmail.COM" } });
    fireEvent.click(within(section).getByRole("button", { name: "Samakan dengan email kontak" }));
    expect(emailInput.value).toBe("Buyer.Custom@Gmail.COM");

    // Password toggle works with aria-pressed
    expect(passInput.type).toBe("password");
    const toggleBtn = within(section).getByRole("button", { name: "Tampilkan Password akun" });
    fireEvent.click(toggleBtn);
    expect(passInput.type).toBe("text");
    fireEvent.change(passInput, { target: { value: "PassRahasia123" } });

    await waitFor(() => expect(quoteBodies).toHaveLength(1), { timeout: 1500 });
    expect(quoteBodies[0].items[0].buyer_fields?.custom_values).toEqual({
      account_email: "buyer.custom@gmail.com",
      account_password: "PassRahasia123",
    });

    // Submit order includes custom_values and never leaks password to localStorage
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    const payButtons = screen.getAllByRole("button", { name: /Buat Pesanan/i }) as HTMLButtonElement[];
    await waitFor(() => expect(payButtons.some((btn) => !btn.disabled)).toBe(true));
    fireEvent.click(payButtons.find((btn) => !btn.disabled)!);
    await waitFor(() => expect(orderBodies).toHaveLength(1), { timeout: 1500 });
    expect(orderBodies[0].items[0].buyer_fields?.custom_values).toEqual({
      account_email: "buyer.custom@gmail.com",
      account_password: "PassRahasia123",
    });
    expect(localStorage.getItem("axvara-cart") ?? "").not.toContain("PassRahasia123");
  });

  it("checkout Google activation separates contact fields above activation section, toggles password visibility, and validates on blur", async () => {
    const bodies = stubQuote(() => ({ body: ok([quoted(1, 39_900, { queued_delivery: true, automatic_processing: true, buyer_fields: { pv_fingerprint: "fp1" } })]) }));
    useCart.setState({ items: [line({ qty: 1, price: 39_900, pixelverifInput: true, maxQty: 1, bulkTiers: [] })] });
    render(<CheckoutPage />);

    // Contact fields (WA + Email) sit together ABOVE the separated Google activation section.
    const waInput = document.getElementById("checkout-wa") as HTMLInputElement;
    const contactEmail = document.getElementById("checkout-email") as HTMLInputElement;
    const activationSection = screen.getByTestId("checkout-activation-section");
    const pvEmailInput = document.getElementById("checkout-pv-email") as HTMLInputElement;
    const pvPassInput = document.getElementById("checkout-pv-password") as HTMLInputElement;
    const pvTotpInput = document.getElementById("checkout-pv-totp") as HTMLInputElement;

    expect(Boolean(waInput.compareDocumentPosition(contactEmail) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(contactEmail.compareDocumentPosition(activationSection) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(activationSection.contains(pvEmailInput)).toBe(true);
    expect(activationSection.contains(contactEmail)).toBe(false);

    // No premature errors on initial mount or tab-through before typing.
    expect(pvEmailInput.getAttribute("aria-invalid")).toBe("false");
    expect(pvTotpInput.getAttribute("aria-invalid")).toBe("false");
    fireEvent.blur(pvEmailInput);
    expect(screen.queryByText(/Gunakan alamat @gmail\.com/)).toBeNull();

    // Typing invalid non-Gmail shows no error mid-typing, only after blur, and clears immediately when fixed.
    fireEvent.change(pvEmailInput, { target: { value: "buyer@yahoo.com" } });
    expect(within(activationSection).queryByText(/Gunakan alamat @gmail\.com/)).toBeNull();
    fireEvent.blur(pvEmailInput);
    expect(within(activationSection).getByText(/Gunakan alamat @gmail\.com/)).toBeTruthy();
    expect(pvEmailInput.getAttribute("aria-invalid")).toBe("true");
    expect(pvEmailInput.getAttribute("aria-describedby")).toBe("checkout-pv-email-error");

    fireEvent.change(pvEmailInput, { target: { value: "buyer@gmail.com" } });
    expect(within(activationSection).queryByText(/Gunakan alamat @gmail\.com/)).toBeNull();
    expect(pvEmailInput.getAttribute("aria-invalid")).toBe("false");

    // Password toggle button uses aria-pressed and unmasks/masks input.
    const toggleBtn = screen.getByRole("button", { name: "Tampilkan password Gmail" });
    expect(toggleBtn.getAttribute("aria-pressed")).toBe("false");
    expect(pvPassInput.type).toBe("password");
    fireEvent.click(toggleBtn);
    expect(pvPassInput.type).toBe("text");
    expect(screen.getByRole("button", { name: "Sembunyikan password Gmail" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(pvPassInput, { target: { value: "secret-pass" } });

    // 6-digit OTP triggers specific guidance on blur, then valid Base32 key clears it and triggers debounced quote.
    fireEvent.change(pvTotpInput, { target: { value: "123456" } });
    fireEvent.blur(pvTotpInput);
    expect(within(activationSection).getByText(/bukan kode OTP 6 digit/)).toBeTruthy();
    expect(pvTotpInput.getAttribute("aria-invalid")).toBe("true");
    expect(pvTotpInput.getAttribute("aria-describedby")).toContain("checkout-pv-totp-error");
    expect(bodies).toHaveLength(0);

    fireEvent.change(pvTotpInput, { target: { value: "JBSWY3DPEHPK3PXP" } });
    expect(within(activationSection).queryByText(/bukan kode OTP 6 digit/)).toBeNull();
    expect(pvTotpInput.getAttribute("aria-invalid")).toBe("false");
    await waitFor(() => expect(bodies).toHaveLength(1), { timeout: 1500 });
    expect(bodies[0].items[0]).toMatchObject({
      buyer_fields: { pv_email: "buyer@gmail.com", pv_password: "secret-pass", pv_totp_secret: "JBSWY3DPEHPK3PXP" },
    });

    // Editing a valid Google credential must immediately disable Bayar (stale
    // quote token invalidated) during the 400ms debounce, then re-quote.
    const payButtons = () => screen.getAllByRole("button", { name: /Buat Pesanan/i }) as HTMLButtonElement[];
    await waitFor(() => expect(payButtons().some((btn) => !btn.disabled)).toBe(true));
    fireEvent.change(pvPassInput, { target: { value: "secret-pass-2" } });
    expect(payButtons().every((btn) => btn.disabled)).toBe(true);
    await waitFor(() => expect(bodies).toHaveLength(2), { timeout: 1500 });
    expect(bodies[1].items[0]).toMatchObject({
      buyer_fields: { pv_email: "buyer@gmail.com", pv_password: "secret-pass-2", pv_totp_secret: "JBSWY3DPEHPK3PXP" },
    });
    await waitFor(() => expect(payButtons().some((btn) => !btn.disabled)).toBe(true));
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

  it("ringkasan checkout menyediakan tautan Lihat S&K ke halaman produk (tab baru)", async () => {
    stubQuote(() => ({ body: ok([quoted(1, 10_000)]) }));
    useCart.setState({ items: [line({ qty: 1, bulkTiers: [] })] });
    render(<CheckoutPage />);
    await waitFor(() => expect(within(rail()).getByRole("link", { name: "Lihat S&K" })).toBeTruthy());
    const link = within(rail()).getByRole("link", { name: "Lihat S&K" });
    expect(link.getAttribute("href")).toBe("/produk/gpt-plus");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});
