// src/lib/orders/checkout/create.ts — checkout slot + atomic order create
// (3B-5a, class E: pure move, no behavior change).
//
// BEFORE: the durable slot admission, buyer-name fallback, the
// `createOrderWithStock` try/catch (stock-error winner reuse, UNIQUE winner
// reuse, 500 log) lived inline in src/app/api/orders/route.ts after the
// signed-method preflight.
// AFTER: `createCheckoutOrder(ctx, deps)` owns that block verbatim and
// returns a discriminated outcome; the route keeps `NextResponse`
// serialization of the created/invoice path, the saved-order response
// builder (injected as `onExistingOrder` so this module never imports the
// route), and everything after creation (invoice issuance, analytics,
// created response). Evaluation order is unchanged:
// `createDatabaseAccess()` -> `checkoutSubjects(...)` ->
// `consumeCheckoutSlot(db, subjects, quote_id)` on the unbudgeted access,
// then fallback name, then exactly one `createOrderWithStock` call. The
// stock-error winner read keeps `.catch(() => null)`; the UNIQUE winner
// read deliberately keeps NO `.catch`. No statement, argument, copy,
// status, header, or log line changes.

import { NextResponse } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";
import { checkoutSubjects, consumeCheckoutSlot } from "@/lib/checkout-guard";
import { createOrderWithStock, queryFirst, StockReservationError } from "@/lib/db";
import { deriveNameFromEmail } from "@/lib/utils";

type CreateContext = {
  code: string;
  quoteId: string;
  // Signed quote items/subtotal, passed through to createOrderWithStock.
  items: Parameters<typeof createOrderWithStock>[0]["items"];
  subtotal: Parameters<typeof createOrderWithStock>[0]["subtotal"];
  locale?: "id" | "en";
  wa: string;
  customerEmail: string;
  customerName?: string | null;
  paymentMethod: string;
  paymentAccount: string;
  proofUrl: string | null;
  ip: string;
};

type CreateDeps = {
  /** Route-owned saved-order response (existingCheckoutResponse + routeDeps). */
  onExistingOrder: (winner: Record<string, unknown>) => Promise<NextResponse> | NextResponse;
};

export type CreateOutcome =
  | { kind: "created"; fallbackName: string }
  | { kind: "responded"; response: NextResponse };

export async function createCheckoutOrder(
  ctx: CreateContext,
  deps: CreateDeps,
): Promise<CreateOutcome> {
  const { code, quoteId, wa, customerEmail: customer_email, customerName, paymentMethod, paymentAccount } = ctx;
  // Resolve saved orders first; durable quote admission also dedupes retries
  // that reach this point before the winning request has saved its order.
  const guard = await consumeCheckoutSlot(
    createDatabaseAccess(),
    await checkoutSubjects({ ip: ctx.ip, wa, email: customer_email }),
    quoteId,
  );
  if (!guard.allowed) {
    if (guard.reason === "unavailable") return {
      kind: "responded",
      response: NextResponse.json(
        { error: "Checkout sementara tidak tersedia. Coba lagi dengan data yang sama." },
        { status: 503, headers: { "Retry-After": String(guard.retryAfterSeconds) } },
      ),
    };
    return {
      kind: "responded",
      response: NextResponse.json(
        { error: "Terlalu banyak pesanan baru dari koneksi/nomor ini. Tunggu hingga 15 menit, lalu coba lagi. Pesanan yang sudah dibuat tetap bisa dilacak." },
        { status: 429, headers: { "Retry-After": String(guard.retryAfterSeconds) } },
      ),
    };
  }

  // Revamp 2026-09-23: customer_name opsional dari web (form tanpa nama).
  // Fallback DIBERSIHKAN (2026-09-23): prefix email mentah bukan nama —
  // `budi123@…` dulu tersimpan apa adanya lalu merembes ke sapaan halaman
  // pesanan, notifikasi Telegram admin, prefill tombol WA, pencarian admin,
  // dan CSV. Nama yang diisi pembeli sendiri tidak pernah disentuh.
  const fallbackName = customerName?.trim()
    ? customerName.trim().slice(0, 80)
    : deriveNameFromEmail(customer_email);
  try {
    await createOrderWithStock({
      code,
      quoteId,
      customerName: fallbackName,
      customerWa: wa,
      customerEmail: customer_email,
      items: ctx.items,
      subtotal: ctx.subtotal,
      paymentMethod,
      paymentAccount,
      proofUrl: ctx.proofUrl,
      locale: ctx.locale ?? "id",
    });
  } catch (e: unknown) {
    if (e instanceof StockReservationError) {
      const winner = await queryFirst("SELECT code,quote_id,subtotal,status,payment_status,locale,buyer_access_version,buyer_access_format FROM orders WHERE quote_id=?", quoteId).catch(() => null);
      if (winner) return { kind: "responded", response: await deps.onExistingOrder(winner as Record<string, unknown>) };
      return { kind: "responded", response: NextResponse.json({ error: e.message }, { status: 409 }) };
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      const existing = await queryFirst("SELECT code,quote_id,subtotal,status,payment_status,locale,buyer_access_version,buyer_access_format FROM orders WHERE quote_id=?", quoteId);
      if (existing) {
        return { kind: "responded", response: await deps.onExistingOrder(existing as Record<string, unknown>) };
      }
      return { kind: "responded", response: NextResponse.json({ error: "Kode pesanan bentrok, coba lagi." }, { status: 409 }) };
    }
    console.error("POST /api/orders insert failed:", msg);
    return { kind: "responded", response: NextResponse.json({ error: "Terjadi kesalahan pada server. Coba lagi." }, { status: 500 }) };
  }
  return { kind: "created", fallbackName };
}
