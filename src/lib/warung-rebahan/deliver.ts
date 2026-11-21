// src/lib/warung-rebahan/deliver.ts — Completion + delivery detail akun WR.
//
// DESAIN (migrasi 0029):
// - Status vendor (processing/completed/failed) monotonik via CAS
//   (advanceWrLinkMonotonic): completed TIDAK PERNAH diregresi oleh failed
//   yang terlambat/replay (P1-7).
// - Status delivery kredensial (delivery_status) TERPISAH dari status
//   vendor: completed dicatat dulu, delivery di-retry sampai durable
//   (P0-6). Order baru dianggap selesai setelah delivery queued/settled.
// - Item WR adalah fulfillment_items mode 'manual' (kontrak fulfillment:
//   hanya manual/shared/unique). Completion WR menyelesaikan HANYA item
//   WR terkait; agregat order dihitung dari SELURUH fulfillment_items
//   (P0-5) — mixed cart tidak delivered prematur.
// - Detail akun dienkripsi AES-256-GCM sebelum disimpan (tidak plaintext).
// - Web retrieval memakai capability token (hash di DB, raw hanya ke
//   pembeli) — TIDAK dibuka hanya dengan kode order (P0-6).
// - Telegram hanya private chat; order WhatsApp historis diserahkan manual.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { decryptSecret, encryptSecret } from "@/lib/fulfillment/crypto";
import { ensureFulfillmentItems } from "@/lib/fulfillment/delivery/inventory-binding";
import { rewriteSupplierDocsLinks } from "@/lib/product-copy/format";
import { casAdvanceBoundInvoice, supplierVendorStatusRank } from "@/lib/suppliers/purchase-state";
import { decodeJaspayVariantId, isJaspayVariantId } from "./jaspay";
import { persistJaspayProgress } from "./progress";
import type { JaspayOrderResult } from "./client";
export type WrOrderLinkRow = {
  id: number;
  order_code: string;
  wr_order_id: string | null;
  wr_variant_id: string;
  quantity: number;
  wr_cost: number;
  status: string;
};

const WR_MANUAL_WA = "legacy_whatsapp_manual_handover";
// Old WR WA delivery called enqueue success "delivered". Recover only when
// the recorded transport is dead, not sent or currently owned by a worker.
const WA_WR_UNSENT = `(delivery_status='delivered' AND delivery_channel='whatsapp'
  AND COALESCE(delivery_last_error,'')!='skipped_manual_handover'
  AND EXISTS (SELECT 1 FROM whatsapp_outbox w
    WHERE w.idempotency_key='wa:text:wr-delivery:' || wr_order_links.order_code
      AND w.status='dead'))`;

export function wrStatusRank(status: unknown): number {
  return supplierVendorStatusRank(status);
}

/**
 * Maju status vendor secara monotonik + CAS (P1-7).
 * - completed/failed (rank 4) tidak bisa diregresi ke rank lebih rendah.
 * - completed tidak bisa diubah menjadi failed dan sebaliknya (keduanya
 *   terminal) — webhook yang kalah sempre direkam di wr_webhook_events
 *   dengan applied=0 (observable, bukan diam).
 * - Event duplikat (event_id sama) tidak diterapkan dua kali.
 * Mengembalikan true bila transisi diterapkan.
 */
export async function advanceWrLinkMonotonic(
  wrOrderId: string,
  toStatus: "processing" | "completed" | "failed",
  fields: Record<string, unknown> | null,
  database?: DatabaseAccess,
  eventId?: string,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const link = await queryFirst(`SELECT * FROM wr_order_links WHERE wr_order_id=?`, wrOrderId).catch(
    () => null,
  );
  if (!link) return false;
  const from = String(link.status || "");
  // Dedupe event: event_id sama yang sudah diterapkan → no-op tercatat.
  if (eventId) {
    const seen = await queryFirst(
      `SELECT id FROM wr_webhook_events WHERE wr_order_id=? AND event_id=? AND applied=1`,
      wrOrderId,
      eventId,
    ).catch(() => null);
    if (seen) {
      await logWebhookEvent(db, wrOrderId, toStatus, eventId, false, "duplicate_event_id").catch(
        () => undefined,
      );
      return true;
    }
  }
  const fromRank = wrStatusRank(from);
  const toRank = wrStatusRank(toStatus);
  // Terminal vs terminal berbeda = regresi terlarang (completed→failed).
  if (fromRank >= 4 && toRank >= 4 && from !== toStatus) {
    await logWebhookEvent(db, wrOrderId, toStatus, eventId, false, `terminal_regression_blocked:${from}`).catch(
      () => undefined,
    );
    return false;
  }
  // Regresi rank = webhook terlambat/replay.
  if (toRank < fromRank) {
    await logWebhookEvent(db, wrOrderId, toStatus, eventId, false, `rank_regression_blocked:${from}`).catch(
      () => undefined,
    );
    return false;
  }
  if (from === toStatus) {
    await logWebhookEvent(db, wrOrderId, toStatus, eventId, true, "idempotent_replay").catch(
      () => undefined,
    );
    return true;
  }
  const res = await casAdvanceBoundInvoice(execRun, "wr", wrOrderId, from, toStatus, fields, eventId);
  const applied = Number(res.changes ?? 0) > 0;
  await logWebhookEvent(
    db,
    wrOrderId,
    toStatus,
    eventId,
    applied,
    applied ? `advanced:${from}` : "lost_race",
  ).catch(() => undefined);
  return applied;
}

async function logWebhookEvent(
  db: DatabaseAccess,
  wrOrderId: string,
  event: string,
  eventId: string | undefined,
  applied: boolean,
  result: string,
): Promise<void> {
  try {
    await db.execRun(
      `INSERT INTO wr_webhook_events (wr_order_id, event, event_id, applied, result)
       VALUES (?,?,?,?,?)`,
      wrOrderId,
      event,
      eventId ?? null,
      applied ? 1 : 0,
      result.slice(0, 200),
    );
  } catch {
    // DB pre-0029: tabel belum ada — abaikan, transisi tetap berlaku.
  }
}

/** Normalisasi key detail akun WR: case/spasi/underscore-insensitive
 *  ("Akses OTP", "akses_otp" → "aksesotp") agar varian baru WR yang memakai
 *  key tak dikenal tetap tampil rapi, bukan JSON mentah. */
function normDetailKey(raw: string): string {
  return raw.toLowerCase().replace(/[\s_]+/g, "");
}

/** Key → label Indonesia. Key tak dikenal tampil apa adanya (kapitalisasi
 *  rapi), bukan JSON — pembeli tidak boleh melihat `{...}`. */
const DETAIL_KEY_LABELS: Record<string, string> = {
  email: "Email",
  username: "Username",
  user: "User",
  akun: "Akun",
  password: "Password",
  pass: "Password",
  pin: "PIN",
  aksesotp: "Akses OTP",
  otp: "OTP",
  url: "Tautan",
  link: "Tautan",
  note: "Catatan",
  keterangan: "Keterangan",
};

function labelDetailKey(raw: string): string {
  return DETAIL_KEY_LABELS[normDetailKey(raw)] ?? raw.trim().replace(/[_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Objek field berlabel dari hulu WR: `{label, value}` / `{name, value}` /
 * `{key, value}` (payload /transactions 2026-10-13, order Bstation: tiap
 * field akun datang sebagai objek seperti ini). Kembalikan [label, nilai]
 * ternormalisasi, atau null bila objek ini BUKAN bentuk berlabel — kunci
 * selain label/value (mis. `{email, password}` datar) tidak boleh tertelan.
 */
function labeledFieldOf(o: Record<string, unknown>): [string, string] | null {
  const keys = Object.keys(o);
  const labelKey = keys.find((k) => ["label", "name", "key", "field"].includes(normDetailKey(k)));
  const valueKey = keys.find((k) => ["value", "val", "isi", "content"].includes(normDetailKey(k)));
  if (!labelKey || !valueKey) return null;
  if (!keys.every((k) => k === labelKey || k === valueKey || ["product", "type"].includes(normDetailKey(k)))) return null;
  const label = String(o[labelKey] ?? "").trim();
  const value = String(o[valueKey] ?? "").trim().replace(/\r\n?/g, "\n");
  if (!label || !value) return null;
  return [labelDetailKey(label), value];
}

/** Satu objek detail → baris-baris "Label: nilai" (newline, BUKAN " · ":
 *  panel/email/WA membacanya sebagai daftar kredensial, dan pemisah titik
 *  tengah dulu melebur label+value mentah jadi satu baris tak terbaca —
 *  screenshot owner 2026-10-13). Nilai URL/OTP panjang tidak dipotong
 *  per-field (batas 2000 char ditegakkan di tingkat hasil).
 *  Objek PEMBUNGKUS hulu (`{product, details}` — bukti prod 95FC****) tidak
 *  dirender sebagai field: hanya `details`-nya yang dipakai (rekursif),
 *  `product` dibuang (nama produk sudah ada di konteks order/pesan).
 *  Nilai ARRAY/OBJEK direkursi (2026-10-04, kasus F111FD64): payload
 *  /transactions untuk varian Private mengirim
 *  `{product, details: [{...},{...},{...},{...}]}` (details = ARRAY OBJEK,
 *  bukan string) — `String(v)` menghasilkan "[object Object]" ×4 persis
 *  seperti screenshot owner. Sekarang tiap elemen diformat rekursif.
 *  Bentuk `{label, value}` per field (2026-10-13) dirender "Label: nilai". */
function formatDetailObject(o: Record<string, unknown>): string {
  const labeled = labeledFieldOf(o);
  if (labeled) return `${labeled[0]}: ${labeled[1]}`;
  const keys = Object.keys(o);
  if ("details" in o && typeof o.details === "string" && keys.every((k) => ["product", "details", "data", "account_details"].includes(normDetailKey(k)))) {
    return normalizeAccountDetailsForDisplay(o.details);
  }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue;
    // Nilai array (mis. details = [{...},{...}]) → format tiap elemen rekursif.
    if (Array.isArray(v)) {
      const nested = v
        .map((el) => {
          if (el == null) return "";
          if (typeof el === "string") return el.trim();
          if (typeof el === "object") return formatDetailObject(el as Record<string, unknown>);
          return String(el);
        })
        .filter(Boolean)
        .join("\n");
      if (nested) {
        // details ber-array = isi utama (tanpa label "Details:"), key lain = field.
        if (["details", "detail", "data", "accountdetails"].includes(normDetailKey(k))) parts.push(nested);
        else parts.push(`${labelDetailKey(k)}:\n${nested}`);
      }
      continue;
    }
    // Nilai objek (mis. details = {email, password}) → rekursi sebagai field.
    if (typeof v === "object") {
      const nested = formatDetailObject(v as Record<string, unknown>);
      if (nested) parts.push(nested);
      continue;
    }
    const text = String(v).trim().replace(/\r\n?/g, "\n");
    if (!text) continue;
    // Metadata non-kredensial + nama produk pembungkus: nama produk sudah
    // ada di konteks order/pesan — jangan cetak ulang sebagai field
    // "Product: ..." (screenshot owner 2026-10-13).
    if (["id", "order_id", "status", "created_at", "product", "product_name", "variant", "variant_name"].includes(normDetailKey(k))) continue;
    // Nilai multiline (details berisi \n) dirender sebagai blok lanjutan,
    // bukan satu field "Details: a\nb".
    if (text.includes("\n") && ["details", "detail", "data", "accountdetails"].includes(normDetailKey(k))) {
      const nested = normalizeAccountDetailsForDisplay(text);
      if (nested) parts.push(nested);
      continue;
    }
    parts.push(`${labelDetailKey(k)}: ${text}`);
  }
  return parts.join("\n");
}

/**
 * Uraikan satu baris "k: v" toleran pemisah ganda ("::" / ": " ganda).
 * `akses otp:  https://...` → ["akses otp", "https://..."].
 * Nilai yang sendiri mengandung ":" (URL, waktu) TIDAK dipotong.
 */
function splitDetailLine(line: string): [string, string] | null {
  const m = /^([^:]+?)\s*:{1,2}\s+(.+)$/.exec(line.trim());
  if (!m) return null;
  const key = m[1].trim();
  const value = m[2].trim();
  if (!key || !value) return null;
  return [key, value];
}

/**
 * Normalisasi SATU baris detail untuk display (dipakai semua kanal: panel
 * web, WA, email, Telegram). Menangani:
 * - `\r\n` / `\r` sisa Windows (SEBELUM split baris — penyebab screenshot
 *   JSON mentah 18 Sep 2026: `\r` ikut jadi bagian key/nilai);
 * - string JSON `{"product": ..., "details": "..."}` (payload reconcile
 *   /transactions kadang membungkus; sebelum 2026-09-18 string apa pun
 *   dikembalikan mentah karena cabang `typeof raw === "string"`);
 * - envelope `{account_details: [...]}` / `{details: "..."}` / `{data: ...}`;
 * - baris `key: value` / `key:: value` (spasi/pemisah ganda) + baris polos.
 * Output SELALU multi-baris rapi — tidak pernah JSON mentah.
 */
export function normalizeAccountDetailsForDisplay(raw: unknown): string {
  const cleaned = decodeCredentialEnvelope(raw);
  if (cleaned == null) return "";
  // Shortlink go/* retroaktif (2026-10-03): kredensial yang TERSIMPAN sebelum
  // shortlink ada (order lama, ciphertext berisi link supplier panjang)
  // dibungkus SAAT TAMPIL — tanpa migrasi data, tanpa re-enkripsi. Berlaku di
  // SEMUA kanal WR yang lewat sini: panel /pesanan + /lacak-pesanan, WA,
  // email, Telegram. SK tidak perlu (formatSkLicenses sudah rewrite di hulu).
  // (format.ts hanya impor ./text yang murni — tidak ada import cycle.)
  if (typeof cleaned === "string") {
    const lines = cleaned
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const kv = splitDetailLine(line);
        if (!kv) return line; // baris polos (catatan) — tampilkan apa adanya.
        return `${labelDetailKey(kv[0])}: ${kv[1]}`;
      });
    // Label ganda ("Email: Email: x") = nilai sudah berlabel dari hulu.
    const text = lines
      .map((l) => l.replace(/^([A-Za-z ]+):\s*\1\s*:\s*/u, "$1: "))
      .join("\n")
      .slice(0, 2000);
    return rewriteSupplierDocsLinks(text) ?? text;
  }
  return formatWrAccountDetails(cleaned);
}

/**
 * Kupas envelope JSON bertingkat sampai ke inti (string / array / objek
 * datar). `"{\"a\":1}"` → `{a:1}`; `{account_details:[...]}` / `{details}`
 * / `{data}` → isinya. Batas 3 lapis anti loop. Gagal parse = kembalikan
 * apa adanya (bukan error).
 */
function decodeCredentialEnvelope(raw: unknown, depth = 0): unknown {
  if (raw == null || depth > 3) return raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try {
        return decodeCredentialEnvelope(JSON.parse(t), depth + 1);
      } catch {
        return raw;
      }
    }
    return raw;
  }
  if (Array.isArray(raw)) return raw.map((d) => decodeCredentialEnvelope(d, depth + 1));
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["account_details", "details", "data"]) {
      if (o[k] !== undefined) return decodeCredentialEnvelope(o[k], depth + 1);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = decodeCredentialEnvelope(v, depth + 1);
    return out;
  }
  return raw;
}

export function formatWrAccountDetails(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.slice(0, 2000);
  try {
    const data = raw as Record<string, unknown>;
    const details = Array.isArray(data) ? data : (data.account_details as unknown[]);
    if (Array.isArray(details) && details.length) {
      return details
        .map((d) => {
          if (typeof d === "string") return d;
          const text = formatDetailObject(d as Record<string, unknown>);
          return text || JSON.stringify(d).slice(0, 500);
        })
        .filter(Boolean)
        .join("\n")
        .slice(0, 2000);
    }
    const flat = formatDetailObject(data);
    if (flat) return flat.slice(0, 2000);
    return JSON.stringify(raw).slice(0, 2000);
  } catch {
    return String(raw).slice(0, 2000);
  }
}

export async function encryptAccountDetails(plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  return encryptSecret(plaintext);
}

export async function decryptAccountDetails(ciphertext: string, iv: string): Promise<string> {
  return decryptSecret(ciphertext, iv);
}

/**
 * Format akun Jaspay (WR3): array `accounts` app-dependent
 * ({email,password} dsb). Field yang didukung dipertahankan semua —
 * JANGAN difilter ke subset premium. Objek tak dikenal dirender
 * key: value (bukan JSON mentah bila memungkinkan, bukan hilang).
 */
export function formatJaspayAccountsForDisplay(accounts: unknown): string {
  if (accounts == null) return "";
  if (typeof accounts === "string") {
    const t = accounts.trim();
    if (!t) return "";
    return normalizeAccountDetailsForDisplay(t);
  }
  const list = Array.isArray(accounts) ? accounts : [accounts];
  const blocks: string[] = [];
  for (const entry of list) {
    if (entry == null) continue;
    if (typeof entry === "string") {
      const t = entry.trim();
      if (t) blocks.push(t);
      continue;
    }
    if (typeof entry === "object") {
      const text = formatDetailObject(entry as Record<string, unknown>);
      blocks.push(text || JSON.stringify(entry).slice(0, 500));
      continue;
    }
    blocks.push(String(entry));
  }
  // Tanpa pemotongan: kredensial qty besar tidak boleh terpotong diam-diam.
  return blocks.filter(Boolean).join("\n\n");
}

/** Akun Jaspay yang benar-benar berisi data (bukan null/kosong). */
export function usableJaspayAccounts(accounts: unknown): unknown[] {
  if (!Array.isArray(accounts)) return [];
  return accounts.filter((entry) => {
    if (entry == null) return false;
    if (typeof entry === "string") return entry.trim().length > 0;
    if (typeof entry === "object") {
      return Object.values(entry as Record<string, unknown>).some(
        (value) => value != null && String(value).trim().length > 0,
      );
    }
    return false;
  });
}

function jaspaySuccessCount(result: JaspayOrderResult): number {
  const direct = Math.floor(Number(result.success_count ?? 0));
  if (Number.isFinite(direct) && direct > 0) return direct;
  const prog = result.progress as { success?: unknown; done?: unknown } | undefined;
  const fromProg = Math.floor(Number(prog?.success ?? 0));
  return Number.isFinite(fromProg) && fromProg > 0 ? fromProg : 0;
}

function jaspayStatusOf(result: JaspayOrderResult): "processing" | "completed" | "partial" | "failed" {
  const raw = String(result.status || "").trim().toLowerCase();
  if (raw === "completed" || raw === "partial" || raw === "failed") return raw;
  return "processing";
}

async function alertJaspayAdminManual(
  invoice: string,
  orderCode: string,
  reason: string,
): Promise<void> {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId || process.env.TELEGRAM_BOT_ENABLED !== "true") return;
  try {
    const { sendMessage } = await import("@/lib/telegram/api");
    await sendMessage({
      chat_id: adminChatId,
      text:
        `🧾 <b>Jaspay perlu tindak lanjut manual</b> <code>${orderCode}</code>\n`
        + `Invoice: <code>${invoice}</code> — ${reason.slice(0, 200)}\n`
        + `Kredensial parsial tersimpan terenkripsi; JANGAN beli ulang otomatis.`,
      parse_mode: "HTML",
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Terminal Jaspay (WR3) — SATU-SATUNYA penentu completed untuk link Jaspay.
 *
 * - completed: HANYA bila paid/qty/success_count/accounts koheren
 *   (success_count >= qty link && accounts.length >= success_count &&
 *   invoice milik link ini via CAS) => jalur completed biasa
 *   (enkripsi + bind + settle + agregat + delivery durable).
 * - partial: kredensial sukses (bila ada) DIENKRIPSI + disimpan durable,
 *   status link TETAP processing (BUKAN completed), item TIDAK di-settle
 *   delivered, TIDAK ada enqueue delivery biasa. Admin di-alert untuk
 *   tindak lanjut manual. TIDAK PERNAH beli ulang / refund buyer otomatis.
 * - failed: monotonik ke failed (seperti premium), tanpa settle. Refund saldo
 *   dengan nominal tidak mengubah pengiriman kecuali supplier juga menyatakan failed.
 * - accounts malformed/kosong pada completed: simpan mentah terenkripsi +
 *   admin followup, JANGAN settle delivered.
 */
export async function handleJaspayTerminal(
  invoice: string,
  result: JaspayOrderResult & { raw?: unknown; refunded_event?: boolean },
  database?: DatabaseAccess,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const link = await queryFirst(`SELECT * FROM wr_order_links WHERE wr_order_id=?`, invoice).catch(
    () => null,
  );
  if (!link || result.invoice !== invoice) return false;
  // No wrong-family fallback: invoice JSP milik link Jaspay saja.
  if (!isJaspayVariantId(String(link.wr_variant_id || ""))) return false;
  const identity = decodeJaspayVariantId(String(link.wr_variant_id));
  if (!identity || (result.product && result.product !== identity.product)) return false;
  const reportedStatus = jaspayStatusOf(result);
  const refundOnly = result.refunded_event === true && reportedStatus !== "failed";
  if (refundOnly) return persistJaspayProgress(link, result, db, true);
  await persistJaspayProgress(link, result, db);
  const status = reportedStatus;
  const now = new Date().toISOString();
  if (status === "processing") {
    return advanceWrLinkMonotonic(invoice, "processing", null, database);
  }
  const qty = Math.max(1, Math.floor(Number(link.quantity || 1)));
  const success = jaspaySuccessCount(result);
  const usable = usableJaspayAccounts(result.accounts);
  if (status === "failed") {
    // Simpan bukti mentah (bila ada) sebelum terminal failed; tidak ada
    // refund pembeli otomatis — admin menindaklanjuti.
    if (result.raw != null || usable.length) {
      await retainJaspayEvidence(link, invoice, result, usable.length, qty, "failed", db);
    }
    const reason = result.refunded_event
      ? "jaspay_refunded"
      : String((result as { note?: unknown }).note ?? "jaspay_failed").slice(0, 500);
    return handleWrOrderFailed(invoice, reason, database, undefined, { allowJaspay: true });
  }
  const reportedQty = Math.floor(Number(result.quantity ?? 0));
  const coherent =
    status === "completed"
    && success >= qty
    && usable.length >= qty
    && (!(reportedQty > 0) || reportedQty === qty);
  if (!coherent) {
    // partial ATAU completed-tak-koheren/malformed: simpan durable untuk
    // admin, tahan di processing, TANPA settle/delivery biasa.
    const applied = await retainJaspayEvidence(link, invoice, result, usable.length, qty, status, db);
    await logWebhookEvent(db, invoice, `jaspay.${status}`, undefined, applied, `retained_for_admin:${usable.length}/${qty}`).catch(
      () => undefined,
    );
    if (applied) {
      await alertJaspayAdminManual(invoice, String(link.order_code || ""), `${status} ${usable.length}/${qty} — kredensial tersimpan, perlu tindak lanjut manual`);
    }
    return applied;
  }
  const plaintext = formatJaspayAccountsForDisplay(usable);
  const { ciphertext, iv } = await encryptSecret(plaintext);
  // Full completed koheren: CAS kepemilikan invoice + settle biasa.
  const completed = await execRun(
    `UPDATE wr_order_links SET wr_account_details=?, wr_account_iv=?, status='completed',
       completed_at=?, last_event_at=?, last_error=NULL, updated_at=datetime('now')
     WHERE wr_order_id=? AND status IN ('pending','claimed','retry','blocked_balance','submitted','ordering','processing','completed')
       AND wr_variant_id LIKE 'jaspay:%' AND status=?`,
    ciphertext,
    iv,
    now,
    now,
    invoice,
    link.status,
  );
  if (!Number(completed.changes ?? 0)) {
    const current = await queryFirst(`SELECT status FROM wr_order_links WHERE wr_order_id=?`, invoice);
    await logWebhookEvent(db, invoice, "jaspay.completed", undefined, false, `terminal_regression_blocked:${current?.status ?? "missing"}`).catch(
      () => undefined,
    );
    return current?.status === "completed";
  }
  await logWebhookEvent(db, invoice, "jaspay.completed", undefined, true, `completed:${String(link.status)}:${success}/${qty}`).catch(
    () => undefined,
  );
  await queueCredentialDelivery(Number(link.id), db);
  let fulfillmentItemId = Number(link.fulfillment_item_id || 0);
  try {
    fulfillmentItemId = await bindWrLinkToFulfillmentItem(Number(link.id), db);
  } catch { /* link TETAP completed; settle memakai fallback */ }
  if (!fulfillmentItemId) fulfillmentItemId = Number(link.fulfillment_item_id || 0);
  await settleWrFulfillmentItem(String(link.order_code), fulfillmentItemId, ciphertext, iv, db);
  await refreshOrderAggregate(String(link.order_code), db);
  if (link.status !== "completed") {
    const { schedulePaidFulfillment } = await import("@/lib/payments/paid-fulfillment");
    await schedulePaidFulfillment(String(link.order_code), "apps", "jaspay", "supplier_settled",
      () => processCredentialDelivery(Number(link.id), db), db);
  } else await processCredentialDelivery(Number(link.id), db).catch(() => undefined);
  return true;
}

/**
 * Simpan bukti kredensial Jaspay non-final secara monotonik: payload LENGKAP
 * (tanpa potong) dienkripsi. Replay dengan akun lebih sedikit/kosong TIDAK
 * menimpa bukti yang lebih lengkap. Link tidak pernah turun dari terminal.
 */
async function retainJaspayEvidence(
  link: Record<string, unknown>,
  invoice: string,
  result: JaspayOrderResult & { raw?: unknown },
  usableCount: number,
  qty: number,
  status: string,
  db: DatabaseAccess,
): Promise<boolean> {
  const previous = /^jaspay_\w+_manual:(\d+)\//.exec(String(link.last_error || ""));
  const previousCount = previous ? Number(previous[1]) : -1;
  const hasEvidence = String(link.wr_account_details || "") !== "";
  const marker = `jaspay_${status}_manual:${usableCount}/${qty}`;
  if (hasEvidence && previousCount >= usableCount) {
    // Bukti lama sama/lebih lengkap: jangan timpa; tetap tahan non-final.
    const kept = await db.execRun(
      `UPDATE wr_order_links SET last_event_at=?, updated_at=datetime('now')
       WHERE wr_order_id=? AND status IN ('submitted','ordering','processing') AND wr_variant_id LIKE 'jaspay:%'`,
      new Date().toISOString(),
      invoice,
    ).catch(() => ({ changes: 0 as number | undefined }));
    return Number(kept.changes ?? 0) > 0 || ["failed", "completed"].includes(String(link.status || ""));
  }
  const evidence = JSON.stringify({
    invoice,
    status,
    quantity: qty,
    success_count: jaspaySuccessCount(result),
    accounts: result.accounts ?? null,
    raw: result.raw ?? null,
    retained_at: new Date().toISOString(),
  });
  const { ciphertext, iv } = await encryptSecret(evidence);
  const nextStatus = status === "failed" ? "failed" : "processing";
  const stored = await db.execRun(
    `UPDATE wr_order_links SET wr_account_details=?, wr_account_iv=?,
       status=CASE WHEN ?='failed' THEN status ELSE 'processing' END,
       last_event_at=?, last_error=?, updated_at=datetime('now')
     WHERE wr_order_id=? AND status IN ('pending','claimed','retry','blocked_balance','submitted','ordering','processing')
       AND wr_variant_id LIKE 'jaspay:%'`,
    ciphertext,
    iv,
    nextStatus,
    new Date().toISOString(),
    marker,
    invoice,
  ).catch(() => ({ changes: 0 as number | undefined }));
  return Number(stored.changes ?? 0) > 0;
}

/**
 * Webhook order.completed (P0-5 + P0-6):
 * 1. Simpan akun terenkripsi (tidak plaintext).
 * 2. Maju monotonik ke completed (CAS — replay failed kemudian ditolak).
 * 3. Selesaikan HANYA fulfillment_items WR terkait (bukan seluruh order).
 * 4. Hitung agregat order dari SELURUH fulfillment_items.
 * 5. Queue delivery kredensial secara durable; duplicate webhook melanjutkan
 *    delivery yang belum selesai (bukan no-op buta).
 */
export async function handleWrOrderCompleted(
  wrOrderId: string,
  accountPayload: unknown,
  database?: DatabaseAccess,
  options: { accountUpdated?: boolean; deferDelivery?: boolean } = {},
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const link = await queryFirst(`SELECT * FROM wr_order_links WHERE wr_order_id=?`, wrOrderId).catch(
    () => null,
  );
  if (!link) return false;
  // WR3: invoice JSP TIDAK PERNAH milik link premium. Tolak sebelum
  // menyimpan akun agar formatter premium tak menelan payload Jaspay.
  if (isJaspayVariantId(String(link.wr_variant_id || ""))) return false;
  // Webhook resmi WR membawa akun di `data.accounts` (api-docs 2026-10);
  // /transactions memakai `account_details`. Keduanya diterima.
  const envelope = accountPayload as { account_details?: unknown; accounts?: unknown } | null;
  const plaintext = formatWrAccountDetails(envelope?.account_details ?? envelope?.accounts ?? accountPayload);
  const { ciphertext, iv } = await encryptSecret(plaintext || "(detail akun kosong dari WR)");
  const now = new Date().toISOString();
  // Simpan kredensial dulu (durable) — sebelum status, agar crash di tengah
  // tidak menghasilkan completed tanpa akun.
  const completed = await execRun(
    `UPDATE wr_order_links SET wr_account_details=?, wr_account_iv=?, status='completed',
       completed_at=?, last_event_at=?, last_error=NULL, updated_at=datetime('now')
      WHERE wr_order_id=? AND status IN ('pending','claimed','retry','blocked_balance','submitted','ordering','processing','completed') AND status=?`,
    ciphertext,
    iv,
    now,
    now,
    wrOrderId,
    link.status,
  );
  // A failed terminal won the race: acknowledge without storing/delivering accounts.
  if (!Number(completed.changes ?? 0)) {
    const current = await queryFirst(`SELECT status FROM wr_order_links WHERE wr_order_id=?`, wrOrderId);
    await logWebhookEvent(db, wrOrderId, "completed", undefined, false, `terminal_regression_blocked:${current?.status ?? "missing"}`);
    return !options.deferDelivery && ["failed", "completed"].includes(String(current?.status));
  }
  await logWebhookEvent(db, wrOrderId, "completed", undefined, true, `completed:${String(link.status)}`);
  // INSIDEN 2026-10-10 (AXV-20261010-90402478): kredensial tersimpan + link
  // completed, tetapi request webhook berhenti sebelum queueCredentialDelivery
  // → delivery_status `not_required` selamanya, pembeli tidak menerima apa pun.
  // Antrekan SEGERA setelah kredensial durable; langkah berikut (bind,
  // settle, agregat) diulang sendiri oleh processCredentialDelivery bila
  // request ini terputus di tengah. `order.account_updated` (akun diganti WR)
  // membuka ulang pengiriman yang sudah delivered dengan penanda khusus.
  if (options.accountUpdated) {
    await execRun(
      `UPDATE wr_order_links SET delivery_status='queued', delivery_attempt_count=0,
         delivery_last_error='account_updated', delivery_next_attempt_at=datetime('now'),
         delivery_channel=COALESCE(delivery_channel, (SELECT sales_channel FROM orders WHERE code=wr_order_links.order_code), 'web'),
         updated_at=datetime('now')
       WHERE id=? AND wr_account_details IS NOT NULL`,
      Number(link.id),
    ).catch(() => undefined);
  } else {
    await queueCredentialDelivery(Number(link.id), db);
  }
  // Kaitkan link ke baris itemnya (paritas SK 2026-10-03 — sebelum ini WR
  // TIDAK PERNAH bind: fulfillment_item_id selalu NULL sehingga panel
  // /pesanan (baca fulfillment_items.delivered_ciphertext) tidak pernah
  // melihat kredensial WR meski link completed. Idempoten bila sudah terisi.
  let fulfillmentItemId = Number(link.fulfillment_item_id || 0);
  try {
    fulfillmentItemId = await bindWrLinkToFulfillmentItem(Number(link.id), db);
  } catch { /* link TETAP completed; settle memakai fallback WR */ }
  if (!fulfillmentItemId) fulfillmentItemId = Number(link.fulfillment_item_id || 0);
  // Selesaikan item WR terkait + agregat ulang dari seluruh item.
  await settleWrFulfillmentItem(String(link.order_code), fulfillmentItemId, ciphertext, iv, db);
  await refreshOrderAggregate(String(link.order_code), db);
  // Coba kirim segera; bila gagal, delivery_status tetap queued/failed dan
  // cron delivery + webhook duplikat akan retry (P0-6).
  if (!options.deferDelivery) {
    if (link.status !== "completed") {
      const { schedulePaidFulfillment } = await import("@/lib/payments/paid-fulfillment");
      await schedulePaidFulfillment(String(link.order_code), "apps", "wr", "supplier_settled",
        () => processCredentialDelivery(Number(link.id), db), db);
    } else await processCredentialDelivery(Number(link.id), db).catch(() => undefined);
  }
  return true;
}

/**
 * Webhook order.failed: monotonik (P1-7) — tidak meregresi completed.
 * Item WR terkait → failed; agregat dihitung ulang (bukan order failed buta,
 * agar mixed cart yang item lain sudah delivered tetap jujur).
 */
export async function handleWrOrderFailed(
  wrOrderId: string,
  errorMessage: string,
  database?: DatabaseAccess,
  eventId?: string,
  options: { allowJaspay?: boolean } = {},
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const link = await queryFirst(`SELECT * FROM wr_order_links WHERE wr_order_id=?`, wrOrderId).catch(
    () => null,
  );
  if (!link) return false;
  // WR3: invoice JSP milik handler Jaspay saja; premium tak boleh
  // meregresi/menyelesaikan link Jaspay.
  // Hanya handleJaspayTerminal (allowJaspay) yang boleh menggagalkannya.
  if (isJaspayVariantId(String(link.wr_variant_id || "")) && !options.allowJaspay) return true;
  const applied = await advanceWrLinkMonotonic(
    wrOrderId,
    "failed",
    { last_error: String(errorMessage || "wr_order_failed").slice(0, 500) },
    db,
    eventId,
  );
  if (!applied) return true; // regresi diblokir (mis. sudah completed) — tetap 200.
  // Item WR terkait → failed; agregat ulang dari seluruh item.
  await execRun(
    `UPDATE fulfillment_items SET status='failed', last_error=?,
       locked_until=NULL, updated_at=datetime('now')
     WHERE order_code=? AND id=COALESCE(NULLIF(?,0), (
       SELECT fi.id FROM fulfillment_items fi JOIN product_variants pv ON pv.id=fi.variant_id
       WHERE fi.order_code=? AND pv.wr_variant_id=? ORDER BY fi.item_index ASC LIMIT 1))
       AND status!='delivered' AND COALESCE(last_error,'') NOT LIKE 'manual_handover:%'`,
    String(errorMessage || "wr_order_failed").slice(0, 500),
    String(link.order_code), Number(link.fulfillment_item_id || 0), String(link.order_code), String(link.wr_variant_id),
  );
  await refreshOrderAggregate(String(link.order_code), db);
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (adminChatId && process.env.TELEGRAM_BOT_ENABLED === "true") {
    try {
      const { sendMessage } = await import("@/lib/telegram/api");
      await sendMessage({
        chat_id: adminChatId,
        text:
          `⚠️ <b>Order WR gagal</b> <code>${String(link.order_code)}</code>\n` +
          `WR: <code>${wrOrderId}</code> — ${String(errorMessage).slice(0, 200)}\n` +
          `Tangani manual (refund/cancel) via admin.`,
        parse_mode: "HTML",
      });
    } catch {
      /* best-effort */
    }
  }
  return true;
}

/**
 * Kaitkan link WR ke baris fulfillment_items yang tepat (P0-5).
 * Dipanggil saat link dibuat (bila item sudah materialisasi) dan oleh
 * reconciler. Satu link ↔ satu item_index (kebutuhan canonical per varian).
 * Item WR memakai mode 'manual' (kontrak fulfillment) tetapi TIDAK boleh
 * muncul sebagai pekerjaan manual palsu: kolom wr_variant marker + kolom
 * fulfillment_items.wr_link_id menandai kepemilikan WR.
 */
export async function bindWrLinkToFulfillmentItem(
  linkId: number,
  database?: DatabaseAccess,
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const link = await queryFirst(`SELECT * FROM wr_order_links WHERE id=?`, linkId).catch(() => null);
  if (!link || Number(link.fulfillment_item_id || 0) > 0) return Number(link?.fulfillment_item_id || 0);
  const orderCode = String(link.order_code || "");
  // Cari item dengan variant yang punya wr_variant_id sama.
  const items = await queryFirst(
    `SELECT fi.id FROM fulfillment_items fi
     JOIN product_variants pv ON pv.id = fi.variant_id
     WHERE fi.order_code=? AND pv.wr_variant_id=?
     ORDER BY fi.item_index ASC LIMIT 1`,
    orderCode,
    String(link.wr_variant_id || ""),
  ).catch(() => null);
  if (!items) return 0;
  const itemId = Number(items.id);
  // .catch: DB pre-0029 (kolom belum ada) → reconciler mengisi setelah migrasi.
  await execRun(`UPDATE wr_order_links SET fulfillment_item_id=? WHERE id=?`, itemId, linkId).catch(
    () => undefined,
  );
  await execRun(`UPDATE fulfillment_items SET wr_link_id=? WHERE id=?`, linkId, itemId).catch(
    () => undefined,
  );
  return itemId;
}

/**
 * Selesaikan HANYA item WR terkait (P0-5). Item manual/shared/unique lain
 * tidak disentuh — mixed cart tidak delivered prematur.
 *
 * Paritas SK 2026-10-03: ciphertext + iv ikut ditulis ke baris item
 * (delivered_ciphertext/delivered_iv) — panel /pesanan + /lacak-pesanan
 * membaca DARI SINI, bukan dari wr_order_links. Sebelum ini WR hanya
 * flip status sehingga panel tidak pernah melihat kredensial meski link
 * completed (order F111FD64 2026-10-03).
 */
async function settleWrFulfillmentItem(
  orderCode: string,
  fulfillmentItemId: number,
  ciphertext?: string,
  iv?: string,
  db?: DatabaseAccess,
): Promise<void> {
  const database = db ?? createDatabaseAccess();
  if (fulfillmentItemId > 0) {
    await database
      .execRun(
        `UPDATE fulfillment_items SET status='delivered', delivered_message_id=?,
           delivered_ciphertext=COALESCE(?, delivered_ciphertext),
           delivered_iv=COALESCE(?, delivered_iv),
           locked_until=NULL, updated_at=datetime('now') WHERE id=? AND order_code=?
           AND COALESCE(last_error,'') NOT LIKE 'manual_handover:%'`,
        `wr:${fulfillmentItemId}`,
        ciphertext ?? null,
        iv ?? null,
        fulfillmentItemId,
        orderCode,
      )
      .catch(() => undefined);
    // Tandai kepemilikan WR supaya fulfillment generik melewatinya (pola
    // sk_link_id): tanpa ini processItem mengklaimnya sebagai manual palsu.
    const linked = await database
      .queryFirst(`SELECT id FROM wr_order_links WHERE order_code=? AND fulfillment_item_id=?`, orderCode, fulfillmentItemId)
      .catch(() => null);
    if (linked) {
      await database.execRun(`UPDATE fulfillment_items SET wr_link_id=? WHERE id=?`, Number(linked.id), fulfillmentItemId).catch(
        () => undefined,
      );
    }
    return;
  }
  // Link lama (fulfillment_item_id NULL): fallback ke item WR order ini.
  await database
    .execRun(
      `UPDATE fulfillment_items SET status='delivered', delivered_message_id='wr:legacy',
         delivered_ciphertext=COALESCE(?, delivered_ciphertext),
         delivered_iv=COALESCE(?, delivered_iv),
         locked_until=NULL, updated_at=datetime('now')
       WHERE order_code=? AND COALESCE(last_error,'') NOT LIKE 'manual_handover:%' AND id IN (
         SELECT fi.id FROM fulfillment_items fi
         JOIN product_variants pv ON pv.id = fi.variant_id
         WHERE fi.order_code=? AND pv.wr_variant_id IS NOT NULL
       )`,
      ciphertext ?? null,
      iv ?? null,
      orderCode,
      orderCode,
    )
    .catch(() => undefined);
}

/**
 * Agregat order dari SELURUH fulfillment_items (P0-5) — menggantikan logika
 * lama "semua link completed → delivered" yang membutakan item non-WR.
 * - semua delivered → delivered
 * - semua settled (delivered/manual_required) → manual_required
 * - ada failed dan sisanya settled → failed (sinyal admin, bukan delivered)
 * - masih ada queued/sending/retry → biarkan status berjalan (queued/sending)
 * Generic reconciler (reconcileSettledJobs) tetap bisa memperbaiki tanpa
 * menghidupkan ulang delivery terminal: delivered/manual_required/failed
 * tidak pernah dibuka kembali di sini.
 */
export async function refreshOrderAggregate(
  orderCode: string,
  database?: DatabaseAccess,
): Promise<string> {
  const db = database ?? createDatabaseAccess();
  const { queryAll, queryFirst, execRun } = db;
  const rows = await queryAll(`SELECT status FROM fulfillment_items WHERE order_code=?`, orderCode).catch(
    () => [],
  );
  if (!rows.length) return "";
  const statuses = rows.map((r) => String(r.status || ""));
  const allDelivered = statuses.every((s) => s === "delivered");
  const allSettled = statuses.every((s) => s === "delivered" || s === "manual_required");
  const anyFailed = statuses.some((s) => s === "failed");
  const anyActive = statuses.some((s) => ["queued", "sending", "retry"].includes(s));
  let aggregate: string | null = null;
  if (allDelivered) aggregate = "delivered";
  else if (allSettled) aggregate = "manual_required";
  else if (anyFailed && !anyActive) aggregate = "failed";
  else if (anyActive) {
    const current = await queryFirst(`SELECT fulfillment_status FROM orders WHERE code=?`, orderCode).catch(
      () => null,
    );
    const cur = String(current?.fulfillment_status || "queued");
    aggregate = ["delivered", "manual_required", "failed"].includes(cur) ? null : cur === "sending" ? "sending" : "queued";
  }
  if (!aggregate) return "";
  // Fence: jangan buka terminal yang sudah benar (reconciler generik aman).
  const current = await queryFirst(`SELECT fulfillment_status FROM orders WHERE code=?`, orderCode).catch(
    () => null,
  );
  const cur = String(current?.fulfillment_status || "");
  if (cur === aggregate) return aggregate;
  if (cur === "delivered" && aggregate !== "delivered") return cur;
  await execRun(`UPDATE orders SET fulfillment_status=?, updated_at=datetime('now') WHERE code=?`, aggregate, orderCode).catch(
    () => undefined,
  );
  // Titik tunggal transisi ke `failed` untuk item WR (webhook order.failed,
  // reconciler, maupun cart campuran yang item terakhirnya baru tuntas).
  // Dulu hanya admin yang di-ping; pembeli lunas menunggu tanpa kabar.
  if (aggregate === "failed") {
    try {
      const { notifyBuyerDeliveryFailed } = await import("@/lib/notify-buyer");
      await notifyBuyerDeliveryFailed(orderCode, db);
    } catch { /* kabar pembeli best-effort */ }
  }
  return aggregate;
}

/**
 * Queue delivery kredensial secara durable (P0-6). Idempoten: delivered
 * tidak di-queue ulang; queued/failed dilanjutkan (duplicate webhook
 * melanjutkan delivery yang belum selesai).
 */
export async function queueCredentialDelivery(linkId: number, database?: DatabaseAccess): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const link = await queryFirst(`SELECT * FROM wr_order_links WHERE id=?`, linkId).catch(() => null);
  if (!link) return false;
  if (String(link.delivery_status || "") === "delivered") return true;
  if (!link.wr_account_details) return false;
  const order = await queryFirst(
    `SELECT sales_channel FROM orders WHERE code=?`,
    String(link.order_code || ""),
  ).catch(() => null);
  const channel = String(order?.sales_channel || "web");
  await execRun(
    `UPDATE wr_order_links SET delivery_status='queued', delivery_channel=?,
       delivery_next_attempt_at=datetime('now'), updated_at=datetime('now')
     WHERE id=? AND delivery_status!='delivered' AND COALESCE(delivery_last_error,'')!=?`,
    channel,
    linkId,
    WR_MANUAL_WA,
  ).catch(() => undefined);
  return true;
}

const WR_DELIVERY_MAX_ATTEMPTS = 5;
const WR_DELIVERY_DELAYS_MINUTES = [1, 5, 15, 60];
// Lease pengiriman kredensial: baris 'sending' yang melewati batas ini
// dianggap milik worker yang mati dan dipulihkan (lihat
// recoverStaleCredentialDeliveries). 2 menit >> durasi pengiriman normal.
const WR_DELIVERY_LEASE_MS = 120_000;

/**
 * Proses satu delivery kredensial dengan claim/lease (P0-6). Telegram hanya
 * private chat, web via capability token dan email, WA historis manual.
 */
export async function processCredentialDelivery(
  linkId: number,
  database?: DatabaseAccess,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const leaseOwner = `dlv-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const leaseUntil = new Date(Date.now() + WR_DELIVERY_LEASE_MS).toISOString();
  // Klaim + PERSIST lease. Sebelum 2026-09-18 lease hanya dihitung lalu
  // dibuang (`void leaseOwner`), sehingga run yang dibunuh platform di tengah
  // pengiriman meninggalkan baris di 'sending' selamanya: recovery hanya
  // memungut ('queued','failed'), jadi tidak ada yang me-retry. Bukti prod:
  // link AXV-20260917-0D35043E berhenti di delivery_status='sending' sejak
  // 17 Sep. Lease disimpan di delivery_next_attempt_at (semantiknya sama:
  // "jangan sentuh sebelum T"), jadi tidak perlu kolom/migrasi baru.
  const claimed = await execRun(
    `UPDATE wr_order_links SET delivery_status='sending',
       delivery_attempt_count=delivery_attempt_count+1,
       delivery_next_attempt_at=?, delivery_last_error=?, updated_at=datetime('now')
     WHERE id=? AND (delivery_status IN ('queued','failed') OR ${WA_WR_UNSENT})
       AND COALESCE(delivery_last_error,'')!=?
       AND (delivery_next_attempt_at IS NULL OR datetime(delivery_next_attempt_at) <= datetime('now'))`,
    leaseUntil,
    `lease:${leaseOwner}`,
    linkId,
    WR_MANUAL_WA,
  ).catch(() => ({ changes: 0 as number | undefined }));
  if (Number(claimed.changes ?? 0) === 0) {
    const cur = await queryFirst(`SELECT delivery_status FROM wr_order_links WHERE id=?`, linkId).catch(
      () => null,
    );
    return String(cur?.delivery_status || "") === "delivered";
  }
  const link = await queryFirst(`SELECT l.*, o.sales_channel AS order_sales_channel
    FROM wr_order_links l JOIN orders o ON o.code=l.order_code WHERE l.id=?`, linkId).catch(() => null);
  if (!link || !link.wr_account_details) {
    await execRun(`UPDATE wr_order_links SET delivery_status='failed', delivery_last_error='no_credential' WHERE id=?`, linkId).catch(
      () => undefined,
    );
    return false;
  }
  const attempts = Number(link.delivery_attempt_count || 0);
  const accountUpdated = String(link.delivery_last_error || "").includes("account_updated");
  // Admin sudah menyerahkan item ini manual (tombol "Kirim ke pembeli") →
  // JANGAN kirim kredensial WR lagi (pembeli dobel pesan, isi bisa beda).
  // Pengecualian: akun DIGANTI WR (account_updated) memang harus dikirim.
  if (!accountUpdated && (await wrItemHandedOverManually(link, db))) {
    await execRun(
      `UPDATE wr_order_links SET delivery_status='delivered', delivered_at=?,
         delivery_last_error='skipped_manual_handover', delivery_next_attempt_at=NULL,
         updated_at=datetime('now') WHERE id=?`,
      new Date().toISOString(),
      linkId,
    ).catch(() => undefined);
    return true;
  }
  if (link.delivery_channel === "whatsapp" || link.order_sales_channel === "whatsapp") {
    const orderCode = String(link.order_code);
    const order = await queryFirst("SELECT * FROM orders WHERE code=? AND status='lunas' AND payment_status='paid'", orderCode);
    if (order) {
      if (!link.fulfillment_item_id) await ensureFulfillmentItems(order, db);
      const itemId = await bindWrLinkToFulfillmentItem(linkId, db);
      // A WR "delivered" item with no completed transport is only stored, not
      // handed over. Leave genuinely delivered/manual-handover rows alone.
      if (!itemId) throw new Error("legacy_whatsapp_handover_item_missing");
      const manual = await execRun(`UPDATE fulfillment_items SET status='manual_required', locked_until=NULL,
        delivered_ciphertext=COALESCE(delivered_ciphertext,?), delivered_iv=COALESCE(delivered_iv,?),
        updated_at=datetime('now') WHERE id=? AND order_code=? AND status!='sending'
        AND (status!='delivered' OR delivered_message_id GLOB 'wr:*')
        AND COALESCE(last_error,'') NOT LIKE 'manual_handover:%'`, link.wr_account_details, link.wr_account_iv, itemId, orderCode);
      if (!manual.changes && !(await queryFirst(`SELECT id FROM fulfillment_items WHERE id=? AND status='delivered'`, itemId))) {
        throw new Error("legacy_whatsapp_handover_item_busy");
      }
      // WR completion may have marked the aggregate delivered before transport.
      await execRun(`UPDATE orders SET fulfillment_status='manual_required',updated_at=datetime('now')
        WHERE code=? AND status='lunas' AND payment_status='paid'
        AND EXISTS(SELECT 1 FROM fulfillment_items WHERE id=? AND status='manual_required')`, orderCode, itemId);
    }
    await execRun(`UPDATE wr_order_links SET delivery_status='failed',delivery_last_error=?,
      delivered_at=NULL,delivery_next_attempt_at=NULL,updated_at=datetime('now') WHERE id=? AND delivery_last_error=?`,
      WR_MANUAL_WA, linkId, `lease:${leaseOwner}`);
    return false;
  }
  // Lengkapi langkah completion yang mungkin terputus (bind → settle →
  // agregat) SEBELUM mengirim: panel /pesanan + tombol Ambil Detail Produk
  // membaca fulfillment_items, bukan wr_order_links. Idempoten.
  try {
    let itemId = Number(link.fulfillment_item_id || 0);
    if (!itemId) itemId = await bindWrLinkToFulfillmentItem(linkId, db).catch(() => 0);
    const item = itemId
      ? await queryFirst(`SELECT status, delivered_ciphertext FROM fulfillment_items WHERE id=?`, itemId).catch(() => null)
      : null;
    if (!item || String(item.status) !== "delivered" || !item.delivered_ciphertext || accountUpdated) {
      await settleWrFulfillmentItem(String(link.order_code), itemId, String(link.wr_account_details), String(link.wr_account_iv), db);
      await refreshOrderAggregate(String(link.order_code), db);
    }
  } catch { /* panel boleh menyusul; kirim ke pembeli tetap jalan */ }
  try {
    const stored = await decryptSecret(String(link.wr_account_details), String(link.wr_account_iv));
    // Normalisasi display di USE-time (2026-09-18 sore): data lama yang
    // tersimpan sebagai JSON mentah `{"product":..,"details":"a:\r\nb"}`
    // (bukti prod: link 95FC**** tampil mentah di panel) diformat rapi
    // SEKARANG untuk SEMUA kanal (panel, email, Telegram) — tanpa
    // mengubah ciphertext yang tersimpan.
    const plaintext = normalizeAccountDetailsForDisplay(stored);
    const channel = String(link.delivery_channel || "web");
    if (channel === "web") {
      // Web: tidak ada push channel. Delivery = token capability diterbitkan
      // durable (lihat issueCredentialToken). settled saat token ada.
      const token = await issueCredentialToken(String(link.order_code), db);
      // `null` punya DUA arti karena issueCredentialToken idempoten: (a) token
      // valid sudah ada → delivery web memang sudah settled, atau (b) order
      // belum siap. Sebelum 2026-09-18 keduanya dianggap gagal, sehingga
      // SETIAP retry delivery web pasti gagal ("capability_token_issue_failed")
      // sampai kehabisan attempt — terlihat begitu pemulihan lease 'sending'
      // dinyalakan. Hanya (b) yang boleh dianggap error.
      if (!token && !(await hasValidCredentialToken(String(link.order_code), db))) {
        throw new Error("capability_token_issue_failed");
      }
      // Preserve panel settlement even if the email push is unavailable.
      await deliverWebCredentialViaEmail(String(link.order_code), plaintext, db, { resend: accountUpdated }).catch(() => undefined);
    } else if (channel === "telegram") {
      await deliverTelegramCredential(String(link.order_code), plaintext, db, String(link.wr_variant_id));
      // Salinan email (2026-11-04) untuk pembeli Telegram dengan produk wajib-email.
      // DM sudah sukses dan otoritatif; email best-effort + idempoten, dan
      // kegagalannya TIDAK boleh membuat link ini di-retry atau berstatus gagal.
      try {
        const { telegramEmailCopyTarget } = await import("@/lib/telegram/email-copy");
        if (await telegramEmailCopyTarget(String(link.order_code), db)) {
          await deliverWebCredentialViaEmail(String(link.order_code), plaintext, db, { resend: accountUpdated });
        }
      } catch { /* email best-effort */ }
    } else {
      throw new Error("unsupported_delivery_channel");
    }
    const now = new Date().toISOString();
    await execRun(
      `UPDATE wr_order_links SET delivery_status='delivered', delivered_at=?,
         delivery_last_error=NULL, delivery_next_attempt_at=NULL,
         updated_at=datetime('now') WHERE id=?`,
      now,
      linkId,
    );
    return true;
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    if (attempts >= WR_DELIVERY_MAX_ATTEMPTS) {
      await execRun(
        `UPDATE wr_order_links SET delivery_status='failed', delivery_last_error=?,
           updated_at=datetime('now') WHERE id=?`,
        message,
        linkId,
      ).catch(() => undefined);
      return false;
    }
    const delay = WR_DELIVERY_DELAYS_MINUTES[Math.min(Math.max(attempts - 1, 0), WR_DELIVERY_DELAYS_MINUTES.length - 1)];
    await execRun(
      `UPDATE wr_order_links SET delivery_status='failed', delivery_last_error=?,
         delivery_next_attempt_at=datetime('now','+${delay} minutes'),
         updated_at=datetime('now') WHERE id=?`,
      message,
      linkId,
    ).catch(() => undefined);
    return false;
  }
}

/**
 * Pulihkan pengiriman kredensial yang tergantung di 'sending' setelah lease
 * habis (worker/invocation dibunuh di tengah jalan). Baris dikembalikan ke
 * 'failed' agar masuk lagi ke antrean queued/failed dengan backoff normal —
 * bukan langsung 'queued', supaya batas WR_DELIVERY_MAX_ATTEMPTS tetap
 * berlaku dan tidak ada loop kirim tanpa henti.
 */
export async function recoverStaleCredentialDeliveries(
  database?: DatabaseAccess,
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  const res = await db
    .execRun(
      `UPDATE wr_order_links SET delivery_status='failed',
         delivery_last_error='delivery_lease_expired',
         delivery_next_attempt_at=datetime('now'), updated_at=datetime('now')
       WHERE delivery_status='sending'
         AND (delivery_next_attempt_at IS NULL
              OR datetime(delivery_next_attempt_at) <= datetime('now'))`,
    )
    .catch(() => ({ changes: 0 as number | undefined }));
  return Number(res.changes ?? 0);
}

/** Item WR order ini sudah diserahkan admin manual (audit manual_handover)? */
async function wrItemHandedOverManually(link: Record<string, unknown>, db: DatabaseAccess): Promise<boolean> {
  const itemId = Number(link.fulfillment_item_id || 0);
  const row = itemId
    ? await db.queryFirst(
        `SELECT 1 AS hit FROM fulfillment_items WHERE id=? AND status='delivered'
           AND (COALESCE(last_error,'') LIKE 'manual_handover:%' OR delivered_message_id='manual')`,
        itemId,
      ).catch(() => null)
    : await db.queryFirst(
        `SELECT 1 AS hit FROM fulfillment_items fi JOIN product_variants pv ON pv.id=fi.variant_id
         WHERE fi.order_code=? AND pv.wr_variant_id=? AND fi.status='delivered'
           AND (COALESCE(fi.last_error,'') LIKE 'manual_handover:%' OR fi.delivered_message_id='manual')
         LIMIT 1`,
        String(link.order_code || ""),
        String(link.wr_variant_id || ""),
      ).catch(() => null);
  return Boolean(row);
}

/**
 * Penyapu kredensial yatim (insiden 2026-10-10): link `completed` dengan
 * kredensial tersimpan tetapi `delivery_status` masih `not_required` (request
 * completion terputus sebelum queue) → antrekan agar cron mengirimnya.
 * Jendela 3 hari: link lama pra-0029 yang sudah dikirim jalur lama tidak
 * disentuh.
 *
 * PAGAR ANTI-KIRIM-ULANG (2026-10-11, permintaan owner: semua order kemarin
 * sudah handover manual): link yang itemnya SUDAH `delivered` (manual ATAU
 * WR — delivered_message_id terisi) TIDAK PERNAH di-queue ulang. Yang
 * di-queue ulang HANYA link yang itemnya belum delivered (completion terputus
 * sebelum settle) — itulah satu-satunya kasus "pembeli belum menerima apa
 * pun". Item handover manual juga dilewati lapis kedua oleh
 * processCredentialDelivery (ditandai skipped_manual_handover).
 */
export async function requeueOrphanCredentialDeliveries(
  database?: DatabaseAccess,
  limit = 20,
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!db.canSpend(2)) return 0;
  const rows = await db
    .queryAll(
      `SELECT l.id FROM wr_order_links l
       WHERE l.status='completed' AND l.delivery_status='not_required'
         AND l.wr_account_details IS NOT NULL
         AND datetime(COALESCE(l.completed_at, l.updated_at)) > datetime('now','-3 days')
         AND NOT EXISTS (
           SELECT 1 FROM fulfillment_items fi
           WHERE (fi.id = l.fulfillment_item_id OR
                  (fi.order_code = l.order_code AND fi.id IN (
                    SELECT fi2.id FROM fulfillment_items fi2
                    JOIN product_variants pv ON pv.id = fi2.variant_id
                    WHERE fi2.order_code = l.order_code AND pv.wr_variant_id = l.wr_variant_id)))
             AND fi.status='delivered' AND fi.delivered_message_id IS NOT NULL)
       ORDER BY l.id ASC LIMIT ?`,
      Math.max(1, Math.min(limit, 20)),
    )
    .catch(() => [] as Record<string, unknown>[]);
  let queued = 0;
  for (const row of rows) {
    if (!db.canSpend(3)) break;
    if (await queueCredentialDelivery(Number(row.id), db).catch(() => false)) queued++;
  }
  return queued;
}

/** Cron delivery: proses antrean kredensial due (bounded, paced <=1/s for Resend). */
export async function processDueCredentialDeliveries(
  database?: DatabaseAccess,
  limit = 15,
  options: { paceMs?: number; sleepImpl?: (ms: number) => Promise<void> } = {},
): Promise<{ processed: number; delivered: number; recovered: number }> {
  const db = database ?? createDatabaseAccess();
  const out = { processed: 0, delivered: 0, recovered: 0 };
  if (!db.canSpend(4)) return out;
  // Lease basi dipulihkan LEBIH DULU agar baris yang ditinggalkan run yang
  // dibunuh ikut terangkat pada run ini, bukan menunggu order baru.
  out.recovered = await recoverStaleCredentialDeliveries(db);
  const due = await db
    .queryAll(
      `SELECT id FROM wr_order_links
       WHERE (delivery_status IN ('queued','failed') OR ${WA_WR_UNSENT}) AND COALESCE(delivery_last_error,'')!=?
         AND (delivery_next_attempt_at IS NULL OR datetime(delivery_next_attempt_at) <= datetime('now'))
       ORDER BY delivery_next_attempt_at ASC, id ASC LIMIT ?`,
      WR_MANUAL_WA, Math.max(1, Math.min(limit, 20)),
    )
    .catch(() => [] as Record<string, unknown>[]);
  const paceMs = options.paceMs ?? (process.env.NODE_ENV === "test" ? 0 : 1_000);
  const sleep = options.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (const row of due) {
    // ±11 statement per baris: klaim, baca, cek handover manual, bind/settle/
    // agregat (bila completion terputus), kirim, tandai delivered.
    if (!db.canSpend(11)) break;
    if (out.processed > 0 && paceMs > 0) await sleep(paceMs);
    out.processed++;
    try {
      if (await processCredentialDelivery(Number(row.id), db)) out.delivered++;
    } catch {
      /* baris tetap queued/failed untuk run berikutnya */
    }
  }
  return out;
}

async function deliverTelegramCredential(orderCode: string, plaintext: string, db: DatabaseAccess, wrVariantId: string): Promise<void> {
  const order = await db
    .queryFirst(
      `SELECT o.code, o.items, o.telegram_chat_id, o.telegram_user_id, pv.id AS delivery_variant_id
       FROM orders o LEFT JOIN product_variants pv ON pv.wr_variant_id=? WHERE o.code=?`,
      wrVariantId, orderCode,
    )
    .catch(() => null);
  if (!order) throw new Error("order_not_found");
  // Target berurutan chat_id tersimpan → telegram_user_id (jalur stok sendiri)
  // → chat order (bila pribadi); id grup tidak pernah dipakai (2026-10-04).
  const { sendTelegramCredential } = await import("@/lib/telegram/credential-delivery");
  const { credentialMessages } = await import("@/lib/telegram/messages/credential");
  const { resolveCredentialTermsForVariants } = await import("@/lib/orders/credential-terms");
  const variantId = Number(order.delivery_variant_id);
  const copies = await resolveCredentialTermsForVariants([variantId], db);
  await sendTelegramCredential(order, credentialMessages({ orderCode, productName: parseProductNames(order.items), plaintext, copy: copies.get(variantId) }), db);
}

/**
 * Isi kredensial untuk pembeli channel WEB via email (Fase B, 2026-09-18).
 * Template "Detail Akun Siap" via Resend (lihat buildCredentialReadyTemplate).
 * Idempoten via `wr_email_forward_log` kunci `wr-cred-email:<order>` —
 * retry delivery tidak mengirim email ganda. Pembeli tanpa email = skip
 * diam (bukan error): panel tetap mencakupnya.
 */
export async function deliverWebCredentialViaEmail(
  orderCode: string,
  plaintext: string,
  db: DatabaseAccess,
  options: { resend?: boolean } = {},
): Promise<void> {
  const { queryFirst, execRun } = db;
  const order = await db
    .queryFirst(
      `SELECT code, customer_name, customer_email, customer_wa, items, locale, buyer_access_version,buyer_access_format FROM orders WHERE code=?`,
      orderCode,
    )
    .catch(() => null);
  if (!order) throw new Error("order_not_found");
  const buyerEmail = String(order.customer_email || "").trim();
  if (!buyerEmail || !buyerEmail.includes("@")) return; // tanpa email: WA + panel cukup.
  // Akun diganti WR (order.account_updated) = email BARU dengan kunci per isi
  // (hash), supaya tidak tertahan kunci email pertama; replay isi sama tetap
  // tertahan kunci hash yang sama.
  const idempotencyKey = options.resend
    ? `wr-cred-email:${orderCode}:${(await sha256Hex(plaintext)).slice(0, 12)}`
    : `wr-cred-email:${orderCode}`;
  const already = await queryFirst(
    `SELECT id FROM wr_email_forward_log WHERE gmail_message_id=? AND buyer_notified_at IS NOT NULL`,
    idempotencyKey,
  ).catch(() => null);
  if (already) return;
  const { isForwardEmailConfigured, sendForwardEmail } = await import("./forward-sender");
  const { buildCredentialReadyTemplate } = await import("./email-forward");
  const { SITE } = await import("@/lib/site");
  if (!isForwardEmailConfigured()) throw new Error("forward_email_not_configured");
  const siteUrl = (process.env.SITE_URL || SITE.webUrl).replace(/\/$/, "");
  // Kode akses di-derive ephemeral dari versi tersimpan aktual (NEVER tebak
  // v1 untuk order lama/reused); legacy (versi 0) = "" dan template identik.
  // Link invoice hanya memuat kode order — tidak pernah access code.
  const { deriveOrderAccessCode } = await import("@/lib/order-access");
  const buyerAccessCode = await deriveOrderAccessCode({
    code: String(order.code ?? orderCode), buyer_access_version: order.buyer_access_version, buyer_access_format: order.buyer_access_format,
  });
  const template = buildCredentialReadyTemplate({
    locale: String(order.locale ?? "id") === "en" ? "en" : "id",
    axvaraOrderCode: orderCode,
    buyerName: String(order.customer_name || ""),
    productNames: parseProductNames(order.items),
    details: plaintext,
    invoiceUrl: `${siteUrl}/pesanan/${encodeURIComponent(orderCode)}`,
    supportWa: SITE.adminWaLocal,
    buyerAccessCode: buyerAccessCode || undefined,
  });
  const sent = await sendForwardEmail({ to: buyerEmail, subject: template.subject, html: template.html, text: template.text });
  await execRun(
    `INSERT OR IGNORE INTO wr_email_forward_log
       (gmail_message_id, wr_invoice, axvara_order_code, kind, buyer_email, buyer_notified_at, channel, error)
     VALUES (?,?,?,?,?,${sent.ok ? "datetime('now')" : "NULL"},'email-credential',?)`,
    idempotencyKey, null, orderCode, "credential_ready", buyerEmail,
    sent.ok ? null : String(sent.error || "send_failed"),
  ).catch(() => undefined);
  if (!sent.ok) throw new Error(String(sent.error || "credential_email_send_failed"));
}

/**
 * Terbitkan capability token untuk order web (P0-6). Raw token 256-bit
 * dikembalikan SEKALI ke pemanggil (pembeli yang berhak); yang disimpan
 * hanya hash SHA-256. Token lama yang masih valid dipakai ulang agar tidak
 * menumpuk (idempoten per order).
 */
export async function issueCredentialToken(
  orderCode: string,
  database?: DatabaseAccess,
  proof?: { buyerAccessVersion: number },
): Promise<string | null> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  // Siap = ada detail WR ATAU isi produk non-WR terkirim (migrasi 0043).
  const ready = await queryFirst(
    `SELECT 1 AS ok WHERE EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND status='completed'
                                   AND wr_account_details IS NOT NULL)
       OR EXISTS(SELECT 1 FROM fulfillment_items WHERE order_code=? AND status='delivered'
                   AND delivered_ciphertext IS NOT NULL)`,
    orderCode, orderCode,
  ).catch(() => null);
  if (!ready) return null;
  const existing = await queryFirst(
    `SELECT id FROM wr_credential_tokens WHERE order_code=? AND revoked=0
       AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
       ${proof ? "AND buyer_access_version=?" : ""}
     ORDER BY id DESC LIMIT 1`,
    orderCode, ...(proof ? [proof.buyerAccessVersion] : []),
  ).catch(() => null);
  if (existing) return null; // token valid sudah ada — settled, jangan duplikat.
  const raw = await randomTokenHex(32);
  const hash = await sha256Hex(`wr-cred:${orderCode}:${raw}`);
  try {
    const inserted = proof ? await execRun(
      `INSERT INTO wr_credential_tokens (order_code, token_hash, expires_at, buyer_access_version)
       SELECT code,?,datetime('now','+30 days'),buyer_access_version FROM orders
       WHERE code=? AND buyer_access_version=? AND buyer_access_format='pin6'
         AND status='lunas' AND payment_status='paid'`,
      hash, orderCode, proof.buyerAccessVersion,
    ) : await execRun(
      `INSERT INTO wr_credential_tokens (order_code, token_hash, expires_at) VALUES (?,?,datetime('now','+30 days'))`, orderCode, hash,
    );
    if (Number(inserted.changes) !== 1) return null;
  } catch {
    return null;
  }
  return raw;
}

/**
 * true bila order masih memegang capability token yang sah. Dipakai untuk
 * membedakan "token sudah ada" (delivery web settled) dari "gagal terbit".
 */
export async function hasValidCredentialToken(
  orderCode: string,
  database?: DatabaseAccess,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const row = await db
    .queryFirst(
      `SELECT id FROM wr_credential_tokens WHERE order_code=? AND revoked=0
         AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
       LIMIT 1`,
      orderCode,
    )
    .catch(() => null);
  return row != null;
}

async function randomTokenHex(bytes: number): Promise<string> {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verifikasi capability token milik pembeli (P0-6). Constant-time implisit
 * via perbandingan hash (bukan raw). Menandai last_used_at. Tidak pernah
 * mengembalikan raw token.
 */
export async function verifyCredentialToken(
  orderCode: string,
  rawToken: string,
  database?: DatabaseAccess,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  if (!orderCode || !rawToken || rawToken.length < 32) return false;
  const hash = await sha256Hex(`wr-cred:${orderCode}:${rawToken.trim()}`);
  const row = await db
    .queryFirst(
      `SELECT t.id FROM wr_credential_tokens t JOIN orders o ON o.code=t.order_code
       WHERE t.order_code=? AND t.token_hash=? AND t.revoked=0
         AND (t.expires_at IS NULL OR datetime(t.expires_at)>datetime('now'))
         AND (o.buyer_access_version=0 OR (o.buyer_access_version>0 AND o.buyer_access_format='code26')
           OR (o.buyer_access_format='pin6' AND t.buyer_access_version=o.buyer_access_version AND t.buyer_access_version>0))`,
      orderCode,
      hash,
    )
    .catch(() => null);
  if (!row) return false;
  await db
    .execRun(`UPDATE wr_credential_tokens SET last_used_at=datetime('now') WHERE id=?`, Number(row.id))
    .catch(() => undefined);
  return true;
}

/**
 * Ambil detail akun terdekripsi untuk halaman pesanan — WAJIB dengan
 * capability token valid ATAU sesi admin. Tanpa itu → [] (P0-6).
 * Order harus lunas/paid; completed saja tidak cukup tanpa pembayaran.
 */
export async function getDecryptedAccountDetails(
  orderCode: string,
  database?: DatabaseAccess,
  capability?: { token: string } | { admin: true },
): Promise<{ order_code: string; details: string; completed_at: string | null }[]> {
  const db = database ?? createDatabaseAccess();
  const order = await db
    .queryFirst(`SELECT status, payment_status FROM orders WHERE code=?`, orderCode)
    .catch(() => null);
  if (!order || String(order.status) !== "lunas" || String(order.payment_status) !== "paid") return [];
  if (!capability) return [];
  if ("admin" in capability) {
    if (!capability.admin) return [];
  } else {
    const ok = await verifyCredentialToken(orderCode, capability.token, db);
    if (!ok) return [];
  }
  const rows = await db
    .queryAll(
      `SELECT order_code, wr_account_details, wr_account_iv, completed_at
       FROM wr_order_links WHERE order_code=? AND status='completed'
         AND wr_account_details IS NOT NULL`,
      orderCode,
    )
    .catch(() => []);
  const out: { order_code: string; details: string; completed_at: string | null }[] = [];
  for (const row of rows) {
    try {
      const stored = await decryptSecret(String(row.wr_account_details), String(row.wr_account_iv));
      out.push({
        order_code: String(row.order_code),
        // Normalisasi display di USE-time (lihat processCredentialDelivery):
        // data lama berformat JSON mentah tampil rapi tanpa migrasi data.
        details: normalizeAccountDetailsForDisplay(stored),
        completed_at: row.completed_at ? String(row.completed_at) : null,
      });
    } catch {
      /* kunci rotasi / data korup: lewati, jangan bocorkan */
    }
  }
  return out;
}

function parseProductNames(raw: unknown): string {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    if (!Array.isArray(parsed)) return "Produk";
    return (
      parsed
        .map((i) => {
          const name = String((i as Record<string, unknown>).name || "Produk");
          const qty = Math.max(1, Number((i as Record<string, unknown>).qty || 1));
          return `${name} ×${qty}`;
        })
        .join(", ") || "Produk"
    );
  } catch {
    return "Produk";
  }
}
