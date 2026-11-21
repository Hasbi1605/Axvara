// tests/order-contact-attempts.test.ts — AU-J2-2: unit coverage for the
// credential-reveal brute-force fence (contact-attempts) and the buyer-facing
// unique-unit progress reader. Real SQLite D1 fixture; fake system time so the
// 15-minute window arithmetic is deterministic.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { contactAttemptLimited, recordContactFailure } from "@/lib/orders/contact-attempts";
import { readUniqueUnitProgress } from "@/lib/orders/unit-progress";

const CODE = "AXV-20261121-CONTACT1";
const IP = "203.0.113.7";
const OTHER_IP = "203.0.113.8";
const T0 = new Date("2026-11-21T10:00:00.000Z");

let fx: ReturnType<typeof createD1Fixture>;
const db = () => createDatabaseAccess(fx.db);
const hash = (ip: string) => createHash("sha256").update(ip).digest("hex");
const windowId = () => Math.floor(Date.now() / 900_000);
const failures = (ip = IP) =>
  Number(fx.sql.prepare("SELECT failures FROM order_contact_attempts WHERE order_code=? AND client_hash=?").get(CODE, hash(ip))?.failures ?? 0);

beforeEach(async () => {
  fx = createD1Fixture();
  await insertTestProduct(fx.sql);
  insertTestOrder(fx.sql, CODE);
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  fx.close();
  vi.restoreAllMocks();
});

describe("contactAttemptLimited / recordContactFailure", () => {
  it("no-op without a D1 binding: never limited, never writes", async () => {
    const access = createDatabaseAccess(null);
    expect(await contactAttemptLimited(access, CODE, IP)).toBe(false);
    expect(await recordContactFailure(access, CODE, IP)).toBe(false);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM order_contact_attempts").get()?.n).toBe(0);
  });

  it("locks out on exactly the 20th failure inside the window", async () => {
    const d = db();
    for (let i = 1; i <= 19; i++) expect(await recordContactFailure(d, CODE, IP)).toBe(false);
    expect(await contactAttemptLimited(d, CODE, IP)).toBe(false);
    expect(failures()).toBe(19);

    expect(await recordContactFailure(d, CODE, IP)).toBe(true);
    expect(failures()).toBe(20);
    expect(await contactAttemptLimited(d, CODE, IP)).toBe(true);
    expect(await recordContactFailure(d, CODE, IP)).toBe(true);
    expect(failures()).toBe(21);
  });

  it("resets the counter when the 15-minute window rolls over and releases the lock", async () => {
    const d = db();
    for (let i = 0; i < 20; i++) await recordContactFailure(d, CODE, IP);
    expect(await contactAttemptLimited(d, CODE, IP)).toBe(true);

    vi.setSystemTime(new Date(T0.getTime() + 900_000));
    // Old-window row no longer matches the current window id → lock released.
    expect(await contactAttemptLimited(d, CODE, IP)).toBe(false);
    expect(await recordContactFailure(d, CODE, IP)).toBe(false);
    expect(failures()).toBe(1);
  });

  it("counts each client separately and stores only a SHA-256 hash of the IP", async () => {
    const d = db();
    for (let i = 0; i < 20; i++) await recordContactFailure(d, CODE, IP);
    expect(await contactAttemptLimited(d, CODE, IP)).toBe(true);
    expect(await contactAttemptLimited(d, CODE, OTHER_IP)).toBe(false);
    expect(failures(OTHER_IP)).toBe(0);

    const hashes = (fx.sql.prepare("SELECT client_hash FROM order_contact_attempts WHERE order_code=?").all(CODE) as { client_hash: string }[])
      .map((row) => row.client_hash);
    expect(hashes).toContain(hash(IP));
    expect(hashes).not.toContain(IP);
  });

  it("caps the stored failure count at 1000", async () => {
    fx.sql.prepare("INSERT INTO order_contact_attempts(order_code,client_hash,window_id,failures) VALUES(?,?,?,?)")
      .run(CODE, hash(IP), windowId(), 999);
    const d = db();
    expect(await recordContactFailure(d, CODE, IP)).toBe(true);
    expect(failures()).toBe(1000);
    expect(await recordContactFailure(d, CODE, IP)).toBe(true);
    expect(failures()).toBe(1000);
  });
});

describe("readUniqueUnitProgress", () => {
  const uniqueItem = (qty: number) => [{ product_id: 1, variant_id: 1, name: "Fixture", price: 1000, qty, fulfillment_mode: "unique", unique_units: true }];
  const unit = (code: string, index: number, status: string, ciphertext: string | null) =>
    fx.sql.prepare("INSERT INTO fulfillment_items(order_code,item_index,product_id,fulfillment_mode,status,delivered_ciphertext) VALUES(?,?,1,'unique',?,?)")
      .run(code, index, status, ciphertext);
  const progressFor = async (code: string) => {
    const row = fx.sql.prepare("SELECT code,status,items FROM orders WHERE code=?").get(code);
    if (!row) throw new Error(`fixture order missing: ${code}`);
    return readUniqueUnitProgress(row);
  };

  it("is hidden unless the order is lunas", async () => {
    insertTestOrder(fx.sql, "AXV-20261121-PROG001", { status: "pending", items: uniqueItem(3) });
    expect(await progressFor("AXV-20261121-PROG001")).toBeUndefined();
  });

  it("only appears when more than one unique unit is expected", async () => {
    insertTestOrder(fx.sql, "AXV-20261121-PROG002", { status: "lunas", items: uniqueItem(1) });
    expect(await progressFor("AXV-20261121-PROG002")).toBeUndefined();

    insertTestOrder(fx.sql, "AXV-20261121-PROG003", { status: "lunas", items: [] });
    expect(await progressFor("AXV-20261121-PROG003")).toBeUndefined();
  });

  it("counts only delivered unique units that carry a ciphertext", async () => {
    insertTestOrder(fx.sql, "AXV-20261121-PROG004", { status: "lunas", items: uniqueItem(3) });
    const code = "AXV-20261121-PROG004";
    unit(code, 0, "delivered", "cipher-a");
    unit(code, 1, "delivered", "cipher-b");
    unit(code, 2, "delivered", null);
    unit(code, 3, "sending", "cipher-c");
    expect(await progressFor(code)).toEqual({ ready: 2, total: 3 });
  });

  it("caps ready at the expected unit total and expands multiple tagged lines", async () => {
    insertTestOrder(fx.sql, "AXV-20261121-PROG005", {
      status: "lunas",
      items: [
        { product_id: 1, variant_id: 1, name: "A", price: 1000, qty: 2, fulfillment_mode: "unique", unique_units: true },
        { product_id: 1, variant_id: 1, name: "B", price: 1000, qty: 2, fulfillment_mode: "unique", unique_units: true },
      ],
    });
    const code = "AXV-20261121-PROG005";
    for (let i = 0; i < 5; i++) unit(code, i, "delivered", `cipher-${i}`);
    expect(await progressFor(code)).toEqual({ ready: 4, total: 4 });
  });

  it("untagged lines do not inflate the expected total and malformed items hide progress", async () => {
    insertTestOrder(fx.sql, "AXV-20261121-PROG006", {
      status: "lunas",
      items: [
        { product_id: 1, variant_id: 1, name: "Tagged", price: 1000, qty: 2, fulfillment_mode: "unique", unique_units: true },
        { product_id: 1, variant_id: 1, name: "Plain", price: 1000, qty: 5 },
      ],
    });
    const code = "AXV-20261121-PROG006";
    unit(code, 0, "delivered", "cipher-a");
    expect(await progressFor(code)).toEqual({ ready: 1, total: 2 });

    expect(await readUniqueUnitProgress({ code, status: "lunas", items: "not-json" })).toBeUndefined();
    expect(await readUniqueUnitProgress({ code, status: "lunas", items: { nope: true } })).toBeUndefined();
  });
});
