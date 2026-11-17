import { describe, expect, it } from "vitest";
import { gamesVariantDescription, gamesVariantName } from "@/lib/games/display-name";
import { gamesItemIcon } from "@/lib/games/item-icons";
import { gamesEffectiveCategory } from "@/lib/games/variant-kind";

const ml = { name: "Mobile Legends", slug: "mobile-legends" };
const cases: [string, string, string, string][] = [
  ["Mobile Legends", "mobile-legends", "  – - Mobilelegend -   50 Diamond  ", "50 Diamond"],
  ["Mobile Legends", "mobile-legends", "Mobile Legends: 50 Diamond", "50 Diamond"],
  ["Mobile Legends", "mobile-legends", "Mobilelegend-Weekly Diamond Pass", "Weekly Diamond Pass"],
  ["Mobile Legends", "mobile-legends", "Mobile Legends Starlight Membership", "Starlight Membership"],
  ["Mobile Legends", "mobile-legends", "Mobilelegend Weekly Membership", "Weekly Membership"],
  ["Mobile Legends", "mobile-legends", "Mobilelegend Diamond", "Mobilelegend Diamond"],
  ["Arena Of Valor", "arena-of-valor", "Aov 18 Vouchers", "18 Vouchers"],
  ["AU2 Mobile", "au2-mobile", "Au2 1.536 Diamonds", "1.536 Diamonds"],
  ["Crossfire Legends", "crossfire-legends", "Legends 6480 Coin", "6.480 Coin"],
  ["Blood Strike", "blood-strike", "- Strike Pass Elite", "Strike Pass Elite"],
  ["Mobile Legends", "mobile-legends", "Europe 11500 Diamond", "Europe 11.500 Diamond"],
  ["Mobile Legends", "mobile-legends", "Brazil 520 Diamond", "Brazil 520 Diamond"],
  ["Genshin Impact", "genshin-impact", "Monthly Pass", "Monthly Pass"],
  ["Genshin Impact", "genshin-impact", "Genesis Supplies", "Genesis Supplies"],
  ["Mobile Legends", "mobile-legends", "Pilihan Pemula", "Pilihan Pemula"],
  ["Arena Breakout Infinite", "arena-breakout-infinite", "Infinite 10.000 Bonds", "Infinite 10.000 Bonds"],
  ["Call of Duty Mobile", "call-of-duty-mobile", "1024 Cp", "1.024 CP"],
  ["FC Mobile", "fc-mobile", "100 Fc Points", "100 FC Points"],
  ["Football Master 2", "football-master-2", "1.944 Fmp", "1.944 FMP"],
  ["Mobile Legends", "mobile-legends", "5 Diamonds (filipina)", "5 Diamonds (Filipina)"],
  ["Mobile Legends", "mobile-legends", "weekly pass (region luar negeri)", "Weekly pass (Region Luar Negeri)"],
  ["Mobile Legends", "mobile-legends", "X5 1.024 Diamonds Au2", "X5 1.024 Diamonds Au2"],
  ["Mobile Legends", "mobile-legends", "Kode 11500", "Kode 11500"],
  ["Mobile Legends", "mobile-legends", "11500 + 100", "11.500 + 100"],
  ["Mobile Legends", "mobile-legends", "Mobilelegend-Mobilelegend 50 Diamond", "50 Diamond"],
  ["Mobile Legends", "mobile-legends", "Mobilelegend", "Mobilelegend"],
  ["Mobile Legends", "mobile-legends", "Mobilelegendary 50 Diamond", "Mobilelegendary 50 Diamond"],
];

describe("buyer variant names", () => {
  it.each(cases)("%s: %s / %s → %s", (name, slug, raw, expected) => {
    const game = { name, slug };
    expect(gamesVariantName(raw, game)).toBe(expected);
    expect(gamesVariantName(expected, game)).toBe(expected);
  });

  it.each(["cp", "fc", "fmp", "uc", "vp", "bp", "ml", "mlbb", "ff", "ow", "rp", "pubg", "aov", "gb"])("uppercases whole-word %s only", (unit) => {
    expect(gamesVariantName(`100 ${unit} ${unit}ish`, ml)).toBe(`100 ${unit.toUpperCase()} ${unit}ish`);
  });

  it("retains region words even when also words of the game name", () => {
    expect(gamesVariantName("Europe 11500 Diamond", { name: "Europe Mobile", slug: "europe-mobile" })).toBe("Europe 11.500 Diamond");
    expect(gamesVariantName("Brazil 520 Diamond", { name: "Brazil Mobile", slug: "brazil-mobile" })).toBe("Brazil 520 Diamond");
  });

  it("uses the game slug even when the admin renamed the game", () => {
    expect(gamesVariantName("Mobilelegend - 50 Diamond", { name: "MLBB", slug: "mobile-legends" })).toBe("50 Diamond");
  });

  it("never empties a variant, including missing supplier text", () => {
    for (const raw of ["", " ", "- – ", "Mobilelegend", "-", "–"]) {
      const name = gamesVariantName(raw, ml);
      expect(name.length).toBeGreaterThan(0);
      expect(gamesVariantName(name, ml)).toBe(name);
    }
  });

  it("sweeps quantities, aliases, separators, regions, units, and repeated prefixes idempotently", () => {
    for (const quantity of [5, 50, 999, 1000, 1024, 6480, 11500, 1000000]) {
      for (const alias of ["", "Mobilelegend ", "Mobile Legends: ", "Mobilelegend - Mobilelegend "]) {
        for (const unit of ["Diamond", "Cp", "UC", "Fmp", "Diamond (filipina)", "X5"]) {
          const raw = ` – ${alias}${quantity} ${unit} `;
          const name = gamesVariantName(raw, ml);
          expect(name).not.toMatch(/^[-–\s]|\s{2,}|\s$/);
          expect(gamesVariantName(name, ml)).toBe(name);
        }
      }
    }
  });

  it.each(cases)("keeps item icons unchanged for %s / %s / %s", (name, slug, raw) => {
    const category = gamesEffectiveCategory({ productName: raw });
    const displayed = gamesVariantName(raw, { name, slug });
    expect(gamesItemIcon(slug, { name: displayed, category }))
      .toBe(gamesItemIcon(slug, { name: raw, category }));
  });
});

const descriptionCases: [string, string | null, string | null][] = [
  ["✅ Proses instant detikan", null, null],
  ["  proses  INSTANT ✅ detikan  ", null, null],
  ["ALL REGION KECUALI ❌ MY / SG / RU tidak didukung.",
    "Berlaku untuk semua region kecuali Malaysia, Singapura, dan Rusia.",
    "Valid for all regions except Malaysia, Singapore, and Russia."],
  ["ALL REGION KECUALI MY, SG, RUSIA (AKAN OTOMATIS GAGAL)",
    "Berlaku untuk semua region kecuali Malaysia, Singapura, dan Rusia.",
    "Valid for all regions except Malaysia, Singapore, and Russia."],
  ["KHUSUS REGION LUAR ✅ REGION ID,PH,MY,SG,RU AUTO DITOLAK",
    "Khusus akun region luar negeri. Akun region Indonesia, Filipina, Malaysia, Singapura, dan Rusia tidak didukung.",
    "For overseas-region accounts only. Indonesia, Philippines, Malaysia, Singapore, and Russia accounts are not supported."],
  ["Bidang ID isi Nomor HP Reedem Voucher :",
    "Isi kolom ID dengan nomor HP untuk menerima kode voucher.",
    "Enter your phone number in the ID field to receive the voucher code."],
];

describe("buyer variant descriptions", () => {
  it.each(descriptionCases)("normalizes known supplier description %s", (raw, id, en) => {
    expect(gamesVariantDescription(raw, "id")).toBe(id);
    expect(gamesVariantDescription(raw, "en")).toBe(en);
  });

  it.each([
    ["  ⚠️ ✅   SUDAH TERMASUK BONUS : -  ", "Sudah termasuk bonus"],
    ["  ✅ Receive your code by email : ", "Receive your code by email"],
    ["Khusus akun baru. ⚠️", "Khusus akun baru."],
    ["STOK READY sekarang", "STOK READY sekarang"],
    ["STOK READY SEKARANG ya", "Stok ready sekarang ya"],
    ["✅ ❌ ⚠️", null],
    [" -- :: ", null],
    ["", null],
    [null, null],
  ] as const)("cleans generic text without inventing a translation: %s", (raw, expected) => {
    expect(gamesVariantDescription(raw, "id")).toBe(expected);
    expect(gamesVariantDescription(raw, "en")).toBe(expected);
  });

  it.each([
    ["  ✅ 50 DIAMOND ", "50 Diamond"],
    ["Vcr Robux 400", "400 Robux"],
    ["Voucher 400 Robux", "Robux 400"],
    ["Roblox Gift Card (IDR) 65.000", "65.000 Gift Card (IDR)"],
    ["Vcr Roblox Gift Card (IDR) 65000", "Roblox Gift Card (IDR) 65.000"],
  ])("hides a nominal restatement: %s", (raw, variant) => {
    expect(gamesVariantDescription(raw, "id", variant)).toBeNull();
    expect(gamesVariantDescription(raw, "en", variant)).toBeNull();
  });

  it("does not hide a different region, quantity, or an actual instruction", () => {
    expect(gamesVariantDescription("Robux 800", "id", "400 Robux")).toBe("Robux 800");
    expect(gamesVariantDescription("Roblox Gift Card (USD) 65.000", "en", "Roblox Gift Card (IDR) 65.000")).not.toBeNull();
    expect(gamesVariantDescription("400 Robux untuk akun baru", "en", "400 Robux")).toBe("400 Robux untuk akun baru");
    expect(gamesVariantDescription("ALL REGION KECUALI ID DAN MY", "en")).toBe("All region kecuali id dan my");
  });
});

describe("PM sweep corrections (production names, 17 Nov 2026)", () => {
  it.each([
    ["Zenless Zone Zero", "zenless-zone-zero", "330 (300+30) Monochromes (id)", "330 (300+30) Monochromes (ID)"],
    ["Genshin Impact", "genshin-impact", "6480+1600 Genesis Crystals (usa)", "6.480+1.600 Genesis Crystals (USA)"],
    ["Mobile Legends", "mobile-legends", "5136 + 1027 Diamonds (russia)", "5.136 + 1.027 Diamonds (Russia)"],
    ["Magic Chess Go Go", "magic-chess-go-go", "9288 (7740+1548) Diamonds (brazil)", "9.288 (7.740+1.548) Diamonds (Brazil)"],
    ["Rainbow Six Mobile", "rainbow-six-mobile", "1000+1700 Platinum First Purchase (us)", "1.000+1.700 Platinum First Purchase (US)"],
  ])("%s: %s", (name, slug, raw, expected) => {
    expect(gamesVariantName(raw, { name, slug })).toBe(expected);
    expect(gamesVariantName(expected, { name, slug })).toBe(expected);
  });
});
