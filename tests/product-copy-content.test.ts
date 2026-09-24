// tests/product-copy-content.test.ts — Salinan Axvara tidak boleh mengurangi
// ketegasan pemasok (permintaan owner 2026-09-24).
//
// Snapshot = teks WR di D1 produksi saat dikurasi. Untuk tiap pasangan S&K +
// cara aktivasi: semua angka (durasi, garansi, batas perangkat, harga), URL,
// dan "keluarga aturan" (larangan, tanpa garansi, refund, perangkat, sanksi,
// dst.) yang ada di teks pemasok WAJIB ada di salinan Axvara. Deskripsi baru
// (migrasi 0040) dicek dengan cara yang sama terhadap deskripsi lamanya.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import snapshot from "./fixtures/product-copy-snapshot.json";
import { createD1Fixture } from "./helpers/d1-fixture";
import { CURATED_VARIANT_COPY, type CuratedVariantCopy } from "@/lib/product-copy/curated";
import { parseProductDescription } from "@/lib/product-copy/format";

const MIGRATION = fs.readFileSync("drizzle/migrations/0040_axvara_product_copy.sql", "utf8");

function entryStrings(entry: CuratedVariantCopy): string[] {
  return [
    ...(entry.paket ?? []),
    ...(entry.proses ?? []),
    ...(entry.aturan ?? []),
    ...(entry.garansi ?? []),
    ...(entry.langkah ?? []),
    ...(entry.grupLangkah ?? []).flatMap((group) => [group.judul, ...group.langkah]),
    ...(entry.catatan ?? []),
  ];
}

const URL_RE = /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|site|us|ai|me|tech|app|dev|io|net|org)(?:\/[^\s),]*)?/gi;

function supplierUrls(raw: string): string[] {
  return [...raw.normalize("NFKC").matchAll(URL_RE)].map((m) => m[0].replace(/[/.]+$/, "").replace(/^https?:\/\//, "").toLowerCase());
}

/** Angka bermakna di teks pemasok (tanpa nomor urut daftar, tanpa angka di URL / "masing2"). */
function supplierNumbers(raw: string): string[] {
  const text = raw
    .normalize("NFKC")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d{1,2}[.)](?![\d.])\s*/, ""))
    .join("\n")
    .replace(URL_RE, " ");
  const found = new Set<string>();
  for (const m of text.matchAll(/(?<![\p{L}\d.,])\d+(?:[.,]\d+)*/gu)) found.add(m[0]);
  for (const m of text.matchAll(/(\d+)\s*[x×]\s*(\d+)/gi)) {
    found.add(m[1]);
    found.add(m[2]);
  }
  return [...found];
}

function containsNumber(text: string, num: string): boolean {
  return new RegExp(`(?<!\\d)${num.replace(/[.]/g, "\\.")}(?!\\d)`).test(text);
}

// [nama, pola di teks pemasok, pola yang wajib ada di salinan Axvara]
const FAMILIES: [string, RegExp, RegExp][] = [
  ["garansi", /garansi|backfree|back\s*free|\bbf\b|nogar|backree/i, /garansi/i],
  [
    "tanpa garansi / tanpa komplain",
    /no\s*gar|nogar|non\s*garansi|tidak ada garansi|tidak garansi|tidak (?:termasuk|berlaku)[^.\n]*garansi|garansi[^.\n]*tidak berlaku|no komplain/i,
    /tanpa garansi|tidak ada garansi|tidak berlaku|tidak termasuk|tidak ditanggung|tanpa komplain/i,
  ],
  ["larangan", /dilarang|jangan/i, /dilarang|jangan/i],
  ["kewajiban", /wajib|harus/i, /wajib|harus/i],
  ["perangkat", /device|perangkat/i, /perangkat/i],
  ["refund", /refund/i, /refund/i],
  ["password", /password|kata sandi|\bpass\b/i, /password|kata sandi/i],
  ["email", /e-?mail|gmail/i, /email|gmail/i],
  ["sharing", /sharing|\bshare\b/i, /sharing|dibagi|berbagi/i],
  ["limit", /limit/i, /limit/i],
  ["sanksi", /hangus|tarik|denda|suspend|banned|\bban\b|diban/i, /hangus|ditarik|denda|suspend|banned/i],
  ["OTP", /\botp\b/i, /\bOTP\b/],
  ["VPN", /\bvpn\b/i, /\bVPN\b/],
  ["TV", /\btv\b/i, /\bTV\b/],
  ["Android", /android|\bandro\b/i, /Android/],
  ["iOS", /\bios\b/i, /\biOS\b/],
  ["Windows", /windows/i, /Windows/],
  ["website / browser", /website|browser|\bweb\b/i, /website|browser|\bweb\b/i],
  ["WhatsApp", /whatsapp|\bwa\b/i, /WhatsApp|\bWA\b/],
  ["admin", /\badmin\b/i, /\badmin\b/i],
];

const SLANG = /\b(?:gak|ga|gada|krn|krna|karna|klo|kalo|yg|dlu|tnggal|sampe|koid|mulu|bkn|pake|masukin|siapin|ngerti|nyangkut|abis|aja|silahkan|amanin|incor|nogar)\b|bl4ck/i;
const ALLOWED_CAPS = new Set(["IDEA"]);

function styleProblems(item: string): string[] {
  const problems: string[] = [];
  if (item !== item.trim() || /\s{2,}/.test(item)) problems.push("spasi");
  if (/\p{Extended_Pictographic}/u.test(item)) problems.push("emoji");
  if (/!/.test(item)) problems.push("tanda seru");
  if (/\.$/.test(item)) problems.push("titik di akhir poin");
  if (SLANG.test(item)) problems.push("bahasa gaul/singkatan pemasok");
  const shouting = item.match(/\b\p{Lu}{5,}\b/gu)?.filter((word) => !ALLOWED_CAPS.has(word)) ?? [];
  if (shouting.length) problems.push(`huruf besar: ${shouting.join(",")}`);
  if (/^\p{Ll}/u.test(item) && !/^(?:i[A-Z]|e[A-Z])/.test(item)) problems.push("huruf kecil di awal");
  return problems;
}

const byKey = new Map(CURATED_VARIANT_COPY.map((entry) => [entry.key, entry]));

describe("cakupan kurasi S&K + cara aktivasi", () => {
  it("setiap pasangan teks WR di snapshot punya salinan Axvara, dan sebaliknya", () => {
    const snapshotKeys = new Set(snapshot.pairs.map((p) => p.key));
    expect(snapshot.pairs.filter((p) => !byKey.has(p.key)).map((p) => p.variants.join(" | "))).toEqual([]);
    expect(CURATED_VARIANT_COPY.filter((entry) => !snapshotKeys.has(entry.key)).map((entry) => entry.label)).toEqual([]);
    expect(byKey.size).toBe(CURATED_VARIANT_COPY.length);
  });

  it("label audit menunjuk produk yang sama dengan snapshot", () => {
    for (const p of snapshot.pairs) {
      const slug = byKey.get(p.key)!.label.split(" · ")[0];
      expect(p.variants.some((variant) => variant.startsWith(`${slug} · `)), p.variants.join()).toBe(true);
    }
  });
});

describe.each(snapshot.pairs.map((p) => [p.variants.join(" | "), p] as const))("salinan Axvara: %s", (_name, p) => {
  const entry = byKey.get(p.key)!;
  const items = entryStrings(entry);
  const joined = items.join("\n");
  const supplier = `${p.terms ?? ""}\n${p.deliveryTerms ?? ""}`;
  const supplierNorm = supplier.normalize("NFKC");

  it("semua angka pemasok terbawa", () => {
    const missing = supplierNumbers(supplier).filter((num) => !containsNumber(joined, num));
    expect(missing).toEqual([]);
  });

  it("semua URL pemasok terbawa", () => {
    const lower = joined.toLowerCase();
    expect(supplierUrls(supplier).filter((url) => !lower.includes(url))).toEqual([]);
  });

  it("tidak ada keluarga aturan pemasok yang hilang", () => {
    const lost = FAMILIES.filter(([, inSupplier, inAxvara]) => inSupplier.test(supplierNorm) && !inAxvara.test(joined)).map(([name]) => name);
    expect(lost).toEqual([]);
  });

  it("gaya Axvara seragam: kalimat biasa, tanpa emoji/teriakan/gaul, tanpa poin ganda", () => {
    const problems = items.flatMap((item) => styleProblems(item).map((problem) => `${problem} → ${item}`));
    expect(problems).toEqual([]);
    const keys = items.map((item) => item.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim());
    expect(keys.filter((key, i) => keys.indexOf(key) !== i)).toEqual([]);
    expect(items.every((item) => item.length > 0)).toBe(true);
  });
});

function seedFromSnapshot() {
  const fixture = createD1Fixture();
  const insert = fixture.sql.prepare(
    "INSERT INTO products (name, slug, description, price, is_active, source) VALUES (?, ?, ?, 1000, ?, ?)",
  );
  for (const d of snapshot.descriptions) insert.run(d.name, d.slug, d.description, d.isActive ? 1 : 0, d.source);
  return fixture;
}

type Row = { slug: string; source: string; description: string | null; admin_description_override: string | null };

describe("deskripsi versi Axvara (migrasi 0040)", () => {
  const fixture = seedFromSnapshot();
  fixture.sql.exec(MIGRATION);
  const rows = fixture.sql.prepare("SELECT slug, source, description, admin_description_override FROM products").all() as Row[];
  fixture.close();
  const shown = (row: Row) => (row.source === "warung_rebahan" ? row.admin_description_override : row.description) ?? "";

  it("semua produk di snapshot mendapat deskripsi baru di kolom yang benar", () => {
    expect(rows).toHaveLength(snapshot.descriptions.length);
    for (const row of rows) {
      const original = snapshot.descriptions.find((d) => d.slug === row.slug)!;
      if (row.source === "warung_rebahan") {
        // Teks milik WR tidak disentuh; versi Axvara masuk kolom milik admin.
        expect(row.description, row.slug).toBe(original.description);
        expect(row.admin_description_override, row.slug).toBeTruthy();
      } else {
        expect(row.description, row.slug).not.toBe(original.description);
      }
    }
  });

  it.each(snapshot.descriptions.map((d) => [d.slug, d] as const))("%s: angka terbawa, format seragam, gaya Axvara", (slug, original) => {
    const row = rows.find((r) => r.slug === slug)!;
    const text = shown(row);
    const parsed = parseProductDescription(text);
    expect(parsed.blocks[0]?.type, "diawali paragraf pembuka").toBe("p");
    expect(parsed.sections, "tanpa bagian bebas di deskripsi").toEqual([]);
    const missing = supplierNumbers(original.description ?? "").filter((num) => !containsNumber(text, num));
    expect(missing).toEqual([]);
    const bullets = parsed.blocks.flatMap((b) => (b.type === "list" ? b.items : []));
    const problems = [...bullets, ...parsed.terms, ...parsed.activation].flatMap((item) => styleProblems(item).map((p) => `${p} → ${item}`));
    expect(problems).toEqual([]);
    expect(text).not.toMatch(/\p{Extended_Pictographic}|!/u);
    expect(text).not.toMatch(SLANG);
  });

  it("GSuite (non-WR) membawa S&K-nya sendiri dalam format yang sama dengan produk WR", () => {
    const gsuite = parseProductDescription(shown(rows.find((r) => r.slug === "akun-gsuite")!));
    expect(gsuite.terms.join(" ")).toMatch(/masa aktif akun, bukan waktu proses/);
    expect(gsuite.terms.join(" ")).toMatch(/Full garansi selama masa aktif akun/);
  });
});

describe("migrasi 0040 menghormati kepemilikan & idempoten", () => {
  it("override admin yang sudah ada dan suntingan admin non-WR tidak ditimpa", () => {
    const fixture = seedFromSnapshot();
    fixture.sql.prepare("UPDATE products SET admin_description_override='Tulisan admin' WHERE slug='netflix-premium'").run();
    fixture.sql.prepare("UPDATE products SET description='Disunting admin' WHERE slug='akun-gsuite'").run();
    fixture.sql.exec(MIGRATION);
    const get = (slug: string) =>
      fixture.sql.prepare("SELECT description, admin_description_override FROM products WHERE slug=?").get(slug) as Row;
    expect(get("netflix-premium").admin_description_override).toBe("Tulisan admin");
    expect(get("akun-gsuite").description).toBe("Disunting admin");
    expect(get("spotify-premium").admin_description_override).toMatch(/^Spotify Premium/);
    fixture.close();
  });

  it("produk manual dengan slug sama tidak ikut ditulis sebagai produk WR; jalan ulang tidak mengubah apa pun", () => {
    const fixture = createD1Fixture();
    fixture.sql.prepare("INSERT INTO products (name, slug, description, price, source) VALUES ('X', 'netflix-premium', 'Punya admin', 1000, 'manual')").run();
    fixture.sql.exec(MIGRATION);
    const first = fixture.sql.prepare("SELECT description, admin_description_override FROM products").all();
    fixture.sql.exec(MIGRATION);
    expect(fixture.sql.prepare("SELECT description, admin_description_override FROM products").all()).toEqual(first);
    expect(first).toEqual([{ description: "Punya admin", admin_description_override: null }]);
    fixture.close();
  });
});
