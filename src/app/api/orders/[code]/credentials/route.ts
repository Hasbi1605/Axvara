// GET/POST /api/orders/[code]/credentials — Retrieval kredensial WR untuk pembeli web.
// P0-6: kredensial TIDAK dibuka hanya dengan kode order. Pembeli membuktikan
// kepemilikan via No. WA ATAU email yang dipakai saat checkout (knowledge
// factor) atau capability token yang diterbitkan sebelumnya.
// - POST {contact} (atau {wa} lama): WA = nomor penuh yang dinormalisasi, email =
//   cocok penuh tanpa beda huruf besar/kecil → tampilkan details sekali + beri
//   capability token untuk akses ulang.
// - GET ?token=: akses ulang dengan capability token.
// Rate-limit ketat (orders:lookup). Tidak pernah mengembalikan data selain
// detail akun milik order itu: detail WR + isi produk non-WR yang terkirim
// (fulfillment_items.delivered_ciphertext, migrasi 0043).

import { NextRequest, NextResponse } from "next/server";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import {
  decryptAccountDetails,
  getDecryptedAccountDetails,
  issueCredentialToken,
  normalizeAccountDetailsForDisplay,
  verifyCredentialToken,
} from "@/lib/warung-rebahan/deliver";
import { readDeliveredSnapshots } from "@/lib/fulfillment/delivery/buyer-email";
import { buyerContactMatches } from "@/lib/order-contact";
import { resolveCredentialTermsByItem } from "@/lib/orders/credential-terms";
import type { VariantCopy } from "@/lib/product-copy/format";

export const runtime = "edge";
export const dynamic = "force-dynamic";
function privateJson(body: unknown, init?: Parameters<typeof NextResponse.json>[1]) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

async function orderReady(code: string) {
  const db = createDatabaseAccess();
  const order = await db
    .queryFirst(`SELECT code, customer_wa, customer_email, status, payment_status FROM orders WHERE code=?`, code)
    .catch(() => null);
  if (!order) return { error: "not_found" as const, status: 404 };
  if (String(order.status) !== "lunas" || String(order.payment_status) !== "paid") {
    return { error: "not_paid" as const, status: 403 };
  }
  const ready = await db
    .queryFirst(
      `SELECT 1 AS ok WHERE EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND status='completed'
                                     AND wr_account_details IS NOT NULL)
         OR EXISTS(SELECT 1 FROM fulfillment_items WHERE order_code=? AND status='delivered'
                     AND delivered_ciphertext IS NOT NULL)`,
      code, code,
    )
    .catch(() => null);
  if (!ready) return { error: "not_ready" as const, status: 404 };
  return { order, db };
}

type CredentialOut = {
  label?: string;
  details: string;
  completed_at: string | null;
  terms?: VariantCopy | null;
};

/**
 * S&K pasca-bayar per kredensial (2026-10-13): dipetakan dari item_index
 * order lewat resolver yang sama dengan PDP. Item WR tunggal memakai
 * item_index 0 (satu link dominan per order pada praktiknya); snapshot
 * generik memakai itemIndex-nya sendiri. Gagal resolusi = tanpa S&K,
 * kredensial tetap tampil.
 */
async function attachTerms(code: string, db: DatabaseAccess, creds: CredentialOut[]): Promise<CredentialOut[]> {
  if (!creds.length) return creds;
  const byIndex = await resolveCredentialTermsByItem(code, db).catch(() => new Map<number, VariantCopy>());
  if (!byIndex.size) return creds;
  return creds.map((cred, position) => ({
    ...cred,
    terms: cred.terms ?? byIndex.get((cred as { itemIndex?: number }).itemIndex ?? position) ?? null,
  }));
}

/** Baca kredensial order lunas — hanya dipanggil SETELAH verifikasi WA/token. */
async function readVerifiedDetails(code: string, db: DatabaseAccess) {
  const rows = await db
    .queryAll(
      `SELECT l.wr_account_details, l.wr_account_iv, l.completed_at
       FROM wr_order_links l JOIN orders o ON o.code=l.order_code
       WHERE l.order_code=? AND l.status='completed'
         AND l.wr_account_details IS NOT NULL
         AND o.status='lunas' AND o.payment_status='paid'`,
      code,
    )
    .catch(() => []);
  const out: CredentialOut[] = [];
  for (const row of rows) {
    try {
      const stored = await decryptAccountDetails(String(row.wr_account_details), String(row.wr_account_iv));
      // Normalisasi display di USE-time (data lama JSON mentah tampil rapi).
      out.push({ details: normalizeAccountDetailsForDisplay(stored), completed_at: row.completed_at ? String(row.completed_at) : null });
    } catch {
      /* lewati baris korup */
    }
  }
  for (const snapshot of await readDeliveredSnapshots(code, db)) {
    const entry: CredentialOut & { itemIndex: number } = {
      label: snapshot.label,
      details: snapshot.details,
      completed_at: snapshot.completed_at,
      terms: null,
      itemIndex: snapshot.itemIndex,
    };
    out.push(entry);
  }
  return attachTerms(code, db, out);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!checkRateLimit(request, "orders:lookup")) {
    return privateJson({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const { code } = await params;
  if (!code || !/^AXV-\d{8}-[A-Z0-9]{8}$/.test(code)) {
    return privateJson({ error: "invalid_code" }, { status: 400 });
  }
  const ready = await orderReady(code);
  if ("error" in ready) return privateJson({ error: ready.error }, { status: ready.status });
  const { order, db } = ready;
  const { contactAttemptLimited, recordContactFailure } = await import("@/lib/orders/contact-attempts");
  if (await contactAttemptLimited(db, code, clientIp(request))) return privateJson({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "900", "Cache-Control": "private, no-store" } });
  const body = await request.json().catch(() => null);
  const raw = String(body?.contact ?? body?.wa ?? "").trim();
  if (!buyerContactMatches(raw, order)) {
    const limited = await recordContactFailure(db, code, clientIp(request));
    return privateJson({ error: limited ? "rate_limited" : "verification_failed" }, {
      status: limited ? 429 : 403, headers: { "Cache-Control": "private, no-store", ...(limited ? { "Retry-After": "900" } : {}) },
    });
  }
  // Terbitkan capability token untuk akses ulang (idempoten).
  const freshToken = await issueCredentialToken(code, db);
  const credentials = await readVerifiedDetails(code, db);
  return privateJson({ ok: true, credentials, capability_token: freshToken }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!checkRateLimit(request, "orders:lookup")) {
    return privateJson({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const { code } = await params;
  if (!code || !/^AXV-\d{8}-[A-Z0-9]{8}$/.test(code)) {
    return privateJson({ error: "invalid_code" }, { status: 400 });
  }
  const token = request.nextUrl.searchParams.get("token") || "";
  if (!token) return privateJson({ error: "token_required" }, { status: 401 });
  const ready = await orderReady(code);
  if ("error" in ready) return privateJson({ error: ready.error }, { status: ready.status });
  if (!(await verifyCredentialToken(code, token, ready.db))) return privateJson({ error: "invalid_token" }, { status: 403 });
  const wr = await getDecryptedAccountDetails(code, ready.db, { token });
  const generic = await readDeliveredSnapshots(code, ready.db);
  const credentials: (CredentialOut & { itemIndex?: number })[] = [
    ...wr.map((d) => ({ details: d.details, completed_at: d.completed_at })),
    ...generic.map((d) => ({ label: d.label, details: d.details, completed_at: d.completed_at, itemIndex: d.itemIndex })),
  ];
  if (!credentials.length) return privateJson({ error: "invalid_token" }, { status: 403 });
  return privateJson({ ok: true, credentials: await attachTerms(code, ready.db, credentials) }, { headers: { "Cache-Control": "private, no-store" } });
}
