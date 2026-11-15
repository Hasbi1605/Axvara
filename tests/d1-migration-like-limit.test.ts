// D1 produksi menolak pola LIKE/GLOB panjang ("LIKE or GLOB pattern too complex",
// SQLITE_ERROR 7500; batas D1 50 byte) padahal SQLite lokal menerimanya. Insiden
// 15 Nov 2026: migrasi 0127 gagal di CI dan menghentikan deploy. Penjaga statis:
// semua literal pola di migrasi harus muat batas D1.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const D1_LIKE_PATTERN_MAX_BYTES = 50;
const DIR = "drizzle/migrations";

describe("migrasi D1: pola LIKE/GLOB muat batas produksi", () => {
  it(`tidak ada literal LIKE/GLOB > ${D1_LIKE_PATTERN_MAX_BYTES} byte`, () => {
    const offenders: string[] = [];
    for (const file of readdirSync(DIR).filter(name => name.endsWith(".sql"))) {
      const sql = readFileSync(`${DIR}/${file}`, "utf8");
      for (const match of sql.matchAll(/\b(?:LIKE|GLOB)\s+'((?:[^']|'')*)'/gi)) {
        const pattern = match[1].replace(/''/g, "'");
        if (Buffer.byteLength(pattern, "utf8") > D1_LIKE_PATTERN_MAX_BYTES) offenders.push(`${file}: ${pattern.slice(0, 40)}…`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
