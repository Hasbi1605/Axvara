import { isPaymentMaintenanceEnabled, paymentMaintenanceResponse } from "@/lib/payment-maintenance";
// src/app/api/payments/qris/[code]/reissue/route.ts
//
// Terbitkan QRIS baru untuk order yang masih hidup tetapi QR-nya sudah mati.
//
// Kenapa endpoint ini ada: sebelumnya masa hidup order disamakan dengan masa
// hidup QR (15 menit), dan tidak ada jalur reissue sama sekali —
// `createGopayQrisInvoice` mengembalikan invoice lama yang sudah kedaluwarsa,
// sedangkan `telegram/invoice-retry.ts` hanya mengirim ulang FOTO invoice yang
// sama. Pembeli yang telat bayar wajib mengulang alur dari nol.
//
// Model akses sengaja sama dengan `/api/orders/[code]`: pemegang kode order
// boleh bertindak atas order itu, tanpa login. Yang membuat ini tidak bisa
// disalahgunakan untuk mengganggu pembeli lain adalah invariannya di
// `reissueGopayQrisInvoice`: reissue HANYA boleh saat invoice lama sudah
// kedaluwarsa, sehingga QR yang sedang aktif tidak pernah bisa dibatalkan
// pihak luar. Ditambah rate limit 5/menit/IP dan batas 1 reissue per order.

import { NextRequest, NextResponse } from "next/server";
import { reissueGopayQrisInvoice } from "@/lib/payments/qris";
import { isValidOrderCode } from "@/lib/security";
import { checkRateLimit } from "@/lib/rateLimit";
import { queryFirst } from "@/lib/db";
import { newOrderAccessFailure } from "@/lib/order-access";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const REASON_MESSAGE: Record<string, string> = {
  order_not_reissuable: "Pesanan ini sudah tidak bisa diperpanjang. Buat pesanan baru ya.",
  invoice_still_active: "QRIS kamu masih berlaku. Pakai QR yang sedang tampil.",
  reissue_limit_reached: "Batas perpanjangan QRIS untuk pesanan ini sudah habis. Buat pesanan baru ya.",
  amount_unavailable: "Nominal unik sedang penuh. Coba lagi beberapa saat.",
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (isPaymentMaintenanceEnabled()) return paymentMaintenanceResponse();
  if (!checkRateLimit(request, "qris:reissue")) {
    return NextResponse.json(
      { error: "Terlalu sering, coba lagi 1 menit." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const { code } = await params;
  const orderCode = String(code || "").toUpperCase();
  if (!isValidOrderCode(orderCode)) {
    return NextResponse.json({ error: "Kode pesanan tidak valid" }, { status: 400 });
  }

  const order = await queryFirst("SELECT code,customer_wa,customer_email,buyer_access_version,buyer_access_format FROM orders WHERE code=?", orderCode);
  if (order) {
    const accessFailure = await newOrderAccessFailure(request, order);
    if (accessFailure) return accessFailure;
  }

  try {
    const result = await reissueGopayQrisInvoice(orderCode);
    if (!result.ok) {
      // 409: state order/invoice tidak memenuhi syarat — bukan kesalahan input.
      return NextResponse.json(
        { error: REASON_MESSAGE[result.reason] ?? "Tidak bisa menerbitkan QRIS baru.", reason: result.reason },
        { status: result.reason === "amount_unavailable" ? 503 : 409 },
      );
    }
    return NextResponse.json({
      qris: {
        payable_amount: result.invoice.payableAmount,
        unique_code: result.invoice.uniqueCode,
        image_url: result.invoice.qrisUrl,
        expires_at: result.invoice.expiresAt,
        status: "pending",
      },
      remaining_reissues: result.remaining,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "qris_not_configured") {
      return NextResponse.json({ error: "QRIS sedang tidak tersedia" }, { status: 503 });
    }
    // Tidak membocorkan detail provider/secret ke pembeli; log untuk diagnosa.
    console.error("QRIS reissue failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Gagal menerbitkan QRIS baru. Coba lagi." }, { status: 500 });
  }
}
