import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { processCredentialDelivery, processDueCredentialDeliveries } from "@/lib/warung-rebahan/deliver";
import { seedWrCatalog, setupWrFixture } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubEnv() {
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("WHATSAPP_ENABLED", "true");
}

/** Link WR kanal whatsapp dengan kredensial siap kirim. */
async function seedWhatsAppLink(fx: Awaited<ReturnType<typeof setupWrFixture>>) {
  seedWrCatalog(fx);
  fx.sql.prepare(
    `INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status,variant_id,paid_at)
     VALUES('AXV-20260922-WA00001','Buyer','628111222333',?,7500,'qris','lunas','paid','whatsapp','queued',1,datetime('now'))`,
  ).run(JSON.stringify([{ product_id: 1, variant_id: 1, name: "CapCut Pro", price: 7500, qty: 1 }]));
  fx.sql.prepare(
    `INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,delivery_status,delivery_channel)
     VALUES('AXV-20260922-WA00001','ORD-WA-1','var-1',1,5000,'completed','queued','whatsapp')`,
  ).run();
  const { encryptSecret } = await import("@/lib/fulfillment/crypto");
  const secret = await encryptSecret("email: buyer@example.com\npassword: rahasia");
  fx.sql.prepare(
    `UPDATE wr_order_links SET wr_account_details=?, wr_account_iv=? WHERE wr_order_id='ORD-WA-1'`,
  ).run(secret.ciphertext, secret.iv);
  return Number((fx.sql.prepare("SELECT id FROM wr_order_links WHERE wr_order_id='ORD-WA-1'").get() as { id: number }).id);
}

describe("FX-15: legacy WR WhatsApp delivery is always manual", () => {
  it("rescues an order that WR called delivered when it only queued a WhatsApp credential", async () => {
    const fx = await setupWrFixture();
    try {
      const linkId = await seedWhatsAppLink(fx);
      fx.sql.prepare("UPDATE wr_order_links SET delivery_status='delivered', delivered_at=datetime('now') WHERE id=?").run(linkId);
      fx.sql.exec(`UPDATE orders SET fulfillment_status='delivered';
        INSERT INTO whatsapp_outbox(idempotency_key,destination,message_type,payload,status,last_error)
        VALUES ('wa:text:wr-delivery:AXV-20260922-WA00001','628111222333','text','fixture','dead','sales_notifications_retired')`);
      await processDueCredentialDeliveries(createDatabaseAccess(fx.db));
      expect(fx.sql.prepare("SELECT fulfillment_status FROM orders").get()?.fulfillment_status).toBe("manual_required");
      expect(fx.sql.prepare("SELECT status FROM fulfillment_items").get()?.status).toBe("manual_required");
      expect(fx.sql.prepare("SELECT delivery_last_error FROM wr_order_links WHERE id=?").get(linkId)?.delivery_last_error).toBe("legacy_whatsapp_manual_handover");
    } finally {
      fx.close();
    }
  });
  it("flag MATI → delivery TIDAK delivered dan alasannya tercatat", async () => {
    const fx = await setupWrFixture();
    try {
      const linkId = await seedWhatsAppLink(fx);
      stubEnv();
      vi.stubEnv("WHATSAPP_CREDENTIAL_DM_ENABLED", "false");

      const delivered = await processCredentialDelivery(linkId, createDatabaseAccess(fx.db));

      const link = fx.sql
        .prepare("SELECT delivery_status, delivery_last_error FROM wr_order_links WHERE id=?")
        .get(linkId) as { delivery_status: string; delivery_last_error: string | null };

      expect(delivered).toBe(false);
      expect(link.delivery_status).not.toBe("delivered");
      // Alasan wajib terekam agar admin tahu sebabnya, bukan gagal tanpa jejak.
      expect(String(link.delivery_last_error ?? "")).toContain("legacy_whatsapp_manual_handover");
      // Tidak ada pesan yang benar-benar dikirim ke pembeli.
      const outbox = fx.sql.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get() as { n: number };
      expect(Number(outbox.n)).toBe(0);
    } finally {
      fx.close();
    }
  });

  it("does not dispatch a historical WR credential even with the old env enabled", async () => {
    const fx = await setupWrFixture();
    try {
      const linkId = await seedWhatsAppLink(fx);
      stubEnv();
      vi.stubEnv("WHATSAPP_CREDENTIAL_DM_ENABLED", "true");

      const delivered = await processCredentialDelivery(linkId, createDatabaseAccess(fx.db));

      const link = fx.sql
        .prepare("SELECT delivery_status FROM wr_order_links WHERE id=?")
        .get(linkId) as { delivery_status: string };
      const outbox = fx.sql.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get() as { n: number };

      expect(delivered).toBe(false);
      expect(link.delivery_status).toBe("failed");
      expect(Number(outbox.n)).toBe(0);
      expect(fx.sql.prepare("SELECT fulfillment_status FROM orders").get()?.fulfillment_status).toBe("manual_required");
    } finally {
      fx.close();
    }
  });
});
