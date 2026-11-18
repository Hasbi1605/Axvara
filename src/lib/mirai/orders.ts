import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { decryptSecret, encryptSecret } from "@/lib/fulfillment/crypto";
import { ensureFulfillmentItems } from "@/lib/fulfillment/delivery/inventory-binding";
import {
  fetchMiraiBalance,
  fetchMiraiPackages,
  getMiraiOrder,
  isMiraiConfigured,
  isMiraiDispatchEnabled,
  isMiraiSyncEnabled,
  numeric,
  record,
  validMiraiPackageCode,
  type MiraiRawResponse,
} from "./client";
import { buyMiraiPackage, miraiEligibility, type MiraiEligibility } from "./purchase";
import { miraiCostUsdtFromVnd } from "./pricing";

export { miraiEligibility, type MiraiEligibility };

type Row = Record<string, unknown>;

const paid = (o: Row) =>
  o.status === "lunas" &&
  o.payment_status === "paid" &&
  (o.order_kind ?? "apps") === "apps" &&
  !Number(o.supplier_purchase_disabled) &&
  ["web", "telegram"].includes(String(o.sales_channel));

function lines(o: Row): Row[] {
  try {
    const v: unknown = JSON.parse(String(o.items));
    return Array.isArray(v) ? v.map((x) => (record(x) ? x : {})) : [];
  } catch {
    return [];
  }
}

export function eligibleMiraiLine(value: unknown): Row | null {
  if (!record(value) || !record(value.mirai_eligibility) || value.unique_units) return null;
  const e = value.mirai_eligibility;
  return e.version === 1 &&
    validMiraiPackageCode(e.package_code) &&
    typeof e.mirai_family === "string" &&
    e.mirai_family.trim().length > 0 &&
    e.sku === `MR-${e.package_code}` &&
    e.source_variant_id === value.variant_id &&
    e.quantity === value.qty &&
    Number.isSafeInteger(value.qty) &&
    Number(value.qty) >= 1 &&
    Number(value.qty) <= 100 &&
    Number.isSafeInteger(value.variant_id) &&
    Number(value.variant_id) > 0 &&
    Number.isSafeInteger(value.product_id) &&
    Number(value.product_id) > 0 &&
    typeof e.cost_usdt === "number" &&
    Number.isFinite(e.cost_usdt) &&
    e.cost_usdt > 0
    ? e
    : null;
}

export const MIRAI_RETRYABLE_SQL = `status='needs_admin' AND attempt_count=0 AND request_sent_at IS NULL AND provider_order_code IS NULL
  AND receipt_ciphertext IS NULL AND receipt_iv IS NULL AND completed_at IS NULL
  AND last_error IN ('package_unavailable','stock_unavailable','insufficient_balance','balance_unavailable','package_quantity_invalid','price_increased','preflight_unavailable')
  AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<datetime('now'))
  AND EXISTS(SELECT 1 FROM orders o WHERE o.code=mirai_order_links.order_code AND o.status='lunas' AND o.payment_status='paid' AND o.supplier_purchase_disabled=0 AND COALESCE(o.order_kind,'apps')='apps' AND o.sales_channel IN ('web','telegram'))
  AND EXISTS(SELECT 1 FROM fulfillment_items f WHERE f.mirai_link_id=mirai_order_links.id AND f.order_code=mirai_order_links.order_code AND f.item_index=mirai_order_links.item_index
    AND f.status IN ('queued','retry','failed','manual_required') AND f.fulfillment_mode='manual' AND f.delivered_ciphertext IS NULL AND f.delivered_iv IS NULL
    AND f.wr_link_id IS NULL AND f.sk_link_id IS NULL AND f.tunvn_link_id IS NULL AND f.aivault_link_id IS NULL AND f.storebat_link_id IS NULL AND f.inventory_id IS NULL)`;

export async function createMiraiOrderLinks(
  code: string,
  db: DatabaseAccess = createDatabaseAccess(),
): Promise<number> {
  if (!db.d1 || !isMiraiConfigured() || !isMiraiSyncEnabled() || !db.canSpend(5)) return 0;
  const order = await db.queryFirst("SELECT items,status,payment_status,order_kind,supplier_purchase_disabled,sales_channel FROM orders WHERE code=?", code);
  if (!order || !paid(order)) return 0;
  const rows = lines(order).flatMap((item, index) => {
    const e = eligibleMiraiLine(item);
    const externalOrderId = `${code}-${index}`;
    return e
      ? [{ index, variant: item.variant_id, product: item.product_id, pkg: e.package_code, qty: item.qty, cost: e.cost_usdt, key: externalOrderId }]
      : [];
  });
  if (!rows.length) return 0;
  const r = await db.execRun(
    `INSERT OR IGNORE INTO mirai_order_links(order_code,item_index,variant_id,product_id,package_code,quantity,cost_usdt,fx_idr_per_usdt,external_order_id,idempotency_key)
     SELECT code,j.value->>'index',j.value->>'variant',j.value->>'product',j.value->>'pkg',j.value->>'qty',j.value->>'cost',
       COALESCE(
         (SELECT fx_idr_per_usdt FROM mirai_packages WHERE package_code=j.value->>'pkg'),
         (SELECT mirai_fx_idr_per_usdt FROM product_variants WHERE id=j.value->>'variant'),
         (SELECT CASE WHEN CAST(fx_rate_text AS REAL)>0 THEN CAST(fx_rate_text AS REAL) END FROM crypto_market_snapshot WHERE id=1)
       ),
       j.value->>'key',j.value->>'key'
     FROM orders JOIN json_each(?) j
     WHERE code=? AND items=? AND status='lunas' AND payment_status='paid'
       AND supplier_purchase_disabled=0 AND COALESCE(order_kind,'apps')='apps' AND sales_channel IN ('web','telegram')`,
    JSON.stringify(rows),
    code,
    order.items,
  );
  return Number(r.changes ?? 0);
}

async function settle(
  db: DatabaseAccess,
  link: Row,
  status: string,
  error: string | null,
  delaySeconds?: number | null,
) {
  const backoffSec = Math.max(60, Number(link.attempt_count) * 120);
  const pendingDelaySec =
    delaySeconds != null && Number.isFinite(delaySeconds) && delaySeconds > 0
      ? Math.max(backoffSec, Math.ceil(delaySeconds))
      : backoffSec;
  const offsetExpr = status === "pending" || status === "processing" ? `+${pendingDelaySec} seconds` : "+60 seconds";
  const result = await db.execRun(
    `UPDATE mirai_order_links
     SET status=?, last_error=?, lease_owner=NULL, lease_expires_at=NULL,
         next_attempt_at=datetime('now', ?),
         completed_at=CASE WHEN ?='completed' THEN datetime('now') ELSE completed_at END,
         updated_at=datetime('now')
     WHERE id=? AND lease_owner=? AND status!='completed'`,
    status,
    error,
    offsetExpr,
    status,
    link.id,
    link.lease_owner,
  );
  if (!result.changes) return;
  if (status === "needs_admin") {
    await db.execRun(
      `UPDATE fulfillment_items
       SET status='manual_required', last_error='supplier_needs_admin', locked_until=NULL
       WHERE mirai_link_id=? AND status NOT IN ('delivered','sending')
         AND EXISTS(SELECT 1 FROM mirai_order_links WHERE id=? AND status='needs_admin' AND lease_owner IS NULL)`,
      link.id,
      link.id,
    );
  }
}

async function deferRetry(
  db: DatabaseAccess,
  link: Row,
  retryAfterSeconds?: number | null,
  fromPost = false,
) {
  const exhausted = Number(link.attempt_count) >= 3;
  if (fromPost) {
    await settle(
      db,
      link,
      exhausted ? "processing" : "pending",
      exhausted ? "lookup_required" : "retry_same_external_id",
      retryAfterSeconds,
    );
    return;
  }
  const expired = link.request_sent_at ? Date.now() - Date.parse(String(link.request_sent_at)) > 86_400_000 : false;
  await settle(
    db,
    link,
    exhausted ? (expired ? "needs_admin" : "processing") : "pending",
    exhausted ? (expired ? "attempts_exhausted" : "lookup_unconfirmed") : "retry_same_external_id",
    retryAfterSeconds,
  );
}

async function saveReceipt(db: DatabaseAccess, link: Row, r: { status: number; text: string }) {
  const sealed = await encryptSecret(r.text);
  return (
    await db.execRun(
      `UPDATE mirai_order_links
       SET receipt_ciphertext=?, receipt_iv=?, receipt_http_status=?, updated_at=datetime('now')
       WHERE id=? AND lease_owner=? AND attempt_count=? AND status!='completed' AND datetime(lease_expires_at)>datetime('now')`,
      sealed.ciphertext,
      sealed.iv,
      r.status,
      link.id,
      link.lease_owner,
      link.attempt_count,
    )
  ).changes;
}

function map409Error(rawText: string): string {
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (record(parsed) && typeof parsed.message === "string") {
      const msg = parsed.message.toLowerCase();
      if (/insufficient|balance|not enough|wallet/.test(msg)) return "blocked_balance";
      if (/idempotency|mismatch/.test(msg)) return "idempotency_mismatch";
      if (/package/.test(msg)) return "bad_package";
    }
  } catch {
    // Malformed 409 body still stops safely at needs_admin.
  }
  return "http_409";
}

function extractRedeemCodes(data: Row, quantity: number): string[] | null {
  if (Array.isArray(data.redeem_codes)) {
    if (data.redeem_codes.length !== quantity) return null;
    const trimmed = data.redeem_codes.map((c) => (typeof c === "string" ? c.trim() : ""));
    return trimmed.every((c) => c.length > 0) ? trimmed : null;
  }
  if (data.redeem_codes == null && quantity === 1 && typeof data.redeem_code === "string") {
    const single = data.redeem_code.trim();
    return single.length > 0 ? [single] : null;
  }
  return null;
}

/** false means safe idempotent replay (GET first, then POST same key), never a fresh external ID. Entire body already sealed. */
async function interpret(
  db: DatabaseAccess,
  link: Row,
  r: Pick<MiraiRawResponse, "status" | "text">,
): Promise<boolean> {
  if (r.status === 429 || r.status >= 500) return false;
  if (r.status === 409) {
    await settle(db, link, "needs_admin", map409Error(r.text));
    return true;
  }
  if (r.status < 200 || r.status >= 300) {
    await settle(db, link, "needs_admin", `http_${r.status}`);
    return true;
  }
  if (r.status !== 200) {
    await settle(db, link, "needs_admin", `http_${r.status}`);
    return true;
  }

  let json: unknown;
  try {
    json = JSON.parse(r.text);
  } catch {
    return false;
  }
  if (!record(json)) return false;
  if (json.success !== true || !record(json.data)) {
    await settle(db, link, "needs_admin", "provider_failed");
    return true;
  }

  const d = json.data;
  const providerOrderCode =
    typeof d.order_code === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(d.order_code) ? d.order_code : null;
  if (
    link.provider_order_code != null &&
    providerOrderCode != null &&
    providerOrderCode !== link.provider_order_code
  ) {
    await settle(db, link, "needs_admin", "receipt_identity_mismatch");
    return true;
  }

  if (
    d.external_order_id !== link.external_order_id ||
    d.package_code !== link.package_code ||
    d.quantity !== link.quantity
  ) {
    await settle(db, link, "needs_admin", "receipt_identity_mismatch");
    return true;
  }

  const quantity = Number(link.quantity);
  const codes = d.status === "fulfilled" ? extractRedeemCodes(d, quantity) : null;
  const amountVnd = numeric(d.amount_vnd);
  const unitPriceVnd = numeric(d.unit_price_vnd);

  await db.execRun(
    `UPDATE mirai_order_links
     SET provider_order_code=COALESCE(?, provider_order_code), receipt_json=?
     WHERE id=? AND lease_owner=? AND status!='completed'`,
    providerOrderCode,
    JSON.stringify({
      received: codes?.length ?? (Array.isArray(d.redeem_codes) ? d.redeem_codes.length : 0),
      requested: quantity,
      status: typeof d.status === "string" ? d.status : null,
      amount_vnd: amountVnd,
      unit_price_vnd: unitPriceVnd,
    }),
    link.id,
    link.lease_owner,
  );

  if (d.status !== "fulfilled") {
    await settle(db, link, "needs_admin", "incomplete_receipt");
    return true;
  }
  if (!codes) {
    await settle(db, link, "needs_admin", "incomplete_receipt");
    return true;
  }

  const secret = await encryptSecret(codes.join("\n"));
  const saved = await db.execRun(
    `UPDATE fulfillment_items
     SET delivered_ciphertext=?, delivered_iv=?, status='queued', last_error=NULL, locked_until=NULL
     WHERE mirai_link_id=? AND order_code=? AND item_index=?
       AND status NOT IN ('delivered','sending')
       AND wr_link_id IS NULL AND sk_link_id IS NULL AND tunvn_link_id IS NULL AND aivault_link_id IS NULL AND storebat_link_id IS NULL AND inventory_id IS NULL
       AND EXISTS(SELECT 1 FROM mirai_order_links WHERE id=? AND lease_owner=? AND status!='completed' AND datetime(lease_expires_at)>datetime('now'))`,
    secret.ciphertext,
    secret.iv,
    link.id,
    link.order_code,
    link.item_index,
    link.id,
    link.lease_owner,
  );
  if (!saved.changes) {
    await settle(db, link, "needs_admin", "fulfillment_owned_elsewhere");
    return true;
  }

  // Queue before clearing the lease; a crash repeats this step from the encrypted receipt.
  await db.execRun(
    `UPDATE fulfillment_jobs
     SET status='queued', attempt_count=0, next_attempt_at=datetime('now'), locked_until=NULL
     WHERE order_code=? AND status IN ('delivered','manual_required','failed')`,
    link.order_code,
  );
  await settle(db, link, "completed", null);
  return true;
}

async function processLink(db: DatabaseAccess, id: number, deadlineMs = Infinity) {
  const owner = crypto.randomUUID();
  const claimed = await db.execRun(
    `UPDATE mirai_order_links
     SET lease_owner=?, lease_expires_at=datetime('now','+90 seconds'), status='claimed'
     WHERE id=? AND status IN ('pending','claimed','processing')
       AND datetime(next_attempt_at)<=datetime('now')
       AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<datetime('now'))`,
    owner,
    id,
  );
  if (!claimed.changes) return;
  const link = await db.queryFirst("SELECT * FROM mirai_order_links WHERE id=? AND lease_owner=?", id, owner);
  if (!link) return;
  if (Date.now() >= deadlineMs) {
    await settle(db, link, link.request_sent_at ? "processing" : "pending", "dispatch_deferred");
    return;
  }

  let sent = false;
  try {
    const order = await db.queryFirst("SELECT * FROM orders WHERE code=?", link.order_code);
    const item = order ? lines(order)[Number(link.item_index)] : null;
    const e = eligibleMiraiLine(item);
    if (
      !order ||
      !paid(order) ||
      !item ||
      !e ||
      e.package_code !== link.package_code ||
      e.cost_usdt !== link.cost_usdt ||
      item.variant_id !== link.variant_id ||
      item.product_id !== link.product_id ||
      item.qty !== link.quantity ||
      link.external_order_id !== `${link.order_code}-${link.item_index}` ||
      link.idempotency_key !== link.external_order_id
    ) {
      await settle(db, link, "needs_admin", "snapshot_mismatch");
      return;
    }

    let fulfillment = await db.queryFirst(
      "SELECT * FROM fulfillment_items WHERE order_code=? AND item_index=?",
      link.order_code,
      link.item_index,
    );
    if (!fulfillment) {
      await ensureFulfillmentItems(order, db, 1);
      fulfillment = await db.queryFirst(
        "SELECT * FROM fulfillment_items WHERE order_code=? AND item_index=?",
        link.order_code,
        link.item_index,
      );
    }
    if (!fulfillment) {
      await settle(db, link, "pending", "fulfillment_missing");
      return;
    }
    if (
      fulfillment.product_id !== link.product_id ||
      fulfillment.variant_id !== link.variant_id ||
      fulfillment.qty !== link.quantity ||
      fulfillment.fulfillment_mode !== "manual" ||
      ["delivered", "sending"].includes(String(fulfillment.status)) ||
      fulfillment.inventory_id ||
      fulfillment.wr_link_id ||
      fulfillment.sk_link_id ||
      fulfillment.tunvn_link_id ||
      fulfillment.aivault_link_id ||
      fulfillment.storebat_link_id ||
      (fulfillment.mirai_link_id && fulfillment.mirai_link_id !== id)
    ) {
      await settle(db, link, "needs_admin", "fulfillment_owned_elsewhere");
      return;
    }

    const bound = await db.execRun(
      `UPDATE fulfillment_items SET mirai_link_id=?
       WHERE id=? AND (mirai_link_id IS NULL OR mirai_link_id=?)
         AND wr_link_id IS NULL AND sk_link_id IS NULL AND tunvn_link_id IS NULL AND aivault_link_id IS NULL AND storebat_link_id IS NULL AND inventory_id IS NULL
         AND status NOT IN ('delivered','sending')`,
      id,
      fulfillment.id,
      id,
    );
    if (!bound.changes) {
      await settle(db, link, "needs_admin", "fulfillment_owned_elsewhere");
      return;
    }

    if (link.receipt_ciphertext && link.receipt_iv && link.receipt_http_status) {
      const storedResponse = {
        status: Number(link.receipt_http_status),
        text: await decryptSecret(String(link.receipt_ciphertext), String(link.receipt_iv)),
      };
      if (await interpret(db, link, storedResponse)) return;
    }

    await encryptSecret("mirai-encryption-preflight");

    const variant = await db.queryFirst(
      `SELECT pv.*, p.source, p.is_active AS product_active, p.archived_at,
         p.mirai_family, p.wr_product_id, p.sk_product_id, p.wr_auto_managed, p.sk_auto_managed,
         p.tunvn_family, p.aivault_family, p.storebat_family
       FROM product_variants pv JOIN products p ON p.id=pv.product_id
       WHERE pv.id=? AND pv.product_id=?`,
      link.variant_id,
      link.product_id,
    );
    if (
      !variant ||
      variant.sku !== `MR-${link.package_code}` ||
      variant.mirai_package_code !== link.package_code ||
      !variant.mirai_family ||
      variant.archived_at != null ||
      variant.fulfillment_mode !== "manual" ||
      variant.source !== "manual" ||
      variant.is_active !== 1 ||
      variant.product_active !== 1 ||
      variant.wr_variant_id ||
      variant.sk_variant_id ||
      variant.tunvn_buff_quantity_b ||
      variant.aivault_service_id ||
      variant.storebat_product_id ||
      variant.wr_product_id ||
      variant.sk_product_id ||
      Number(variant.wr_auto_managed) ||
      Number(variant.sk_auto_managed) ||
      variant.tunvn_family ||
      variant.aivault_family ||
      variant.storebat_family
    ) {
      await settle(db, link, "needs_admin", "source_changed");
      return;
    }

    // Recovery after a previous POST attempt: always GET /orders/{external_order_id} first.
    if (link.request_sent_at) {
      const lookup = await getMiraiOrder(String(link.external_order_id));
      if (lookup.status === 200) {
        if (!(await saveReceipt(db, link, lookup))) return;
        if (!(await interpret(db, link, lookup))) await deferRetry(db, link, lookup.retryAfterSeconds);
        return;
      }
      if (lookup.status === 429 || lookup.status >= 500) {
        await deferRetry(db, link, lookup.retryAfterSeconds);
        return;
      }
      if (lookup.status !== 404) {
        await settle(db, link, "needs_admin", `http_${lookup.status}`);
        return;
      }
    }

    if (Number(link.attempt_count) >= 3) {
      await settle(db, link, "needs_admin", "attempts_exhausted");
      return;
    }

    if (!link.request_sent_at) {
      const pkgsRes = await fetchMiraiPackages();
      if (pkgsRes.kind !== "ok") {
        await settle(db, link, "needs_admin", "package_unavailable");
        return;
      }
      const pkg = pkgsRes.data.find((p) => p.code === link.package_code);
      if (!pkg) {
        await settle(db, link, "needs_admin", "package_unavailable");
        return;
      }
      const qty = Number(link.quantity);
      if (qty < pkg.min_quantity || qty > pkg.max_quantity) {
        await settle(db, link, "needs_admin", "package_quantity_invalid");
        return;
      }
      if (!pkg.unlimited && pkg.remaining_today < qty) {
        await settle(db, link, "needs_admin", "stock_unavailable");
        return;
      }
      if (!Number.isFinite(pkg.reseller_price_vnd) || pkg.reseller_price_vnd <= 0) {
        await settle(db, link, "needs_admin", "package_unavailable");
        return;
      }
      const liveUnitUsdt = miraiCostUsdtFromVnd(pkg.reseller_price_vnd);
      const liveTotalUsdt = Math.round(liveUnitUsdt * qty * 1_000_000) / 1_000_000;
      const snapshotUsdt = Number(link.cost_usdt);
      if (liveUnitUsdt * qty > snapshotUsdt + 1e-9 || liveTotalUsdt > snapshotUsdt + 1e-9) {
        await settle(db, link, "needs_admin", "price_increased");
        return;
      }

      const balRes = await fetchMiraiBalance();
      if (balRes.kind !== "ok") {
        await settle(db, link, "needs_admin", "balance_unavailable");
        return;
      }
      const requiredVnd = pkg.reseller_price_vnd * qty;
      if (balRes.balance_vnd < requiredVnd) {
        await settle(db, link, "needs_admin", "insufficient_balance");
        return;
      }
    }

    const fenced = await db.execRun(
      `UPDATE mirai_order_links
       SET request_sent_at=COALESCE(request_sent_at,?),
           attempt_count=attempt_count+1,
           receipt_ciphertext=NULL, receipt_iv=NULL, receipt_http_status=NULL
       WHERE id=? AND lease_owner=? AND status='claimed' AND attempt_count=? AND attempt_count<3
         AND datetime(lease_expires_at)>datetime('now')
         AND EXISTS(SELECT 1 FROM orders WHERE code=? AND items=? AND status='lunas' AND payment_status='paid' AND supplier_purchase_disabled=0)
         AND EXISTS(SELECT 1 FROM fulfillment_items f
           WHERE f.id=? AND f.mirai_link_id=? AND f.status NOT IN ('delivered','sending')
             AND f.wr_link_id IS NULL AND f.sk_link_id IS NULL AND f.tunvn_link_id IS NULL AND f.aivault_link_id IS NULL AND f.storebat_link_id IS NULL AND f.inventory_id IS NULL
             AND f.fulfillment_mode='manual'
             AND f.product_id=mirai_order_links.product_id AND f.variant_id=mirai_order_links.variant_id AND f.qty=mirai_order_links.quantity)
         AND EXISTS(SELECT 1 FROM product_variants v JOIN products p ON p.id=v.product_id
           WHERE v.id=? AND v.product_id=? AND v.mirai_package_code=? AND v.sku=?
             AND v.is_active=1 AND p.is_active=1 AND p.archived_at IS NULL
             AND v.fulfillment_mode='manual' AND p.source='manual' AND p.mirai_family IS ?
             AND v.wr_variant_id IS NULL AND v.sk_variant_id IS NULL AND v.tunvn_buff_quantity_b IS NULL AND v.aivault_service_id IS NULL AND v.storebat_product_id IS NULL
             AND p.wr_product_id IS NULL AND p.sk_product_id IS NULL AND p.wr_auto_managed=0 AND p.sk_auto_managed=0
             AND p.tunvn_family IS NULL AND p.aivault_family IS NULL AND p.storebat_family IS NULL)`,
      new Date().toISOString(),
      id,
      owner,
      link.attempt_count,
      link.order_code,
      order.items,
      fulfillment.id,
      id,
      link.variant_id,
      link.product_id,
      link.package_code,
      variant.sku,
      variant.mirai_family,
    );
    if (!fenced.changes) {
      await settle(db, link, "needs_admin", "send_guard_changed");
      return;
    }
    link.attempt_count = Number(link.attempt_count) + 1;
    sent = true;

    const response = await buyMiraiPackage(
      String(link.package_code),
      Number(link.quantity),
      String(link.external_order_id),
      String(link.idempotency_key),
    );
    if (!(await saveReceipt(db, link, response))) return;
    if (!(await interpret(db, link, response))) {
      await deferRetry(db, link, response.retryAfterSeconds, true);
    }
  } catch {
    // Fixed metadata only; provider bodies/keys/redeem codes never enter logs/errors.
    if (sent || link.request_sent_at) {
      await deferRetry(db, link, undefined, true).catch(() => {});
    } else {
      await settle(db, link, "needs_admin", "preflight_unavailable").catch(() => {});
    }
  }
}

export async function retryMiraiOrder(db: DatabaseAccess, id: number): Promise<boolean> {
  if (!db.d1 || !isMiraiDispatchEnabled() || !db.canSpend(30)) return false;
  const r = await db.execRun(
    `UPDATE mirai_order_links
     SET status='pending', last_error=NULL, next_attempt_at=datetime('now'), lease_owner=NULL, lease_expires_at=NULL
     WHERE id=? AND ${MIRAI_RETRYABLE_SQL}`,
    id,
  );
  if (!r.changes) return false;
  await processLink(db, id);
  return true;
}

export async function processMiraiOrders(
  db: DatabaseAccess = createDatabaseAccess(),
  options: { orderCode?: string; deadlineMs?: number } = {},
): Promise<number> {
  if (!db.d1 || !isMiraiDispatchEnabled() || !db.canSpend(35) || Date.now() >= (options.deadlineMs ?? Infinity)) return 0;
  const orphan = options.orderCode
    ? { code: options.orderCode }
    : await db.queryFirst(
        `SELECT o.code FROM orders o
         WHERE o.status='lunas' AND o.payment_status='paid' AND o.supplier_purchase_disabled=0
           AND COALESCE(o.order_kind,'apps')='apps' AND o.sales_channel IN ('web','telegram')
           AND EXISTS(
             SELECT 1 FROM json_each(CASE WHEN json_valid(o.items) THEN o.items ELSE '[]' END) j
             WHERE json_extract(j.value,'$.mirai_eligibility.version')=1
               AND json_extract(j.value,'$.mirai_eligibility.cost_usdt')>0
               AND NOT EXISTS(
                 SELECT 1 FROM mirai_order_links l
                 WHERE l.order_code=o.code AND l.item_index=CAST(j.key AS INTEGER)
               )
           )
         ORDER BY o.id LIMIT 1`,
      );
  if (orphan) await createMiraiOrderLinks(String(orphan.code), db);
  if (!db.canSpend(25) || Date.now() >= (options.deadlineMs ?? Infinity)) return 0;
  const link = await db.queryFirst(
    `SELECT id FROM mirai_order_links
     WHERE status IN ('pending','claimed','processing')
       AND datetime(next_attempt_at)<=datetime('now')
       AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<datetime('now'))
       ${options.orderCode ? "AND order_code=?" : ""}
     ORDER BY next_attempt_at, id LIMIT 1`,
    ...(options.orderCode ? [options.orderCode] : []),
  );
  if (!link) return 0;
  await processLink(db, Number(link.id), options.deadlineMs);
  return 1;
}
