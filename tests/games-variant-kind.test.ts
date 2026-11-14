import { describe, expect, it } from "vitest";
import {
  GAMES_CATEGORY_ORDER,
  GAMES_CATEGORY_SECTIONS,
  GAMES_DISPLAY_GROUP_VALUES,
  cleanGamesFieldLabel,
  gamesAutoCategory,
  gamesCategoryLabel,
  gamesEffectiveCategory,
  gamesFieldLabelMajority,
  gamesRegionCode,
  gamesRegionTypeNames,
  gamesTypeLabel,
  isGamesDisplayGroupValue,
  isGenericGamesFieldLabel,
  regionCodeFromNickname,
} from "@/lib/games/variant-kind";

// Nama nyata dari snapshot katalog Sekalipay (games-fixture-seed.sql, 14 Nov 2026).
describe("gamesTypeLabel: ejaan Indonesia untuk tipe supplier", () => {
  it.each([
    ["Philippines", "Filipina"],
    ["Filipina", "Filipina"],
    ["Russia", "Rusia"],
    ["Turkey", "Turki"],
    ["Singapore", "Singapura"],
    ["Singapura", "Singapura"],
    ["Brazil", "Brasil"],
    ["Indonesia", "Indonesia"],
    ["Global", "Global"],
    ["Malaysia", "Malaysia"],
    ["Membership", "Membership"],
    ["Diamond", "Diamond"],
  ])("%s → %s", (input, expected) => {
    expect(gamesTypeLabel(input)).toBe(expected);
  });

  it("menyembunyikan DIGITAL dan tipe kosong", () => {
    expect(gamesTypeLabel("DIGITAL")).toBeNull();
    expect(gamesTypeLabel("")).toBeNull();
    expect(gamesTypeLabel("   ")).toBeNull();
    expect(gamesTypeLabel(null)).toBeNull();
    expect(gamesTypeLabel(undefined)).toBeNull();
  });

  it("mempertahankan tipe tak dikenal apa adanya (tanpa menebak)", () => {
    expect(gamesTypeLabel("Big Cat Coins")).toBe("Big Cat Coins");
    expect(gamesTypeLabel("  Vouchers  ")).toBe("Vouchers");
  });
});

describe("gamesRegionCode", () => {
  it.each([
    ["Indonesia", "ID"],
    ["Malaysia", "MY"],
    ["Singapore", "SG"],
    ["Singapura", "SG"],
    ["Philippines", "PH"],
    ["Filipina", "PH"],
    ["Brazil", "BR"],
    ["Russia", "RU"],
    ["Turkey", "TR"],
    ["USA", "US"],
    ["Global", "GLOBAL"],
  ])("%s → %s", (input, expected) => {
    expect(gamesRegionCode(input)).toBe(expected);
  });

  it("null untuk tipe non-negara", () => {
    for (const type of ["Membership", "Diamond", "DIGITAL", "Vouchers", "", "Big Cat Coins"]) {
      expect(gamesRegionCode(type), type).toBeNull();
    }
  });

  it("kebalikan kode region dipakai filter admin", () => {
    expect(gamesRegionTypeNames("PH")).toEqual(["philippines", "filipina"]);
    expect(gamesRegionTypeNames("id")).toEqual(["indonesia", "indonesian"]);
    expect(gamesRegionTypeNames("XX")).toBeNull();
  });
});

describe("regionCodeFromNickname", () => {
  it("mengambil ISO-2 di akhir nickname", () => {
    expect(regionCodeFromNickname("Sekalipay3121 (ID)")).toBe("ID");
    expect(regionCodeFromNickname("Player (ph)")).toBe("PH");
    expect(regionCodeFromNickname("Player (sg) ")).toBe("SG");
  });

  it("null tanpa kode negara di akhir", () => {
    expect(regionCodeFromNickname("Sekalipay3121")).toBeNull();
    expect(regionCodeFromNickname("Player (Indonesia)")).toBeNull();
    expect(regionCodeFromNickname("Player (ID) extra")).toBeNull();
    expect(regionCodeFromNickname("")).toBeNull();
    expect(regionCodeFromNickname(null)).toBeNull();
  });
});

// Aturan otomatis B6, diuji pada nama nyata dari fixture.
describe("gamesAutoCategory: aturan nama nyata", () => {
  it.each([
    ["First Top Up 50+5 Diamonds (brazil)", "first_topup"],
    ["First Top Up 150+bonus Diamonds (indonesia)", "first_topup"],
    ["Top Up Pertama 86 Diamond", "first_topup"],
    ["Double Diamond 172", "first_topup"],
    ["Weekly Diamond Pass 2x (indonesia)", "pass"],
    ["Weekly Diamond Pass", "pass"],
    ["Twilight Pass (global)", "pass"],
    ["Starlight Membership", "pass"],
    ["Europe Monthly Membership", "pass"],
    ["Level Up Pass - Level 30", "pass"],
    ["Super Pass Bundle", "pass"],
    ["Global Rookie Enchance Pack", "pack"],
    ["Memory Sphere Package", "other"],
    ["Paket Khusus Pemula", "pack"],
    ["Mobilelegend - 5 Diamond", "topup"],
    ["5 Diamonds (filipina)", "topup"],
    ["86 UC", "topup"],
    ["100+10 Platinum (malaysia)", "topup"],
    ["Genesis Crystals 60", "topup"],
    ["Roblox Gift Card (US) $10", "other"],
    ["Twilight Pass", "pass"],
    ["Voucher 50.000", "other"],
    ["Membership Mingguan X3", "pass"],
  ])("%s → %s", (name, expected) => {
    expect(gamesAutoCategory({ productName: name })).toBe(expected);
  });

  it("teks kosong jatuh ke other", () => {
    expect(gamesAutoCategory({})).toBe("other");
    expect(gamesAutoCategory({ productName: "   " })).toBe("other");
  });
});

describe("gamesEffectiveCategory: override admin menang", () => {
  it.each([...GAMES_DISPLAY_GROUP_VALUES])("menerima override %s", (group) => {
    expect(gamesEffectiveCategory({ displayGroup: group, productName: "Mobilelegend - 5 Diamond" })).toBe(group);
  });

  it("jatuh ke aturan otomatis untuk null/asing/legacy", () => {
    for (const value of [null, undefined, "", "all", "bogus", "SPECIAL "]) {
      // "SPECIAL " → dinormalisasi trim+lowercase menjadi special yang sah.
      if (String(value).trim().toLowerCase() === "special") continue;
      expect(gamesEffectiveCategory({ displayGroup: value, productName: "Twilight Pass (global)" }), String(value)).toBe("pass");
    }
    expect(gamesEffectiveCategory({ displayGroup: "SPECIAL ", productName: "5 Diamond" })).toBe("special");
    // Nilai lama `all` bukan kategori Oura → aturan otomatis.
    expect(gamesEffectiveCategory({ displayGroup: "all", productName: "Roblox Gift Card (US) $10" })).toBe("other");
  });
});

describe("urutan + label section kategori", () => {
  it("urutan dan label Indonesia sesuai OD4", () => {
    expect(GAMES_CATEGORY_ORDER).toEqual([
      "bestseller", "special", "promo", "first_topup", "pass", "pack", "topup", "other",
    ]);
    expect(GAMES_CATEGORY_SECTIONS.map((section) => section.label)).toEqual([
      "Terlaris", "Spesial", "Promo", "Top up pertama", "Pass & membership",
      "Paket mingguan/bulanan", "Top up", "Lainnya",
    ]);
    expect(gamesCategoryLabel("first_topup")).toBe("Top up pertama");
    expect(gamesCategoryLabel("bogus" as never)).toBe("Lainnya");
  });

  it("nilai display_group yang sah = 8 kategori", () => {
    // Urutan daftar mengikuti spesifikasi B6; urutan SECTION berbeda (bestseller dulu).
    expect([...GAMES_DISPLAY_GROUP_VALUES]).toEqual([
      "special", "bestseller", "promo", "first_topup", "pass", "pack", "topup", "other",
    ]);
    expect([...GAMES_DISPLAY_GROUP_VALUES].sort()).toEqual([...GAMES_CATEGORY_ORDER].sort());
    expect(isGamesDisplayGroupValue("promo")).toBe(true);
    expect(isGamesDisplayGroupValue("all")).toBe(false);
    expect(isGamesDisplayGroupValue(null)).toBe(false);
  });
});

describe("cleanGamesFieldLabel", () => {
  it.each([
    ["User ID :", "User ID"],
    ["No Hp", "No Hp"],
    ["  Zone ID  :  ", "Zone ID"],
    ["User ID:", "User ID"],
    ["Server  ID", "Server ID"],
    ["", ""],
    [null, ""],
  ])("%j → %j", (input, expected) => {
    expect(cleanGamesFieldLabel(input)).toBe(expected);
  });
});

// V2 (PM 14 Nov): label generik supplier tidak boleh tampil ke pembeli.
describe("isGenericGamesFieldLabel", () => {
  it.each([
    ["Catatan", true],
    ["catatan", true],
    ["  Catatan : ", true],
    ["Note", true],
    ["notes", true],
    ["Keterangan", true],
    ["Keterangan :", true],
    ["", true],
    [null, true],
    ["User ID", false],
    ["No Hp", false],
    ["Zepetto ID", false],
    ["Server akun kamu, global , sea , america", false],
  ])("%j → %s", (input, expected) => {
    expect(isGenericGamesFieldLabel(input)).toBe(expected);
  });
});

describe("gamesFieldLabelMajority", () => {
  const fields = (...labels: string[]) => labels.map((label) => ({ key: "note", label }));

  it("memilih label mayoritas dan mengabaikan label generik", () => {
    // Mobile Legends: 349 "User ID" vs 3 "Catatan".
    const majority = gamesFieldLabelMajority([fields("User ID"), fields("Catatan"), fields("User ID")]);
    expect(majority.get("note")).toBe("User ID");
  });

  it("cukup satu label bermakna untuk menang atas label generik", () => {
    const majority = gamesFieldLabelMajority([fields("Catatan"), fields("Note"), fields("Customer ID")]);
    expect(majority.get("note")).toBe("Customer ID");
  });

  it("key tanpa label bermakna tidak masuk peta", () => {
    const majority = gamesFieldLabelMajority([fields("Catatan"), fields("Keterangan"), fields("")]);
    expect(majority.has("note")).toBe(false);
  });

  it("tie dimenangkan label yang lebih dulu muncul (fc-mobile/zepeto)", () => {
    const majority = gamesFieldLabelMajority([fields("Customer ID"), fields("Catatan"), fields("Customer ID")]);
    expect(majority.get("note")).toBe("Customer ID");
    const tie = gamesFieldLabelMajority([fields("A ID"), fields("B ID")]);
    expect(tie.get("note")).toBe("A ID");
  });

  it("memisahkan per key: note dan zone_id tidak saling memengaruhi", () => {
    const majority = gamesFieldLabelMajority([
      [{ key: "note", label: "User ID" }, { key: "zone_id", label: "Zona ID" }],
      [{ key: "note", label: "Catatan" }, { key: "zone_id", label: "Catatan" }],
    ]);
    expect(majority.get("note")).toBe("User ID");
    expect(majority.get("zone_id")).toBe("Zona ID");
  });

  it("label dibersihkan saat dihitung (titik dua di akhir dibuang)", () => {
    const majority = gamesFieldLabelMajority([fields("User ID :"), fields("User ID")]);
    expect(majority.get("note")).toBe("User ID");
  });

  it("daftar kosong menghasilkan peta kosong", () => {
    expect(gamesFieldLabelMajority([]).size).toBe(0);
  });
});
