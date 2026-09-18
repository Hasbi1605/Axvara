import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryFirst } from "@/lib/db";
import { MAX_QRIS_REISSUES } from "@/lib/payments/dana-qris";
import { checkRateLimit } from "@/lib/rateLimit";
import { constantTimeEqual } from "@/lib/security";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  code: z.string().trim().min(1).max(32),
  wa: z.string().trim().min(1).max(20),
});

/** Normalisasi nomor WA ke format 62... agar 08... / +62... / 62... sama. */
function normalizeWa(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits;
}

function isValidWaFormat(raw: string): boolean {
  return /^(\+62|62|0)8\d{8,13}$/.test(raw.replace(/[\s-]/g, ""));
}

export async function POST(req: NextRequest) {
  if (!checkRateLimit(req, "orders:lookup")) {
    return NextResponse.json({ error: "Terlalu sering, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Kode pesanan dan nomor WA wajib diisi." }, { status: 400 });
  }
  const code = parsed.data.code.trim().toUpperCase();
  const waRaw = parsed.data.wa.trim();
  if (!/^AXV-\d{8}-[A-Z0-9]{8}$/.test(code)) {
    return NextResponse.json({ error: "Format kode tidak valid. Contoh: AXV-20260917-AB12CD34." }, { status: 400 });
  }
  if (!isValidWaFormat(waRaw)) {
    return NextResponse.json({ error: "Nomor WA tidak valid. Gunakan format 08... atau +62...." }, { status: 400 });
  }

  const row = (await queryFirst(
    `SELECT o.*, pt.payable_amount, pt.unique_code, pt.qris_url AS dynamic_qris_url,
            pt.expires_at AS payment_expires_at, pt.status AS transaction_status
     FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
     WHERE o.code=?`,
    code,
  )) as Record<string, unknown> | undefined;

  // Respons generik untuk tidak-ditemukan maupun WA-tidak-cocok agar kode
  // order tidak bisa di-oracle satu per satu (enumerasi).
  const notFound = () =>
    NextResponse.json({ error: "Pesanan tidak ditemukan atau nomor WA tidak cocok. Periksa kembali kode dan nomor WA yang dipakai saat checkout." }, { status: 404 });

  if (!row) return notFound();
  const storedWa = normalizeWa(row.customer_wa);
  const providedWa = normalizeWa(waRaw);
  if (!storedWa || !providedWa || !constantTimeEqual(providedWa, storedWa)) return notFound();

  const waFull = String(row.customer_wa ?? "");
  const waMasked = waFull.length >= 7 ? `${waFull.slice(0, 5)}****${waFull.slice(-4)}` : waFull ? `${waFull.slice(0, 3)}****` : "";
  const emailFull = String(row.customer_email ?? "");
  const emailMasked = emailFull.includes("@") ? emailFull.replace(/(^.).+(@.*)/, (_, a, b) => `${a}***${b}`) : emailFull ? "***" : null;
  let items: { name: string; price: number; qty: number }[] = [];
  try {
    items = JSON.parse(String(row.items || "[]"));
  } catch {
    items = [];
  }
  // Flag kredensial siap (Fase B): lookup SUDAH memverifikasi WA penuh
  // (constantTimeEqual di atas), jadi panel di hasil lacak sama amannya
  // dengan halaman pesanan — tanpa input WA ulang.
  let credentialsReady = false;
  if (String(row.status) === "lunas") {
    const cred = await queryFirst(
      `SELECT 1 AS ok FROM wr_order_links
       WHERE order_code=? AND status='completed' AND wr_account_details IS NOT NULL
       LIMIT 1`,
      code,
    ).catch(() => null);
    credentialsReady = Boolean(cred);
  }
  return NextResponse.json({
    order: {
      code: row.code,
      customer_name: row.customer_name,
      customer_wa: waMasked,
      customer_email: emailMasked,
      items,
      subtotal: row.subtotal,
      payment_method: row.payment_method,
      payment_account: row.payment_account,
      proof_url: undefined,
      status: row.status,
      payment_status: row.payment_status ?? null,
      fulfillment_status: row.fulfillment_status ?? null,
      created_at: row.created_at,
      expires_at: row.expires_at,
      credentials_ready: credentialsReady,
      qris_reissue_allowed: row.status === "pending" && row.sales_channel !== "whatsapp" && Number(row.qris_reissue_count || 0) < MAX_QRIS_REISSUES,
      qris: row.dynamic_qris_url
        ? {
            payable_amount: row.payable_amount,
            unique_code: row.unique_code,
            image_url: row.dynamic_qris_url,
            expires_at: row.payment_expires_at,
            status: row.transaction_status,
          }
        : null,
    },
  });
}
