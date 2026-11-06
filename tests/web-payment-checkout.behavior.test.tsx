// @vitest-environment jsdom
// Checkout web: metode HANYA dari quote.paymentMethods (qris/gateway/crypto),
// QRIS default dengan badge persis, pilihan terikat ID yang ditandatangani,
// angka dari server, submit memakai skema create yang ada.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Fixture checkout/pesanan async; beri ruang bila mesin sedang sibuk (tidak mengubah asersi).
configure({ asyncUtilTimeout: 4000 });
import CheckoutPage from "@/app/(shop)/checkout/page";
import { PaymentMethodPicker } from "@/components/storefront/PaymentMethodPicker";
import { parsePayOptions } from "@/lib/payment-ui";
import { useCart, type CartItem } from "@/stores/cart";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/payment-maintenance", () => ({ isPaymentMaintenanceEnabled: () => false }));

const norm = (t: string | null | undefined) => String(t ?? "").replace(/\s/g, " ");
const qrisM = { id: "qris", kind: "qris", label: "QRIS", sublabel: null, account_number: "", account_name: "", qris_url: null, currency: "IDR", available: true };
// FIXTURE kontrak quote (bukan katalog/limit merchant nyata): grup + limits adalah tampilan; ID/angka bertanda tangan tidak berubah.
const gw = (code: string, name: string, fee: number, total: number, sub = 250_000, extra: Record<string, unknown> = {}) => ({ id: `sekalipay_gateway:${code}`, kind: "gateway", label: name, sublabel: "Estimasi biaya pembayaran", account_number: "", currency: "IDR", available: true, group: "va", limits: { min: 10_000, max: 10_000_000 }, gateway: { channel: code, estimated_fee: fee, estimated_total: total, idr_subtotal: sub }, ...extra });
const gwOff = (code: string, name: string, extra: Record<string, unknown> = {}, sub = 250_000) => ({ id: `sekalipay_gateway:${code}`, kind: "gateway", label: name, sublabel: "Estimasi biaya pembayaran", account_number: "", currency: "IDR", available: false, group: "va", limits: { min: 252_500, max: 10_000_000 }, unavailable_reason: "below_min", shortfall: 2_500, gateway: { channel: code, idr_subtotal: sub }, ...extra });
// FIXTURE kontrak quote crypto multi-koin: amount_text = TOTAL (base 15.63 + biaya layanan 1,5% 0.24); angka dari server.
const coinM = (ticker: string, symbol: string, networkLabel: string, network: string, group: "popular" | "stable", extra: Record<string, unknown> = {}) => ({ id: `nowpayments:${ticker}`, kind: "crypto", label: symbol, sublabel: networkLabel, group, available: true, currency: "USD", amount_text: "15.87", pay_currency: ticker, network, fee_payer: "merchant", fixed_rate: false, sender_gas_extra: true, base_cents: 1563, surcharge_cents: 24, total_cents: 1587, surcharge_bps: 150, usd: { cents: "1563", rate_text: "16000.00" }, account_number: "", ...extra });
const cryptoM = coinM("usdtbsc", "USDT", "BNB Smart Chain", "bsc", "stable");
const coinOff = (ticker: string, symbol: string, networkLabel: string, network: string, group: "popular" | "stable", minText: string, minIdr: number | null) => ({ id: `nowpayments:${ticker}`, kind: "crypto", label: symbol, sublabel: networkLabel, group, available: false, unavailable_reason: "below_min", currency: "USD", pay_currency: ticker, network, min_total_cents: Math.round(Number(minText) * 100), min_total_text: minText, min_idr_subtotal: minIdr, account_number: "" });

function cartLine(): CartItem {
  return { id: "1", slug: "gpt-plus", name: "GPT Plus", description: "", categorySlug: "ai", image: "/x.png", price: 250_000, qty: 1, variantId: 11, variantLabel: "1 Bulan", minQty: 1 } as unknown as CartItem;
}
function quoteBody(methods: unknown[], extra: Record<string, unknown> = {}) {
  const items = [{ product_id: 1, variant_id: 11, name: "GPT Plus", price: 250_000, qty: 1, stock: -1, image: "/x.png", queued_delivery: false }];
  return { ok: true, items, subtotal: 250_000, quoteToken: "quote-token-fixture-123456", paymentMethods: methods, locale: "id", ...extra };
}
type Orders = { status?: number; body: unknown } | "timeout";
function stub(opts: { quotes: Array<{ methods: unknown[]; extra?: Record<string, unknown>; status?: number; body?: unknown }>; order?: Orders }) {
  let quoteN = 0;
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/checkout/quote") {
      const q = opts.quotes[Math.min(quoteN++, opts.quotes.length - 1)];
      const body = q.body ?? quoteBody(q.methods, q.extra);
      return new Response(JSON.stringify(body), { status: q.status ?? 200, headers: { "Content-Type": "application/json" } });
    }
    if (u === "/api/orders") {
      posts.push(JSON.parse(String(init?.body)));
      if (opts.order === "timeout") throw new TypeError("network");
      const o = opts.order ?? { status: 201, body: { code: "AXV-20261104-AAAAAAAA", subtotal: 250_000, status: "pending", locale: "id", qris: null, buyer_access_session: "p1.x", checkout_credential_grant: "g.x" } };
      return new Response(JSON.stringify(o.body), { status: o.status ?? 201, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 200 });
  }));
  return { posts };
}
// Semua radio di DOM (termasuk panel grup tertutup); `visibleRadios` = hanya yang bisa difokus pembeli.
const radios = () => screen.getAllByRole("radio", { hidden: true }) as HTMLInputElement[];
const visibleRadios = () => screen.queryAllByRole("radio") as HTMLInputElement[];
const headers = () => screen.getAllByRole("button").filter((b) => (b.getAttribute("aria-controls") ?? "").startsWith("pay-group-")) as HTMLButtonElement[];
const header = (re: RegExp) => headers().find((h) => re.test(h.getAttribute("aria-label") ?? ""))!;
const radio = (re: RegExp) => radios().find((r) => re.test(r.closest("label")?.textContent ?? ""))!;
const qrisCard = () => radio(/QRIS/).closest("label")!;
// QRIS SELALU terlihat langsung (tanpa akordeon); tunggu pilihan bawaan + kartu QRIS muncul, jangan berasumsi sinkron.
const qrisVisible = () => waitFor(() => expect(visibleRadios().some((r) => r === radio(/QRIS/))).toBe(true));
const noQrisAccordion = () => expect(headers().some((h) => /^QRIS/.test(h.getAttribute("aria-label") ?? ""))).toBe(false);
const openAll = () => headers().filter((h) => h.getAttribute("aria-expanded") === "false").forEach((h) => fireEvent.click(h));
function fillAndAgree() {
  fireEvent.change(document.getElementById("checkout-wa")!, { target: { value: "081234567890" } });
  fireEvent.change(document.getElementById("checkout-email")!, { target: { value: "buyer@example.com" } });
  const boxes = ["checkout-agree-mobile", "checkout-agree"].map((id) => document.getElementById(id)).filter(Boolean) as HTMLInputElement[];
  fireEvent.click(boxes[0]);
}
const payButton = () => screen.getAllByRole("button").filter((b) => /Bayar|Buat Pesanan|Pay |Place order/.test(b.textContent ?? "")).slice(-1)[0] as HTMLButtonElement;
const railText = () => norm(document.querySelector("aside")?.textContent);

beforeEach(() => { window.scrollTo = vi.fn(); nav.push.mockClear(); localStorage.clear(); sessionStorage.clear(); useCart.setState({ items: [cartLine()] }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("checkout: akordeon grup metode (logo, tanpa pengulangan)", () => {
  const cards = () => radios().map((r) => r.closest("label")!);
  const methods = () => [qrisM, gw("DEMO_BCA_VA", "BCA Virtual Account", 4000, 254_000), gw("DEMO_OVO", "OVO", 2500, 252_500, 250_000, { group: "ewallet" }), cryptoM];

  it("QRIS langsung tampil di atas grup; grup lain = tombol native aria-expanded/aria-controls; satu radio terpilih dan satu badge inline", async () => {
    stub({ quotes: [{ methods: methods() }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(headers().length).toBe(3));
    await qrisVisible();
    noQrisAccordion();
    expect(headers().map((h) => h.getAttribute("aria-label")?.split(",")[0])).toEqual(["Virtual Account", "E-Wallet", "Crypto"]);
    for (const h of headers()) {
      expect(h.tagName).toBe("BUTTON"); expect(h.className).toContain("min-h-[64px]");
      const panel = document.getElementById(h.getAttribute("aria-controls")!)!;
      const closed = h.getAttribute("aria-expanded") === "false"; // tertutup = tetap terpasang tetapi inert + aria-hidden (animasi)
      expect(panel.getAttribute("aria-hidden") === "true").toBe(closed);
      expect(panel.hasAttribute("inert")).toBe(closed);
      expect(panel.className).toContain("duration-[220ms]");
    }
    expect(headers().map((h) => h.getAttribute("aria-expanded"))).toEqual(["false", "false", "false"]);
    expect(visibleRadios()).toHaveLength(1); // hanya kartu QRIS langsung terlihat; radio panel tertutup tidak bisa difokus
    expect(visibleRadios()[0].checked).toBe(true);
    expect(radios().filter((r) => r.checked)).toHaveLength(1);
    expect(norm(document.body.textContent).match(/Paling cepat/g)).toHaveLength(1);
    expect(norm(qrisCard().textContent)).toContain("Paling cepat");
    // Header grup tertutup memuat baris chip logo (bukan teks panjang).
    expect(headers()[0].querySelectorAll("[data-bank-tile] img").length).toBe(1);
    expect(headers()[0].querySelector('img[src="/payments/bca.svg"]')).toBeTruthy();
    expect(headers()[1].querySelector('img[src="/payments/ovo.svg"]')).toBeTruthy();
    expect(headers()[2].querySelector('img[src="/payments/coins/usdtbsc.svg"]')).toBeTruthy();
  });

  it("QRIS selalu terlihat; hanya satu grup terbuka dan membuka grup lain menutup yang sebelumnya; pilihan tidak berubah", async () => {
    stub({ quotes: [{ methods: methods() }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(headers().length).toBe(3));
    await qrisVisible();
    fireEvent.click(header(/^Virtual Account/));
    expect(headers().map((h) => h.getAttribute("aria-expanded"))).toEqual(["true", "false", "false"]);
    expect(visibleRadios()).toHaveLength(2); // QRIS + VA
    fireEvent.click(header(/^E-Wallet/)); // exclusive-open: VA tertutup
    expect(headers().map((h) => h.getAttribute("aria-expanded"))).toEqual(["false", "true", "false"]);
    expect(visibleRadios()).toHaveLength(2); // QRIS + E-Wallet
    expect(radio(/QRIS/).checked).toBe(true);
    fireEvent.click(header(/^E-Wallet/)); // grup yang sama menutup semua
    expect(headers().map((h) => h.getAttribute("aria-expanded"))).toEqual(["false", "false", "false"]);
    expect(visibleRadios()).toHaveLength(1); // QRIS saja
    expect(radio(/QRIS/).checked).toBe(true);
  });

  it("VA vs E-Wallet dari `group`; group hilang/tak dikenal -> 'Lainnya' (tidak diasumsikan VA)", async () => {
    stub({ quotes: [{ methods: [qrisM, gw("A", "Alpha", 1000, 251_000, 250_000, { group: undefined }), gw("B", "Beta", 1000, 251_000, 250_000, { group: "card" }), gw("C", "Gamma VA", 1000, 251_000)] }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(headers().length).toBe(2));
    expect(headers().map((h) => h.getAttribute("aria-label")?.split(",")[0])).toEqual(["Virtual Account", "Lainnya"]);
    const panel = (re: RegExp) => document.getElementById(header(re).getAttribute("aria-controls")!)!;
    expect(norm(panel(/^Virtual Account/).textContent)).toContain("GAGammaBiaya Rp 1.000"); // monogram netral "GA" + nama tanpa akhiran VA
    expect(norm(panel(/^Virtual Account/).textContent)).not.toMatch(/Alpha|Beta/);
    expect(norm(panel(/^Lainnya/).textContent)).toMatch(/Alpha.*Beta|Beta.*Alpha/);
  });

  it("grup terbuka: baris gateway selaras baris crypto (ubin logo 40×26 | nama pendek | 'Biaya Rp x' + radio), min-h 48px, tanpa sublabel server dan tanpa catatan panjang", async () => {
    stub({ quotes: [{ methods: methods() }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(headers().length).toBe(3));
    openAll();
    for (const input of ["sekalipay_gateway:DEMO_BCA_VA", "sekalipay_gateway:DEMO_OVO"]) {
      const card = (document.querySelector(`input[value="${input}"]`) as HTMLInputElement).closest("label")!;
      for (const cls of ["grid-cols-[40px_minmax(0,1fr)_auto]", "min-h-[48px]", "rounded-xl"]) expect(card.className, cls).toContain(cls);
      expect(card.querySelector("[data-bank-tile]")!.className).toContain("w-10");
      expect(card.querySelector("[data-bank-tile]")!.className).toContain("bg-white");
    }
    expect(norm(radio(/^BCA/).closest("label")!.textContent)).toBe("BCABiaya Rp 4.000"); // akhiran "Virtual Account" dibuang di grup VA
    expect(norm(radio(/OVO/).closest("label")!.textContent)).toBe("OVOBiaya Rp 2.500");
    expect(norm(radio(/QRIS/).closest("label")!.textContent)).toBe("QRIS Paling cepatScan dari semua e-wallet & m-banking");
    expect(norm(document.body.textContent)).not.toMatch(/Estimasi biaya pembayaran|Biaya & total estimasi|total akhir kamu setujui/);
    expect(document.getElementById("pay-hint")).toBeNull();
    expect(document.querySelector(".text-emerald-300\\/70")).toBeNull();
    expect(radio(/QRIS/).closest("label")!.className).toContain("border-[#00E5FF]/50");
    expect(radio(/^BCA/).closest("label")!.className).not.toContain("ring-[#00E5FF]/50");
    fireEvent.click(radio(/^BCA/));
    expect(radio(/^BCA/).closest("label")!.className).toContain("ring-[#00E5FF]/50"); // terpilih = ring + titik radio, tanpa garis kiri
    expect(radio(/^BCA/).closest("label")!.className).not.toMatch(/border-l|bg-\[#00E5FF\]/);
  });

  it("menutup grup terpilih menghapus pilihan/fee/ringkasan, tidak memilih QRIS otomatis, dan CTA menunggu pilihan baru", async () => {
    stub({ quotes: [{ methods: methods() }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(headers().length).toBe(3));
    await qrisVisible();
    fireEvent.click(header(/^E-Wallet/));
    fireEvent.click(radio(/OVO/));
    expect(radio(/OVO/).checked).toBe(true);
    expect(railText()).toContain("Biaya OVO");
    fireEvent.click(header(/^E-Wallet/)); // menutup grup terpilih
    const h = header(/^E-Wallet/);
    expect(h.getAttribute("aria-expanded")).toBe("false");
    expect(radios().filter((r) => r.checked)).toHaveLength(0);
    expect(radio(/OVO/).checked).toBe(false);
    expect(radio(/QRIS/).checked).toBe(false); // deselect eksplisit tidak jatuh ke QRIS
    expect(h.querySelector("[data-selected-summary]")).toBeNull();
    expect(norm(document.body.textContent)).not.toContain("Dipilih: OVO");
    expect(railText()).not.toMatch(/Biaya OVO/);
    expect(payButton().disabled).toBe(true);
    fireEvent.click(header(/^E-Wallet/)); // buka lagi tidak boleh menghidupkan pilihan lama
    expect(radios().filter((r) => r.checked)).toHaveLength(0);
    expect(radio(/OVO/).checked).toBe(false);
    expect(payButton().disabled).toBe(true);
  });

  it("membuka grup lain yang menutup grup terpilih menghapus pilihan sebelumnya", async () => {
    stub({ quotes: [{ methods: methods() }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(headers().length).toBe(3));
    await qrisVisible();
    fireEvent.click(header(/^Virtual Account/));
    fireEvent.click(radio(/^BCA/));
    expect(radio(/^BCA/).checked).toBe(true);
    expect(railText()).toContain("Biaya BCA Virtual Account");
    fireEvent.click(header(/^E-Wallet/)); // auto-menutup VA yang memuat pilihan
    expect(header(/^Virtual Account/).getAttribute("aria-expanded")).toBe("false");
    expect(header(/^E-Wallet/).getAttribute("aria-expanded")).toBe("true");
    expect(radios().filter((r) => r.checked)).toHaveLength(0);
    expect(radio(/^BCA/).checked).toBe(false);
    expect(header(/^Virtual Account/).querySelector("[data-selected-summary]")).toBeNull();
    expect(railText()).not.toMatch(/Biaya BCA Virtual Account/);
    expect(payButton().disabled).toBe(true);
  });

  it("membuka/menutup grup lain tidak mengubah pilihan QRIS langsung", async () => {
    stub({ quotes: [{ methods: methods() }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(headers().length).toBe(3));
    await qrisVisible();
    fireEvent.click(header(/^Virtual Account/));
    expect(radio(/QRIS/).checked).toBe(true);
    fireEvent.click(header(/^Virtual Account/));
    expect(radio(/QRIS/).checked).toBe(true);
    expect(radios().filter((r) => r.checked)).toHaveLength(1);
    expect(payButton().disabled).toBe(false);
  });

  it("crypto: tanpa paragraf/amber; header berisi judul + keterangan total USD + chip logo bulat; baris = logo + simbol + jaringan; 'halaman pesanan' hanya di catatan gateway/CTA; kurs sekali di ringkasan", async () => {
    stub({ quotes: [{ methods: [qrisM, cryptoM] }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(headers().length).toBe(1));
    const head = header(/^Crypto/);
    expect(norm(head.textContent)).toBe("CryptoUS$15,87 · termasuk biaya layanan 1,5%");
    expect(head.querySelectorAll("[data-coin-chips] [data-coin-logo]")).toHaveLength(1);
    fireEvent.click(head);
    fireEvent.click(radio(/USDT/));
    expect(norm(radio(/USDT/).closest("label")!.textContent)).toBe("USDT BNB Smart Chain"); // jumlah USD tidak diulang per baris
    const body = norm(document.body.textContent);
    expect(body).not.toMatch(/Biaya penyedia untuk pembeli belum diketahui|Dibayar lewat alamat crypto|bukan nol|Total sudah termasuk biaya layanan crypto\. Alamat/);
    // Revisi owner 6 Nov: ringkasan crypto tidak lagi menampilkan baris kurs (mentah maupun terformat).
    expect(railText()).not.toMatch(/kurs Rp/);
    expect(railText()).not.toContain("16000.00"); // kurs mentah tidak ditampilkan
    expect(document.querySelector(".text-\\[\\#FFD66B\\]")).toBeNull(); // tidak ada baris amber permanen
    expect(document.querySelector("fieldset")!.innerHTML).not.toMatch(/border-l-|bg-\[#00E5FF\]\/(5|10)\b/); // tanpa garis kiri / wash cyan
    expect(head.querySelector('img[src="/payments/coins/usdtbsc.svg"]')).toBeTruthy();
  });

  it("logo: QRIS hitam di pelat putih, USDT, merek gateway dari LABEL server; label tak dikenal = monogram netral", async () => {
    stub({ quotes: [{ methods: [qrisM, gw("ZZ_1", "BCA Virtual Account", 4000, 254_000), gw("ZZ_2", "OVO", 2500, 252_500, 250_000, { group: "ewallet" }), gw("BCA_VA", "Channel Rahasia", 4000, 254_000), cryptoM] }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(headers().length).toBe(3));
    openAll();
    const qrisLogo = radio(/QRIS/).closest("label")!.querySelector('img[src="/brand/qris.svg"]')!;
    expect(qrisLogo.className).toContain("brightness-0");
    expect(radio(/USDT/).closest("label")!.querySelector('img[src="/payments/coins/usdtbsc.svg"]')!.className).not.toContain("brightness-0");
    expect(radio(/^BCA/).closest("label")!.querySelector('[data-bank-tile] img[src="/payments/bca.svg"]')).toBeTruthy();
    expect(radio(/OVO/).closest("label")!.querySelector('[data-bank-tile] img[src="/payments/ovo.svg"]')).toBeTruthy();
    const unknown = radio(/Channel Rahasia/).closest("label")!; // ID memuat BCA tetapi label tidak dikenal
    expect(unknown.querySelector('img[src^="/payments/"]')).toBeNull();
    const monogram = unknown.querySelector("[data-bank-tile][data-monogram]")!; // monogram netral, bukan logo merek lain
    expect(monogram.textContent).toBe("CR");
    expect(monogram.querySelector("img")).toBeNull();
    for (const img of Array.from(document.querySelectorAll("label img, button img"))) { expect(img.getAttribute("alt")).toBe(""); expect(img.getAttribute("src")).toMatch(/^\//); }
  });

  it("header gateway: judul 14px semibold, keterangan 'Biaya mulai Rp x' (termurah, estimasi server), maksimal 4 ubin logo persegi putih bertumpuk + '+N'; nama aksesibel = judul + N metode + tersedia", async () => {
    const fees = [1000, 3500, 4500, 2000, 4000, 3000, 5000, 1500];
    const many = ["BNI VA", "Mandiri VA", "Permata VA", "BRI VA", "BCA VA", "CIMB VA", "Danamon VA", "BSI VA"].map((n, i) => gw(`X${i}`, n, fees[i], 250_000 + fees[i]));
    stub({ quotes: [{ methods: [qrisM, ...many, gwOff("OFF", "SeaBank")] }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(headers().length).toBe(1));
    const h = header(/^Virtual Account/);
    expect(h.getAttribute("aria-label")).toBe("Virtual Account, 9 metode, 8 tersedia");
    expect(norm(h.textContent)).toContain("Virtual AccountBiaya mulai Rp 1.000");
    const title = Array.from(h.querySelectorAll("span")).find((el) => el.textContent === "Virtual Account")!;
    expect(title.className).toContain("text-[14px]"); expect(title.className).toContain("font-semibold"); expect(title.className).not.toMatch(/uppercase|tracking-/);
    const tiles = h.querySelectorAll("[data-bank-chips] [data-bank-tile]");
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) { expect(tile.className).toContain("rounded-md"); expect(tile.className).toContain("w-8"); }
    expect(h.querySelector("[data-bank-chips] .-space-x-2")).toBeTruthy(); // bertumpuk
    expect(norm(h.querySelector("[data-bank-chips]")!.textContent)).toContain("+5");
  });

  it("restorasi pilihan di grup non-QRIS membuka grup itu sejak awal; QRIS tetap terlihat tanpa toggle (picker props saja)", () => {
    const options = parsePayOptions([qrisM, gw("DEMO_BCA_VA", "BCA Virtual Account", 4000, 254_000), cryptoM]);
    render(<PaymentMethodPicker options={options} selectedId="sekalipay_gateway:DEMO_BCA_VA" onSelect={() => {}} />);
    expect(headers().map((h) => h.getAttribute("aria-expanded"))).toEqual(["true", "false"]);
    expect(visibleRadios()).toHaveLength(2); // QRIS langsung + VA yang dipulihkan terbuka
    expect(radio(/^BCA/).checked).toBe(true);
    expect(radio(/QRIS/).checked).toBe(false);
    noQrisAccordion();
  });

  it("picker disabled tidak menutup grup terpilih dan tidak menghapus pilihan terkunci (picker props saja)", () => {
    const options = parsePayOptions([qrisM, gw("DEMO_BCA_VA", "BCA Virtual Account", 4000, 254_000), cryptoM]);
    const onSelect = vi.fn();
    render(<PaymentMethodPicker options={options} selectedId="sekalipay_gateway:DEMO_BCA_VA" onSelect={onSelect} disabled />);
    expect(header(/^Virtual Account/).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(header(/^Virtual Account/));
    expect(header(/^Virtual Account/).getAttribute("aria-expanded")).toBe("true");
    expect(radio(/^BCA/).checked).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("EN: catatan gateway/crypto, caption, satu badge 'Fastest'", async () => {
    stub({ quotes: [{ methods: [qrisM, gw("BCA_VA", "BCA Virtual Account", 4000, 254_000), cryptoM], extra: { displayPreferences: { locale: "en", usdAvailable: true } } }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(headers().length).toBe(2));
    const body = norm(document.body.textContent);
    expect(body).not.toContain("Fees and totals are estimates"); // catatan panjang dihapus
    expect(norm(header(/^Virtual Account/).textContent)).toContain("Fees from Rp 4,000"); // locale EN: pemisah ribuan koma
    expect(norm(header(/^Crypto/).textContent)).toBe("CryptoUS$15.87 · incl. 1.5% service fee");
    expect(body).not.toMatch(/network gas is paid by the sender|\+ network fees/);
    expect(header(/^Virtual Account/).getAttribute("aria-label")).toBe("Virtual Account, 1 method, 1 available");
    expect(body.match(/Fastest/g)).toHaveLength(1);
  });
});

describe("checkout: batas min/max per metode (FIXTURE; nilai dari server, klien tidak berhitung)", () => {
  const limits = (min: number) => ({ limits: { min, max: 10_000_000 } });
  const offMin = (shortfall: number) => gwOff("VA_OFF", "BRI VA", { limits: { min: 10_000, max: 10_000_000 }, shortfall }, 9_999);

  it("min-1: baris nonaktif native + aria-disabled, 'Min. Rp 10.000', alasan dari shortfall server (sr-only), tidak bisa dicek; header menghitung hanya yang tersedia", async () => {
    const { posts } = stub({ quotes: [{ methods: [qrisM, gw("VA_OK", "BCA Virtual Account", 4000, 254_000, 250_000, limits(10_000)), offMin(1)] }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(headers().length).toBe(1));
    expect(header(/^Virtual Account/).getAttribute("aria-label")).toBe("Virtual Account, 2 metode, 1 tersedia");
    fireEvent.click(header(/^Virtual Account/));
    const off = radio(/^BRI/);
    expect(off.disabled).toBe(true);
    expect(off.closest("label")!.getAttribute("aria-disabled")).toBe("true");
    expect(off.closest("label")!.className).toContain("cursor-not-allowed");
    expect(off.closest("label")!.className).toContain("opacity-55");
    expect(norm(off.closest("label")!.textContent)).toBe("BRIMin. Rp 10.000Tambah Rp 1 untuk metode ini"); // tanpa biaya karangan; alasan server hanya sr-only
    expect(document.getElementById(off.getAttribute("aria-describedby")!)!.className).toContain("sr-only");
    expect(norm(document.getElementById(off.getAttribute("aria-describedby")!)?.textContent)).toBe("Tambah Rp 1 untuk metode ini"); // nilai server, bukan hitungan klien
    fireEvent.click(off);
    expect(off.checked).toBe(false);
    expect(radios().filter((r) => r.checked)).toHaveLength(1);
    // Panel: tersedia dulu lalu nonaktif.
    const names = Array.from(document.getElementById("pay-group-va")!.querySelectorAll("label")).map((l) => norm(l.textContent));
    expect(names[0]).toContain("BCA"); expect(names[1]).toContain("BRI");
    // Tidak bisa dikirim: pilihan tetap QRIS.
    fillAndAgree();
    await act(async () => { fireEvent.click(payButton()); });
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].payment_method).toBe("qris");
  });

  it("min / min+1 / max tersedia (hanya 'Biaya'); max+1 nonaktif 'Maks. Rp …' dengan alasan server sr-only dan tanpa baris shortfall", async () => {
    stub({ quotes: [{ methods: [qrisM, gw("AT_MIN", "At Min", 4000, 254_000, 250_000, limits(250_000)), gw("MIN1", "Min Plus", 4000, 254_000, 250_000, limits(249_999)), gw("AT_MAX", "At Max", 4000, 254_000, 250_000, { limits: { min: 100, max: 250_000 } }),
      gwOff("OVER", "Over Max", { unavailable_reason: "above_max", shortfall: undefined, limits: { min: 100, max: 249_999 } })] }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(headers().length).toBe(1));
    fireEvent.click(header(/^Virtual Account/));
    for (const name of [/At Min/, /Min Plus/, /At Max/]) { expect(radio(name).disabled).toBe(false); }
    expect(norm(radio(/At Min/).closest("label")!.textContent)).toBe("AMAt MinBiaya Rp 4.000"); // "AM" = monogram netral (aria-hidden) // batas min hanya tampil untuk baris nonaktif
    expect(norm(radio(/At Max/).closest("label")!.textContent)).toBe("AMAt MaxBiaya Rp 4.000");
    const over = radio(/Over Max/);
    expect(over.disabled).toBe(true);
    expect(norm(over.closest("label")!.textContent)).toContain("Maks. Rp 249.999");
    expect(norm(document.getElementById(over.getAttribute("aria-describedby")!)?.textContent)).toBe("Melebihi maks. Rp 249.999");
    expect(norm(document.body.textContent)).not.toMatch(/Tambah Rp .* untuk metode ini/);
  });

  it("semua metode grup nonaktif: header 'Belum tersedia untuk nominal ini', grup tetap bisa dibuka (logo + batas), tidak ada radio yang bisa dicek", async () => {
    stub({ quotes: [{ methods: [qrisM, gwOff("O1", "BRI VA"), gwOff("O2", "Mandiri VA")] }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(headers().length).toBe(1));
    const h = header(/^Virtual Account/);
    expect(h.getAttribute("aria-label")).toBe("Virtual Account, 2 metode, Tidak tersedia untuk total ini");
    expect(norm(h.textContent)).toContain("Belum tersedia untuk nominal ini"); // keterangan header tanpa kanal tersedia
    expect(h.querySelectorAll("[data-bank-tile]")).toHaveLength(2);
    fireEvent.click(h);
    expect(h.getAttribute("aria-expanded")).toBe("true");
    const group = Array.from(document.getElementById("pay-group-va")!.querySelectorAll<HTMLInputElement>("input[type=radio]"));
    expect(group).toHaveLength(2);
    for (const r of group) { expect(r.disabled).toBe(true); fireEvent.click(r); expect(r.checked).toBe(false); }
    expect(radio(/QRIS/).checked).toBe(true);
  });

  it("pilihan VA lalu quote baru membuatnya nonaktif: pilihan pindah ke QRIS + satu pemberitahuan sampai pembeli memilih lagi; satu radio terpilih; CTA QRIS", async () => {
    stub({ quotes: [
      { methods: [qrisM, gw("VA_OK", "BCA Virtual Account", 4000, 254_000, 250_000, limits(10_000))] },
      { methods: [qrisM, gwOff("VA_OK", "BCA Virtual Account", { limits: { min: 252_500, max: 10_000_000 }, shortfall: 2_500 }), gw("EW_OK", "OVO", 2500, 252_500, 250_000, { group: "ewallet" })] },
    ] });
    render(<CheckoutPage />);
    await waitFor(() => expect(headers().length).toBe(1));
    fireEvent.click(radio(/^BCA/));
    expect(radio(/^BCA/).checked).toBe(true);
    expect(norm(payButton().textContent)).toBe("Buat Pesanan — estimasi Rp 254.000");
    useCart.setState({ items: [{ ...cartLine(), qty: 2 }] });
    await waitFor(() => expect(radio(/^BCA/).disabled).toBe(true));
    expect(radio(/QRIS/).checked).toBe(true);
    expect(radios().filter((r) => r.checked)).toHaveLength(1);
    expect(norm(document.body.textContent)).toContain("BCA Virtual Account tidak tersedia untuk total ini — dipilih QRIS.");
    expect(norm(payButton().textContent)).toMatch(/^Bayar Rp .* — Buat Pesanan$/);
    expect(norm(document.body.textContent)).not.toContain("tidak tersedia lagi. Metode diganti");
    fireEvent.click(radio(/OVO/)); // pilihan pembeli berikutnya menghapus pemberitahuan
    expect(norm(document.body.textContent)).not.toContain("dipilih QRIS.");
  });
});


describe("checkout: picker dari quote", () => {
  it("tiga jenis: QRIS default + badge persis 'Paling cepat' (satu-satunya), tanpa Maintenance/upload, hanya opsi server", async () => {
    stub({ quotes: [{ methods: [qrisM, { id: "ewallet", kind: "qris", label: "DANA", account_number: "0" }, gw("BCA_VA", "BCA Virtual Account", 4000, 254_000), gw("OVO", "OVO", 2500, 252_500), cryptoM] }] });
    render(<CheckoutPage />);
    await waitFor(() => {
      expect(radios()).toHaveLength(4);
      expect(radio(/QRIS/).checked).toBe(true);
      expect(radios().filter((r) => r.checked)).toEqual([radio(/QRIS/)]);
    });
    const body = norm(document.body.textContent);
    expect(body.match(/Paling cepat/g)).toHaveLength(1);
    expect(body).not.toMatch(/Paling Cepat|Maintenance|E-WALLET|TRANSFER BANK|upload bukti|DANA/);
    expect(new Set(radios().map((r) => r.name))).toEqual(new Set(["checkout-pay"]));
    expect(radios().every((r) => r.className.includes("sr-only") && r.closest("label")!.className.includes("has-[:focus-visible]"))).toBe(true);
    expect(body).toContain("Virtual Account");
    expect(body).toContain("Crypto");
    expect(body).toContain("USDT");
    expect(body).toContain("USDT BNB Smart Chain");
    expect(norm(payButton().textContent)).toBe("Bayar Rp 250.000 — Buat Pesanan");
  });

  it("memilih gateway: biaya estimasi + estimasi total dari server di rail, mobile, dan CTA; submit membawa ID quote + token", async () => {
    const { posts } = stub({ quotes: [{ methods: [qrisM, gw("BCA_VA", "BCA Virtual Account", 4000, 254_000), cryptoM] }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(radios().length).toBe(3));
    fireEvent.click(radio(/^BCA/));
    expect(radio(/^BCA/).checked).toBe(true);
    const text = railText();
    expect(text).toContain("SubtotalRp 250.000");
    expect(text).toContain("Biaya BCA Virtual AccountRp 4.000"); // tanpa "+" dan tanpa "(estimasi)"
    expect(text).toContain("TotalRp 254.000");
    expect(text).toContain("Total akhir disetujui di halaman pesanan."); // satu baris muted
    expect(text).not.toMatch(/Estimasi total|\+Rp 4\.000/);
    expect(text.indexOf("Subtotal")).toBeLessThan(text.indexOf("Biaya BCA"));
    expect(text.indexOf("Biaya BCA")).toBeLessThan(text.indexOf("TotalRp 254.000"));
    expect(text).not.toMatch(/Rp 258\.000/); // biaya tidak ditambahkan dua kali
    expect(norm(payButton().textContent)).toBe("Buat Pesanan — estimasi Rp 254.000");
    fillAndAgree();
    await act(async () => { fireEvent.click(payButton()); });
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ payment_method: "sekalipay_gateway:BCA_VA", quote_token: "quote-token-fixture-123456", proof_url: null });
    expect(Object.keys(posts[0]).sort()).toEqual(["customer_email", "customer_name", "customer_wa", "items", "payment_method", "proof_url", "quote_token"]);
    await waitFor(() => expect(nav.push).toHaveBeenCalled());
    expect(String(nav.push.mock.calls[0][0])).toContain("/pesanan/AXV-20261104-AAAAAAAA");
  });

  it("memilih crypto: total USD persis teks server + kurs + peringatan biaya tidak diketahui (bukan nol) + gas pengirim; tanpa FX klien", async () => {
    const { posts } = stub({ quotes: [{ methods: [qrisM, cryptoM] }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(radios().length).toBe(2));
    expect(norm(document.body.textContent)).not.toContain("bukan nol"); // paragraf panjang dihapus
    fireEvent.click(header(/^Crypto/));
    fireEvent.click(radio(/USDT/));
    const text = railText();
    // Revisi owner 6 Nov: ringkasan crypto hanya Subtotal + Biaya layanan + Total (tanpa baris kurs/gas).
    expect(text).toContain("SubtotalUS$15,63");
    expect(text).toContain("Biaya layanan 1,5%US$0,24");
    expect(text).toContain("Total dalam USDUS$15,87");
    expect(text).not.toContain("Biaya jaringan dibayar dari wallet pengirim");
    expect(text).not.toContain("kurs Rp");
    expect(document.querySelector('aside [data-testid="crypto-gas-note"]')).toBeNull();
    expect(norm(payButton().textContent)).toBe("Buat Pesanan — US$15,87");
    fillAndAgree();
    await act(async () => { fireEvent.click(payButton()); });
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ payment_method: "nowpayments:usdtbsc" });
    expect(JSON.stringify(posts[0])).not.toMatch(/15\.(63|87)|pay_currency|"network"|rate_|amount_text|"usd"/);
  });

  describe("banyak koin crypto (fungsional: render, pilih, nonaktif dengan minimum, total mengikuti koin)", () => {
    const many = () => [
      qrisM,
      coinM("btc", "BTC", "Bitcoin", "btc", "popular"), coinM("eth", "ETH", "Ethereum", "eth", "popular"),
      coinM("usdtbsc", "USDT", "BNB Smart Chain", "bsc", "stable"), coinM("usdttrc20", "USDT", "Tron (TRC20)", "trx", "stable", { amount_text: "15.87" }),
      coinOff("ton", "TON", "TON", "ton", "popular", "2.25", 36_000), coinOff("usdcsol", "USDC", "Solana", "sol", "stable", "2.30", 37_000),
    ];

    // Baris per SIMBOL: BTC/ETH/TON/USDC = satu jaringan (radio langsung); USDT punya 2 jaringan (tombol -> pilihan jaringan eksplisit).
    const expandSymbol = (symbol: string) => fireEvent.click(screen.getAllByRole("button").find((b) => b.getAttribute("aria-expanded") !== null && new RegExp(`^${symbol}\\b`).test(norm(b.textContent)))!);
    it("baris per simbol: simbol satu jaringan = radio, multi-jaringan = tombol; yang di bawah minimum nonaktif dengan 'Min.' dari server tanpa jumlah", async () => {
      stub({ quotes: [{ methods: many() }] });
      render(<CheckoutPage />);
      await waitFor(() => expect(headers().length).toBe(1));
      fireEvent.click(header(/^Crypto/));
      const coinRadios = radios().filter((r) => r.value.startsWith("nowpayments:"));
      const visibleCoins = () => visibleRadios().filter((r) => r.value.startsWith("nowpayments:")).map((r) => r.value);
      expect(visibleCoins()).toEqual(["nowpayments:btc", "nowpayments:eth", "nowpayments:ton", "nowpayments:usdcsol"]); // jaringan USDT baru terlihat/terfokus setelah simbol dibuka
      expandSymbol("USDT");
      expect(visibleCoins()).toEqual(["nowpayments:btc", "nowpayments:eth", "nowpayments:ton", "nowpayments:usdtbsc", "nowpayments:usdttrc20", "nowpayments:usdcsol"]);
      const ton = radio(/TON/);
      expect(ton.disabled).toBe(true);
      const tonCard = norm(ton.closest("label")!.textContent);
      expect(tonCard).toContain("Min. US$2,25");
      expect(tonCard).toContain("Belanja minimal US$2,25 (± Rp 36.000) untuk koin ini");
      expect(tonCard).not.toMatch(/US\$15|Termasuk biaya layanan/);
      expect(norm(radio(/USDC/).closest("label")!.textContent)).toContain("Min. US$2,30");
      for (const r of radios().filter((c) => /:(btc|eth|usdtbsc|usdttrc20)$/.test(c.value))) expect(r.disabled).toBe(false);
      // chip header dibatasi 6 + sisa; header menyebut jumlah metode
      expect(header(/^Crypto/).getAttribute("aria-label")).toBe("Crypto, 6 metode");
    });

    it("koin nonaktif tidak bisa dipilih lewat klik maupun keyboard; koin tersedia memilih dan CTA/total mengikuti total koin", async () => {
      const { posts } = stub({ quotes: [{ methods: many() }] });
      render(<CheckoutPage />);
      await waitFor(() => expect(headers().length).toBe(1));
      fireEvent.click(header(/^Crypto/));
      fireEvent.click(radio(/TON/));
      fireEvent.keyDown(radio(/TON/), { key: " " });
      expect(radio(/TON/).checked).toBe(false);
      expect(radio(/QRIS/).checked).toBe(true); // pilihan QRIS tidak berubah
      expandSymbol("USDT");
      expect(radios().filter((r) => r.checked).map((r) => r.value)).toEqual(["qris"]); // jaringan tidak dipilih otomatis
      fireEvent.click(radio(/Tron \(TRC20\)/));
      expect(radio(/Tron \(TRC20\)/).checked).toBe(true);
      expect(norm(payButton().textContent)).toBe("Buat Pesanan — US$15,87");
      expect(railText()).toContain("Total dalam USDUS$15,87");
      fillAndAgree();
      await act(async () => { fireEvent.click(payButton()); });
      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0]).toMatchObject({ payment_method: "nowpayments:usdttrc20" });
    });

    it("menutup grup crypto menghapus pilihan koin (kembali ke QRIS tidak otomatis)", async () => {
      stub({ quotes: [{ methods: many() }] });
      render(<CheckoutPage />);
      await waitFor(() => expect(headers().length).toBe(1));
      fireEvent.click(header(/^Crypto/));
      fireEvent.click(radio(/BTC/));
      expect(radio(/BTC/).checked).toBe(true);
      fireEvent.click(header(/^Crypto/)); // tutup grup yang memuat pilihan
      expect(radios().filter((r) => r.checked)).toHaveLength(0);
      expect(payButton().disabled).toBe(true);
    });
  });

  it("quote berubah: pilihan valid dipertahankan berdasarkan ID; hilang -> QRIS eksplisit + pemberitahuan", async () => {
    stub({ quotes: [
      { methods: [qrisM, gw("BCA_VA", "BCA Virtual Account", 4000, 254_000)] },
      { methods: [qrisM, gw("BCA_VA", "BCA Virtual Account", 4500, 254_500)], extra: {} },
      { methods: [qrisM] },
    ] });
    render(<CheckoutPage />);
    await waitFor(() => expect(radios().length).toBe(2));
    fireEvent.click(radio(/^BCA/));
    useCart.setState({ items: [{ ...cartLine(), qty: 2 }] });
    await waitFor(() => expect(railText()).toContain("Rp 4.500"));
    expect(radio(/^BCA/).checked).toBe(true);
    useCart.setState({ items: [{ ...cartLine(), qty: 3 }] });
    await waitFor(() => expect(radios().length).toBe(1));
    expect(radio(/QRIS/).checked).toBe(true);
    expect(norm(document.body.textContent)).toContain("BCA Virtual Account tidak tersedia lagi. Metode diganti ke QRIS.");
  });

  it("tanpa QRIS: tidak ada pilihan otomatis berbiaya, CTA nonaktif sampai pembeli memilih", async () => {
    stub({ quotes: [{ methods: [gw("BCA_VA", "BCA Virtual Account", 4000, 254_000)] }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(radios().length).toBe(1));
    expect(radios()[0].checked).toBe(false);
    expect(payButton().disabled).toBe(true);
    fireEvent.click(radios()[0]);
    await waitFor(() => expect(payButton().disabled).toBe(false));
  });

  it("opsi tidak tersedia disabled dengan alasan; QRIS tetap bekerja bila gateway/crypto tidak ada", async () => {
    stub({ quotes: [{ methods: [qrisM, { ...gw("OVO", "OVO", 2500, 252_500), available: false }] }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(radios().length).toBe(2));
    const ovo = radio(/OVO/);
    expect(ovo.disabled).toBe(true);
    expect(document.getElementById(ovo.getAttribute("aria-describedby")!)?.textContent).toBe("Sedang tidak tersedia");
    expect(radio(/QRIS/).checked).toBe(true);
    expect(payButton().disabled).toBe(false);
  });

  it("submit ambigu (timeout): metode dikunci dan pemilihan tetap; terbuka lagi setelah quote baru", async () => {
    stub({ quotes: [{ methods: [qrisM, gw("BCA_VA", "BCA Virtual Account", 4000, 254_000)] }], order: "timeout" });
    render(<CheckoutPage />);
    await waitFor(() => expect(radios().length).toBe(2));
    fireEvent.click(radio(/^BCA/));
    fillAndAgree();
    await act(async () => { fireEvent.click(payButton()); });
    await waitFor(() => expect(radios().every((r) => r.disabled)).toBe(true));
    expect(radio(/^BCA/).checked).toBe(true);
    expect(norm(document.body.textContent)).toContain("Metode dikunci karena pesanan mungkin sudah dibuat");
  });

  it("locale dari displayPreferences: badge 'Fastest' dan salinan EN; format Rp tetap", async () => {
    stub({ quotes: [{ methods: [qrisM, gw("BCA_VA", "BCA Virtual Account", 4000, 254_000)], extra: { displayPreferences: { locale: "en", usdAvailable: true } } }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(radios().length).toBe(2));
    const body = norm(document.body.textContent);
    expect(body).toContain("Fastest");
    expect(body).not.toContain("Paling cepat");
    expect(body).toContain("Fees from Rp 4,000");
    expect(body).not.toMatch(/Est\. fee|est\. total/);
  });

  it("tidak ada opsi sama sekali / error quote jujur: pesan, tanpa metode palsu", async () => {
    stub({ quotes: [{ methods: [] }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(norm(document.body.textContent)).toContain("Pembayaran belum tersedia saat ini"));
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(payButton().disabled).toBe(true);
    cleanup();
    stub({ quotes: [{ methods: [], status: 500, body: { error: "Harga gagal dimuat" } }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(norm(document.body.textContent)).toContain("Harga gagal dimuat"));
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("baseline: QRIS-only mengirim payment_method=qris; expected_price base dan ringkasan grosir tetap (tidak ada tambahan metode)", async () => {
    const { posts } = stub({ quotes: [{ methods: [qrisM] }] });
    render(<CheckoutPage />);
    await waitFor(() => expect(radios().length).toBe(1));
    expect(norm(payButton().textContent)).toBe("Bayar Rp 250.000 — Buat Pesanan");
    fillAndAgree();
    await act(async () => { fireEvent.click(payButton()); });
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].payment_method).toBe("qris");
    const dialog = within(document.body);
    expect(dialog.queryByText("Perubahan Harga / Stok")).toBeNull();
  });
});
