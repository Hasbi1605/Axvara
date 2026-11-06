// Logo dekoratif metode pembayaran: merek gateway dikenali dari LABEL server (kecocokan persis, ternormalisasi),
// bukan dari ID/kode kanal atau substring; aset hanya lokal dan bersih.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { methodLogo } from "@/lib/payments/method-logos";
import type { PayOption } from "@/lib/payment-ui";
import { CRYPTO_ASSETS } from "@/lib/payments/crypto-assets";

const gateway = (label: string, id = "sekalipay_gateway:ARBITRARY_1"): PayOption => ({ id, kind: "gateway", label, sublabel: null, available: true, feeIdr: 1, totalIdr: 2, subtotalIdr: 1, group: "va", limits: null, unavailableReason: null, shortfall: null });
const crypto = (payCurrency: string, id = `nowpayments:${payCurrency.toLowerCase()}`): PayOption => ({ id, kind: "crypto", label: "USDT", sublabel: null, available: true, group: "stable", usdText: "1.00", payCurrency, network: "BSC", rateText: null, baseText: null, surchargeText: null, surchargeBps: null, feePayer: "merchant", senderGasExtra: true, fixedRate: false, unavailableReason: null, minTotalText: null, minIdr: null });
const root = join(__dirname, "..", "public");

describe("methodLogo", () => {
  it("QRIS memakai aset existing; logo koin hanya dari katalog kurasi dan id harus cocok dengan ticker", () => {
    expect(methodLogo({ id: "qris", kind: "qris", label: "QRIS", available: true })).toEqual({ src: "/brand/qris.svg", darken: true });
    expect(methodLogo(crypto("usdtbsc"))).toEqual({ src: "/payments/coins/usdtbsc.svg" });
    expect(methodLogo(crypto("btc"))).toEqual({ src: "/payments/coins/btc.svg" });
    expect(methodLogo(crypto("usdttrc20"))).toEqual({ src: "/payments/coins/usdttrc20.svg" });
    // semua koin kurasi punya berkas logo lokal
    for (const asset of CRYPTO_ASSETS) {
      expect(methodLogo(crypto(asset.ticker))).toEqual({ src: asset.logo });
      expect(existsSync(join(root, asset.logo)), asset.logo).toBe(true);
    }
    for (const other of [crypto("usdtfake"), crypto("doge"), crypto("usddtrc20"), crypto("usdtbsc", "nowpayments:other"), crypto("usdt", "nowpayments:usdtbsc"), crypto("btc", "nowpayments:usdtbsc")]) expect(methodLogo(other)).toBeNull();
  });

  it("aset QRIS mono putih: wajib digelapkan di pelat putih (kasus pelat kosong); logo lain tidak", () => {
    const svg = readFileSync(join(root, "brand/qris.svg"), "utf8");
    const fills = new Set(Array.from(svg.matchAll(/fill:\s*(#[0-9a-f]{3,6}|none)/gi)).map((m) => m[1].toLowerCase()));
    expect([...fills].filter((f) => f !== "none")).toEqual(["#ffffff"]); // semua isian putih = tak terlihat di pelat putih tanpa darken
    expect(methodLogo({ id: "qris", kind: "qris", label: "QRIS", available: true })?.darken).toBe(true);
    expect(methodLogo(crypto("usdtbsc"))?.darken).toBeUndefined();
    expect(methodLogo(gateway("BCA VA"))?.darken).toBeUndefined();
  });

  it("label merek persis pada ID gateway SEMBARANG mendapat logo yang benar (normalisasi huruf/spasi)", () => {
    const expected: Array<[string, string]> = [
      ["BCA Virtual Account", "bca"], ["  bca  VA ", "bca"], ["BCA", "bca"], ["BRI VA", "bri"], ["BRIVA", "bri"], ["Mandiri Virtual Account", "mandiri"],
      ["MANDIRI VA", "mandiri"], ["BNI VA", "bni"], ["BNI", "bni"], ["Permata VA", "permata"], ["CIMB Niaga Virtual Account", "cimb-niaga"], ["CIMB VA", "cimb-niaga"],
      ["Danamon VA", "danamon"], ["BSI VA", "bsi"], ["SeaBank", "seabank"], ["Gopay", "gopay"], ["OVO", "ovo"], ["LinkAja", "linkaja"], ["Link  Aja", "linkaja"],
    ];
    for (const [label, file] of expected) {
      for (const id of ["sekalipay_gateway:ZZZ_1", "sekalipay_gateway:QRIS_X", "x:1"]) expect(methodLogo(gateway(label, id)), `${label} / ${id}`).toEqual({ src: `/payments/${file}.svg` });
    }
  });

  it("label tidak dikenal, mirip, menyesatkan, atau ID berisi nama bank tidak mendapat logo", () => {
    for (const label of ["BCA Syariah VA", "Bank BCA Transfer", "Not BCA", "BCAA", "BC A", "XBCA", "Bank Transfer Lainnya", "Virgo", "ShopeePay", "AstraPay", "SPayLater", "Mandiri Taspen", "BRI Agro", "OVO Points", "Gopay Later", "", "   "]) {
      expect(methodLogo(gateway(label)), label).toBeNull();
    }
    for (const id of ["sekalipay_gateway:BCA_VA", "sekalipay_gateway:OVO", "sekalipay_gateway:BRIVA"]) expect(methodLogo(gateway("Channel Rahasia", id)), id).toBeNull();
    expect(methodLogo(gateway("__proto__"))).toBeNull();
    expect(methodLogo(gateway("constructor"))).toBeNull();
    // Label merek pada opsi non-gateway tidak mengaktifkan logo gateway.
    expect(methodLogo({ ...crypto("btc"), label: "BCA" })).toEqual({ src: "/payments/coins/btc.svg" }); // logo koin dari ticker, bukan label
    expect(methodLogo({ ...crypto("doge"), label: "BCA" })).toBeNull();
  });

  it("semua logo yang dirujuk ada lokal; SVG bersih (tanpa script, on*, href/url eksternal, gambar tertanam)", () => {
    const svgs = readdirSync(join(root, "payments")).filter((name) => name.endsWith(".svg"));
    expect(svgs.sort()).toEqual(["bca.svg", "bni.svg", "bri.svg", "bsi.svg", "cimb-niaga.svg", "danamon.svg", "gopay.svg", "linkaja.svg", "mandiri.svg", "ovo.svg", "permata.svg", "seabank.svg"]);
    for (const name of svgs) {
      const svg = readFileSync(join(root, "payments", name), "utf8");
      expect(svg, name).toContain("viewBox");
      expect(svg, name).not.toMatch(/<script|\son[a-z]+\s*=|href\s*=\s*["']https?:|<image|data:image|@import|<foreignObject|url\(\s*["']?https?:/i);
    }
    for (const src of ["/brand/qris.svg", "/payments/usdt.png"]) expect(existsSync(join(root, src)), src).toBe(true);
    expect(readFileSync(join(root, "brand/qris.svg"), "utf8")).not.toMatch(/<script|\son[a-z]+\s*=|href\s*=\s*["']https?:|@import/i);
    const png = readFileSync(join(root, "payments/usdt.png"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.length).toBeLessThan(10_240);
  });
});
