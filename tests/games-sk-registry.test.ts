// tests/games-sk-registry.test.ts — kontrak katalog Sekalipay: slug stabil,
// kontrak field per varian (teks, bukan tebakan numerik), aset, dan availability.
import { describe, expect, it } from "vitest";
import {
  GAMES_REGISTRY,
  gamesRegistryGame,
  gamesSkRowPurchasable,
  gamesSlugify,
  isAllowedSkImageUrl,
  parseGamesSkContract,
  sanitizeSkImageUrl,
  type GamesSkContract,
} from "@/lib/games/registry";
import { normalizeSkGamesContract } from "@/lib/games/sk-catalog-sync";
import type { SkVariant } from "@/lib/sekalipay/client";

const variant = (over: Partial<SkVariant> = {}): SkVariant => ({
  id: 1,
  sku: "VAR1",
  name: "100 Diamond",
  price: 10000.4,
  stock: 100,
  order_process: "h2h",
  h2h_provider: "h2h",
  provider_meta: null,
  required_fields: [{ key: "note", label: "User ID :", required: true }],
  validation: { available: false, requires_zone_id: false, fields: [] },
  updated_at: null,
  ...over,
});

const contract = (over: Partial<SkVariant> = {}): GamesSkContract => normalizeSkGamesContract(variant(over));

describe("gamesSlugify / legacy overrides", () => {
  it("derives stable slugs from supplier product names", () => {
    expect(gamesSlugify("Pubg Mobile")).toBe("pubg-mobile");
    expect(gamesSlugify("Mobile Legends")).toBe("mobile-legends");
    expect(gamesSlugify("Free Fire Max")).toBe("free-fire-max");
    expect(gamesSlugify("Honkai: Star Rail")).toBe("honkai-star-rail");
    expect(gamesSlugify("Pokémon Unite")).toBe("pokemon-unite");
    expect(gamesSlugify("  **  ")).toBe("");
  });

  it("keeps the four existing legacy slugs resolved by the registry", () => {
    for (const game of GAMES_REGISTRY) {
      const derived = gamesRegistryGame(gamesSlugify(game.name));
      expect(derived?.slug).toBe(game.slug);
      expect(derived?.publisher).toBe(game.publisher);
      expect(derived?.icon).toBe(game.icon);
    }
  });
});

describe("sanitizeSkImageUrl", () => {
  it("accepts only exact HTTPS supplier product images", () => {
    expect(sanitizeSkImageUrl("https://sekalipay.com/images/products/oGHiZojNr2.png"))
      .toBe("https://sekalipay.com/images/products/oGHiZojNr2.png");
    expect(isAllowedSkImageUrl("https://sekalipay.com/images/products/a.webp")).toBe(true);
    for (const bad of [
      "http://sekalipay.com/images/products/a.png",
      "https://evil.example/images/products/a.png",
      "https://sekalipay.com.evil.example/images/products/a.png",
      "https://sekalipay.com/images/products/a.svg",
      "https://sekalipay.com/images/products/a.png?x=1",
      "https://user:pass@sekalipay.com/images/products/a.png",
      "https://sekalipay.com/images/other/a.png",
      "https://sekalipay.com/images/products/../private/a.png",
      "/images/products/a.png",
      "",
    ]) expect(sanitizeSkImageUrl(bad)).toBeNull();
  });
});

describe("normalizeSkGamesContract", () => {
  it("supports note-only and note+zone with text input and bounded lengths", () => {
    expect(contract()).toMatchObject({ supported: true, reason: null, requires_zone_id: false, open_denom: false });
    expect(contract().fields).toEqual([
      { key: "note", label: "User ID :", required: true, input: "text", min: 1, max: 50 },
    ]);

    const zoned = contract({
      required_fields: [
        { key: "note", label: "User ID", required: true },
        { key: "zone_id", label: "Zone ID", required: true },
      ],
      validation: { available: true, requires_zone_id: true, fields: [] },
    });
    expect(zoned).toMatchObject({ supported: true, requires_zone_id: true, validation_available: true });
    expect(zoned.fields.find((field) => field.key === "zone_id")).toMatchObject({ input: "text", min: 1, max: 20 });
  });

  it("keeps an optional note optional and never guesses digit-only patterns", () => {
    const optional = contract({ required_fields: [{ key: "note", label: "Riot #tag", required: false }] });
    expect(optional).toMatchObject({ supported: true });
    expect(optional.fields[0]).toEqual({ key: "note", label: "Riot #tag", required: false, input: "text", min: 1, max: 50 });
    expect(optional.fields[0]).not.toHaveProperty("pattern");
  });

  it("imports but disables unsupported contracts with an explicit reason", () => {
    expect(contract({ provider_meta: { open_denom: true } }))
      .toMatchObject({ supported: false, open_denom: true, reason: "open_denom" });
    expect(contract({ required_fields: [{ key: "note", label: "ID", required: true }, { key: "server", label: "Server", required: true }] }))
      .toMatchObject({ supported: false, reason: "unknown_field" });
    expect(contract({ order_process: "auto" })).toMatchObject({ supported: false, reason: "order_process" });
    expect(contract({ required_fields: null })).toMatchObject({ supported: false, reason: "missing_note" });
    expect(contract({ required_fields: [{ key: "note", label: "ID", required: true }], validation: { available: false, requires_zone_id: true, fields: [] } }))
      .toMatchObject({ supported: false, reason: "missing_zone" });
    expect(contract({ required_fields: "[]" as unknown as SkVariant["required_fields"] }))
      .toMatchObject({ supported: false, reason: "malformed_required_fields" });
    expect(contract({ validation: "nope" as unknown as SkVariant["validation"] }))
      .toMatchObject({ supported: false, reason: "malformed_validation" });
  });

  it("strips markup/control characters from labels and caps them", () => {
    const dirty = contract({ required_fields: [{ key: "note", label: `<b>ID\u0000</b> ${"x".repeat(80)}`, required: true }] });
    expect(dirty.fields[0].label.startsWith("ID x")).toBe(true);
    expect(dirty.fields[0].label.length).toBeLessThanOrEqual(40);
    expect(dirty.fields[0].label).not.toMatch(/[<>]/);
  });
});

describe("parseGamesSkContract", () => {
  it("round-trips the stored JSON and rejects malformed records", () => {
    const stored = JSON.stringify(contract());
    expect(parseGamesSkContract(stored)).toMatchObject({ version: 1, supported: true });
    expect(parseGamesSkContract(contract())).toMatchObject({ version: 1, supported: true });
    for (const bad of [null, undefined, "", "{}", "{not json", JSON.stringify({ version: 2, fields: [], supported: true }), JSON.stringify({ version: 1, fields: [{ key: "note" }], supported: true })]) {
      expect(parseGamesSkContract(bad)).toBeNull();
    }
  });

  it("rejects duplicate keys, non-boolean flags, over-limit fields, and incoherent support", () => {
    const base = contract();
    const bad: unknown[] = [
      { ...base, fields: [base.fields[0], base.fields[0]] },
      { ...base, requires_zone_id: "true" },
      { ...base, open_denom: 0 },
      { ...base, validation_available: null },
      { ...base, fields: [{ ...base.fields[0], max: 51 }] },
      { ...base, fields: [{ ...base.fields[0], max: 0 }] },
      { ...base, supported: true, reason: "open_denom" },
      { ...base, open_denom: true },
      { ...base, supported: false, reason: null },
      { ...base, fields: [] },
    ];
    for (const value of bad) expect(parseGamesSkContract(value)).toBeNull();
    const zoned = contract({
      required_fields: [
        { key: "note", label: "ID", required: true },
        { key: "zone_id", label: "Zone", required: true },
      ],
      validation: { available: false, requires_zone_id: true, fields: [] },
    });
    expect(parseGamesSkContract(zoned)).not.toBeNull();
    expect(parseGamesSkContract({ ...zoned, fields: [zoned.fields[0]] })).toBeNull();
    expect(parseGamesSkContract({ ...zoned, fields: [zoned.fields[0], { ...zoned.fields[1], required: false }] })).toBeNull();
  });
});

describe("gamesSkRowPurchasable", () => {
  const base = {
    supplier: "sekalipay", supplier_active: 1, stock: 10, min_order: 1, cost: 10001, sell_price: 10302,
    required_fields_json: JSON.stringify(contract()),
  };
  it("requires an active, in-stock, qty-1, supported SK row", () => {
    expect(gamesSkRowPurchasable(base)).toBe(true);
    expect(gamesSkRowPurchasable({ ...base, supplier: "digiflazz" })).toBe(false);
    expect(gamesSkRowPurchasable({ ...base, supplier_active: 0 })).toBe(false);
    expect(gamesSkRowPurchasable({ ...base, stock: 0 })).toBe(false);
    expect(gamesSkRowPurchasable({ ...base, min_order: 2 })).toBe(false);
    expect(gamesSkRowPurchasable({ ...base, cost: 0 })).toBe(false);
    expect(gamesSkRowPurchasable({ ...base, sell_price: 0 })).toBe(false);
    expect(gamesSkRowPurchasable({ ...base, required_fields_json: JSON.stringify(contract({ provider_meta: { open_denom: true } })) })).toBe(false);
    expect(gamesSkRowPurchasable({ ...base, required_fields_json: "garbage" })).toBe(false);
  });
});
