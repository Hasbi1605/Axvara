// @vitest-environment jsdom
// Halaman /pesanan/[code]: panel gateway/crypto dari `order.payment` (tampilan
// aman server). Detail hanya pada tahap yang mengizinkan; persetujuan total
// akhir memakai kontak checkout + total yang ditampilkan lewat rute yang ada.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Fixture pesanan async; beri ruang bila mesin sedang sibuk (tidak mengubah asersi).
configure({ asyncUtilTimeout: 4000 });
import OrderPage from "@/app/(shop)/pesanan/[code]/page";
import { checkoutContactKey } from "@/components/storefront/WrCredentialsPanel";

const CODE = "AXV-20261104-ABCD1234";
vi.mock("next/navigation", () => ({ useParams: () => ({ code: CODE }) }));

const future = () => new Date(Date.now() + 14 * 60_000).toISOString();
const norm = (t: string | null | undefined) => String(t ?? "").replace(/\s/g, " ");
const gwView = (o: Record<string, unknown> = {}) => ({ provider: "sekalipay_gateway", kind: "gateway", label: "BCA Virtual Account", channel: "BCA_VA", state: "fee_consent_required", currency: "IDR", subtotal: 250_000, estimated_fee: 4000, fee: 4500, total: 254_500, fee_consent_required: true, expires_at: future(), payment_link: null, virtual_account: null, checkout_url: null, ...o });
const cryptoView = (o: Record<string, unknown> = {}) => ({ provider: "nowpayments", kind: "crypto", label: "USDT", sublabel: "BNB Smart Chain", symbol: "USDT", network_label: "BNB Smart Chain", logo: "/payments/coins/usdtbsc.svg", state: "pending", currency: "USD", amount_text: "15.87", base_amount_text: "15.63", surcharge_amount_text: "0.24", surcharge_bps: 150, crypto_amount_text: "15.634512 USDT", pay_amount_text: "15.634512", pay_currency: "usdtbsc", network: "bsc", pay_address: "0x1234567890abcdef1234567890abcdef12345678", expires_at: future(), payment_url: null, fee_payer: "merchant", fixed_rate: false, sender_gas_extra: true, ...o });
function orderBody(payment: unknown, extra: Record<string, unknown> = {}) {
  return { order: { code: CODE, customer_name: "Hasbi", customer_wa: "0812****7890", customer_email: "b***@example.com", items: [{ name: "GPT Plus", price: 250_000, qty: 1 }], subtotal: 250_000, payment_method: "sekalipay_gateway:BCA_VA", status: "pending", locale: "id", expires_at: future(), buyer_pin_required: true, credentials_ready: false, qris_reissue_allowed: false, qris: null, ...(payment ? { payment } : {}), ...extra } };
}
type Handler = { gets: Array<unknown>; cancel?: { status: number; body: unknown }; consent?: (body: Record<string, unknown>) => { status: number; body: unknown } };
function stub(h: Handler) {
  let n = 0;
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (u.startsWith("/api/orders?code=")) return json(200, h.gets[Math.min(n++, h.gets.length - 1)]);
    if (u.endsWith("/cancel") && h.cancel) return json(h.cancel.status, h.cancel.body);
    if (u.endsWith("/payment-consent")) { const r = h.consent!(calls.at(-1)!.body!); return json(r.status, r.body); }
    return json(200, {});
  }));
  return calls;
}
const text = () => norm(document.body.textContent);
// Tautan bantuan (WA/Telegram) yang sudah ada juga target=_blank; hanya tautan di dalam panel pembayaran yang dihitung.
const anchors = () => Array.from(document.querySelectorAll("section a[target=_blank]"));
const consentPosts = (calls: Array<{ url: string; method: string; body?: Record<string, unknown> }>) => calls.filter((c) => c.method === "POST" && c.url.endsWith("/payment-consent"));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("gateway: persetujuan total akhir", () => {
  it("consent: total akhir + biaya persis dari server, tanpa tautan/VA di DOM; kontak diminta; kosong tidak mengirim", async () => {
    const calls = stub({ gets: [orderBody(gwView({ payment_link: "https://pay.example/leak", virtual_account: "8888LEAK", checkout_url: "https://pay.example/c" }))], consent: () => ({ status: 200, body: { ok: true } }) });
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Setujui Total Pembayaran" });
    expect(text()).toContain("TotalRp 254.500");
    expect(text()).toContain("Biaya BCA Virtual AccountRp 4.500");
    expect(text()).toContain("SubtotalRp 250.000");
    expect(text()).not.toContain("Rp 259.000"); // total tidak digabung biaya lagi
    expect(anchors()).toHaveLength(0);
    expect(text()).not.toMatch(/8888LEAK|pay\.example|Nomor virtual account/);
    expect(text()).not.toContain("Total akhir sudah termasuk biaya pembayaran"); // intro panel ganda dihapus; subjudul halaman tetap
    expect(text()).not.toContain("BCA_VA"); // kode kanal mentah bukan nilai baris
    expect(screen.getByLabelText(/No\. WA atau email checkout/)).toBeTruthy();
    expect(text()).not.toMatch(/Admin akan memverifikasi bukti|bukti pembayaran/i);
    fireEvent.click(screen.getByRole("button", { name: /Setujui Rp\s254\.500/ }));
    expect(await screen.findByText(/Isi No\. WA atau email checkout yang dipakai/)).toBeTruthy();
    expect(consentPosts(calls)).toHaveLength(0);
  });

  it("kontak + total yang ditampilkan dikirim ke rute consent yang ada; sukses -> baca ulang -> tautan https target _blank noopener noreferrer + VA + salin", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const calls = stub({
      gets: [orderBody(gwView()), orderBody(gwView({ state: "pending", fee_consent_required: false, payment_link: "https://pay.example/x", virtual_account: "8888123456", checkout_url: null }))],
      consent: () => ({ status: 200, body: { ok: true } }),
    });
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Setujui Total Pembayaran" });
    fireEvent.change(screen.getByLabelText(/No\. WA atau email checkout/), { target: { value: "081234567890" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Setujui Rp\s254\.500/ })); });
    const post = consentPosts(calls)[0];
    expect(post.url).toBe(`/api/orders/${CODE}/payment-consent`);
    expect(post.body).toEqual({ contact: "081234567890", expected_final_total: 254_500 });
    expect(post.url).not.toContain("0812");
    await screen.findByRole("heading", { name: "Selesaikan Pembayaran" });
    const link = anchors()[0] as HTMLAnchorElement;
    expect(link.href).toBe("https://pay.example/x");
    expect(link.rel).toMatch(/noopener/);
    expect(link.rel).toMatch(/noreferrer/);
    expect(text()).toContain("8888123456");
    expect(text()).toContain("Total bayarRp 254.500");
    fireEvent.click(screen.getByRole("button", { name: "Salin" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("8888123456"));
    expect((await screen.findAllByRole("status")).some((el) => el.textContent === "Tersalin")).toBe(true);
    expect(text()).toContain("Metode pembayaran tidak bisa diganti untuk pesanan ini");
  });

  it("kontak checkout tersimpan dipakai; tidak ada input kontak dan tidak ada kontak di URL/query", async () => {
    sessionStorage.setItem(checkoutContactKey(CODE), "081234567890");
    const calls = stub({ gets: [orderBody(gwView()), orderBody(gwView({ state: "pending", payment_link: "https://pay.example/x" }))], consent: () => ({ status: 200, body: { ok: true } }) });
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Setujui Total Pembayaran" });
    expect(screen.queryByLabelText(/No\. WA atau email checkout/)).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Setujui Rp\s254\.500/ })); });
    expect(consentPosts(calls)[0].body).toEqual({ contact: "081234567890", expected_final_total: 254_500 });
    expect(calls.every((c) => !c.url.includes("0812") && !c.url.includes("contact"))).toBe(true);
  });

  it("409 stale: baca ulang dan tampilkan TOTAL baru tanpa persetujuan otomatis; dua klik cepat = satu POST", async () => {
    const calls = stub({ gets: [orderBody(gwView()), orderBody(gwView({ fee: 5000, total: 255_000 }))], consent: () => ({ status: 409, body: { error: "Persetujuan tidak tersedia" } }) });
    sessionStorage.setItem(checkoutContactKey(CODE), "081234567890");
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Setujui Total Pembayaran" });
    await act(async () => { const b = screen.getByRole("button", { name: /Setujui Rp\s254\.500/ }); fireEvent.click(b); fireEvent.click(b); });
    await screen.findByRole("button", { name: /Setujui Rp\s255\.000/ });
    expect(text()).toContain("Total berubah atau persetujuan tidak tersedia");
    expect(text()).toContain("TotalRp 255.000");
    expect(consentPosts(calls)).toHaveLength(1);
    expect(anchors()).toHaveLength(0);
  });

  it("paid-before-consent / review: tanpa tombol, tautan, VA atau pembatalan walau payload membawa kolomnya", async () => {
    stub({ gets: [orderBody(gwView({ state: "manual_review", payment_link: "https://pay.example/x", virtual_account: "8888REVIEW" }))] });
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Pembayaran Sedang Diperiksa" });
    expect(anchors()).toHaveLength(0);
    expect(text()).not.toMatch(/8888REVIEW|Setujui|Salin|Batalkan Pesanan/);
    expect(text()).toContain("Diperiksa manual");
  });

  it("tautan non-https ditolak; pending tanpa tautan/VA memperingatkan jangan bayar", async () => {
    stub({ gets: [orderBody(gwView({ state: "pending", payment_link: "http://evil.example", checkout_url: "javascript:alert(1)", virtual_account: null }))] });
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Selesaikan Pembayaran" });
    expect(anchors()).toHaveLength(0);
    expect(text()).toContain("Tautan pembayaran belum tersedia. Jangan bayar sebelum tautan muncul.");
  });

  it("expired: tanpa tautan/VA, tanpa pembatalan; teks buat pesanan baru", async () => {
    stub({ gets: [orderBody(gwView({ state: "expired", payment_link: "https://pay.example/x", virtual_account: "8888OLD" }))] });
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Pesanan Kedaluwarsa" });
    expect(text()).toContain("Jangan lanjutkan pembayaran di halaman lama");
    expect(anchors()).toHaveLength(0);
    expect(text()).not.toMatch(/8888OLD|Batalkan Pesanan/);
  });

  it("ringkasan memakai label server dan total final, bukan id mentah huruf besar", async () => {
    stub({ gets: [orderBody(gwView())] });
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Setujui Total Pembayaran" });
    expect(text()).toContain("Total • BCA Virtual Account");
    expect(text()).not.toContain("SEKALIPAY_GATEWAY");
  });
});

describe("expires_at SQL UTC tanpa offset pada browser Asia/Jakarta (pesanan gateway)", () => {
  // API gateway menyimpan expires_at sebagai SQL UTC "YYYY-MM-DD HH:MM:SS" (tanpa T/Z). Date.parse mentah menafsirkannya sebagai WAKTU LOKAL browser,
  // sehingga di WIB (UTC+7) pesanan baru langsung tampak 7 jam kedaluwarsa. Halaman wajib memakai parser UTC kanonis (src/lib/expiry.ts).
  const sqlUtc = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace("T", " ");
  const originalTz = process.env.TZ;
  beforeEach(() => { process.env.TZ = "Asia/Jakarta"; });
  afterEach(() => { if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz; });

  const render_ = async (expires: string | undefined, payment: Record<string, unknown> | null = gwView(), extra: Record<string, unknown> = {}) => {
    stub({ gets: [orderBody(payment, { expires_at: expires, ...extra })] });
    render(<OrderPage />);
  };

  it("lingkungan uji benar-benar WIB: string tanpa offset ditafsirkan lokal 7 jam lebih awal dari UTC (jebakan yang harus dihindari)", () => {
    const naive = Date.parse("2026-11-05 02:05:42"); // tafsir lokal (WIB)
    const utc = Date.parse("2026-11-05T02:05:42Z");
    expect(utc - naive).toBe(7 * 3_600_000);
    expect(new Date(naive).getTimezoneOffset()).toBe(-420);
  });

  it("SQL UTC di masa depan: halaman persetujuan hidup dan detail tetap tersembunyi", async () => {
    const expires = sqlUtc(14 * 60_000);
    expect(Date.parse(expires)).toBeLessThan(Date.now()); // old browser-local parsing would mark it expired
    await render_(expires, gwView({ expires_at: future(), payment_link: "https://sekalipay.com/pay/LEAK", virtual_account: "8888LEAK" }));
    await screen.findByRole("heading", { name: "Setujui Total Pembayaran" });
    expect(text()).not.toMatch(/Pesanan Kedaluwarsa|Kedaluwarsa/);
    expect(screen.getByRole("button", { name: /Setujui Rp\s254\.500/ })).toBeTruthy();
    expect(text()).not.toMatch(/LEAK|8888LEAK/);
    expect(text()).not.toContain("NaN");
  });

  it("countdown QRIS menafsirkan SQL UTC sebagai waktu UTC di WIB", async () => {
    const expires = sqlUtc(14 * 60_000);
    await render_(future(), null, { payment_method: "qris", qris: { payable_amount: 250000, qris_url: "https://example.test/qris.png", expires_at: expires } });
    await screen.findByRole("heading", { name: "Pembayaran QRIS" });
    expect(text()).toMatch(/Berlaku 1[34]:\d{2}/);
  });

  it("SQL UTC sudah lewat: kedaluwarsa dan tombol/tautan/VA tidak tampil (gating tidak berubah); UTC yang baru lewat 1 detik tetap kedaluwarsa", async () => {
    await render_(sqlUtc(-1_000), gwView({ state: "pending", fee_consent_required: false, payment_link: "https://sekalipay.com/pay/LEAK", virtual_account: "8888LEAK" }));
    await screen.findByRole("heading", { name: "Pesanan Kedaluwarsa" });
    expect(text()).not.toMatch(/LEAK|Setujui Rp|Buka halaman pembayaran|Salin/);
    expect(screen.queryByRole("button", { name: /Setujui Rp/ })).toBeNull();
  });

  it("ISO Z dan offset eksplisit (+07:00 / -05:00) di masa depan tetap hidup; offset yang sudah lewat kedaluwarsa", async () => {
    const plus7 = (ms: number) => { const d = new Date(Date.now() + ms + 7 * 3_600_000).toISOString().slice(0, 19); return `${d}+07:00`; };
    const minus5 = (ms: number) => { const d = new Date(Date.now() + ms - 5 * 3_600_000).toISOString().slice(0, 19); return `${d}-05:00`; };
    for (const expires of [future(), plus7(14 * 60_000), minus5(14 * 60_000)]) {
      await render_(expires);
      await screen.findByRole("heading", { name: "Setujui Total Pembayaran" });
      cleanup();
    }
    await render_(plus7(-60_000));
    await screen.findByRole("heading", { name: "Pesanan Kedaluwarsa" });
  });

  it("tanggal tidak valid/kosong: gagal tertutup tanpa detail atau consent", async () => {
    for (const expires of ["bukan-tanggal", undefined, ""]) {
      await render_(expires, gwView({ payment_link: "https://sekalipay.com/pay/LEAK", virtual_account: "8888LEAK" }));
      await screen.findByRole("heading", { name: "Pesanan Kedaluwarsa" });
      expect(text()).not.toContain("NaN");
      expect(screen.queryByRole("button", { name: /Setujui Rp/ })).toBeNull();
      expect(text()).not.toMatch(/LEAK|8888LEAK/);
      cleanup();
    }
  });

  it("dibatalkan dan kadaluarsa asli (status) tetap menutup tanpa melihat expires_at; QRIS dan crypto ISO tidak terpengaruh", async () => {
    await render_(sqlUtc(14 * 60_000), gwView(), { status: "kadaluarsa" });
    await screen.findByRole("heading", { name: "Pesanan Kedaluwarsa" });
    cleanup();
    await render_(sqlUtc(14 * 60_000), gwView({ payment_link: "https://sekalipay.com/pay/LEAK", virtual_account: "8888LEAK" }), { status: "dibatalkan" });
    await screen.findByRole("heading", { name: "Pesanan Dibatalkan" });
    expect(text()).not.toMatch(/LEAK|8888LEAK|Setujui Rp/);
    cleanup();
    await render_(future(), cryptoView(), { payment_method: "nowpayments:usdtbsc" });
    await screen.findByRole("heading", { name: "Selesaikan Pembayaran Crypto" });
    expect(text()).not.toMatch(/Kedaluwarsa/);
  });
});

describe("chrome ringkasan/footer mengikuti locale pesanan", () => {
  it("pesanan EN: ringkasan, total, tautan, bantuan dan catatan kaki berbahasa Inggris; pesanan ID tetap Indonesia; preferensi global tidak dipakai", async () => {
    document.cookie = "axv_locale=id; Path=/";
    stub({ gets: [orderBody(cryptoView(), { locale: "en", payment_method: "nowpayments:usdtbsc" })] });
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Complete Crypto Payment" });
    const en = text();
    for (const label of ["Summary", "Order total", "Track Status", "Continue Shopping", "Need help?", "Third-party AXVARA product", "warranty terms"]) expect(en, label).toContain(label);
    expect(en).not.toMatch(/Ringkasan|Total pesanan|Lacak Status|Lanjut Belanja|Butuh bantuan|ketentuan garansi/);
    cleanup();
    stub({ gets: [orderBody(cryptoView(), { locale: "id", payment_method: "nowpayments:usdtbsc" })] });
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Selesaikan Pembayaran Crypto" });
    for (const label of ["Ringkasan", "Total pesanan", "Lacak Status", "Lanjut Belanja", "Butuh bantuan?", "ketentuan garansi"]) expect(text(), label).toContain(label);
    document.cookie = "axv_locale=; Max-Age=0; Path=/";
  });
});

describe("crypto", () => {
  it("pending: nominal TEKS persis (besar/kecil), jaringan, alamat penuh + salin, USD terpisah, catatan estimasi vs final dan biaya tidak diketahui", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    for (const amount of ["98765432.123456789", "0.000000123"]) {
      stub({ gets: [orderBody(cryptoView({ pay_amount_text: amount, crypto_amount_text: `${amount} USDT` }), { payment_method: "nowpayments:usdtbsc" })] });
      render(<OrderPage />);
      await screen.findByRole("heading", { name: "Selesaikan Pembayaran Crypto" });
      expect(screen.getByTestId("crypto-amount").textContent).toBe(`${amount} USDT`);
      expect(screen.getByTestId("crypto-address").textContent).toBe("0x1234567890abcdef1234567890abcdef12345678");
      // rincian: subtotal + biaya layanan crypto 1,5% + total; jaringan = label kurasi server
      expect(text()).toContain("SubtotalUS$15,63");
      expect(text()).toContain("Biaya layanan 1,5%US$0,24");
      expect(text()).toContain("Total (USD)US$15,87");
      expect(text()).toContain("JaringanBNB Smart Chain"); // alamat/nominal yang disalin tidak berubah
      expect(text()).toContain("Kirim tepat"+amount+" USDT"); // label + nominal TEKS persis
      expect(screen.getByTestId("crypto-network").textContent).toBe("JaringanBNB Smart Chain"); // jaringan sebagai nilai berlabel
      expect(screen.getByTestId("crypto-amount").querySelector("span.whitespace-nowrap")!.textContent).toBe("USDT"); // simbol tidak pernah terpotong di tengah kata
      expect(screen.getByTestId("crypto-logo").getAttribute("src")).toBe("/payments/coins/usdtbsc.svg");
      expect(text()).not.toContain("bsc");
      // < sm: blok alamat penuh lalu tombol salin (tidak berhimpitan 4 baris).
      const addressRow = screen.getByTestId("crypto-address").parentElement!.parentElement!;
      expect(addressRow.className).toContain("flex-col");
      expect(addressRow.className).toContain("sm:flex-row");
      expect(screen.getByRole("button", { name: "Salin alamat" }).className).toContain("w-full");
      // Satu baris peringatan amber: hanya koin itu di jaringan itu yang diterima; baris gas/kurang-bayar lama dihapus.
      expect(text()).toContain(`Hanya USDT di jaringan BNB Smart Chain yang diterima. Koin atau jaringan lain dapat membuat dana hilang.`);
      expect(text()).not.toMatch(/Gas jaringan ditanggung pengirim|diperiksa manual/);
      expect(text()).not.toMatch(/Biaya penyedia/);
      expect(text()).not.toMatch(/angka final dari penyedia|bukan nol|Biaya jaringan \(gas\) dibayar dari wallet|Status diperbarui otomatis/);
      expect(text()).toContain("Metode pembayaran tidak bisa diganti untuk pesanan ini."); // satu baris tetap ada
      expect(Array.from(document.querySelectorAll("section p")).filter((p) => p.className.includes("text-amber-200")).map((p) => p.textContent)).toEqual([`Hanya USDT di jaringan BNB Smart Chain yang diterima. Koin atau jaringan lain dapat membuat dana hilang.`]);
      fireEvent.click(screen.getByRole("button", { name: "Salin nominal" }));
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(amount));
      fireEvent.click(screen.getByRole("button", { name: "Salin alamat" }));
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("0x1234567890abcdef1234567890abcdef12345678"));
      expect((await screen.findAllByRole("status")).some((el) => el.textContent === "Tersalin")).toBe(true);
      expect(text()).not.toMatch(/Admin akan memverifikasi bukti|bukti pembayaran/i);
      expect(screen.getByRole("button", { name: "Batalkan Pesanan Ini" })).toBeTruthy();
      cleanup();
    }
  });

  it("QR alamat tujuan: SVG lokal berlabel, hanya untuk tahap pending (tidak ada di confirming/expired); alamat tetap tersalin tanpa QR", async () => {
    stub({ gets: [orderBody(cryptoView(), { payment_method: "nowpayments:usdtbsc" })] });
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Selesaikan Pembayaran Crypto" });
    const qr = await screen.findByTestId("crypto-qr");
    expect(qr.getAttribute("src")).toMatch(/^data:image\/svg\+xml;utf8,%3Csvg/);
    expect(qr.getAttribute("alt")).toBe("QR alamat tujuan");
    expect(qr.className).toContain("bg-white"); // modul gelap di atas putih agar terbaca pemindai
    cleanup();
    for (const state of ["confirming", "expired"]) {
      stub({ gets: [orderBody(cryptoView({ state }))] });
      render(<OrderPage />);
      await screen.findByRole("heading");
      expect(screen.queryByTestId("crypto-qr"), state).toBeNull();
      cleanup();
    }
  });

  it("batal mandiri mengikuti locale pesanan: EN penuh (tombol, dialog, galat klien + galat server dikenal), ID tetap byte-identik", async () => {
    stub({ gets: [orderBody(cryptoView(), { locale: "en", payment_method: "nowpayments:usdtbsc" })], cancel: { status: 404, body: { error: "Pesanan tidak ditemukan atau kontak tidak cocok." } } });
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Complete Crypto Payment" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel this order" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm order cancellation" });
    const d = within(dialog);
    expect(d.getByText(`Cancel order ${CODE}?`)).toBeTruthy();
    expect(norm(dialog.textContent)).toContain("Stock is released immediately and can be ordered by others.");
    expect(d.getByLabelText("Checkout WhatsApp number or email *")).toBeTruthy();
    expect((d.getByLabelText("Checkout WhatsApp number or email *") as HTMLInputElement).placeholder).toBe("0812… or name@email.com");
    expect(d.getByRole("button", { name: "Back" })).toBeTruthy();
    fireEvent.change(d.getByLabelText("Checkout WhatsApp number or email *"), { target: { value: "" } }); // bisa terisi otomatis dari kontak checkout yang tersimpan
    fireEvent.click(d.getByRole("button", { name: "Yes, cancel" })); // kontak kosong -> galat klien EN
    expect((await d.findByRole("alert")).textContent).toBe("Enter the WhatsApp number or email used at checkout.");
    fireEvent.change(d.getByLabelText("Checkout WhatsApp number or email *"), { target: { value: "081234567890" } });
    fireEvent.click(d.getByRole("button", { name: "Yes, cancel" }));
    expect((await d.findByRole("alert")).textContent).toBe("Order not found or the contact does not match."); // galat server dikenal -> EN
    expect(dialog.textContent).not.toMatch(/Batalkan|Konfirmasi|Kembali|Isi No/);
    cleanup();
    stub({ gets: [orderBody(cryptoView(), { locale: "id", payment_method: "nowpayments:usdtbsc" })], cancel: { status: 404, body: { error: "Pesanan tidak ditemukan atau kontak tidak cocok." } } });
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Selesaikan Pembayaran Crypto" });
    fireEvent.click(screen.getByRole("button", { name: "Batalkan Pesanan Ini" }));
    const idDialog = screen.getByRole("dialog", { name: "Konfirmasi pembatalan pesanan" });
    const di = within(idDialog);
    expect(di.getByText(`Batalkan pesanan ${CODE}?`)).toBeTruthy();
    expect(norm(idDialog.textContent)).toContain("Stok langsung kembali dan bisa dipesan orang lain. Pastikan kamu belum membayar — bila dana sudah masuk, hubungi admin dengan kode pesanan.");
    fireEvent.change(di.getByLabelText("No. WA atau email checkout *"), { target: { value: "" } });
    fireEvent.click(di.getByRole("button", { name: "Ya, Batalkan" }));
    expect((await di.findByRole("alert")).textContent).toBe("Isi No. WA atau email checkout yang dipakai saat memesan.");
    fireEvent.change(di.getByLabelText("No. WA atau email checkout *"), { target: { value: "081234567890" } });
    fireEvent.click(di.getByRole("button", { name: "Ya, Batalkan" }));
    expect((await di.findByRole("alert")).textContent).toBe("Pesanan tidak ditemukan atau kontak tidak cocok."); // pesan server apa adanya
    expect(di.getByRole("button", { name: "Kembali" })).toBeTruthy();
  });

  it("confirming / review / expired / failed / tahap tak dikenal: alamat dan tombol tersembunyi walau payload membawa alamat; tanpa pembatalan untuk confirming & review", async () => {
    const cases: Array<[string, string, boolean]> = [
      ["confirming", "Menunggu Konfirmasi Jaringan", false],
      ["manual_review", "Pembayaran Sedang Diperiksa", false],
      ["weird_state", "Pembayaran Sedang Diperiksa", false],
      ["failed", "Pembayaran Tidak Berhasil", true],
      ["expired", "Pesanan Kedaluwarsa", false],
    ];
    for (const [state, heading, cancelAllowed] of cases) {
      stub({ gets: [orderBody(cryptoView({ state }))] });
      render(<OrderPage />);
      await screen.findByRole("heading", { name: heading });
      expect(screen.queryByTestId("crypto-address"), state).toBeNull();
      expect(text(), state).not.toContain("0x1234567890abcdef");
      expect(screen.queryByRole("button", { name: "Salin alamat" })).toBeNull();
      if (state === "confirming") expect(text().split("Jangan kirim ulang").length - 1).toBe(1); // satu kalimat saja (subjudul halaman)
      if (state === "expired") expect(text()).toContain("Jangan kirim crypto ke alamat lama");
      expect(!!screen.queryByRole("button", { name: /Batalkan Pesanan/ }), `${state} cancel`).toBe(cancelAllowed);
      cleanup();
    }
  });

  it("flag/FX mati atau quote tak ada: halaman memakai tampilan tersimpan saja; tidak ada panggilan quote atau pergantian metode", async () => {
    const calls = stub({ gets: [orderBody(cryptoView())] });
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Selesaikan Pembayaran Crypto" });
    expect(calls.every((c) => c.url.startsWith("/api/orders"))).toBe(true);
    expect(calls.some((c) => c.url.includes("quote"))).toBe(false);
    expect(screen.queryByRole("button", { name: /QRIS/ })).toBeNull();
    expect(text()).toContain("Metode pembayaran tidak bisa diganti untuk pesanan ini");
  });

  it("locale pesanan: EN vs ID, mata uang USD sama dan format angka mengikuti locale (US$15.87 / US$15,87)", async () => {
    stub({ gets: [orderBody(cryptoView(), { locale: "en" })] });
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Complete Crypto Payment" });
    expect(text()).toContain("Send exactly");
    expect(screen.getByRole("button", { name: "Copy address" })).toBeTruthy();
    expect(text()).toContain("Total (USD)US$15.87");
    expect(text()).toContain("Only USDT on the BNB Smart Chain network is accepted. Other coins or networks may lose your funds.");
    expect(screen.getByTestId("crypto-network").textContent).toBe("NetworkBNB Smart Chain");
    expect(text()).toContain("Pay before");
    cleanup();
    stub({ gets: [orderBody(cryptoView(), { locale: "id" })] });
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Selesaikan Pembayaran Crypto" });
    expect(text()).toContain("Total (USD)US$15,87");
    expect(text()).toContain("Total pesanan • USDT");
  });

  it("cek pembayaran memakai pengecekan status yang ada (wake=1), tanpa interval baru", async () => {
    const calls = stub({ gets: [orderBody(cryptoView())] });
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Selesaikan Pembayaran Crypto" });
    const gets = () => calls.filter((c) => c.url.startsWith("/api/orders?code="));
    const before = gets().length;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cek Pembayaran" })); });
    expect(gets().length).toBe(before + 1);
    expect(gets().at(-1)!.url).toContain("wake=1");
  });
});

describe("baseline dan akses", () => {
  it("QRIS tidak berubah: judul QRIS, tanpa panel gateway/crypto", async () => {
    stub({ gets: [orderBody(null, { payment_method: "qris", qris: { payable_amount: 250_123, unique_code: 123, image_url: "/qris.png", expires_at: future(), status: "pending" }, qris_reissue_allowed: false })] });
    render(<OrderPage />);
    await screen.findByText("Pembayaran QRIS");
    expect(text()).toContain("Scan QRIS");
    expect(text()).not.toMatch(/Setujui|Salin alamat|Crypto/);
    expect(text()).toContain("Total • QRIS");
  });

  it("akses ditolak: form kontak yang sudah ada tetap tampil (tanpa panel)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reason: "access_required" }), { status: 404, headers: { "Content-Type": "application/json" } })));
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "Buka pesananmu" });
    expect(screen.queryByTestId("crypto-address")).toBeNull();
  });

  it("gagal memuat: pesan error jujur, tanpa panel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Server sibuk" }), { status: 500, headers: { "Content-Type": "application/json" } })));
    render(<OrderPage />);
    await waitFor(() => expect(text()).toContain("Server sibuk"));
    expect(anchors()).toHaveLength(0);
  });
});
