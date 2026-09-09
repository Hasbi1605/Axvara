// src/lib/fulfillment/delivery/handover.ts — Penyerahan manual satu item oleh admin.
//
// MENGAPA dipisah: handover manual adalah tindakan nyata (bukan sekadar catatan)
// dengan kontrak idempotensi, jejak audit stabil, dan penilaian kelengkapan
// manifest yang berbeda dari jalur otomatis. Mengumpulkannya membuat aturan
// "item delivered tetapi agregat belum → sembuhkan tanpa efek ganda" dan
// stempel audit STABIL per fakta handover mudah ditinjau tanpa terkubur di
// mesin cron/kirim. NOL perubahan perilaku: SQL, guard status, dan regex audit
// identik dengan versi monolit.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import type { ManualHandoverResult, Row } from "./types";
import { allItemsDelivered, findMissingFulfillmentLines } from "./manifest";
import { ensureFulfillmentItems } from "./inventory-binding";

/**
 * Selesaikan penulisan handover yang tertunda secara idempoten (RR3-07):
 * inventory → audit → agregat order → job. Tiap langkah aman diulang
 * (guard status/CAS); tidak ada pengiriman ulang kredensial dan tidak ada
 * pemotongan stok ganda. Mengembalikan true bila seluruh efek samping kini
 * konsisten (atau sudah konsisten sebelumnya).
 *
 * RR4-03: stempel audit STABIL per fakta handover — pemanggil memberikan
 * stamp kejadian awal; retry memakai stamp yang SAMA sehingga tidak tercipta
 * marker audit kedua. Marker recovery (bila perlu) dicatat terpisah dengan
 * awalan berbeda, bukan sebagai handover baru.
 */
/** Reconcile side effects from the ORIGINAL recorded fact. A literal prefix is
 * the event identity; unlike LIKE it has no pattern-length/wildcard semantics. */
export async function reconcileHandoverWrites(
  orderCode: string, itemIndex: number, reviewer: string, stamp: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  const { queryFirst, queryAll, execRun } = database;
  void reviewer;
  void stamp;
  const item = await queryFirst(
    `SELECT * FROM fulfillment_items WHERE order_code=? AND item_index=?`, orderCode, itemIndex,
  );
  if (!item || String(item.status) !== "delivered") return false;
  const noteRow = await queryFirst(`SELECT admin_note FROM orders WHERE code=?`, orderCode);
  const prefix = `handover item ${itemIndex} oleh `;
  const oldNote = String(noteRow?.admin_note ?? "");
  const recorded = String(item.last_error ?? "").match(/^manual_handover:([^:]+):(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
  // A legacy delivered row without a handover fact is recorded as recovery,
  // not attributed to the current admin as a new physical handover.
  const actor = recorded?.[1] ?? "legacy (pelaku tidak tercatat)";
  const occurredAt = recorded?.[2] ?? String(item.updated_at ?? "waktu tidak tercatat");
  const marker = ` [${prefix}${actor} ${occurredAt}]`;
  const missing = await findMissingFulfillmentLines(orderCode, database);
  const remaining = await queryAll(`SELECT status FROM fulfillment_items WHERE order_code=?`, orderCode);
  const complete = missing.length === 0 && allItemsDelivered(remaining);
  const aggregate = complete ? "delivered" : "manual_required";
  const statements: { sql: string; params: unknown[] }[] = [];
  if (Number(item.inventory_id || 0) > 0) statements.push({
    sql: `UPDATE fulfillment_inventory SET status='delivered', delivered_at=datetime('now')
          WHERE id=? AND status='reserved' AND order_code=?`, params: [Number(item.inventory_id), orderCode],
  });
  if (!oldNote.includes(prefix)) statements.push({
    sql: `UPDATE orders SET admin_note=COALESCE(admin_note,'') || ?, updated_at=datetime('now')
          WHERE code=? AND instr(COALESCE(admin_note,''), ?)=0`, params: [marker, orderCode, prefix],
  });
  statements.push({ sql: `UPDATE orders SET fulfillment_status=?, updated_at=datetime('now') WHERE code=?`, params: [aggregate, orderCode] });
  if (complete) statements.push({
    sql: `UPDATE fulfillment_jobs SET status='delivered', locked_until=NULL, item_cursor=NULL, updated_at=datetime('now')
          WHERE order_code=? AND status!='delivered'`, params: [orderCode],
  });
  try {
    if (database.d1) await database.d1.batch(statements.map(({ sql, params }) => database.d1!.prepare(sql).bind(...params)));
    else for (const statement of statements) await execRun(statement.sql, ...statement.params);
  } catch { return false; }
  return true;
}

/** Compatibility helper: use the winning item's durable timestamp. */
export async function readHandoverStamp(
  orderCode: string, itemIndex: number, reviewer: string, fallbackStamp: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<string> {
  void reviewer;
  const item = await database.queryFirst(`SELECT last_error, updated_at FROM fulfillment_items WHERE order_code=? AND item_index=?`, orderCode, itemIndex);
  return String(item?.last_error ?? "").match(/^manual_handover:[^:]+:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/)?.[1]
    ?? String(item?.updated_at ?? fallbackStamp);
}

export async function recordManualHandover(
  orderCode: string,
  itemIndex: number,
  adminEmail: string,
  note?: string | null,
): Promise<boolean> {
  const result = await recordManualHandoverDetailed(orderCode, itemIndex, adminEmail, note);
  return result.ok;
}

/**
 * Catat penyerahan manual satu item oleh admin (review R3/D — tindakan
 * handover yang nyata, bukan sekadar menulis admin_note).
 *
 * Kontrak:
 * - Hanya untuk order lunas (status='lunas', payment_status='paid').
 * - Item harus milik order tersebut (order_code + item_index cocok) dan
 *   masih menunggu penyerahan (status manual_required/retry/queued).
 * - Idempoten: item yang sudah delivered → sukses tanpa efek samping
 *   (klik dua kali tidak menggandakan pengiriman/konsumsi stok).
 * - Status pembayaran TIDAK diubah — hanya status pengiriman.
 * - Inventory unique yang diserahkan manual ikut ditandai delivered agar
 *   tidak dikirim ganda oleh retry otomatis; stok varian tidak dipotong
 *   lagi (sudah dipotong saat checkout).
 * - Jejak audit: admin_note order ditambah + last_error item mencatat
 *   siapa menyerahkan dan kapan.
 *
 * RR3-02: sebelum menyelesaikan agregat, manifest dicocokkan terhadap
 * order (item_index, product_id, variant_id, jumlah). Bila materialisasi
 * terputus (baris hilang/salah), agregat TIDAK delivered — handover
 * mencoba memulihkan baris yang hilang secara idempoten
 * (ensureFulfillmentItems) dan melaporkan `incomplete_manifest` bila
 * masih belum lengkap.
 *
 * RR3-07: seluruh penulisan lanjutan (inventory, audit, agregat order,
 * job) diverifikasi; bila salah satunya gagal, handover mengembalikan
 * `storage_error` (JANGAN klaim sukses) dan pemanggilan ulang
 * menyelesaikan sisanya via reconcileHandoverWrites tanpa efek ganda.
 *
 * Mengembalikan { ok:true } bila item kini delivered (termasuk sudah
 * delivered sebelumnya), { ok:false, reason } bila prasyarat tak terpenuhi.
 */
export async function recordManualHandoverDetailed(
  orderCode: string,
  itemIndex: number,
  adminEmail: string,
  note?: string | null, database: DatabaseAccess = createDatabaseAccess()
): Promise<ManualHandoverResult> {
  const { queryAll, queryFirst, execRun } = database;
  const reviewer = String(adminEmail || "").trim().slice(0, 120);
  if (!reviewer) return { ok: false, reason: "not_found" };
  const order = await queryFirst(
    `SELECT code, status, payment_status FROM orders WHERE code=?`,
    orderCode,
  );
  if (!order) return { ok: false, reason: "not_found" };
  if (String(order.status) !== "lunas" || String(order.payment_status) !== "paid") {
    return { ok: false, reason: "not_paid" };
  }
  const item = await queryFirst(
    `SELECT * FROM fulfillment_items WHERE order_code=? AND item_index=?`,
    orderCode, itemIndex,
  );
  if (!item) return { ok: false, reason: "not_found" };
  const firstStamp = new Date().toISOString();
  if (String(item.status) === "delivered") {
    // Idempoten TETAPI sembuhkan agregat yang tertinggal (RR3-07): item
    // delivered + agregat manual_required = penulisan lanjutan yang gagal
    // dan belum pernah dicoba ulang.
    // RR4-03: hasil reconcile DIPROPAGASI — bila DB masih gagal, kembalikan
    // reconcile_failed (JANGAN klaim sukses). Stamp stabil: baca marker yang
    // sudah tercatat untuk item ini (fakta awal), bukan stamp baru.
    const stableStamp = await readHandoverStamp(orderCode, itemIndex, reviewer, firstStamp, database);
    const healed = await reconcileHandoverWrites(orderCode, itemIndex, reviewer, stableStamp, database).catch(() => false);
    if (!healed) return { ok: false, reason: "reconcile_failed" };
    if ((await findMissingFulfillmentLines(orderCode, database)).length) return { ok: false, reason: "incomplete_manifest" };
    const remaining = await database.queryAll(`SELECT status FROM fulfillment_items WHERE order_code=?`, orderCode);
    return { ok: true, complete: allItemsDelivered(remaining) };
  }
  if (!["manual_required", "retry", "queued", "failed"].includes(String(item.status))) {
    return { ok: false, reason: "bad_state" };
  }
  const stamp = firstStamp;
  const audit = `manual_handover:${reviewer}:${stamp}${note ? `:${String(note).slice(0, 200)}` : ""}`;
  try {
    const flipped = await execRun(
      `UPDATE fulfillment_items
       SET status='delivered', delivered_message_id='manual', locked_until=NULL,
           last_error=?, updated_at=datetime('now')
       WHERE order_code=? AND item_index=? AND status IN ('manual_required','retry','queued','failed')`,
      audit, orderCode, itemIndex,
    );
    if (!flipped.changes) {
      // Kalah race dengan worker lain yang baru menyelesaikan — baca ulang:
      // bila kini delivered, anggap sukses idempoten TETAPI tetap sembuhkan
      // agregat; kegagalan reconcile dipropagasi (RR4-03).
      const fresh = await queryFirst(
        `SELECT status FROM fulfillment_items WHERE order_code=? AND item_index=?`,
        orderCode, itemIndex,
      );
      if (String(fresh?.status) === "delivered") {
        const healed = await reconcileHandoverWrites(orderCode, itemIndex, reviewer, stamp, database).catch(() => false);
        if (!healed) return { ok: false, reason: "reconcile_failed" };
        if ((await findMissingFulfillmentLines(orderCode, database)).length) return { ok: false, reason: "incomplete_manifest" };
        const remaining = await database.queryAll(`SELECT status FROM fulfillment_items WHERE order_code=?`, orderCode);
        return { ok: true, complete: allItemsDelivered(remaining) };
      }
      return { ok: false, reason: "bad_state" };
    }
  } catch {
    return { ok: false, reason: "storage_error" };
  }
  // RR3-02: pulihkan baris yang hilang sebelum menilai agregat — INSERT
  // yang tertelan di tengah (partial materialization) tidak boleh membuat
  // order dinyatakan selesai.
  try {
    const fullOrder = await queryFirst(`SELECT * FROM orders WHERE code=?`, orderCode);
    if (fullOrder) await ensureFulfillmentItems(fullOrder, database).catch(() => {});
  } catch { /* lanjut ke penilaian manifest di bawah */ }
  const missing = await findMissingFulfillmentLines(orderCode, database);
  if (missing.length > 0) {
    // Manifest belum lengkap: item ini TETAP tercatat delivered (fakta
    // penyerahan tidak dihapus), tetapi agregat TIDAK boleh delivered.
    // Baris yang hilang tetap queued/retry untuk pemulihan berikutnya.
    try {
      await execRun(
        `UPDATE orders SET fulfillment_status='manual_required', updated_at=datetime('now') WHERE code=?`,
        orderCode,
      );
    } catch { return { ok: false, reason: "storage_error" }; }
    return { ok: false, reason: "incomplete_manifest" };
  }
  // RR3-07: selesaikan seluruh penulisan lanjutan; kegagalan di sini =
  // storage_error yang jujur (bukan sukses palsu), dan retry berikutnya
  // menyembuhkan via reconcileHandoverWrites.
  const reconciled = await reconcileHandoverWrites(orderCode, itemIndex, reviewer, stamp, database).catch(() => false);
  if (!reconciled) return { ok: false, reason: "storage_error" };
  const remaining = await queryAll(
    `SELECT status FROM fulfillment_items WHERE order_code=?`,
    orderCode,
  ).catch(() => [] as Row[]);
  const complete = remaining.length > 0 && remaining.every((row) => String(row.status) === "delivered");
  return { ok: true, complete };
}
