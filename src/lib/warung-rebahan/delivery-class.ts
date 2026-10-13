// src/lib/warung-rebahan/delivery-class.ts — Kelas pengiriman WR per varian.
//
// SATU sumber kebenaran (sejak 2026-10-13, penyederhanaan ala SK atas
// permintaan owner): `delivery_mode` resmi API WR per varian. Pemetaan
// paten dua nilai — sama seperti `sk_order_process` SK:
//   "auto"   → restock       (badge admin: AUTO)
//   "manual" → made_by_order (badge admin: MANUAL)
//   "mixed"  → made_by_order (dilipat ke MANUAL: bisa manual tergantung
//               ketersediaan — menjanjikan AUTO untuknya berarti berbohong
//               separuh waktu; nilai 'mixed' sendiri tetap tersimpan mentah
//               di kolom wr_delivery_mode untuk audit, hanya kelasnya yang
//               biner)
//   kosong/tak dikenal → made_by_order (default aman deterministik, BUKAN
//               tebakan: mending bilang manual ternyata cepat, daripada
//               bilang otomatis ternyata slow)
//
// Mesin tebakan lama (guessDeliveryClass + daftar nama screenshot 16 Sep
// 2026 + cap sumber 'system/screenshot/admin') DIHAPUS 2026-10-13: audit
// D1 prod hari yang sama membuktikan 92/94 varian aktif sudah membawa
// delivery_mode resmi (2 sisa = varian Canva nonaktif stok 0), sementara
// label "• tebakan"/"• daftar WR"/"• kunci admin" + tombol kunci kelas
// admin hanya mengaburkan halaman. Kelas kini murni turunan API — admin
// tidak lagi mengunci manual; koreksi kelas = koreksi di dashboard WR.

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
 * - Varian SK: hanya `sk_order_process=auto` yang instan (lisensi langsung);
 *   SK non-auto (manual/h2h/smm) ikut kelas antrean walau fulfillment_mode
 *   lokalnya 'manual' (kontrak fulfillment hanya manual/shared/unique).
 * - Varian non-WR/non-SK: `shared`/`unique` instan dari stok sendiri; `manual`
 *   berarti diserahkan admin, jadi ikut kelas antrean.
 * Dipakai quote checkout + halaman pesanan supaya ekspektasi waktu yang
 * ditampilkan berasal dari satu aturan, bukan tebakan per layar.
 */
export function isQueuedFulfillment(input: {
  wrVariantId?: unknown;
  wrClass?: unknown;
  skVariantId?: unknown;
  skOrderProcess?: unknown;
  fulfillmentMode?: unknown;
}): boolean {
  const wrId = input.wrVariantId == null ? "" : String(input.wrVariantId).trim();
  if (wrId) {
    const raw = input.wrClass == null ? "" : String(input.wrClass).trim();
    return isQueuedDelivery(raw || null);
  }
  // SK auto tidak pernah antre — regresi 2026-10-02: Prime Video SK auto badge
  // PDP "Kirim otomatis" benar tapi checkout bilang Made By Order 12 jam,
  // karena quote hanya melihat fulfillment_mode lokal ('manual' untuk semua SK).
  const skId = input.skVariantId == null ? "" : String(input.skVariantId).trim();
  if (skId) {
    const raw = input.skOrderProcess == null || String(input.skOrderProcess).trim() === ""
      ? "manual"
      : String(input.skOrderProcess).trim().toLowerCase();
    return raw !== "auto";
  }
  return String(input.fulfillmentMode ?? "").trim().toLowerCase() === "manual";
}

/**
 * Apakah wr_type ini bertipe Invite strict (satu-satunya tipe yang menurut
 * api-docs live + admin WR wajib email_invite — POST /order: "Wajib untuk
 * produk bertipe invite")?
 * Perbandingan case-insensitive + trim.
 */
export function isInviteWrType(wrType: string | null | undefined): boolean {
  return String(wrType || "").trim().toLowerCase() === "invite";
}

/**
 * Apakah wr_type ini memakai email_invite saat order ke WR (gate konservatif)?
 * Invite ATAU Link. Alasan Link ikut (audit implementasi 2026-10-07):
 * tipe "Link" itu NYATA di API WR — fixture sync.test.ts memakai
 * `type: "Link"` dengan UUID Canva asli (bukan tebakan). Api-docs + admin
 * hanya menyebut Invite sebagai wajib, tapi MENGHILANGKAN Link dari gate
 * berisiko order Link 422 (retry tak sembuh, pembeli sudah bayar) bila
 * ternyata WR masih membutuhkannya — jauh lebih buruk daripada kotak
 * TARGET ACCOUNT INVITATION kosmetik di dashboard WR. Jadi Link tetap
 * dikirimi email_invite (perilaku lama, tidak pernah merusak order);
 * yang DIPERBAIKI hanya Private/Sharing/dll yang kini di-omit total.
 * Bila admin WR konfirmasi tertulis Link tak butuh email, hapus
 * `|| ... === "link"` di bawah (satu baris) + sesuaikan test.
 */
export function wrTypeUsesEmailInvite(wrType: string | null | undefined): boolean {
  if (isInviteWrType(wrType)) return true;
  return String(wrType || "").trim().toLowerCase() === "link";
}

/**
 * Apakah baris ini WAJIB email pembeli SEBELUM bayar (2026-09-16,
 * dipersempit 2026-10-07)?
 * Aturan gabungan (keputusan owner + koreksi admin WR 2026-10-07):
 * - Varian WR tipe Invite/Link OTOMATIS butuh (tanpa setting): WR 422
 *   "Email Invite is required" bila tanpa email_invite (uji live #1;
 *   Link dipertahankan karena tipe nyata di API WR — lihat
 *   wrTypeUsesEmailInvite).
 *   Private/Sharing TIDAK butuh dan TIDAK boleh dikirimi email_invite
 *   (temuan admin: produk non-invite ikut muncul TARGET ACCOUNT INVITATION
 *   di dashboard WR karena Axvara selalu meneruskan customer_email).
 * - Produk non-WR: ikut toggle products.require_email (untuk e-book,
 *   lisensi, akun masa depan).
 * Email selalu diminta sebelum bayar — order lunas tanpa email = macet WR.
 */
export function needsEmailForVariant(input: {
  wrType?: string | null;
  requireEmail?: number | boolean | null;
}): boolean {
  if (input.requireEmail === 1 || input.requireEmail === true) return true;
  if (isInviteWrType(input.wrType)) return true;
  return String(input.wrType || "").trim().toLowerCase() === "link";
}

/** Pesan penjelasan saat email wajib tapi kosong/tidak valid. */
export const EMAIL_REQUIRED_MESSAGE =
  "Produk ini dikirim via email invite — tulis email aktif yang benar sebelum bayar.";

/** Label admin lengkap (panel saja, bukan storefront): hanya AUTO/MANUAL. */
export function deliveryLabelForAdmin(wrClass: string | null | undefined): string {
  if (wrClass === "restock") return "AUTO";
  if (wrClass === "made_by_order") return "MANUAL";
  return "?";
}

/**
 * Kelas pengiriman dari `delivery_mode` resmi API WR — SATU-SATUNYA penentu
 * kelas (2026-10-13). Pemetaan paten biner ala SK:
 * "auto" → restock; "manual"/"mixed" → made_by_order. Kosong/tak dikenal →
 * null (pemanggil memakai default aman deterministik `made_by_order`,
 * bukan tebakan konten).
 */
export function deliveryClassFromApiMode(mode: string | null | undefined): WrDeliveryClass | null {
  const m = String(mode ?? "").trim().toLowerCase();
  if (m === "auto") return "restock";
  if (m === "manual" || m === "mixed") return "made_by_order";
  return null;
}

/**
 * Default kelas untuk varian yang API-nya (belum) mengirim `delivery_mode`:
 * deterministik `made_by_order` — BUKAN tebakan. Under-promise secara sadar
 * (lihat header file): begitu sync berikutnya membawa mode resmi, kelas
 * langsung mengikuti API.
 */
export const WR_DEFAULT_DELIVERY_CLASS: WrDeliveryClass = "made_by_order";
