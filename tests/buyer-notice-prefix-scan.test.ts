// Audit AU-G2-4: `idempotency_key LIKE 'prefix%'` on buyer_notice_log did a full
// SCAN (SQLite's default LIKE is case-insensitive, so the TEXT primary-key index
// is unusable). The sweeps now filter by a BINARY range instead.
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { keyPrefixRange } from "@/lib/db/key-prefix";
import { credentialAccessKeyRange } from "@/lib/orders/access-email";

let f: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  f = createD1Fixture();
  f.sql.exec(`
    INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel)
      VALUES('A','B','6280','[]',1,'qris','lunas','paid','telegram');
    INSERT INTO buyer_notice_log(idempotency_key,order_code,channel,status) VALUES
      ('email:credential_access:A:v1','A','email','failed'),
      ('email:credential_access:A:v2','A','email','sent'),
      ('email:pedia-paid:A','A','email','failed'),
      ('telegram:cred:A','A','telegram','failed');
  `);
});
afterEach(() => f.close());

const plan = (sql: string, params: unknown[] = []) =>
  f.sql.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => String(row.detail));

describe("keyPrefixRange", () => {
  it("derives the exclusive BINARY upper bound", () => {
    expect(keyPrefixRange("email:credential_access:")).toEqual({
      start: "email:credential_access:",
      end: "email:credential_access;",
    });
    expect(keyPrefixRange("email:pedia-paid:")).toEqual({ start: "email:pedia-paid:", end: "email:pedia-paid;" });
    expect(() => keyPrefixRange("")).toThrow(/invalid_key_prefix/);
  });
});

describe("buyer_notice_log sweep plans", () => {
  it("credential-access sweep searches the primary-key index", () => {
    const details = plan(
      `SELECT idempotency_key, order_code, access_attempts FROM buyer_notice_log
        WHERE ${credentialAccessKeyRange()} AND status='failed'
        ORDER BY created_at ASC LIMIT 10`,
    );
    expect(details.join(" | ")).toMatch(/SEARCH buyer_notice_log USING INDEX sqlite_autoindex_buyer_notice_log_1/);
    expect(details.join(" | ")).not.toMatch(/SCAN buyer_notice_log/);
  });

  it("pedia phase sweep with bound range params searches the index", () => {
    const range = keyPrefixRange("email:pedia-paid:");
    const details = plan(
      `SELECT order_code, idempotency_key FROM buyer_notice_log b
        WHERE b.idempotency_key >= ? AND b.idempotency_key < ? AND b.status='failed' LIMIT 10`,
      [range.start, range.end],
    );
    expect(details.join(" | ")).toMatch(/SEARCH b USING INDEX sqlite_autoindex_buyer_notice_log_1/);
    expect(details.join(" | ")).not.toMatch(/SCAN buyer_notice_log/);
  });

  it("the LIKE-prefix form still scans, which is why the sweeps use a range", () => {
    const details = plan("SELECT idempotency_key FROM buyer_notice_log WHERE idempotency_key LIKE 'email:credential_access:%'");
    expect(details.join(" | ")).toMatch(/SCAN buyer_notice_log/);
  });

  it("selects exactly the same rows as the prefix LIKE", () => {
    const range = keyPrefixRange("email:credential_access:");
    const byRange = f.sql
      .prepare("SELECT idempotency_key FROM buyer_notice_log WHERE idempotency_key >= ? AND idempotency_key < ? ORDER BY 1")
      .all(range.start, range.end).map((row) => String(row.idempotency_key));
    const byLike = f.sql
      .prepare("SELECT idempotency_key FROM buyer_notice_log WHERE idempotency_key LIKE ? ORDER BY 1")
      .all("email:credential_access:%").map((row) => String(row.idempotency_key));
    expect(byRange).toEqual(byLike);
    expect(byRange).toEqual(["email:credential_access:A:v1", "email:credential_access:A:v2"]);
  });

  it("production sweeps no longer use idempotency_key LIKE", () => {
    expect(fs.readFileSync("src/lib/orders/access-email.ts", "utf8")).not.toMatch(/idempotency_key LIKE/);
    const notifyRetry = fs.readFileSync("src/lib/pedia/notify-retry.ts", "utf8");
    expect(notifyRetry).not.toMatch(/idempotency_key LIKE/);
    expect(notifyRetry).toContain("b.idempotency_key >= ? AND b.idempotency_key < ?");
  });
});
