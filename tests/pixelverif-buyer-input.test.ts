import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAdminToken, createIdleToken } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { runMaintenanceCleanup } from "@/lib/maintenance-cleanup";
import { purgePixelverifInput } from "@/lib/pixelverif/purge";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";

let fx: ReturnType<typeof createD1Fixture>;
const codes = { expired: "AXV-20261122-EXPIRED1", cancelled: "AXV-20261122-CANCEL01", unpaid: "AXV-20261122-UNPAID01", paid: "AXV-20261122-PAID0001", active: "AXV-20261122-ACTIVE01" };
const markers = ["fixture-password-marker", "fixture-second-factor-marker", "fixture-encrypted-marker", "fixture-iv-marker"];
beforeEach(async () => {
  fx = createD1Fixture();
  await insertTestProduct(fx.sql);
  vi.stubEnv("ADMIN_JWT_SECRET", "pixel-admin-test-only");
  vi.stubEnv("ADMIN_EMAIL", "admin@example.test");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "pixel-buyer-test-only");
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); });

function createInput(code: string, index = 0) {
  fx.sql.prepare(`INSERT INTO pixelverif_buyer_inputs(order_code,item_index,input_ciphertext,input_iv,email_masked,fingerprint)
    VALUES(?,?,?,?,'f***@example.test','fixture-hash')`).run(code, index, markers[2], markers[3]);
}

it("clears only eligible legacy data, 50 rows per hourly run; repeated purges are idempotent", async () => {
  for (const [key, code] of Object.entries(codes)) {
    insertTestOrder(fx.sql, code, { status: ({ expired: "kadaluarsa", cancelled: "dibatalkan", paid: "lunas" } as Record<string, string>)[key] ?? "pending" });
    createInput(code);
  }
  fx.sql.prepare("UPDATE orders SET expires_at=datetime('now','-5 minutes') WHERE code IN (?,?)").run(codes.unpaid, codes.paid);
  fx.sql.prepare("UPDATE orders SET expires_at=datetime('now','+5 minutes') WHERE code=?").run(codes.active);
  for (let n = 1; n <= 50; n++) createInput(codes.expired, n);
  const db = createDatabaseAccess(fx.db);
  const count = () => Number(fx.sql.prepare("SELECT COUNT(*) AS n FROM pixelverif_buyer_inputs WHERE purged_at IS NOT NULL AND input_ciphertext IS NULL AND input_iv IS NULL").get()?.n);
  await runMaintenanceCleanup(db);
  expect(count()).toBe(50);
  expect(await runMaintenanceCleanup(db)).toMatchObject({ cleanup_skipped: "interval" });
  expect(count()).toBe(50);
  fx.sql.exec("UPDATE store_settings SET value=datetime('now','-61 minutes') WHERE key='maintenance_cleanup_at'");
  await runMaintenanceCleanup(db);
  expect(count()).toBe(53);
  expect(fx.sql.prepare("SELECT order_code FROM pixelverif_buyer_inputs WHERE purged_at IS NULL ORDER BY order_code").all()).toEqual([
    { order_code: codes.active }, { order_code: codes.paid },
  ]);
  expect(await purgePixelverifInput(db, codes.paid, 0)).toBe(1);
  expect(await purgePixelverifInput(db, codes.paid, 0)).toBe(0);
});

it("does not expose legacy input through buyer status, lookup, or admin lists/audit", async () => {
  const code = codes.paid;
  insertTestOrder(fx.sql, code, { channel: "web", status: "lunas", items: [{
    name: "Pixel fixture", price: 10000, qty: 1,
    buyer_fields: { pv_password: markers[0], pv_totp_secret: markers[1] },
    pixelverif_input: { input_ciphertext: markers[2], input_iv: markers[3] },
  }] });
  const email = "fixture@example.test";
  fx.sql.prepare("UPDATE orders SET customer_email=?,buyer_access_format='pin6',buyer_access_version=1 WHERE code=?").run(email, code);
  createInput(code);
  const row = fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;
  const { deriveOrderAccessCode } = await import("@/lib/order-access");
  const pin = await deriveOrderAccessCode(row);
  const { GET: status } = await import("@/app/api/orders/route");
  const { POST: lookup } = await import("@/app/api/orders/lookup/route");
  const { GET: admin } = await import("@/app/api/admin/orders/route");
  const session = await createAdminToken("admin@example.test");
  const idle = await createIdleToken(session.sid);
  const responses = [
    await status(new NextRequest(`https://axvara.test/api/orders?code=${code}`, { headers: { "x-order-contact": email } })),
    await lookup(new NextRequest("https://axvara.test/api/orders/lookup", { method: "POST", body: JSON.stringify({ code, contact: email, access_code: pin }) })),
    await admin(new NextRequest("https://axvara.test/api/admin/orders?page=1", { headers: { cookie: `axvara_admin_token=${session.token}; axvara_idle=${idle}` } })),
  ];
  for (const [index, response] of responses.entries()) {
    expect(response.status, ["buyer status", "lookup", "admin list"][index]).toBe(200);
    const text = await response.text();
    expect(text).toContain("Pixel fixture");
    for (const marker of markers) expect(text).not.toContain(marker);
    expect(text).not.toMatch(/pixelverif_input|input_ciphertext|pv_password|pv_totp_secret/);
  }
  for (const marker of markers) expect(JSON.stringify(fx.sql.prepare("SELECT * FROM security_events").all())).not.toContain(marker);
});
