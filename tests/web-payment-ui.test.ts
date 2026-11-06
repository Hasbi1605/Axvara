// Logika murni presentasi pembayaran web: parse opsi quote, pemilihan stabil
// berdasarkan ID, redaksi tampilan pesanan, dan salinan ID/EN.
import { describe, expect, it } from "vitest";
import { asPayLocale, fxRateLabel, usdFor, normalizePaymentView, orderPanelCopy, parsePayOptions, payCopy, reconcileSelection } from "@/lib/payment-ui";

const qris = { id: "qris", kind: "qris", label: "QRIS", sublabel: null, account_number: "", account_name: "", qris_url: null, currency: "IDR", available: true };
const gateway = (code: string, fee = 4000, total = 254_000) => ({ id: `sekalipay_gateway:${code}`, kind: "gateway", label: `Channel ${code}`, sublabel: "Estimasi biaya pembayaran", account_number: "", currency: "IDR", available: true, gateway: { channel: code, estimated_fee: fee, estimated_total: total, idr_subtotal: 250_000 } });
const crypto = { id: "nowpayments:usdtbsc", kind: "crypto", label: "USDT", sublabel: "BNB Smart Chain", group: "stable", available: true, currency: "USD", amount_text: "15.87", pay_currency: "usdtbsc", network: "bsc", fee_payer: "merchant", fixed_rate: false, sender_gas_extra: true, base_cents: 1563, surcharge_cents: 24, total_cents: 1587, surcharge_bps: 150, usd: { rate_text: "1 USD = Rp16.000" }, account_number: "" };
const cryptoBelowMin = { id: "nowpayments:btc", kind: "crypto", label: "BTC", sublabel: "Bitcoin", group: "popular", available: false, unavailable_reason: "below_min", currency: "USD", pay_currency: "btc", network: "btc", min_total_cents: 225, min_total_text: "2.25", min_idr_subtotal: 35000, account_number: "" };

describe("parsePayOptions", () => {
  it("tiga jenis dari quote apa adanya; metode manual lama dan entri cacat dibuang", () => {
    const options = parsePayOptions([
      qris, { id: "ewallet", kind: "qris", label: "DANA", account_number: "08" }, { id: "bca", label: "BCA" },
      gateway("A"), { ...gateway("B"), gateway: { channel: "B", estimated_fee: 1.5, estimated_total: 2, idr_subtotal: 1 } },
      crypto, { ...crypto, id: "x", amount_text: "1e3" }, null, "x", { kind: "gateway" },
    ]);
    expect(options.map((o) => [o.id, o.kind])).toEqual([["qris", "qris"], ["sekalipay_gateway:A", "gateway"], ["nowpayments:usdtbsc", "crypto"]]);
    const gw = options[1];
    expect(gw.kind === "gateway" && [gw.feeIdr, gw.totalIdr, gw.subtotalIdr]).toEqual([4000, 254_000, 250_000]);
    const c = options[2];
    expect(c.kind === "crypto" && [c.usdText, c.payCurrency, c.network, c.rateText, c.feePayer, c.fixedRate, c.senderGasExtra]).toEqual(["15.87", "usdtbsc", "bsc", "1 USD = Rp16.000", "merchant", false, true]);
    expect(c.kind === "crypto" && [c.baseText, c.surchargeText, c.surchargeBps, c.group]).toEqual(["15.63", "0.24", 150, "stable"]);
  });
  it("koin di bawah minimum tampil nonaktif dengan minimum server dan tanpa jumlah; tanpa minimum = dibuang", () => {
    const [off] = parsePayOptions([cryptoBelowMin]);
    expect(off).toMatchObject({ id: "nowpayments:btc", kind: "crypto", available: false, usdText: "", unavailableReason: "below_min", minTotalText: "2.25", minIdr: 35000, group: "popular" });
    expect(parsePayOptions([{ ...cryptoBelowMin, min_total_cents: undefined }])).toEqual([]);
    // koin tersedia tanpa jumlah valid dibuang
    expect(parsePayOptions([{ ...crypto, amount_text: undefined }])).toEqual([]);
  });
  it("banyak koin crypto dari quote semuanya diurai (urutan server dipertahankan)", () => {
    const many = ["btc", "eth", "trx", "usdtbsc", "usdttrc20", "usdc"].map((ticker) => ({ ...crypto, id: `nowpayments:${ticker}`, pay_currency: ticker, label: ticker.toUpperCase() }));
    expect(parsePayOptions(many).map((o) => o.id)).toEqual(many.map((o) => o.id));
  });
  it("quote lama tanpa kind untuk id qris tetap dikenali; bukan array = kosong", () => {
    expect(parsePayOptions([{ id: "qris", label: "QRIS", account_number: "", account_name: "", qris_url: null }])).toEqual([{ id: "qris", kind: "qris", label: "QRIS", available: true }]);
    expect(parsePayOptions(undefined)).toEqual([]);
    expect(parsePayOptions({})).toEqual([]);
  });
  it("nominal USD besar/kecil tetap TEKS persis (tanpa float)", () => {
    for (const amount of ["0.000001", "123456789012.123456789012345678"]) {
      const o = parsePayOptions([{ ...crypto, amount_text: amount }]);
      expect(o[0].kind === "crypto" && o[0].usdText).toBe(amount);
    }
  });
});

describe("reconcileSelection", () => {
  const opts = parsePayOptions([qris, gateway("A"), crypto]);
  it("QRIS default saat tanpa pilihan; pilihan valid dipertahankan lewat quote baru", () => {
    expect(reconcileSelection(opts, null, null)).toEqual({ selectedId: "qris", notice: null });
    expect(reconcileSelection(opts, "sekalipay_gateway:A", "Channel A")).toEqual({ selectedId: "sekalipay_gateway:A", notice: null });
  });
  it("pilihan hilang -> QRIS eksplisit + pemberitahuan; tanpa QRIS -> kosong, tidak memilih metode berbiaya", () => {
    const noGateway = parsePayOptions([qris, crypto]);
    expect(reconcileSelection(noGateway, "sekalipay_gateway:A", "Channel A")).toEqual({ selectedId: "qris", notice: { kind: "fallback", fromLabel: "Channel A" } });
    const noQris = parsePayOptions([gateway("A"), crypto]);
    expect(reconcileSelection(noQris, null, null)).toEqual({ selectedId: null, notice: null });
    expect(reconcileSelection(noQris, "nowpayments:other", "Old")).toEqual({ selectedId: null, notice: { kind: "cleared", fromLabel: "Old" } });
    expect(reconcileSelection([], null, null).selectedId).toBeNull();
  });
  it("opsi tidak tersedia tidak dipertahankan", () => {
    const off = parsePayOptions([qris, { ...gateway("A"), available: false }]);
    expect(reconcileSelection(off, "sekalipay_gateway:A", "Channel A").selectedId).toBe("qris");
  });
});

describe("normalizePaymentView (redaksi gagal-tertutup)", () => {
  const gw = { kind: "gateway", label: "Channel A", channel: "A", currency: "IDR", subtotal: 250_000, estimated_fee: 4000, fee: 4500, total: 254_500, fee_consent_required: false, expires_at: "2026-11-04T10:00:00.000Z", payment_link: "https://pay.example/x", virtual_account: "8888123", checkout_url: "https://pay.example/c" };
  it("tautan/VA hanya pada tahap pending dan hanya https", () => {
    const pending = normalizePaymentView({ ...gw, state: "pending" });
    expect(pending).toMatchObject({ state: "pending", paymentLink: "https://pay.example/x", checkoutUrl: "https://pay.example/c", virtualAccount: "8888123", total: 254_500 });
    for (const state of ["fee_consent_required", "initializing", "expired", "manual_review", "paid"]) {
      expect(normalizePaymentView({ ...gw, state })).toMatchObject({ paymentLink: null, checkoutUrl: null, virtualAccount: null });
    }
    expect(normalizePaymentView({ ...gw, state: "pending", payment_link: "http://x", checkout_url: "javascript:alert(1)" })).toMatchObject({ paymentLink: null, checkoutUrl: null });
  });
  it("tahap tak dikenal = pemeriksaan manual, tanpa detail", () => {
    expect(normalizePaymentView({ ...gw, state: "weird" })).toMatchObject({ state: "manual_review", paymentLink: null, virtualAccount: null });
    expect(normalizePaymentView({ kind: "crypto", state: "???", pay_address: "0xabc", pay_amount_text: "1", label: "USDT" })).toMatchObject({ state: "manual_review", payAddress: "" });
    expect(normalizePaymentView({ kind: "other" })).toBeNull();
    expect(normalizePaymentView(null)).toBeNull();
  });
  it("alamat crypto hanya pada pending, nominal tetap teks", () => {
    const base = { kind: "crypto", label: "USDT", sublabel: "BNB Smart Chain", symbol: "USDT", network_label: "BNB Smart Chain", currency: "USD", amount_text: "15.87", base_amount_text: "15.63", surcharge_amount_text: "0.24", surcharge_bps: 150, pay_amount_text: "15.634512000000000001", pay_currency: "usdtbsc", network: "bsc", pay_address: "0x1234567890abcdef1234567890abcdef12345678", expires_at: "2026-11-04T10:00:00.000Z", fee_payer: "merchant", fixed_rate: false, sender_gas_extra: true };
    expect(normalizePaymentView({ ...base, state: "pending" })).toMatchObject({ payAddress: base.pay_address, payAmountText: "15.634512000000000001", usdText: "15.87", symbol: "USDT", networkLabel: "BNB Smart Chain", baseText: "15.63", surchargeText: "0.24", surchargeBps: 150, feePayer: "merchant" });
    for (const state of ["confirming", "expired", "manual_review", "failed", "paid", "preparing"]) expect(normalizePaymentView({ ...base, state })).toMatchObject({ payAddress: "" });
  });
});

describe("salinan ID/EN", () => {
  it("badge QRIS persis dan locale terpisah dari mata uang", () => {
    expect(payCopy("id").fastest).toBe("Paling cepat");
    expect(payCopy("en").fastest).toBe("Fastest");
    expect(asPayLocale("en")).toBe("en");
    expect(asPayLocale("fr")).toBe("id");
    expect(asPayLocale(undefined)).toBe("id");
    expect(orderPanelCopy("en").h1.confirming).toBe("Waiting for Network Confirmation");
    expect(orderPanelCopy("id").h1.confirming).toBe("Menunggu Konfirmasi Jaringan");
  });
  it("tanpa kata terlarang untuk gateway/crypto", () => {
    const blob = JSON.stringify([payCopy("id"), payCopy("en"), orderPanelCopy("id"), orderPanelCopy("en")].map((c) => { const { fastest, ...rest } = c as Record<string, unknown>; void fastest; return rest; }));
    expect(blob).not.toMatch(/instan|instant|bukti transfer|upload proof|dalam \d+ menit/i);
  });
});

describe("baris kurs ringkasan checkout (format saja)", () => {
  it("id/en: 'Dari Rp 38.000 · kurs Rp 18.087,80/US$1' / 'From Rp 38,000 · rate Rp 18,087.80/US$1'; tanpa angka mentah", () => {
    const norm = (v: string) => v.replace(/\s/g, " ");
    expect(norm(payCopy("id").usdFrom(38_000, "18087.80"))).toBe("Dari Rp 38.000 · kurs Rp 18.087,80/US$1");
    expect(norm(payCopy("en").usdFrom(38_000, "18087.80"))).toBe("From Rp 38,000 · rate Rp 18,087.80/US$1");
    expect(fxRateLabel("18087.8", "id")).toBe("Rp 18.087,80/US$1");
    expect(fxRateLabel("16000", "en")).toBe("Rp 16,000.00/US$1");
  });
  it("kurs kosong atau bukan desimal tidak ditampilkan mentah", () => {
    expect(norm2(payCopy("id").usdFrom(38_000, null))).toBe("Dari Rp 38.000");
    expect(norm2(payCopy("en").usdFrom(38_000, "1 USD = Rp16.000"))).toBe("From Rp 38,000");
    expect(fxRateLabel("abc", "id")).toBeNull();
    expect(fxRateLabel("1e5", "id")).toBeNull();
  });
});
const norm2 = (v: string) => v.replace(/\s/g, " ");

describe("usdFor: USD fiat mengikuti locale (koin dan clipboard tidak pernah dilokalkan)", () => {
  it("id memakai koma desimal, en memakai titik; teks 2-dp diparse ke sen tanpa float", () => {
    expect(usdFor("3.60", "id")).toBe("US$3,60");
    expect(usdFor("3.60", "en")).toBe("US$3.60");
    expect(usdFor("0.24", "id")).toBe("US$0,24");
    expect(usdFor("15.87", "id")).toBe("US$15,87");
    expect(usdFor("1234.56", "id")).toBe("US$1.234,56");
    expect(usdFor("1234.56", "en")).toBe("US$1,234.56");
    expect(usdFor("5", "id")).toBe("US$5,00");
    expect(usdFor("2.5", "en")).toBe("US$2.50");
    expect(usdFor("999999999999.99", "en")).toBe("US$999,999,999,999.99"); // tanpa kehilangan presisi float
  });
  it("bentuk yang tak bisa diparse persis (3+ desimal, bukan angka) jatuh ke 'US$…' mentah", () => {
    expect(usdFor("1.234", "id")).toBe("US$1.234");
    expect(usdFor("abc", "id")).toBe("US$abc");
    expect(usdFor("", "en")).toBe("US$");
  });
  it("salinan payCopy memakai usdFor di setiap sisi: keterangan header, Min., alasan, CTA", () => {
    const id = payCopy("id"), en = payCopy("en");
    expect(id.cryptoUsd("3.60")).toBe("US$3,60");
    expect(en.cryptoUsd("3.60")).toBe("US$3.60");
    expect(id.cryptoMin("2.25")).toBe("Min. US$2,25");
    expect(en.cryptoMin("2.25")).toBe("Min. US$2.25");
    expect(id.cryptoCaption("3.60", 150)).toBe("US$3,60 · termasuk biaya layanan 1,5%");
    expect(en.cryptoCaption("3.60", 150)).toBe("US$3.60 · incl. 1.5% service fee");
    expect(id.ctaCrypto("3.60")).toBe("Buat Pesanan — US$3,60");
    expect(en.ctaCrypto("3.60")).toBe("Place order — US$3.60");
    expect(id.cryptoMinReason("2.25", null)).toBe("Belanja minimal US$2,25 untuk koin ini");
  });
});

describe("salinan gateway: keterangan header, baris, ringkasan", () => {
  it("id/en: 'Biaya mulai'/'Fees from', 'Biaya Rp x'/'Fee Rp x', 'Min.'/'Maks.'/'Max', ringkasan Subtotal/Biaya/Total tanpa '+'", () => {
    const n = (v: string) => v.replace(/\s/g, " ");
    const id = payCopy("id"), en = payCopy("en");
    expect(id.groupOther).toBe("Lainnya"); expect(en.groupOther).toBe("Other");
    expect(n(id.gatewayCaptionFrom(3500))).toBe("Biaya mulai Rp 3.500");
    expect(n(en.gatewayCaptionFrom(3500))).toBe("Fees from Rp 3,500");
    expect(id.gatewayCaptionNone).toBe("Belum tersedia untuk nominal ini");
    expect(n(id.gatewayRowFee(4000))).toBe("Biaya Rp 4.000"); expect(id.gatewayRowFee(0)).toBe("Tanpa biaya"); expect(en.gatewayRowFee(0)).toBe("No fee");
    expect(n(id.gatewayRowMin(10_000))).toBe("Min. Rp 10.000"); expect(n(id.gatewayRowMax(249_999))).toBe("Maks. Rp 249.999"); expect(n(en.gatewayRowMax(1000))).toBe("Max Rp 1,000");
    expect(id.subtotalRow).toBe("Subtotal"); expect(id.totalRow).toBe("Total");
    expect(id.feeRow("BCA VA")).toBe("Biaya BCA VA"); expect(en.feeRow("BCA VA")).toBe("BCA VA fee");
    expect(id.gatewayFinalNote).toBe("Total akhir disetujui di halaman pesanan.");
    expect(orderPanelCopy("id").feeFor("BCA VA")).toBe("Biaya BCA VA");
    expect(orderPanelCopy("en").feeFor("")).toBe("Fee");
  });
});
