// F-H1 (2026-09-22) — order WR kanal WhatsApp TIDAK boleh ditandai
// `delivered` saat kill-switch DM kredensial mati.
//
// Kenapa ini yang paling berbahaya dari seluruh audit UX: `delivered` adalah
// status terminal yang dibaca pembeli ("Selesai") DAN dipercaya admin. Dulu
// `deliverWhatsAppCredential` hanya `return` saat flag mati, sehingga
// `processCredentialDelivery` lanjut menulis `delivery_status='delivered'`
// walau NOL pesan terkirim — pembeli menerima nihil, admin mengira beres, dan
// tidak ada satu pun jejak kegagalan.
//
// Pembeda penting yang diuji di sini: kanal WEB memang boleh settle tanpa DM
// (punya token capability + panel pesanan + email sebagai jalur pengambilan),
// sementara kanal WHATSAPP tidak punya jalur lain sama sekali.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { processCredentialDelivery } from "@/lib/warung-rebahan/deliver";
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

describe("F-H1: kill-switch DM WA tidak boleh menghasilkan 'delivered' palsu", () => {
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
      expect(String(link.delivery_last_error ?? "")).toContain("whatsapp_credential_dm_disabled");
      // Tidak ada pesan yang benar-benar dikirim ke pembeli.
      const outbox = fx.sql.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get() as { n: number };
      expect(Number(outbox.n)).toBe(0);
    } finally {
      fx.close();
    }
  });

  it("flag HIDUP → kredensial masuk antrean WA dan delivery settled", async () => {
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

      expect(delivered).toBe(true);
      expect(link.delivery_status).toBe("delivered");
      // Outbox = antrean durable; settled sah karena pesan sudah masuk antrean.
      expect(Number(outbox.n)).toBeGreaterThan(0);
    } finally {
      fx.close();
    }
  });
});
