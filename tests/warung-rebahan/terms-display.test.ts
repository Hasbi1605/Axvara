// tests/warung-rebahan/terms-display.test.ts — S&K WR ala Axvara.
//
// Kontrak:
//  1. TEGAS: kata perintah + konsekuensi dipertahankan (Wajib/Jangan/Hanya/).
//  2. TIDAK MEMBENTAK: tanpa CAPS-lock, "!!!!", "DILARANG KERAS",
//     "TOLERANSI", "HANGUS", "denda", "bl4ckmarket".
//  3. TIDAK ADA PESAN HILANG: tiap baris input muncul di sections/steps.
//  4. DB tak disentuh: formatter murni, read-only milik sync tetap.
import { describe, it, expect } from "vitest";
import {
  normalizeRule,
  formatTermsForDisplay,
} from "@/lib/warung-rebahan/terms-display";

const SHOUT = [/DILARANG KERAS/, /TOLERANSI/, /HANGUS/, /!{2,}/, /bl4ckmarket/i, /denda 100k/i];

function expectCalm(lines: string[]) {
  for (const line of lines) {
    for (const re of SHOUT) {
      expect(line, `masih membentak (${re}): ${line}`).not.toMatch(re);
    }
  }
}

describe("normalizeRule — tegas tapi tidak membentak", () => {
  it("ancaman sapu-jagat Netflix jadi konsekuensi spesifik", () => {
    const out = normalizeRule(
      "🚫 TIDAK ADA TOLERANSI SEDIKITPUN. MELANGGAR SALAH SATU PERATURAN DIATAS? AKUN KAMI TARIK DAN GARANSI HANGUS!",
    );
    expect(out).toContain("akun bisa kami tarik");
    expect(out).toContain("garansi tidak berlaku");
    expectCalm([out]);
  });

  it("denda WeTV dihapus, garansi tetap tegas", () => {
    const out = normalizeRule("patuhi snk untuk garansi, melanggar = denda 100k dan garansi hangus");
    expect(out).toContain("garansi tidak berlaku");
    expect(out).not.toMatch(/denda/i);
    expectCalm([out]);
  });

  it("VPN keras jadi larangan beralasan", () => {
    const out = normalizeRule("DILARANG KERAS MENGGUNAKAN VPN MANAPUN!");
    expect(out).toMatch(/Jangan gunakan VPN/);
    expect(out).toMatch(/garansi tidak berlaku/);
    expectCalm([out]);
  });

  it("backfree / maximum login dijelaskan inline", () => {
    const out = normalizeRule("GARANSI BF > MAXIMUM NO GARANSI!! MAXIMUM = KEBANYAKAN LOGIN");
    expect(out.toLowerCase()).toMatch(/kembali ke gratis/);
    expect(out).toMatch(/terlalu sering login/);
    expectCalm([out]);
  });

  it("produk tanpa garansi tetap jujur tanpa garansi", () => {
    const out = normalizeRule("NO GARANSI, NO KOMPLAIN!");
    expect(out.toLowerCase()).toMatch(/tanpa garansi/);
    expectCalm([out]);
  });

  it("'jangan beli kalau tidak paham' tidak mengusir", () => {
    const out = normalizeRule("Jangan beli kalo tidak paham cara pakai");
    expect(out).toMatch(/Pastikan kamu sudah paham/);
    expect(out).not.toMatch(/Jangan beli/);
  });

  it("risiko blackmarket jadi penjelasan third-party", () => {
    const out = normalizeRule("Pahami resiko bl4ckmarket");
    expect(out).toMatch(/third-party/);
    expect(out).not.toMatch(/bl4ckmarket/i);
  });

  it("singkatan supplier dikembangkan", () => {
    expect(normalizeRule("Berupa akun, tnggal login")).toMatch(/tinggal login/);
    expect(normalizeRule("Durasi Langsung 1 Bulan (bkn renew)")).toMatch(/bukan renew/);
  });

  it("nomor prefix mentah di-strip (render yang memberi nomor)", () => {
    expect(normalizeRule("1. Mendapatkan akun")).toBe("Mendapatkan akun.");
    expect(normalizeRule("Made by Order (Fresh) No Rush")).toMatch(/Dibuatkan baru/);
  });
});

describe("formatTermsForDisplay — tak ada pesan hilang", () => {
  const NETFLIX_TERMS = [
    "1 Kali Checkout Untuk 1 Device",
    "Tidak bisa set PIN / Profile",
    "1 Akun untuk 2-3 User saja! Bebas pakai profil mana aja Garansi Screen Limit!",
    "Pahami resiko bl4ckmarket",
    "Fixing Garansi 1x24 jam (estimasi)",
  ].join("\n");
  const NETFLIX_DELIVERY = [
    "DILARANG KERAS MENGANTI NAMA PROFIL",
    "DILARANG KERAS MENGGUNAKAN VPN MANAPUN!",
    "🚫 TIDAK ADA TOLERANSI SEDIKITPUN. MELANGGAR SALAH SATU PERATURAN DIATAS? AKUN KAMI TARIK DAN GARANSI HANGUS!",
  ].join("\n");

  it("tegas: highlight berisi aturan device + akun + garansi", () => {
    const out = formatTermsForDisplay(NETFLIX_TERMS, NETFLIX_DELIVERY)!;
    expect(out).not.toBeNull();
    expect(out.highlights.length).toBeGreaterThanOrEqual(2);
    expect(out.highlights.length).toBeLessThanOrEqual(3);
    const blob = out.highlights.join(" ").toLowerCase();
    expect(blob).toMatch(/device|profil|garansi/);
    expectCalm(out.highlights);
  });

  it("semua baris input tercakup di sections + steps", () => {
    const out = formatTermsForDisplay(NETFLIX_TERMS, NETFLIX_DELIVERY)!;
    // 5 terms + 3 delivery (1 baris ancaman melebur jadi konsekuensi) —
    // total baris tampil >= 7 (dedup wajar, bukan hilang).
    const shown = out.sections.flatMap((s) => s.items).length + out.steps.length;
    expect(shown).toBeGreaterThanOrEqual(7);
    expect(out.totalRules).toBe(5);
    expect(out.steps.length).toBe(3);
  });

  it("null bila terms + delivery kosong (section disembunyikan)", () => {
    expect(formatTermsForDisplay(null, null)).toBeNull();
    expect(formatTermsForDisplay("", "")).toBeNull();
  });

  it("varian pendek tanpa delivery tetap punya highlight", () => {
    const out = formatTermsForDisplay(
      "Plan Basic\nSharing 3U\n1x Checkout untuk 1 Device\nGaransi Hanya Backfree",
      null,
    )!;
    expect(out.highlights.length).toBeGreaterThanOrEqual(2);
    expect(out.steps).toHaveLength(0);
    expect(out.sections.flatMap((s) => s.items).join(" ").toLowerCase()).toMatch(/kembali ke/);
  });

  it("angka dan durasi dipertahankan (tidak dibulatkan/dihilangkan)", () => {
    const out = formatTermsForDisplay("25 - 30 hari dihitung 1 bulan\nMaksimal 3 Perangkat (iOS 1 device)", null)!;
    const blob = out.sections.flatMap((s) => s.items).join(" ");
    expect(blob).toMatch(/25/);
    expect(blob).toMatch(/30 hari/);
    expect(blob).toMatch(/3 Perangkat/);
  });
});
