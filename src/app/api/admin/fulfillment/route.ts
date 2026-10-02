// /api/admin/fulfillment — Inventory management: import, count, revoke
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryAll, queryFirst } from "@/lib/db";
import { importInventory, countInventory, revokeInventory } from "@/lib/fulfillment/inventory";
import { decryptSecret, encryptSecret } from "@/lib/fulfillment/crypto";
import { execRun } from "@/lib/db";

export const runtime = "edge";

// GET — count inventory for a product
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const productId = Number(request.nextUrl.searchParams.get("product_id") ?? 0);
  if (!productId) return NextResponse.json({ error: "product_id required" }, { status: 400 });
  const variantId = Number(request.nextUrl.searchParams.get("variant_id") ?? 0) || null;

  const target = variantId
    ? await queryFirst(
        `SELECT id, fulfillment_mode, handover_template FROM product_variants WHERE id=? AND product_id=?`,
        variantId, productId,
      )
    : await queryFirst(`SELECT id, fulfillment_mode FROM products WHERE id=?`, productId);
  if (!target) return NextResponse.json({ error: variantId ? "variant_not_found" : "product_not_found" }, { status: 404 });

  const counts = await countInventory(productId, variantId);
  // Peringatan selisih unique (2026-10-02, insiden Head 18 Bulan): kolom
  // stock vs unit available milik varian. Dikirim sebagai angka mentah agar
  // panel admin bisa menampilkan banner "angka tidak sama — sinkronkan".
  let variantStock: number | null = null;
  let stockMismatch = false;
  try {
    if (variantId) {
      const vRow = await queryFirst(
        `SELECT stock, fulfillment_mode FROM product_variants WHERE id=? AND product_id=?`,
        variantId, productId,
      );
      if (vRow && String(vRow.fulfillment_mode ?? "") === "unique") {
        variantStock = Number(vRow.stock ?? -1);
        const scopedAvailable = await queryFirst(
          `SELECT COUNT(*) AS available FROM fulfillment_inventory
           WHERE product_id=? AND variant_id=? AND status='available'`,
          productId, variantId,
        );
        const scoped = Number(scopedAvailable?.available ?? 0);
        stockMismatch = variantStock !== scoped;
      }
    }
  } catch { /* warning pendukung — counts tetap dikembalikan */ }
  // Keputusan owner 2026-09-19: admin BOLEH melihat isi kredensial plaintext
  // di panel (mereka pemilik toko). Dekripsi terjadi server-side per request
  // dan TIDAK PERNAH dikirim ke storefront/pembeli — hanya route admin ini.
  let sharedSecret: string | null = null;
  const inventory: { id: number; secret: string; status: string }[] = [];
  try {
    if (variantId) {
      const row = await queryFirst(
        `SELECT shared_secret_ciphertext, shared_secret_iv FROM product_variants WHERE id=? AND product_id=?`,
        variantId, productId,
      );
      const ct = String(row?.shared_secret_ciphertext || "");
      const iv = String(row?.shared_secret_iv || "");
      if (ct && iv) {
        try { sharedSecret = await decryptSecret(ct, iv); } catch { sharedSecret = null; }
      }
      const rows = await queryAll(
        `SELECT id, secret_ciphertext, secret_iv, status FROM fulfillment_inventory
         WHERE product_id=? AND variant_id=? AND status='available' ORDER BY id ASC LIMIT 100`,
        productId, variantId,
      );
      for (const r of rows) {
        try {
          inventory.push({
            id: Number(r.id),
            secret: await decryptSecret(String(r.secret_ciphertext || ""), String(r.secret_iv || "")),
            status: String(r.status || ""),
          });
        } catch { /* baris rusak dilewati, tidak menggagalkan reveal */ }
      }
    }
  } catch { /* reveal pendukung — counts tetap dikembalikan */ }
  return NextResponse.json({
    product_id: productId,
    variant_id: variantId,
    fulfillment_mode: String(target.fulfillment_mode || "manual"),
    handover_template: typeof target.handover_template === "string" ? target.handover_template : "",
    shared_secret: sharedSecret,
    inventory,
    variant_stock: variantStock,
    stock_mismatch: stockMismatch,
    ...counts,
  });
}

// POST — import inventory or set shared secret
export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const body = raw as {
    action: string;
    product_id: number;
    secrets?: string[];
    shared_secret?: string;
    fulfillment_mode?: string;
    variant_id?: number;
    handover_template?: string;
  };

  const productId = Number(body.product_id);
  const variantId = Number(body.variant_id ?? 0) || null;
  if (!productId) return NextResponse.json({ error: "product_id required" }, { status: 400 });

  // Verify product exists
  const product = await queryFirst(`SELECT id, fulfillment_mode FROM products WHERE id=?`, productId);
  if (!product) return NextResponse.json({ error: "product_not_found" }, { status: 404 });
  if (variantId) {
    const variant = await queryFirst(
      `SELECT id FROM product_variants WHERE id=? AND product_id=?`,
      variantId, productId,
    );
    if (!variant) return NextResponse.json({ error: "variant_not_found" }, { status: 404 });
  }

  // Set fulfillment mode
  if (body.action === "set_mode" && body.fulfillment_mode) {
    const validModes = ["manual", "shared", "unique"];
    if (!validModes.includes(body.fulfillment_mode)) {
      return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
    }
    if (variantId) {
      await execRun(
        `UPDATE product_variants SET fulfillment_mode=?, updated_at=datetime('now') WHERE id=? AND product_id=?`,
        body.fulfillment_mode, variantId, productId,
      );
    } else {
      await execRun(
        `UPDATE products SET fulfillment_mode=?, updated_at=datetime('now') WHERE id=?`,
        body.fulfillment_mode, productId,
      );
    }
    return NextResponse.json({ ok: true, mode: body.fulfillment_mode });
  }

  // Template pesan serah terima (varian Made By Order non-WR, migrasi 0043).
  // Bukan rahasia (teks instruksi), jadi disimpan polos; kosong = hapus.
  if (body.action === "set_handover_template") {
    if (!variantId) return NextResponse.json({ error: "variant_id required" }, { status: 400 });
    const template = String(body.handover_template ?? "").trim();
    if (template.length > 2000) return NextResponse.json({ error: "template_too_long" }, { status: 400 });
    await execRun(
      `UPDATE product_variants SET handover_template=?, updated_at=datetime('now') WHERE id=? AND product_id=?`,
      template || null, variantId, productId,
    );
    return NextResponse.json({ ok: true, handover_template: template });
  }

  // Set shared secret
  if (body.action === "set_shared_secret" && body.shared_secret) {
    const trimmed = body.shared_secret.trim();
    if (trimmed.length < 3 || trimmed.length > 5000) {
      return NextResponse.json({ error: "secret_length_invalid" }, { status: 400 });
    }
    const { ciphertext, iv } = await encryptSecret(trimmed);
    if (variantId) {
      await execRun(
        `UPDATE product_variants
         SET shared_secret_ciphertext=?, shared_secret_iv=?, fulfillment_mode='shared', updated_at=datetime('now')
         WHERE id=? AND product_id=?`,
        ciphertext, iv, variantId, productId,
      );
    } else {
      await execRun(
        `UPDATE products SET shared_secret_ciphertext=?, shared_secret_iv=?, fulfillment_mode='shared',
         updated_at=datetime('now') WHERE id=?`,
        ciphertext, iv, productId,
      );
    }
    return NextResponse.json({ ok: true, mode: "shared" });
  }

  // Import unique inventory
  if (body.action === "import" && body.secrets) {
    if (!process.env.FULFILLMENT_ENCRYPTION_KEY) {
      return NextResponse.json({ error: "encryption_key_not_configured" }, { status: 503 });
    }
    if (!Array.isArray(body.secrets) || body.secrets.length === 0) {
      return NextResponse.json({ error: "secrets_required" }, { status: 400 });
    }
    if (body.secrets.length > 100) {
      return NextResponse.json({ error: "max_100_per_request" }, { status: 400 });
    }

    const result = await importInventory(productId, body.secrets, variantId);
    // Selaraskan kolom stock unique → available (2026-10-02): tanpa ini
    // angka "Sisa" PDP + agregat induk selisih permanen dari kredensial.
    const { syncUniqueVariantStock } = await import("@/lib/fulfillment/inventory");
    const syncedStock = await syncUniqueVariantStock(productId, variantId);
    return NextResponse.json({ ok: true, ...result, synced_stock: syncedStock });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}

// DELETE — revoke available inventory
export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json() as { inventory_id: number };
  if (!body.inventory_id) {
    return NextResponse.json({ error: "inventory_id required" }, { status: 400 });
  }

  const revoked = await revokeInventory(body.inventory_id);
  if (!revoked) {
    return NextResponse.json({ error: "cannot_revoke" }, { status: 409 });
  }
  // Revoke mengurangi available → selaraskan kolom stock unique juga
  // (2026-10-02, cermin import di atas). variant_id dibaca dari barisnya.
  try {
    const { syncUniqueVariantStock } = await import("@/lib/fulfillment/inventory");
    const row = await queryFirst(
      `SELECT product_id, variant_id FROM fulfillment_inventory WHERE id=?`,
      Number(body.inventory_id),
    );
    if (row) await syncUniqueVariantStock(Number(row.product_id), row.variant_id != null ? Number(row.variant_id) : null);
  } catch { /* sync best-effort — revoke sudah sukses */ }

  return NextResponse.json({ ok: true });
}
