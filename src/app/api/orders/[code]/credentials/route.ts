// GET/POST /api/orders/[code]/credentials — Retrieval kredensial WR untuk pembeli web.
// P0-6: kredensial TIDAK dibuka hanya dengan kode order. Pembeli membuktikan
// kepemilikan via No. WA ATAU email yang dipakai saat checkout (knowledge
// factor) atau capability token yang diterbitkan sebelumnya.
// - POST {contact} (atau {wa} lama): WA = 6 digit terakhir customer_wa, email =
//   cocok penuh tanpa beda huruf besar/kecil → tampilkan details sekali + beri
//   capability token untuk akses ulang.
// - GET ?token=: akses ulang dengan capability token.
// Rate-limit ketat (orders:lookup). Tidak pernah mengembalikan data selain
// detail akun milik order itu: detail WR + isi produk non-WR yang terkirim
// (fulfillment_items.delivered_ciphertext, migrasi 0043).

import { NextRequest, NextResponse } from "next/server";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  decryptAccountDetails,
  getDecryptedAccountDetails,
  issueCredentialToken,
  normalizeAccountDetailsForDisplay,
  verifyCredentialToken,
} from "@/lib/warung-rebahan/deliver";
import { readDeliveredSnapshots } from "@/lib/fulfillment/delivery/buyer-email";
import { emailMatches } from "@/lib/order-contact";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function digitsOnly(raw: unknown): string {
  return String(raw || "").replace(/\D/g, "");
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
  const out: { label?: string; details: string; completed_at: string | null }[] = [];
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
    out.push({ label: snapshot.label, details: snapshot.details, completed_at: snapshot.completed_at });
  }
  return out;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!checkRateLimit(request, "orders:lookup")) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const { code } = await params;
  if (!code || !/^AXV-\d{8}-[A-Z0-9]{8}$/.test(code)) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }
  const ready = await orderReady(code);
  if ("error" in ready) return NextResponse.json({ error: ready.error }, { status: ready.status });
  const { order, db } = ready;
  const body = await request.json().catch(() => null);
  const raw = String(body?.contact ?? body?.wa ?? "").trim();
  let verified: boolean;
  if (raw.includes("@")) {
    verified = emailMatches(raw.toLowerCase(), order.customer_email);
  } else {
    const provided = digitsOnly(raw);
    const expected = digitsOnly(order.customer_wa);
    // Cocokkan 6 digit terakhir (cukup spesifik, toleran format +62/0).
    verified = provided.length >= 6 && expected.length >= 6 && provided.slice(-6) === expected.slice(-6);
  }
  if (!verified) return NextResponse.json({ error: "verification_failed" }, { status: 403 });
  // Terbitkan capability token untuk akses ulang (idempoten).
  const freshToken = await issueCredentialToken(code, db);
  const credentials = await readVerifiedDetails(code, db);
  return NextResponse.json({ ok: true, credentials, capability_token: freshToken });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!checkRateLimit(request, "orders:lookup")) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const { code } = await params;
  if (!code || !/^AXV-\d{8}-[A-Z0-9]{8}$/.test(code)) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }
  const token = request.nextUrl.searchParams.get("token") || "";
  if (!token) return NextResponse.json({ error: "token_required" }, { status: 401 });
  const ready = await orderReady(code);
  if ("error" in ready) return NextResponse.json({ error: ready.error }, { status: ready.status });
  if (!(await verifyCredentialToken(code, token, ready.db))) return NextResponse.json({ error: "invalid_token" }, { status: 403 });
  const wr = await getDecryptedAccountDetails(code, ready.db, { token });
  const generic = await readDeliveredSnapshots(code, ready.db);
  const credentials = [
    ...wr.map((d) => ({ details: d.details, completed_at: d.completed_at })),
    ...generic.map((d) => ({ label: d.label, details: d.details, completed_at: d.completed_at })),
  ];
  if (!credentials.length) return NextResponse.json({ error: "invalid_token" }, { status: 403 });
  return NextResponse.json({ ok: true, credentials });
}
