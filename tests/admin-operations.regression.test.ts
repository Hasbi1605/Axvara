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
    expect(footer).toContain("storeSettings.footerText");
  });
});
