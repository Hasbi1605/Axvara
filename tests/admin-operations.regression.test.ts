import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("admin operational workspace", () => {
  it("keeps order filters, pagination, and CSV export on the authenticated server API", () => {
    const api = read("src/app/api/admin/orders/route.ts");
    const manager = read("src/components/admin/OrdersManager.tsx");
    expect(api).toContain("requireAdmin");
    expect(api).toContain('params.get("channel")');
    expect(api).toContain('params.get("date_from")');
    expect(api).toContain('params.get("export") === "csv"');
    expect(api).toContain("LIMIT ? OFFSET ?");
    expect(manager).toContain("Export CSV");
    expect(manager).toContain("WhatsApp");
  });

  it("uses QRIS Hook as the only approval authority for QRIS orders", () => {
    const manager = read("src/components/admin/OrdersManager.tsx");
    const events = read("src/app/api/admin/payments/events/route.ts");
    expect(manager).toContain("Menunggu QRIS Hook");
    expect(manager).toContain("Bukti hanya referensi");
    expect(events).toContain("retry_match");
    expect(events).toContain("transitionPendingPaymentToPaid");
  });

  it("neutralizes spreadsheet formulas in the CSV export (issue #9)", async () => {
    const { sanitizeCsvField, csvCell } = await import("@/lib/csv");
    // Payload klasik: dievaluasi sebagai formula tanpa sanitasi.
    expect(sanitizeCsvField("=cmd|'/c calc'!A0")).toBe("'=cmd|'/c calc'!A0");
    expect(sanitizeCsvField("+1+1")).toBe("'+1+1");
    expect(sanitizeCsvField("-2+3")).toBe("'-2+3");
    expect(sanitizeCsvField("@SUM(A1:A10)")).toBe("'@SUM(A1:A10)");
    // Whitespace/control character di depan tidak boleh menyembunyikan trigger.
    expect(sanitizeCsvField("  =HYPERLINK(\"http://x\")")).toBe("'  =HYPERLINK(\"http://x\")");
    expect(sanitizeCsvField("\t+1+1")).toBe("'\t+1+1");
    expect(sanitizeCsvField(" @evil")).toBe("' @evil");
    // Keterbacaan data aman: tidak diubah.
    expect(sanitizeCsvField("Budi Santoso")).toBe("Budi Santoso");
    expect(sanitizeCsvField("082135277434")).toBe("082135277434");
    expect(sanitizeCsvField("user@example.com")).toBe("user@example.com");
    expect(sanitizeCsvField("AXV-20260907-AB12CD34")).toBe("AXV-20260907-AB12CD34");
    expect(sanitizeCsvField("ChatGPT Plus 1 Bulan x1")).toBe("ChatGPT Plus 1 Bulan x1");
    expect(sanitizeCsvField(89000)).toBe("89000");
    expect(sanitizeCsvField(null)).toBe("");
    // Newline tetap diratakan (perilaku lama dipertahankan), quote tetap di-escape.
    expect(sanitizeCsvField("baris1\nbaris2")).toBe("baris1 baris2");
    // Sel yang sudah disanitasi tidak menjadi formula saat di-quote:
    // `"..."` di sekitar `'=...` membuat spreadsheet memperlakukannya teks.
    const quoted = csvCell("=1+1");
    expect(quoted).toBe("\"'=1+1\"");
    expect(quoted.startsWith('"=')).toBe(false);
    // Unicode dipertahankan (BOM + teks non-ASCII tidak rusak).
    expect(sanitizeCsvField("Toko Kucing 🐱")).toContain("🐱");
    // Seluruh kolom CSV (termasuk header) melewati sanitasi di kode route.
    const api = read("src/app/api/admin/orders/route.ts");
    expect(api).toContain('import { csvCell } from "@/lib/csv"');
    expect(api).toContain("header.map(csvCell)");
    expect(read("src/lib/csv.ts")).toContain("sanitizeCsvField");
  });

  it("stores editable storefront settings without exposing admin writes", () => {
    const migration = read("drizzle/migrations/0011_store_settings.sql");
    const api = read("src/app/api/store-settings/route.ts");
    const navbar = read("src/components/storefront/Navbar.tsx");
    const footer = read("src/components/storefront/Footer.tsx");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS store_settings");
    expect(api).toContain("export async function GET");
    expect(api).toContain("export async function PUT");
    expect(api).toContain("requireAdmin");
    expect(navbar).toContain("storeSettings.name");
    expect(footer).toContain("storeSettings.name");
  });
});
