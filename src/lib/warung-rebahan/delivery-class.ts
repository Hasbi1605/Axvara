// src/lib/warung-rebahan/delivery-class.ts — Kelas pengiriman WR per varian.
//
// Masalah: API WR tidak memberi penanda auto/manual (hanya id, name, price,
// duration, type, warranty, stock, terms, delivery_terms). Satu-satunya
// kebenaran adalah daftar admin WR (RESTOK vs MADE BY ORDER) yang volatil.
//
// Desain hibrida (keputusan owner 2026-09-16):
// - Seed screenshot = modal awal (17 nama, sumber 'screenshot').
// - guessDeliveryClass = tebakan sistem untuk sisanya + varian baru.
// - Yang sudah dikunci (screenshot/admin/system) TIDAK PERNAH ditimpa sync.
// - Default aman = 'made_by_order' (under-promise: mending bilang manual
//   ternyata cepat, daripada bilang otomatis ternyata slow).

export type WrDeliveryClass = "restock" | "made_by_order";

// Plafon janji publik untuk varian antrean (keputusan owner 2026-09-18).
// Owner supplier menyebut 6–12 jam, "kalau lancar tidak sampai 1 jam".
// Yang DIJANJIKAN ke pembeli hanya batas atasnya + "umumnya lebih cepat":
// rentang mentah 6–12 jam akan dibaca sebagai janji minimum 6 jam, dan
// tanpa angka sama sekali pembeli tetap menanyakannya lewat support.
// Angka ini juga dipakai untuk ambang peringatan internal (alert di
// WR_QUEUED_ALERT_HOURS, sengaja di ATAS plafon publik).
export const WR_QUEUED_MAX_HOURS = 12;
export const WR_QUEUED_ALERT_HOURS = 13;

/** Label pembeli singkat (web/Telegram/WA). Tanpa emoji — badge/styling diurus UI. */
export function deliveryLabelForBuyer(wrClass: string | null | undefined): string {
  return wrClass === "restock" ? "Kirim otomatis" : "Made By Order";
}

/**
 * Satu kalimat ekspektasi waktu untuk pembeli. WAJIB dipakai di SEMUA
 * permukaan sebelum bayar (PDP, modal varian, checkout, Telegram, WA) —
 * bukan hanya di halaman pesanan. Alasan: varian antrean butuh jam-jaman,
 * jadi pembeli harus tahu SEBELUM uangnya masuk, bukan sesudah.
 * Tidak pernah menyebut pemasok/pihak ketiga: semua tampil sebagai proses
 * Axvara (keputusan owner 2026-09-18).
 */
export function deliveryEtaForBuyer(wrClass: string | null | undefined): string {
  return wrClass === "restock"
    ? "Kirim otomatis setelah pembayaran dikonfirmasi"
    : `Made By Order — dikerjakan sesuai antrean, umumnya lebih cepat, maksimal ${WR_QUEUED_MAX_HOURS} jam pada jam layanan`;
}

/** true bila varian ini masuk kelas antrean (bukan kirim otomatis). */
export function isQueuedDelivery(wrClass: string | null | undefined): boolean {
  return wrClass !== "restock";
}

/**
 * Apakah baris ini butuh antrean (manusia) alih-alih kirim instan?
 * - Varian WR: hanya kelas `restock` yang instan.
 * - Varian non-WR: `shared`/`unique` instan dari stok sendiri; `manual`
 *   berarti diserahkan admin, jadi ikut kelas antrean.
 * Dipakai quote checkout + halaman pesanan supaya ekspektasi waktu yang
 * ditampilkan berasal dari satu aturan, bukan tebakan per layar.
 */
export function isQueuedFulfillment(input: {
  wrVariantId?: unknown;
  wrClass?: unknown;
  fulfillmentMode?: unknown;
}): boolean {
  const wrId = input.wrVariantId == null ? "" : String(input.wrVariantId).trim();
  if (wrId) {
    const raw = input.wrClass == null ? "" : String(input.wrClass).trim();
    return isQueuedDelivery(raw || null);
  }
  return String(input.fulfillmentMode ?? "").trim().toLowerCase() === "manual";
}

/**
 * Apakah varian ini WAJIB email pembeli SEBELUM bayar (2026-09-16)?
 * Aturan gabungan (keputusan owner):
 * - Varian WR tipe Invite/Link OTOMATIS butuh (tanpa setting): WR 422
 *   "Email Invite is required" bila tanpa email_invite (uji live #1).
 * - Produk non-WR: ikut toggle products.require_email (untuk e-book,
 *   lisensi, akun masa depan).
 * Email selalu diminta sebelum bayar — order lunas tanpa email = macet WR.
 */
export function needsEmailForVariant(input: {
  wrType?: string | null;
  requireEmail?: number | boolean | null;
}): boolean {
  if (input.requireEmail === 1 || input.requireEmail === true) return true;
  const type = String(input.wrType || "").trim().toLowerCase();
  return type === "invite" || type === "link";
}

/** Pesan penjelasan saat email wajib tapi kosong/tidak valid. */
export const EMAIL_REQUIRED_MESSAGE =
  "Produk ini dikirim via email invite — tulis email aktif yang benar sebelum bayar.";

/** Label admin lengkap (panel saja, bukan storefront). */
export function deliveryLabelForAdmin(
  wrClass: string | null | undefined,
  source: string | null | undefined,
): string {
  if (wrClass === "restock") {
    return source === "admin" ? "RESTOK • auto • kunci admin"
      : source === "screenshot" ? "RESTOK • auto • daftar WR"
        : source === "system" ? "RESTOK • auto • tebakan"
          : "RESTOK • auto";
  }
  if (wrClass === "made_by_order") {
    return source === "admin" ? "MBO • manual • kunci admin"
      : source === "screenshot" ? "MBO • manual • daftar WR"
        : source === "system" ? "MBO • manual • tebakan"
          : "MBO • manual";
  }
  return "? • belum dikunci";
}

// Nama produk daftar admin WR 2026-09-16 (cocok substring, case-insensitive).
// RESTOK = stok siap, auto. MBO = dibuat saat order, slow.
const RESTOCK_NAMES = [
  "netflix", "capcut", "gemini", "apple music",
  "canva", "loklok", "ilovepdf", "vidio",
  "office", "microsoft",
];

const MBO_NAMES = [
  "wink", "meitu", "zoom", "picsart",
  "scribd", "vpn", "hidemyass", "hma",
];

function containsAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

/**
 * Tebakan sistem untuk varian yang belum dikunci. Sinyal dari data API WR
 * aktual (diukur 2026-09-16, 48 produk / 87 varian):
 * - Stok > 0 + kata langsung/otomatis → restock.
 * - Tipe Invite/Link (butuh email_invite pembeli) → made_by_order.
 * - Kata slow/proses/antri → made_by_order.
 * - Selain itu → made_by_order (default aman).
 */
export function guessDeliveryClass(input: {
  productName: string;
  variantName: string;
  type?: string | null;
  stock?: number | null;
  terms?: string | null;
  deliveryTerms?: string | null;
}): WrDeliveryClass {
  const productName = input.productName || "";
  const variantName = input.variantName || "";
  const combined = `${productName} ${variantName}`;
  // 1. Daftar screenshot menang atas heuristik (modal awal).
  if (containsAny(combined, RESTOCK_NAMES)) return "restock";
  if (containsAny(combined, MBO_NAMES)) return "made_by_order";
  const type = String(input.type || "").toLowerCase();
  const blob = `${input.terms || ""} ${input.deliveryTerms || ""}`.toLowerCase();
  const stock = Number(input.stock || 0);
  // 2. Tipe Invite/Link butuh email_invite pembeli dulu: order Axvara HARUS
  //    membawa customer_email (diteruskan processOneLink → createOrder).
  //    Tanpa email, WR 422 dan retry tidak sembuh (uji live 2026-09-16).
  //    Kelasnya tetap bisa restock bila daftar screenshot, tapi checkout
  //    WAJIB minta email untuk tipe ini.
  if (type === "invite" || type === "link") return "made_by_order";
  // 3. Kata slow/proses/antri = antrean manusia di sisi WR.
  if (/(slow|antri|queue|manual|proses \d|sesuai antrian)/.test(blob)) return "made_by_order";
  // 4. Stok ready + kata langsung/otomatis = restock.
  if (stock > 0 && /(langsung|otomatis|otomatis|real-?time|instant)/.test(blob)) return "restock";
  // 5. Default aman: manual.
  return "made_by_order";
}
