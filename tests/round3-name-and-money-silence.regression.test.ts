// Audit ronde 3 (2026-09-23) — temuan yang TERBUKTI setelah ditelaah.
//
// Prioritas dipersempit sesuai keputusan owner: kanal WEB dan TELEGRAM wajib
// sempurna; WhatsApp dinonaktifkan sebagai kanal utama untuk 2-5 bulan ke
// depan (bot sedang mati, grup akan dikunci admin-only), jadi temuan
// khusus-WA sengaja TIDAK dikerjakan di batch ini.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveNameFromEmail, FALLBACK_CUSTOMER_NAME } from "@/lib/utils";

const read = (path: string) => readFileSync(path, "utf8");

describe("R1-R3: nama pembeli web tidak lagi prefix email mentah", () => {
  it("prefix email dibersihkan menjadi nama yang layak tampil", () => {
    // Nilai ini tersimpan di orders.customer_name lalu merembes ke sapaan
    // halaman pesanan, notifikasi Telegram admin, prefill tombol WA, pencarian
    // admin, dan CSV — jadi ia harus layak dibaca manusia.
    expect(deriveNameFromEmail("budi123@gmail.com")).toBe("Budi");
    expect(deriveNameFromEmail("first.last+promo@gmail.com")).toBe("First Last");
    expect(deriveNameFromEmail("siti_aminah@mail.co")).toBe("Siti Aminah");
    // Plus-addressing adalah tag, bukan bagian nama.
    expect(deriveNameFromEmail("hasbi+axvara@gmail.com")).toBe("Hasbi");
  });

  it("jatuh ke nama umum bila email tidak menyisakan apa pun yang layak", () => {
    expect(deriveNameFromEmail("x@gmail.com")).toBe(FALLBACK_CUSTOMER_NAME);
    expect(deriveNameFromEmail("12345@gmail.com")).toBe(FALLBACK_CUSTOMER_NAME);
    expect(deriveNameFromEmail("")).toBe(FALLBACK_CUSTOMER_NAME);
  });

  it("nama yang diisi pembeli sendiri tidak pernah ditimpa sanitizer", () => {
    const route = read("src/app/api/orders/route.ts");
    // customer_name dipakai apa adanya bila ada; sanitizer hanya untuk fallback.
    expect(route).toMatch(/customer_name\?\.trim\(\)[\s\S]{0,120}deriveNameFromEmail\(customer_email\)/);
  });

  it("kedua jalur (API dan form checkout) memakai sanitizer yang sama", () => {
    expect(read("src/app/api/orders/route.ts")).toContain("deriveNameFromEmail");
    expect(read("src/app/checkout/page.tsx")).toContain("deriveNameFromEmail");
    // Tidak boleh ada lagi pemakaian prefix email mentah sebagai nama.
    for (const path of ["src/app/api/orders/route.ts", "src/app/checkout/page.tsx"]) {
      expect(read(path), path).not.toMatch(/split\("@"\)\[0\][\s\S]{0,40}slice\(0, 80\)/);
    }
  });
});

describe("F2: uang masuk tanpa pasangan invoice tidak lagi sunyi", () => {
  it("cabang unmatched webhook DANA membunyikan Telegram admin", () => {
    const route = read("src/app/api/webhook/dana/route.ts");
    const unmatched = route.slice(
      route.indexOf("SET status='ignored'"),
      route.indexOf('status: "unmatched"'),
    );
    expect(unmatched).toContain("TELEGRAM_ADMIN_CHAT_ID");
    expect(unmatched).toContain("sendMessage");
    // Nominal dari payload yang di-parse (kolom `amount` tidak ikut di-SELECT).
    expect(unmatched).toContain("payment.amount");
    // Ack webhook tetap 2xx: ping admin tidak boleh membuat DANA retry.
    expect(route).toMatch(/catch \{ \/\* ping admin best-effort \*\/ \}/);
  });
});

describe("F5 + F9: pembeli tahu saat pengiriman gagal", () => {
  it("kegagalan terminal mengabari pembeli, bukan hanya admin", () => {
    const send = read("src/lib/fulfillment/delivery/send.ts");
    expect(send).toContain("notifyBuyerDeliveryFailed");
    // Harus di dalam cabang transisi terminal, bukan tiap percobaan.
    expect(send).toMatch(/becameTerminal[\s\S]{0,900}notifyBuyerDeliveryFailed/);
    expect(read("src/lib/notify-buyer.ts")).toContain("export async function notifyBuyerDeliveryFailed");
  });

  it("halaman lacak pesanan membedakan lunas-terkirim dari lunas-gagal", () => {
    const page = read("src/app/lacak-pesanan/lacak-pesanan-client.tsx");
    // `/api/orders/lookup` sudah mengembalikan fulfillment_status; dulu
    // halaman ini hanya membaca status pembayaran sehingga order yang gagal
    // kirim tampil hijau "Lunas" selamanya.
    expect(page).toContain("fulfillmentStatus");
    // Kondisinya harus benar-benar dihitung dari data, bukan konstanta.
    expect(page).toMatch(
      /const isDeliveryFailed = isPaid && order\?\.fulfillmentStatus === "failed";/,
    );
    expect(page).toMatch(/isDeliveryFailed[\s\S]{0,200}Lunas — pengiriman bermasalah/);
    // Pembeli diberi langkah lanjutan, bukan hanya badge merah.
    expect(page).toContain("gagal dikirim otomatis");
  });
});

describe("B1 DITOLAK: klaim retry tetap tanpa penaikan counter & tanpa debounce", () => {
  it("retry tidak menaikkan attempt_count (penaikan milik worker)", () => {
    const route = read("src/app/api/admin/warung/orders/[id]/retry/route.ts");
    // Menaikkan di sini akan menghitung GANDA: worker menaikkannya saat
    // mengklaim, dan handleInsufficientBalance mengembalikannya agar saldo
    // habis tidak memakan jatah transport.
    expect(route).not.toContain("attempt_count=attempt_count+1");
    const worker = read("src/lib/warung-rebahan/order.ts");
    expect(worker).toContain("attempt_count=attempt_count-1");
    expect(worker).toMatch(/status='claimed', attempt_count=\?/);
  });
});
