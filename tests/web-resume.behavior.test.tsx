// @vitest-environment jsdom
// Permukaan "lanjutkan pesanan" (lacak-pesanan, PendingOrderReminder, DeviceOrders)
// untuk rel gateway/crypto: tampilan aman `order.payment`, tanpa asumsi `order.qris`,
// detail tersembunyi di DOM pada tahap review/expired/consent, perilaku QRIS tetap.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";

configure({ asyncUtilTimeout: 4000 });

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/storefront/WrCredentialsPanel", () => ({ WrCredentialsPanel: () => null, checkoutContactKey: (c: string) => `axvara-checkout-contact:${c}` }));
vi.mock("@/components/storefront/StoreWhatsAppLink", () => ({ StoreWhatsAppLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

import { PendingOrderReminder } from "@/components/storefront/PendingOrderReminder";
import { DeviceOrders, deviceOrderStatus } from "@/components/storefront/DeviceOrders";
import LacakClient from "@/app/(shop)/lacak-pesanan/lacak-pesanan-client";

const CODE = "AXV-20261104-RESUME01";
const norm = (t: string | null | undefined) => String(t ?? "").replace(/\s/g, " ");
const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const gw = (o: Record<string, unknown> = {}) => ({ provider: "sekalipay_gateway", kind: "gateway", label: "BCA Virtual Account", channel: "BCA_VA", state: "fee_consent_required", currency: "IDR", subtotal: 250_000, estimated_fee: 4000, fee: 4500, total: 254_500, fee_consent_required: true, expires_at: inMin(10), payment_link: "https://pay.example/LEAK", virtual_account: "8888LEAK", checkout_url: "https://pay.example/c-LEAK", ...o });
const cr = (o: Record<string, unknown> = {}) => ({ provider: "nowpayments", kind: "crypto", label: "USDT", sublabel: "BNB Smart Chain", symbol: "USDT", network_label: "BNB Smart Chain", logo: "/payments/coins/usdtbsc.svg", state: "pending", currency: "USD", amount_text: "15.87", base_amount_text: "15.63", surcharge_amount_text: "0.24", surcharge_bps: 150, crypto_amount_text: "15.634512 USDT", pay_amount_text: "15.634512", pay_currency: "usdtbsc", network: "bsc", pay_address: ADDRESS, expires_at: inMin(10), payment_url: null, fee_payer: "merchant", fixed_rate: false, sender_gas_extra: true, ...o });
const orderOf = (payment: unknown, extra: Record<string, unknown> = {}) => ({ code: CODE, customer_name: "Hasbi", customer_wa: "0812****7890", customer_email: null, items: [{ name: "GPT Plus", price: 250_000, qty: 1 }], subtotal: 250_000, payment_method: "sekalipay_gateway:BCA_VA", status: "pending", locale: "id", created_at: new Date().toISOString(), expires_at: inMin(14), qris: null, qris_reissue_allowed: true, buyer_pin_required: true, credentials_ready: false, ...(payment ? { payment } : {}), ...extra });

function setLocal(extra: Record<string, unknown> = {}, minutesAgo = 2) {
  localStorage.setItem("axvara-orders", JSON.stringify([{ code: CODE, status: "pending", createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(), subtotal: 250_000, method: "sekalipay_gateway:BCA_VA", items: [{ name: "GPT Plus", price: 250_000, qty: 1 }], ...extra }]));
}
const stubOrder = (order: Record<string, unknown>) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ order }) })));

beforeEach(() => { pathname = "/"; localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function mountReminder() { await act(async () => { render(<PendingOrderReminder />); }); await act(async () => { await Promise.resolve(); }); }
const region = () => screen.queryByRole("region", { name: "Pesanan menunggu pembayaran" });

describe("PendingOrderReminder: gateway/crypto", () => {
  it("consent: judul persetujuan total, hitung mundur, CTA ke pesanan SAMA, tanpa QRIS/perpanjang dan tanpa tautan/VA di DOM", async () => {
    setLocal(); stubOrder(orderOf(gw()));
    await mountReminder();
    expect(region()).toBeTruthy();
    const text = norm(region()!.textContent);
    expect(text).toContain("Setujui total pembayaran");
    expect(text).toContain("Setujui total");
    const title = Array.from(region()!.querySelectorAll("span")).find((el) => el.textContent === "Setujui total pembayaran")!;
    expect(title.className).not.toContain("truncate"); // judul tidak dipotong
    const close = screen.getByRole("button", { name: "Tutup pengingat" });
    expect(close.className).toContain("h-11");
    expect(close.className).toContain("w-11");
    expect(text).toMatch(/0[89]:\d\d/);
    expect(text).not.toMatch(/QRIS|Perpanjang|LEAK/);
    const link = document.querySelector(`a[href="/pesanan/${CODE}"]`)!;
    expect(link).toBeTruthy();
    expect(document.querySelector('a[href^="http"]')).toBeNull();
  });

  it("pending gateway + crypto: CTA sadar penyedia; tidak pernah menawarkan QRIS baru meski qris_reissue_allowed true", async () => {
    for (const [view, cta] of [[gw({ state: "pending", fee_consent_required: false }), "Lanjut bayar"], [cr(), "Bayar crypto"]] as const) {
      setLocal(); stubOrder(orderOf(view, { qris_reissue_allowed: true }));
      await mountReminder();
      const text = norm(region()!.textContent);
      expect(text).toContain("Pesanan belum dibayar");
      expect(text).toContain(cta);
      expect(text).not.toMatch(/QRIS|Perpanjang/);
      expect(text).not.toContain(ADDRESS);
      cleanup();
    }
  });

  it("tahap tanpa tindakan (confirming/review/expired/failed/paid): tidak ada pengingat dan salinan lokal tidak diubah", async () => {
    for (const view of [cr({ state: "confirming" }), cr({ state: "manual_review" }), cr({ state: "expired" }), cr({ state: "failed" }), gw({ state: "manual_review" }), gw({ state: "expired" }), gw({ state: "initializing" }), cr({ state: "weird" })]) {
      setLocal(); stubOrder(orderOf(view));
      await mountReminder();
      expect(region(), JSON.stringify((view as { state: string }).state)).toBeNull();
      expect(JSON.parse(localStorage.getItem("axvara-orders")!)[0].status).toBe("pending");
      cleanup();
    }
  });

  it("batas bayar lewat: tidak tampil; locale EN pesanan memakai teks EN; QRIS baseline tetap 'Bayar'", async () => {
    setLocal(); stubOrder(orderOf(gw({ state: "pending", expires_at: inMin(-1) })));
    await mountReminder();
    expect(region()).toBeNull();
    cleanup();
    setLocal(); stubOrder(orderOf(gw({ state: "fee_consent_required" }), { locale: "en" }));
    await mountReminder();
    expect(norm(region()!.textContent)).toContain("Approve payment total");
    expect(norm(region()!.textContent)).toContain("Approve total");
    cleanup();
    setLocal({ method: "qris" }); stubOrder(orderOf(null, { payment_method: "qris", qris: { expires_at: inMin(10) }, qris_reissue_allowed: false }));
    await mountReminder();
    expect(document.querySelector(`a[href="/pesanan/${CODE}"]`)?.textContent).toContain("Bayar");
    expect(norm(region()!.textContent)).toContain("Pesanan belum dibayar");
  });
});

describe("DeviceOrders: gateway/crypto", () => {
  const rowText = () => norm(document.querySelector("li")?.textContent);
  async function mountDevice() { await act(async () => { render(<DeviceOrders />); }); await waitFor(() => expect(rowText()).not.toContain("Memeriksa status")); }
  const open = () => { const details = document.querySelector("details"); if (details) (details as HTMLDetailsElement).open = true; };

  it("gateway consent/pending dan crypto pending: label dan CTA sadar penyedia, jumlah mata uang asli, tautan ke pesanan yang sama", async () => {
    const cases: Array<[unknown, string, string, string]> = [
      [gw(), "Perlu persetujuan total", "Setujui total", "Rp 254.500"],
      [gw({ state: "pending", fee_consent_required: false }), "Menunggu pembayaran", "Lanjut bayar", "Rp 254.500"],
      [cr(), "Menunggu pembayaran crypto", "Bayar crypto", "US$15,87"],
    ];
    for (const [view, label, cta, amount] of cases) {
      setLocal(); stubOrder(orderOf(view));
      await mountDevice(); open();
      const text = rowText();
      expect(text).toContain(label);
      expect(text).toContain(amount);
      if (amount.startsWith("US$")) expect(text).not.toMatch(/Rp ?250/); // tanpa Rupiah karangan untuk jumlah crypto
      const link = document.querySelector("li a") as HTMLAnchorElement;
      expect(link.textContent).toBe(cta);
      expect(link.getAttribute("href")).toBe(`/pesanan/${CODE}`);
      expect(norm(document.body.textContent)).not.toMatch(/QRIS|LEAK/);
      expect(document.body.innerHTML).not.toContain(ADDRESS);
      cleanup();
    }
  });

  it("header: pil 'belum dibayar' satu baris dan tanpa chip hitungan ganda; nama aksesibel tetap memuat jumlah pesanan", async () => {
    setLocal(); stubOrder(orderOf(gw()));
    await mountDevice();
    const summary = document.querySelector("summary")!;
    expect(summary.getAttribute("aria-label")).toBe("Pesanan di perangkat ini, 1 pesanan");
    const pill = Array.from(summary.querySelectorAll("span")).find((el) => el.textContent === "1 belum dibayar")!;
    expect(pill.className).toContain("whitespace-nowrap");
    expect(Array.from(summary.querySelectorAll("span")).some((el) => el.textContent === "1")).toBe(false);
    open();
    expect(document.querySelector("li a")).toBeTruthy(); // baris diperluas tetap berfungsi
  });

  it("tahap sensitif: confirming/review/expired/failed tanpa alamat/tautan/VA dan tanpa 'Bayar'; CTA netral", async () => {
    const cases: Array<[unknown, string]> = [[cr({ state: "confirming" }), "Konfirmasi jaringan"], [cr({ state: "manual_review" }), "Diperiksa manual"], [cr({ state: "expired" }), "Kedaluwarsa"], [cr({ state: "failed" }), "Tidak berhasil"], [gw({ state: "manual_review" }), "Diperiksa manual"], [gw({ state: "expired" }), "Kedaluwarsa"], [cr({ state: "weird" }), "Diperiksa manual"]];
    for (const [view, label] of cases) {
      setLocal(); stubOrder(orderOf(view));
      await mountDevice(); open();
      expect(rowText()).toContain(label);
      expect((document.querySelector("li a") as HTMLAnchorElement).textContent).toBe("Lihat pesanan");
      expect(document.body.innerHTML).not.toMatch(/0x1234567890|LEAK|pay\.example/);
      cleanup();
    }
  });

  it("locale tersimpan pesanan menentukan teks (EN); QRIS baseline tetap 'Menunggu pembayaran' + 'Bayar sekarang'; salinan lokal tanpa data rahasia", async () => {
    setLocal(); stubOrder(orderOf(cr(), { locale: "en" }));
    await mountDevice(); open();
    expect(rowText()).toContain("Awaiting crypto payment");
    expect((document.querySelector("li a") as HTMLAnchorElement).textContent).toBe("Pay with crypto");
    cleanup();
    setLocal({ method: "qris" }); stubOrder(orderOf(null, { payment_method: "qris", qris: { payable_amount: 250_123, expires_at: inMin(5) } }));
    await mountDevice(); open();
    expect(rowText()).toContain("Menunggu pembayaran");
    expect(rowText()).toContain("Rp 250.123");
    expect((document.querySelector("li a") as HTMLAnchorElement).textContent).toBe("Bayar sekarang");
    const stored = localStorage.getItem("axvara-orders")!;
    expect(stored).not.toMatch(/0x1234|LEAK|pay_address|virtual_account|payment_link|contact|pin/i);
  });

  it("deviceOrderStatus: kompatibel mundur untuk data lama tanpa payment", () => {
    expect(deviceOrderStatus({ status: "pending", fulfillment: null, total: 1000 })).toMatchObject({ label: "Menunggu pembayaran", pay: true });
    expect(deviceOrderStatus({ status: "lunas", fulfillment: "delivered", total: 1000 })).toMatchObject({ label: "Selesai", pay: false });
  });
});

describe("lacak-pesanan: lookup gateway/crypto", () => {
  async function lookup(responses: Array<{ status?: number; body: unknown }>, consent?: (body: Record<string, unknown>) => { status: number; body: unknown }) {
    let n = 0;
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.endsWith("/payment-consent")) { const r = consent!(calls.at(-1)!.body!); return new Response(JSON.stringify(r.body), { status: r.status }); }
      const r = responses[Math.min(n++, responses.length - 1)];
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
    }));
    render(<LacakClient />);
    fireEvent.change(screen.getByLabelText(/Kode pesanan/), { target: { value: CODE } });
    const contact = screen.getByLabelText(/No\. WA atau email checkout/) as HTMLInputElement;
    fireEvent.change(contact, { target: { value: "081234567890" } });
    await act(async () => { fireEvent.submit(contact.closest("form")!); });
    return { calls, contact };
  }
  const bodyText = () => norm(document.body.textContent);
  // Hasil lacak saja (FAQ statis di bawah halaman membahas QRIS/transfer secara umum dan bukan bagian rel pesanan).
  const resultText = () => norm(document.querySelector('[aria-live="polite"].ax-glass-card')?.textContent);

  it("lookup result controls retain their actions and 44px minimum targets", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await lookup([{ body: { order: orderOf(cr()) } }]);
    await screen.findByRole("heading", { name: "Selesaikan Pembayaran Crypto" });
    // Panel crypto juga punya tombol "Salin" (nominal); lacak memakai tombol kode 44px.
    const copy = screen.getAllByRole("button", { name: /Salin$/ }).find((button) => button.className.includes("min-h-11"))!;
    const another = screen.getByRole("button", { name: "Lacak pesanan lain" });
    for (const button of [copy, another]) {
      expect(button.className).toContain("min-h-11");
      expect(button.className).toContain("min-w-11");
    }
    await act(async () => { fireEvent.click(copy); });
    expect(writeText).toHaveBeenCalledWith(CODE);
    expect(screen.getByRole("button", { name: /Disalin$/ })).toBeTruthy();
    fireEvent.click(another);
    expect(screen.queryByRole("heading", { name: "Selesaikan Pembayaran Crypto" })).toBeNull();
    // Fokus pindah ke kolom kode SESUDAH form dirender ulang; kode/kontak tidak direset.
    const codeInput = document.getElementById("track-code") as HTMLInputElement;
    expect(codeInput).toBeTruthy();
    expect(document.activeElement).toBe(codeInput);
    expect(codeInput.value).toBe(CODE);
    expect((screen.getByLabelText(/No\. WA atau email checkout/) as HTMLInputElement).value).toBe("081234567890");
  });

  it("gateway consent: panel dengan total akhir, tanpa tautan/VA; setuju memakai kontak lookup + total tampil; lalu tautan https", async () => {
    const { calls } = await lookup(
      [{ body: { order: orderOf(gw()) } }, { body: { order: orderOf(gw({ state: "pending", fee_consent_required: false, payment_link: "https://pay.example/ok", virtual_account: "8888123456789012", checkout_url: null })) } }],
      () => ({ status: 200, body: { ok: true } }),
    );
    await screen.findByRole("heading", { name: "Setujui Total Pembayaran" });
    expect(bodyText()).toContain("TotalRp 254.500");
    expect(bodyText()).not.toMatch(/LEAK|Nomor virtual account/);
    expect(document.querySelectorAll("section a[target=_blank]")).toHaveLength(0);
    expect(screen.queryByLabelText(/No\. WA atau email checkout yang/)).toBeNull(); // kontak lookup dipakai, tidak diminta lagi
    expect(resultText()).not.toMatch(/QRIS|Perpanjang/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Setujui Rp\s254\.500/ })); });
    const post = calls.find((c) => c.url.endsWith("/payment-consent"))!;
    expect(post.url).toBe(`/api/orders/${CODE}/payment-consent`);
    expect(post.body).toEqual({ contact: "081234567890", expected_final_total: 254_500 });
    await screen.findByRole("heading", { name: "Selesaikan Pembayaran" });
    const link = document.querySelector("section a[target=_blank]") as HTMLAnchorElement;
    expect(link.href).toBe("https://pay.example/ok");
    expect(link.rel).toMatch(/noopener/);
    expect(bodyText()).toContain("8888123456789012");
    expect(bodyText()).toContain("Total • BCA Virtual Account");
    expect(bodyText()).toContain("Diverifikasi otomatis oleh sistem pembayaran.");
    expect(resultText()).not.toMatch(/SEKALIPAY_GATEWAY|verifikasi admin/);
    const sameOrder = document.querySelector(`a[href="/pesanan/${CODE}"]`) as HTMLAnchorElement;
    expect(sameOrder.textContent).toBe("Lanjut bayar"); // CTA ke pesanan SAMA, bukan tautan penyedia langsung
  });

  it("409 stale: total baru dibaca ulang dan ditampilkan tanpa persetujuan otomatis", async () => {
    const { calls } = await lookup(
      [{ body: { order: orderOf(gw()) } }, { body: { order: orderOf(gw({ fee: 5000, total: 255_000 })) } }],
      () => ({ status: 409, body: { error: "Persetujuan tidak tersedia" } }),
    );
    await screen.findByRole("heading", { name: "Setujui Total Pembayaran" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Setujui Rp\s254\.500/ })); });
    await screen.findByRole("button", { name: /Setujui Rp\s255\.000/ });
    expect(bodyText()).toContain("Total berubah atau persetujuan tidak tersedia");
    expect(calls.filter((c) => c.url.endsWith("/payment-consent"))).toHaveLength(1);
  });

  it("crypto pending: nominal teks persis + alamat penuh + total pesanan IDR terpisah dari nilai USD; tanpa QRIS/Rp karangan", async () => {
    await lookup([{ body: { order: orderOf(cr({ pay_amount_text: "98765432.123456789" }), { payment_method: "nowpayments:usdtbsc" }) } }]);
    await screen.findByRole("heading", { name: "Selesaikan Pembayaran Crypto" });
    expect(screen.getByTestId("crypto-amount").textContent).toBe("98765432.13 USDT"); // tampilan dibulatkan ke atas
    expect(screen.getByTestId("crypto-address").textContent).toBe(ADDRESS);
    expect(bodyText()).toContain("Total pesanan • USDT");
    expect(bodyText()).toContain("Total (USD, termasuk biaya layanan crypto)US$15,87");
    expect(resultText()).not.toMatch(/QRIS|Perpanjang|verifikasi admin/);
  });

  it("lacak: batal mandiri mengikuti locale pesanan (EN penuh, galat server dikenal -> EN); ID tetap byte-identik", async () => {
    await lookup([{ body: { order: orderOf(cr(), { locale: "en", payment_method: "nowpayments:usdtbsc" }) } }, { status: 409, body: { error: "Pembayaran sedang diperiksa; pembatalan tidak tersedia." } }]);
    await screen.findByRole("button", { name: "Cancel this order" });
    expect(screen.queryByRole("button", { name: "Batalkan Pesanan Ini" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel this order" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm order cancellation" });
    expect(norm(dialog.textContent)).toContain(`Cancel order ${CODE}?`);
    expect(norm(dialog.textContent)).toContain("Stock is released immediately and can be ordered by others.");
    expect(dialog.querySelector("button")!.textContent).toBe("Back");
    await act(async () => { fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Yes, cancel")!); });
    expect((await screen.findByRole("alert")).textContent).toBe("Payment is being checked; cancellation is not available.");
    expect(dialog.textContent).not.toMatch(/Batalkan|Konfirmasi|Kembali/);
    cleanup();
    await lookup([{ body: { order: orderOf(cr(), { locale: "id", payment_method: "nowpayments:usdtbsc" }) } }, { status: 409, body: { error: "Pembayaran sedang diperiksa; pembatalan tidak tersedia." } }]);
    fireEvent.click(await screen.findByRole("button", { name: "Batalkan Pesanan Ini" }));
    const idDialog = screen.getByRole("dialog", { name: "Konfirmasi pembatalan pesanan" });
    expect(norm(idDialog.textContent)).toContain(`Batalkan pesanan ${CODE}?`);
    await act(async () => { fireEvent.click(Array.from(idDialog.querySelectorAll("button")).find((b) => b.textContent === "Ya, Batalkan")!); });
    expect((await screen.findByRole("alert")).textContent).toBe("Pembayaran sedang diperiksa; pembatalan tidak tersedia.");
    expect(Array.from(idDialog.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Kembali", "Ya, Batalkan"]);
  });

  it("review/expired/confirming/failed: alamat, tautan, VA, tombol bayar dan pembatalan tersembunyi; CTA netral atau pesanan baru", async () => {
    const cases: Array<[unknown, string]> = [[cr({ state: "confirming" }), "Menunggu Konfirmasi Jaringan"], [cr({ state: "manual_review" }), "Pembayaran Sedang Diperiksa"], [cr({ state: "expired" }), "Pesanan Kedaluwarsa"], [gw({ state: "manual_review" }), "Pembayaran Sedang Diperiksa"], [gw({ state: "expired" }), "Pesanan Kedaluwarsa"], [cr({ state: "weird" }), "Pembayaran Sedang Diperiksa"]];
    for (const [view, heading] of cases) {
      await lookup([{ body: { order: orderOf(view) } }]);
      await screen.findByRole("heading", { name: heading });
      expect(document.body.innerHTML).not.toMatch(/0x1234567890|LEAK|pay\.example/);
      expect(screen.queryByTestId("crypto-address")).toBeNull();
      expect(screen.queryByRole("button", { name: /Batalkan Pesanan/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Setujui|Salin alamat|Salin nominal/ })).toBeNull();
      cleanup();
    }
  });

  it("proof gagal: kontak/kode yang diketik dipertahankan + pesan; tombol coba lagi (kirim ulang) memakai input yang sama", async () => {
    const { calls, contact } = await lookup([{ status: 403, body: { error: "Kontak tidak cocok dengan pesanan." } }, { body: { order: orderOf(cr()) } }]);
    await screen.findByText("Kontak tidak cocok dengan pesanan.");
    expect(contact.value).toBe("081234567890");
    expect((screen.getByLabelText(/Kode pesanan/) as HTMLInputElement).value).toBe(CODE);
    expect(screen.queryByTestId("crypto-address")).toBeNull();
    await act(async () => { fireEvent.submit(contact.closest("form")!); });
    await screen.findByRole("heading", { name: "Selesaikan Pembayaran Crypto" });
    expect(calls.filter((c) => c.url === "/api/orders/lookup")).toHaveLength(2);
    expect(calls[1].body).toMatchObject({ code: CODE, contact: "081234567890" });
  });

  it("form kosong: tidak mengirim apa pun; QRIS baseline: tombol 'Buka Halaman Pembayaran' dan tanpa panel rel baru", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<LacakClient />);
    const submit = screen.getByRole("button", { name: "Lacak Pesanan" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    cleanup();
    await lookup([{ body: { order: orderOf(null, { payment_method: "qris", qris: { payable_amount: 250_123, unique_code: 123, image_url: "/q.png", expires_at: inMin(10), status: "pending" } }) } }]);
    await screen.findByRole("link", { name: "Buka Halaman Pembayaran" });
    expect(bodyText()).toContain("Total • QRIS");
    expect(bodyText()).toContain("Rp 250.123");
    expect(screen.queryByTestId("crypto-address")).toBeNull();
  });
});
