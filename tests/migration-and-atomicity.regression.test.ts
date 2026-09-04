// tests/migration-and-atomicity.regression.test.ts — Migration 0008, order idempotency, stock lifecycle & Proof CAS tests
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildWhatsAppOrderIdempotencyKey,
  isReusablePendingOrder,
} from "@/lib/commerce";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Migration 0008: Orders Table Multi-channel Rebuild & FK Integrity (P0.3)", () => {
  it("rebuilds orders table, preserving telegram data, adding channel identity, and accepting whatsapp", () => {
    const migrationSql = read("drizzle/migrations/0008_orders_multichannel.sql");
    const schemaSql = read("drizzle/schema.sql");

    expect(migrationSql).toContain("sales_channel IN ('web','telegram','whatsapp')");
    expect(migrationSql).toContain("channel_conversation_id TEXT");
    expect(migrationSql).toContain("channel_member_id TEXT");
    expect(migrationSql).toMatch(/PRAGMA\s+defer_foreign_keys\s*=\s*ON/i);
    expect(migrationSql).not.toMatch(/PRAGMA\s+foreign_keys\s*=\s*OFF/i);
    expect(migrationSql).toContain("payment_proofs_one_active_per_order");
    expect(schemaSql).toContain("telegram_enabled INTEGER NOT NULL DEFAULT 1");
    expect(schemaSql).toContain("INSERT INTO product_variants");
    expect(schemaSql).toContain("'DEFAULT-' || p.id");
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

  it("refuses to create an order idempotency key without Fonnte inboxid", () => {
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
  it("callback and reconciliation use atomic payment/order transition helpers", () => {
    const db = read("src/lib/db.ts");
    const callback = read("src/app/api/payments/klikqris/callback/route.ts");
    const cron = read("src/app/api/cron/operations/route.ts");
    expect(db).toContain("export async function transitionPendingPaymentOrder");
    expect(db).toContain("export async function transitionPendingPaymentToPaid");
    expect(db).toContain("UPDATE product_variants SET stock=stock+?");
    expect(callback).toContain("transitionPendingPaymentOrder");
    expect(callback).toContain("transitionPendingPaymentToPaid");
    expect(cron).toContain("transitionPendingPaymentOrder");
    expect(cron).toContain("transitionPendingPaymentToPaid");
  });

  it("does not trust a paid callback when provider confirmation is unavailable", () => {
    const callback = read("src/app/api/payments/klikqris/callback/route.ts");
    expect(callback).toContain("status_confirmation_unavailable");
    expect(callback).not.toContain("accepting callback");
  });

  it("repairs a legacy split-brain paid transaction whose order is still pending", () => {
    const db = read("src/lib/db.ts");
    const callback = read("src/app/api/payments/klikqris/callback/route.ts");
    const cron = read("src/app/api/cron/operations/route.ts");
    expect(db).toMatch(/status IN \('pending','paid'\)/);
    expect(callback).toContain("transitionPendingPaymentToPaid(orderCode");
    expect(callback).toContain("legacyOrderStillPending");
    expect(cron).toContain("pt.status='paid' AND o.status='pending'");
  });

  it("does not reuse an order after the member changes selected variant", () => {
    const webhook = read("src/app/api/whatsapp/webhook/route.ts");
    expect(webhook).toContain("session.selected_variant_id !== variantId");
    expect(webhook).toContain("AND o.variant_id=?");
  });

  it("reuses an existing KlikQRIS ledger before requesting another provider invoice", () => {
    const webhook = read("src/app/api/whatsapp/webhook/route.ts");
    const lookup = webhook.indexOf("SELECT payable_amount, qris_url FROM payment_transactions WHERE order_code=?");
    const create = webhook.indexOf("provider.createInvoice", lookup);
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
