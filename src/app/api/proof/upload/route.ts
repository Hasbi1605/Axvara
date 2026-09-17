import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// Public proof upload — for checkout (buyer). Strict: image only, 5MB, magic bytes, save to bukti/ prefix (private R2 via /api/admin/bukti).
// Maintenance sementara (2026-09-17): implementasi normal dipindah ke
// handleProofUploadRequest di bawah dan TIDAK dipanggil — POST selalu 503.
// Revert = hapus early-return 503 dan panggil handleProofUploadRequest(req).

export async function POST(req: NextRequest) {
  if (!checkRateLimit(req, "proof:upload")) return NextResponse.json({ error: "Terlalu sering, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  // Maintenance sementara (2026-09-17): upload bukti WEB disembunyikan dan
  // endpoint ditutup — hanya QRIS yang berlaku di semua platform.
  return NextResponse.json({ error: "Upload bukti sedang dinonaktifkan. Silakan bayar via QRIS." }, { status: 503 });
}
