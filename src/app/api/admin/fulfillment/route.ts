// /api/admin/fulfillment — Inventory management: import, count, revoke
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { queryFirst } from "@/lib/db";
import { importInventory, countInventory, revokeInventory } from "@/lib/fulfillment/inventory";
import { encryptSecret } from "@/lib/fulfillment/crypto";
import { execRun } from "@/lib/db";

export const runtime = "edge";

// GET — count inventory for a product
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const productId = Number(request.nextUrl.searchParams.get("product_id") ?? 0);
  if (!productId) return NextResponse.json({ error: "product_id required" }, { status: 400 });

  const counts = await countInventory(productId);
  return NextResponse.json({ product_id: productId, ...counts });
}

// POST — import inventory or set shared secret
export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json() as {
    action: string;
    product_id: number;
    secrets?: string[];
    shared_secret?: string;
    fulfillment_mode?: string;
  };

  const productId = body.product_id;
  if (!productId) return NextResponse.json({ error: "product_id required" }, { status: 400 });

  // Verify product exists
  const product = await queryFirst(`SELECT id, fulfillment_mode FROM products WHERE id=?`, productId);
  if (!product) return NextResponse.json({ error: "product_not_found" }, { status: 404 });

  // Set fulfillment mode
  if (body.action === "set_mode" && body.fulfillment_mode) {
    const validModes = ["manual", "shared", "unique"];
    if (!validModes.includes(body.fulfillment_mode)) {
      return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
    }
    await execRun(
      `UPDATE products SET fulfillment_mode=?, updated_at=datetime('now') WHERE id=?`,
      body.fulfillment_mode, productId,
    );
    return NextResponse.json({ ok: true, mode: body.fulfillment_mode });
  }

  // Set shared secret
  if (body.action === "set_shared_secret" && body.shared_secret) {
    const trimmed = body.shared_secret.trim();
    if (trimmed.length < 3 || trimmed.length > 5000) {
      return NextResponse.json({ error: "secret_length_invalid" }, { status: 400 });
    }
    const { ciphertext, iv } = await encryptSecret(trimmed);
    await execRun(
      `UPDATE products SET shared_secret_ciphertext=?, shared_secret_iv=?, fulfillment_mode='shared',
       updated_at=datetime('now') WHERE id=?`,
      ciphertext, iv, productId,
    );
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

    const result = await importInventory(productId, body.secrets);
    return NextResponse.json({ ok: true, ...result });
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

  return NextResponse.json({ ok: true });
}
