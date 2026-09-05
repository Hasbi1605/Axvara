// tests/migration-and-atomicity.regression.test.ts — Migration 0008, order idempotency, stock lifecycle & Proof CAS tests
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  buildWhatsAppOrderIdempotencyKey,
  isReusablePendingOrder,
} from "@/lib/commerce";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

type SqliteStatement = {
  all: () => unknown[];
  get: () => Record<string, unknown> | undefined;
};

type SqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
};

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as {
  DatabaseSync: new (location: string) => SqliteDatabase;
};

describe("Migration 0008: Orders Table Multi-channel Rebuild & FK Integrity (P0.3)", () => {
  it("rebuilds orders table, preserving telegram data, adding channel identity, and accepting whatsapp", () => {
    const migrationSql = read("drizzle/migrations/0008_orders_multichannel.sql");
    const schemaSql = read("drizzle/schema.sql");

    expect(migrationSql).toContain("sales_channel IN ('web','telegram','whatsapp')");
    expect(migrationSql).toContain("channel_conversation_id TEXT");
    expect(migrationSql).toContain("channel_member_id TEXT");
    expect(migrationSql).toMatch(/PRAGMA\s+defer_foreign_keys\s*=\s*ON/i);
    expect(migrationSql).toMatch(/UPDATE\s+payment_transactions\s+SET\s+order_code='__axvara_0008__:'\s*\|\|\s*order_code/i);
    expect(migrationSql).toMatch(/UPDATE\s+fulfillment_jobs\s+SET\s+order_code='__axvara_0008__:'\s*\|\|\s*order_code/i);
    expect(migrationSql).toMatch(/UPDATE\s+payment_proofs\s+SET\s+order_code='__axvara_0008__:'\s*\|\|\s*order_code/i);
    expect(migrationSql).toMatch(/PRAGMA\s+defer_foreign_keys\s*=\s*OFF/i);
    expect(migrationSql).not.toMatch(/PRAGMA\s+foreign_keys\s*=\s*OFF/i);
    expect(migrationSql).toContain("payment_proofs_one_active_per_order");
    expect(schemaSql).toContain("telegram_enabled INTEGER NOT NULL DEFAULT 1");
    expect(schemaSql).toContain("INSERT INTO product_variants");
    expect(schemaSql).toContain("'DEFAULT-' || p.id");
  });

  it("executes with populated D1-style child tables and preserves every foreign key", () => {
    const db = new DatabaseSync(":memory:");
    const migrationSql = read("drizzle/migrations/0008_orders_multichannel.sql");

    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE product_variants (id INTEGER PRIMARY KEY);
      INSERT INTO product_variants (id) VALUES (7);

      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        customer_name TEXT NOT NULL,
        customer_wa TEXT NOT NULL,
        customer_email TEXT,
        items TEXT NOT NULL,
        subtotal INTEGER NOT NULL,
        payment_method TEXT NOT NULL,
        payment_account TEXT,
        proof_url TEXT,
        status TEXT DEFAULT 'pending',
        admin_note TEXT,
        quote_id TEXT,
        expires_at TEXT,
        sales_channel TEXT NOT NULL DEFAULT 'web'
          CHECK (sales_channel IN ('web','telegram')),
        telegram_chat_id TEXT,
        telegram_user_id TEXT,
        payment_status TEXT NOT NULL DEFAULT 'unpaid'
          CHECK (payment_status IN ('unpaid','pending','paid','expired','failed','refunded')),
        fulfillment_status TEXT NOT NULL DEFAULT 'not_required'
          CHECK (fulfillment_status IN (
            'not_required','reserved','queued','sending','delivered',
            'manual_required','retry','failed'
          )),
        variant_id INTEGER REFERENCES product_variants(id),
        variant_snapshot TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE payment_transactions (
        id INTEGER PRIMARY KEY,
        order_code TEXT NOT NULL UNIQUE REFERENCES orders(code)
      );
      CREATE TABLE fulfillment_jobs (
        id INTEGER PRIMARY KEY,
        order_code TEXT NOT NULL UNIQUE REFERENCES orders(code)
      );
      CREATE TABLE payment_proofs (
        id INTEGER PRIMARY KEY,
        order_code TEXT NOT NULL REFERENCES orders(code),
        status TEXT NOT NULL,
        rejection_reason TEXT,
        reviewed_at TEXT
      );
      CREATE TABLE whatsapp_inbox_events (
        id INTEGER PRIMARY KEY,
        conversation_id TEXT,
        member_id TEXT,
        created_at TEXT
      );

      INSERT INTO orders (
        id, code, customer_name, customer_wa, items, subtotal,
        payment_method, sales_channel, telegram_chat_id, telegram_user_id,
        payment_status, fulfillment_status, variant_id
      ) VALUES
        (1, 'AXV-WEB', 'Web Buyer', '0811111111', '[]', 10000,
         'qris', 'web', NULL, NULL, 'unpaid', 'not_required', 7),
        (2, 'AXV-TG', 'Telegram Buyer', '0822222222', '[]', 20000,
         'qris', 'telegram', '-100123', '456', 'paid', 'delivered', 7);
      INSERT INTO payment_transactions (id, order_code) VALUES (1, 'AXV-TG');
      INSERT INTO fulfillment_jobs (id, order_code) VALUES (1, 'AXV-TG');
      INSERT INTO payment_proofs (id, order_code, status) VALUES (1, 'AXV-WEB', 'submitted');
    `);

    db.exec(`BEGIN;\n${migrationSql}\nCOMMIT;`);

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM orders").get()?.count).toBe(2);
    expect(db.prepare("SELECT order_code FROM payment_transactions").get()?.order_code).toBe("AXV-TG");
    expect(db.prepare("SELECT order_code FROM fulfillment_jobs").get()?.order_code).toBe("AXV-TG");
    expect(db.prepare("SELECT order_code FROM payment_proofs").get()?.order_code).toBe("AXV-WEB");

    const telegramOrder = db.prepare(
      "SELECT channel_conversation_id, channel_member_id FROM orders WHERE code='AXV-TG'",
    ).get();
    expect(telegramOrder).toMatchObject({
      channel_conversation_id: "-100123",
      channel_member_id: "456",
    });

    expect(() => db.exec(`
      INSERT INTO orders (
        code, customer_name, customer_wa, items, subtotal, payment_method, sales_channel
      ) VALUES ('AXV-WA', 'WA Buyer', '0833333333', '[]', 30000, 'qris', 'whatsapp');
    `)).not.toThrow();
  });
});

describe("Migration 0009: WhatsApp alias and historical state repair", () => {
  it("adds display aliases, repairs expired payment state, and moves sessions to Baileys", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE orders (
        code TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        payment_status TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE TABLE whatsapp_sessions (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        UNIQUE(provider, conversation_id, member_id)
      );
      INSERT INTO products VALUES (1, 'ChatGPT Plus 1 Bulan'), (2, 'Produk Khusus');
      INSERT INTO orders VALUES ('AXV-OLD', 'kadaluarsa', 'pending', NULL);
      INSERT INTO whatsapp_sessions VALUES (1, 'fonnte', 'group-a', 'member-a');
    `);

    db.exec(read("drizzle/migrations/0009_whatsapp_alias_order_state.sql"));

    expect(db.prepare("SELECT whatsapp_alias FROM products WHERE id=1").get()?.whatsapp_alias).toBe("CHATGPT");
    expect(db.prepare("SELECT whatsapp_alias FROM products WHERE id=2").get()?.whatsapp_alias).toBeNull();
    expect(db.prepare("SELECT payment_status FROM orders WHERE code='AXV-OLD'").get()?.payment_status).toBe("expired");
    expect(db.prepare("SELECT provider FROM whatsapp_sessions WHERE id=1").get()?.provider).toBe("baileys");
  });
});

describe("Migration 0010: DANA dynamic QRIS ledger", () => {
  it("adds dynamic payload fields, hook dedup, and unique active amounts", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE orders (code TEXT PRIMARY KEY);
      CREATE TABLE payment_methods (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        account_number TEXT,
        account_name TEXT,
        qris_url TEXT
      );
      CREATE TABLE payment_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_code TEXT NOT NULL UNIQUE REFERENCES orders(code),
        provider TEXT NOT NULL,
        provider_mode TEXT NOT NULL,
        provider_order_id TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        requested_amount INTEGER NOT NULL,
        payable_amount INTEGER,
        status TEXT NOT NULL DEFAULT 'initializing',
        qris_url TEXT,
        direct_url TEXT,
        expires_at TEXT
      );
      INSERT INTO payment_methods VALUES ('qris','QRIS','','Brotherstore06','/qris/legacy.png');
      INSERT INTO orders VALUES ('AXV-A'), ('AXV-B');
    `);

    db.exec(read("drizzle/migrations/0010_dana_dynamic_qris.sql"));

    const columns = db.prepare("PRAGMA table_info(payment_transactions)").all() as Record<string, unknown>[];
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(["unique_code", "qris_payload"]));
    expect(db.prepare("SELECT label,account_name,qris_url FROM payment_methods WHERE id='qris'").get()).toMatchObject({
      label: "QRIS Dinamis",
      account_name: "DANA Business",
      qris_url: null,
    });

    db.exec(`
      INSERT INTO payment_transactions (
        order_code,provider,provider_mode,provider_order_id,merchant_id,
        requested_amount,payable_amount,status
      ) VALUES ('AXV-A','dana','dynamic-qris','AXV-A','dana-business',10000,10123,'pending');
      INSERT INTO dana_webhook_events (event_key,payload_hash,amount,status)
      VALUES ('evt-1','hash-1',10123,'received');
    `);
    expect(() => db.exec(`
      INSERT INTO payment_transactions (
        order_code,provider,provider_mode,provider_order_id,merchant_id,
        requested_amount,payable_amount,status
      ) VALUES ('AXV-B','dana','dynamic-qris','AXV-B','dana-business',10000,10123,'pending');
    `)).toThrow(/UNIQUE/i);
    expect(() => db.exec(`
      INSERT INTO dana_webhook_events (event_key,payload_hash,amount,status)
      VALUES ('evt-1','hash-2',10123,'received');
    `)).toThrow(/UNIQUE/i);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

describe("Deterministic Idempotency Key (P0.4)", () => {
  it("reuses one inbound pay event but allows a later purchase of the same variant", () => {
    const groupId = "120363024823948293@g.us";
    const memberId = "628123456789";
    const variantId = 42;

    const key1 = buildWhatsAppOrderIdempotencyKey(groupId, memberId, "98234123", variantId);
    const retryKey = buildWhatsAppOrderIdempotencyKey(groupId, memberId, "98234123", variantId);
    const laterPurchaseKey = buildWhatsAppOrderIdempotencyKey(groupId, memberId, "98234124", variantId);

    expect(key1).toBe(retryKey);
    expect(laterPurchaseKey).not.toBe(key1);
    expect(key1).not.toContain(String(Date.now()));
  });

  it("refuses to create an order idempotency key without a Baileys inbox id", () => {
    expect(() => buildWhatsAppOrderIdempotencyKey("group", "member", "", 42)).toThrow(/inbox/i);
  });
});

describe("Reusable WhatsApp pending order", () => {
  const now = Date.parse("2026-09-04T12:00:00.000Z");

  it("only reuses an unexpired unpaid/pending order", () => {
    expect(isReusablePendingOrder({
      status: "pending",
      payment_status: "pending",
      expires_at: "2026-09-04T13:00:00.000Z",
    }, now)).toBe(true);
    expect(isReusablePendingOrder({
      status: "pending",
      payment_status: "paid",
      expires_at: "2026-09-04T13:00:00.000Z",
    }, now)).toBe(false);
    expect(isReusablePendingOrder({
      status: "pending",
      payment_status: "pending",
      expires_at: "2026-09-04T11:59:59.000Z",
    }, now)).toBe(false);
  });
});

describe("Variant stock expiry lifecycle", () => {
  it("DANA webhook and expiry cron use atomic payment/order transition helpers", () => {
    const db = read("src/lib/db.ts");
    const callback = read("src/app/api/webhook/dana/route.ts");
    const cron = read("src/app/api/cron/operations/route.ts");
    expect(db).toContain("export async function transitionPendingPaymentOrder");
    expect(db).toContain("export async function transitionPendingPaymentToPaid");
    expect(db).toContain("UPDATE product_variants SET stock=stock+?");
    expect(callback).toContain("transitionPendingPaymentToPaid");
    expect(cron).toContain("transitionPendingPaymentOrder");
    expect(cron).not.toContain("checkStatus");
  });

  it("authenticates QRIS Hook and matches only an active exact amount", () => {
    const callback = read("src/app/api/webhook/dana/route.ts");
    expect(callback).toContain("x-webhook-secret");
    expect(callback).toContain("constantTimeEqual");
    expect(callback).toContain("pt.payable_amount=?");
    expect(callback).toContain("datetime(pt.expires_at)>datetime('now')");
  });

  it("deduplicates hook events and allows the atomic paid repair guard", () => {
    const db = read("src/lib/db.ts");
    const callback = read("src/app/api/webhook/dana/route.ts");
    expect(db).toMatch(/status IN \('pending','paid'\)/);
    expect(callback).toContain("transitionPendingPaymentToPaid(orderCode");
    expect(callback).toContain("INSERT OR IGNORE INTO dana_webhook_events");
    expect(callback).toContain('status: "duplicate"');
  });

  it("does not reuse an order after the member changes selected variant", () => {
    const webhook = read("src/app/api/whatsapp/webhook/route.ts");
    expect(webhook).toContain("session.selected_variant_id !== variantId");
    expect(webhook).toContain("AND o.variant_id=?");
  });

  it("reuses an existing DANA ledger before allocating another unique amount", () => {
    const qris = read("src/lib/payments/dana-qris.ts");
    const lookup = qris.indexOf("FROM payment_transactions WHERE order_code=? AND provider='dana'");
    const create = qris.indexOf("for (let attempt = 0; attempt < 40; attempt++)", lookup);
    expect(lookup).toBeGreaterThan(0);
    expect(create).toBeGreaterThan(lookup);
  });

  it("creates a default variant with a new product and archives product deletes", () => {
    const createRoute = read("src/app/api/products/route.ts");
    const productRoute = read("src/app/api/products/[id]/route.ts");
    expect(createRoute).toContain("'DEFAULT-' || p.id");
    expect(productRoute).toContain("UPDATE product_variants SET is_active=0");
  });

  it("keeps legacy product summary fields synchronized with authoritative variants", () => {
    const variantsRoute = read("src/app/api/admin/variants/route.ts");
    const productRoute = read("src/app/api/products/[id]/route.ts");
    expect(variantsRoute).toContain("MIN(price)");
    expect(variantsRoute).toContain("SUM(CASE WHEN stock>0 THEN stock ELSE 0 END)");
    expect(productRoute).toContain("defaultVariant");
    expect(productRoute).toContain("Harga dan stok dikelola per varian");
  });

  it("normalizes SKU case on every admin write path", () => {
    const variantsRoute = read("src/app/api/admin/variants/route.ts");
    expect(variantsRoute.match(/sku\.toUpperCase\(\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps legacy Telegram inventory compatible after variant backfill", () => {
    const inventory = read("src/lib/fulfillment/inventory.ts");
    expect(inventory).toContain("variantId === null");
    expect(inventory).toContain("WHERE product_id=? AND status='available' ORDER BY id ASC LIMIT 1");
  });

  it("pins Telegram variant fulfillment to an order snapshot and compensates partial invoice setup", () => {
    const telegram = read("src/app/api/telegram/webhook/route.ts");
    const delivery = read("src/lib/fulfillment/deliver.ts");
    expect(telegram).toContain("variant_snapshot");
    expect(telegram).toContain("product_name: productName");
    expect(telegram).toContain("transitionPendingOrder");
    expect(delivery).toContain("fulfillmentModeFromOrderSnapshot");
  });

  it("uses the persisted order snapshot for WhatsApp payment copy", () => {
    const commerce = read("src/lib/commerce.ts");
    const webhook = read("src/app/api/whatsapp/webhook/route.ts");
    expect(commerce).toContain("product_name: input.productName");
    expect(webhook).toContain("parsePaymentDisplaySnapshot");
    expect(webhook).toContain("SELECT items, variant_snapshot FROM orders WHERE code=?");
  });

  it("fails closed when a shared variant has no encrypted delivery secret", () => {
    const commerce = read("src/lib/commerce.ts");
    expect(commerce).toContain("fulfillment_mode!='shared'");
    expect(commerce).toContain("shared_secret_ciphertext IS NOT NULL");
    expect(commerce).toContain("shared_secret_iv IS NOT NULL");
  });
});

describe("Compare-And-Set (CAS) for Proof Review (P0.5)", () => {
  it("ensures double approve cannot occur on already reviewed proof", () => {
    // In-memory simulation of CAS
    type Proof = { id: number; status: "submitted" | "approved" | "rejected"; reviewed_by?: string };
    const proofs: Proof[] = [
      { id: 1, status: "submitted" },
    ];

    function reviewProofCAS(id: number, action: "approve" | "reject", reviewer: string): { changes: number } {
      const p = proofs.find(item => item.id === id && item.status === "submitted");
      if (!p) return { changes: 0 };
      p.status = action === "approve" ? "approved" : "rejected";
      p.reviewed_by = reviewer;
      return { changes: 1 };
    }

    // First review attempt succeeds
    const res1 = reviewProofCAS(1, "approve", "admin@axvara.tech");
    expect(res1.changes).toBe(1);
    expect(proofs[0].status).toBe("approved");

    // Second review attempt (e.g. concurrent click or retry) fails with 0 changes!
    const res2 = reviewProofCAS(1, "approve", "admin@axvara.tech");
    expect(res2.changes).toBe(0);

    // Third attempt (reject after approve) also fails with 0 changes!
    const res3 = reviewProofCAS(1, "reject", "admin@axvara.tech");
    expect(res3.changes).toBe(0);
  });
});
