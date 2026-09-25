import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { createCheckoutQuoteToken, verifyCheckoutQuoteToken } from "@/lib/auth";
import { createOrderWithStock, execRun, queryFirst, transitionPendingOrder } from "@/lib/db";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Checkout quote integrity", () => {
  it("menandatangani payload authoritative dan menolak token yang diubah", async () => {
    const signed = await createCheckoutQuoteToken({
      items: [{ product_id: 1, name: "Produk", price: 89000, qty: 2 }],
      subtotal: 178000,
      payment_methods: [{ id: "seabank", account_number: "901812349386" }],
    });
    const verified = await verifyCheckoutQuoteToken(signed.token);
    expect(verified?.quote_id).toBe(signed.quoteId);
    expect(verified?.subtotal).toBe(178000);
    expect(verified?.items[0].price).toBe(89000);
    const tampered = signed.token.slice(0, -1) + (signed.token.endsWith("a") ? "b" : "a");
    expect(await verifyCheckoutQuoteToken(tampered)).toBeNull();
  });

  it("client mengirim slug+snapshot harga dan order memakai quote token", () => {
    const checkout = read("src/app/checkout/page.tsx");
    const orders = read("src/app/api/orders/route.ts");
    expect(checkout).toContain("expected_price");
    expect(checkout).toContain("quote_token: quoteToken");
    expect(orders).toContain("verifyCheckoutQuoteToken");
    expect(orders).toContain("sameItems");
    expect(orders).toContain("quote.subtotal");
    expect(checkout).toContain("quoteRequestId");
    expect(checkout).toContain("() => isDirect");
  });

  it("stok tidak tersedia menghasilkan issue terstruktur yang dipahami UI", () => {
    const quote = read("src/app/api/checkout/quote/route.ts");
    const checkout = read("src/app/checkout/page.tsx");
    expect(quote).toContain("type: \"out_of_stock\"");
    expect(quote).toContain("status: 409");
    expect(checkout).toContain("r.status === 409");
    expect(checkout).toContain("issue.message");
  });

  it("displayName quote menggabung label + durasi anti-duplikasi (audit Meitu 2026-09-19)", () => {
    const quote = read("src/app/api/checkout/quote/route.ts");
    // Quote memakai helper kanonis, bukan label mentah — ringkasan checkout
    // + blok Made By Order menampilkan "Meitu VIP - 7 Hari".
    expect(quote).toContain("formatVariantLabel");
    // PDP + modal memakai helper yang sama (satu pola, bukan tambal per layar).
    expect(read("src/app/produk/[slug]/product-detail-client.tsx")).toContain("formatVariantLabel(v)");
    expect(read("src/components/storefront/QuickVariantModal.tsx")).toContain("formatVariantLabel(v)");
  });

  it("layout revamp ala Sekalipay (2026-09-23): metode dulu, ringkasan 1x, CTA 1x per viewport", () => {
    const checkout = read("src/app/checkout/page.tsx");
    // Rail kanan DESKTOP ONLY: aside sticky berisi ringkasan + S&K + CTA
    // (metode pindah ke kolom kiri; mobile rail disembunyikan total).
    expect(checkout).toContain("Action rail kanan");
    expect(checkout).toContain("lg:sticky lg:top-[72px]");
    expect(checkout).toContain("Ringkasan dan pembayaran");
    expect(checkout).toContain("hidden lg:block");
    expect(checkout).toContain("{paymentBlock}");
    // S&K kini fungsi renderAgreeBlock (1 definisi, 2 render per viewport)
    // agar tidak duplikat id — bukan lagi variabel agreeBlock tunggal.
    expect(checkout).toContain("renderAgreeBlock");
    expect(checkout).toContain("checkout-agree-mobile");
    expect(checkout).toContain('renderAgreeBlock("checkout-agree")');
    expect(checkout).not.toContain("{agreeBlock}");
    // Redundan Batch C awal DIHAPUS: mini-blok MBO + trust sebaris di rail.
    expect(checkout).not.toContain("Trust rail");
    expect(checkout).not.toContain("Badge Made By Order di rail");
    // Kiri: ① Metode → ② Data minimal (WA + Email) → S&K mobile.
    expect(checkout).toContain("Kiri — METODE + DATA + S&K");
    expect(checkout).toContain("① Metode Pembayaran");
    expect(checkout).toContain("② Data Pembeli");
    // Field Nama dihapus (data minimal ala Sekalipay).
    expect(checkout).not.toContain("checkout-name");
    expect(checkout).not.toContain("Nama lengkap");
    // QRIS auto-select selama maintenance (hemat 1 klik).
    expect(checkout).toContain("Auto-select QRIS");
    // Satu handler submit dipakai 2 tombol (rail + sticky mobile) —
    // tidak ada logika validasi ganda.
    expect(checkout).toContain("ctaDisabled");
    expect(checkout).toContain("ctaLabel");
    const submitCount = (checkout.match(/onClick=\{submit\}/g) || []).length;
    expect(submitCount).toBe(2);
    // Mobile: accordion ringkasan di atas + sticky bottom CTA + spacer.
    expect(checkout).toContain("Ringkasan accordion");
    expect(checkout).toContain("checkout-summary-mobile");
    expect(checkout).toContain("Sticky bottom CTA");
    expect(checkout).toContain("fixed bottom-0");
    // Batasan batch: tidak ada metode/diskon/logic quote baru — hanya 1
    // blok metode (variabel dipakai ulang) + tidak ada input kode diskon.
    expect(checkout).not.toContain("kode promo");
    expect(checkout).not.toContain("kode voucher");
    expect(checkout).not.toContain("Masukkan voucher");
  });

  it("variant mode tidak dapat dibypass dengan checkout tanpa variant_id", () => {
    const quote = read("src/app/api/checkout/quote/route.ts");
    const products = read("src/app/api/products/route.ts");
    const card = read("src/components/storefront/ProductCard.tsx");
    // PDP interaktif kini di product-detail-client.tsx (page.tsx server-only, #11).
    const detail = read("src/app/produk/[slug]/product-detail-client.tsx");
    expect(quote).toContain('type: "variant_required"');
    expect(products).toContain("variant_count");
    expect(card).toContain("hasVariants");
    expect(detail).toContain("variant_catalog_unavailable");
  });

  it("panel upload bukti disembunyikan selama maintenance jalur manual", () => {
    const checkout = read("src/app/checkout/page.tsx");
    // Maintenance 2026-09-17: tidak ada input file bukti di checkout (QRIS
    // saja). Revert: kembalikan blok upload + setProofUrl(null) reset.
    expect(checkout).toContain("MANUAL_PAYMENTS_MAINTENANCE");
    expect(checkout).not.toContain('type="file"');
    expect(checkout).not.toContain("Klik untuk upload bukti");
  });
});

describe("Atomic stock lifecycle", () => {
  it("dev transaction mengurangi lalu mengembalikan stok saat batal", async () => {
    const before = await queryFirst("SELECT * FROM products WHERE id=?", 1);
    const initial = Number(before?.stock);
    const suffix = Math.random().toString(16).slice(2, 10).toUpperCase().padEnd(8, "0").slice(0, 8);
    const code = `AXV-20260903-${suffix}`;
    const quoteId = `test-${suffix}`;
    await createOrderWithStock({
      code,
      quoteId,
      customerName: "Test Integritas",
      customerWa: "6281234567890",
      customerEmail: null,
      items: [{ product_id: 1, name: "ChatGPT Plus 1 Bulan", price: 89000, qty: 2 }],
      subtotal: 178000,
      paymentMethod: "qris",
      paymentAccount: "",
      proofUrl: "/r2/bukti/test.webp",
    });
    expect(Number((await queryFirst("SELECT * FROM products WHERE id=?", 1))?.stock)).toBe(initial - 2);
    await expect(createOrderWithStock({
      code: `AXV-20260903-${suffix.split("").reverse().join("")}`,
      quoteId,
      customerName: "Test Integritas",
      customerWa: "6281234567890",
      customerEmail: null,
      items: [{ product_id: 1, name: "ChatGPT Plus 1 Bulan", price: 89000, qty: 2 }],
      subtotal: 178000,
      paymentMethod: "qris",
      paymentAccount: "",
      proofUrl: "/r2/bukti/test.webp",
    })).rejects.toThrow(/UNIQUE/);
    expect(Number((await queryFirst("SELECT * FROM products WHERE id=?", 1))?.stock)).toBe(initial - 2);
    await transitionPendingOrder(code, "dibatalkan", null, [{ product_id: 1, qty: 2 }]);
    expect(Number((await queryFirst("SELECT * FROM products WHERE id=?", 1))?.stock)).toBe(initial);
  });

  it("stok unlimited tetap -1 setelah reservasi", async () => {
    const row = await queryFirst("SELECT * FROM products WHERE id=?", 24);
    const initial = Number(row?.stock);
    await execRun("UPDATE products SET stock=? WHERE id=?", -1, 24);
    const suffix = Math.random().toString(16).slice(2, 10).toUpperCase().padEnd(8, "0").slice(0, 8);
    const code = `AXV-20260903-${suffix}`;
    await createOrderWithStock({
      code,
      quoteId: `unlimited-${suffix}`,
      customerName: "Test Unlimited",
      customerWa: "6281234567890",
      customerEmail: null,
      items: [{ product_id: 24, name: "Grammarly", price: 95000, qty: 3 }],
      subtotal: 285000,
      paymentMethod: "qris",
      paymentAccount: "",
      proofUrl: "/r2/bukti/test.webp",
    });
    expect(Number((await queryFirst("SELECT * FROM products WHERE id=?", 24))?.stock)).toBe(-1);
    await transitionPendingOrder(code, "dibatalkan", null, [{ product_id: 24, qty: 3 }]);
    await execRun("UPDATE products SET stock=? WHERE id=?", initial, 24);
  });

  it("D1 memakai batch+guard, quote id unik, dan expiry 24 jam", () => {
    const db = read("src/lib/db/orders-create.ts");
    const schema = read("drizzle/schema.sql");
    expect(db).toContain("await d1.batch(statements)");
    expect(db).toContain("CASE WHEN stock=-1 THEN -1");
    expect(db).toContain("operation_guards");
    expect(schema).toContain("orders_quote_id_unique");
    expect(schema).toContain("expires_at TEXT");
  });
});

describe("Authoritative UI and admin state", () => {
  it("homepage/detail/direct checkout tidak menghidupkan seed produk", () => {
    // Beranda: state awal = produk D1 dari server (page.tsx memanggil handler
    // /api/products) atau kosong — tidak pernah seed statis.
    const home = read("src/app/home-client.tsx");
    expect(home).toContain("useState<Product[]>(initialProducts ?? [])");
    expect(home).not.toMatch(/import \{[^}]*\bproducts\b[^}]*\} from "@\/lib\/products"/);
    expect(read("src/app/page.tsx")).toContain("@/app/api/products/route");
    // PDP interaktif kini di product-detail-client.tsx (page.tsx server-only, #11).
    expect(read("src/app/produk/[slug]/product-detail-client.tsx")).toContain("useState<Product[]>([])");
    expect(read("src/app/checkout/page.tsx")).not.toContain("products.find");
  });

  it("admin tidak memakai order localStorage dan payment methods dapat diedit", () => {
    const admin = read("src/app/admin/page.tsx");
    expect(admin).not.toContain('localStorage.getItem("axvara-orders")');
    expect(admin).not.toContain('localStorage.setItem("axvara-orders")');
    expect(admin).toContain("PaymentMethodsManager");
    const paymentApi = read("src/app/api/payment-methods/route.ts");
    expect(paymentApi).toContain("requireAdmin");
    expect(paymentApi).toContain("UPDATE payment_methods");
    expect(paymentApi).toContain("INSERT INTO payment_methods");
    expect(paymentApi).toContain("export async function POST");
    expect(paymentApi).toContain("QRIS statis tidak lagi digunakan");
    expect(read("src/app/checkout/page.tsx")).not.toContain('pmQris.qris_url || "/qris/axvara-qris.jpg"');
  });

  it("semua modal storefront memakai satu hook a11y kanonis", () => {
    // Perilaku sebenarnya (Escape, focus trap, scroll lock, restore fokus)
    // diuji secara nyata di tests/modal-a11y.behavior.test.tsx memakai jsdom.
    // Test ini hanya menjaga WIRING: tidak ada modal yang kembali menyalin
    // logikanya sendiri, karena salinan itulah yang dulu membuat
    // QuickVariantModal tidak punya a11y sama sekali.
    const hook = read("src/hooks/useModalA11y.ts");
    expect(hook).toContain('document.body.style.overflow = "hidden"');
    expect(hook).toContain('event.key === "Escape"');
    expect(hook).toContain("previousFocus?.focus()");

    for (const file of [
      "src/components/storefront/CartDrawer.tsx",
      "src/components/storefront/PopupBanner.tsx",
      "src/components/storefront/QuickVariantModal.tsx",
    ]) {
      const source = read(file);
      expect(source, file).toContain("useModalA11y");
      expect(source, file).toContain('aria-modal="true"');
      // Tidak boleh ada reimplementasi lokal yang bisa menyimpang dari hook.
      expect(source, file).not.toContain('document.body.style.overflow = "hidden"');
    }
  });

  it("halaman status memakai visual per status dan menampilkan kegagalan polling", () => {
    const statusPage = read("src/app/pesanan/[code]/page.tsx");
    expect(statusPage).toContain("statusVisual");
    expect(statusPage).toContain("/icons/ios11/close-96.png");
    expect(statusPage).toContain("Status terbaru gagal dimuat");
  });

  it("framing QRIS menempel di QR: label Scan QRIS + lockup resmi + kontrak gambar utuh", () => {
    const statusPage = read("src/app/pesanan/[code]/page.tsx");
    // Label instruksi persis di atas QR, di cabang QR aktif saja.
    expect(statusPage).toContain("Scan QRIS");
    // Lockup resmi di bawah QR: logo resmi + teks lengkap (tidak terpotong "...").
    expect(statusPage).toContain("/brand/qris.svg");
    expect(statusPage).toContain("National Payment Standard");
    // Kontrak gambar TIDAK berubah: src QR tetap ke route image per order.
    expect(statusPage).toContain("order.qris.image_url");
    expect(statusPage).toContain('alt={`QRIS dinamis pesanan ${order.code}`}');
    // Aset logo resmi versi putih tema gelap wajib ada.
    expect(fs.existsSync(path.join(process.cwd(), "public/brand/qris.svg"))).toBe(true);
  });

  it("tombol Telegram Admin mengarah ke akun support manusia, bukan bot", () => {
    const statusPage = read("src/app/pesanan/[code]/page.tsx");
    expect(statusPage).toContain("supportTelegramLink()");
    expect(statusPage).not.toContain("adminTelegramLink()");
    const site = read("src/lib/site.ts");
    expect(site).toContain('supportTelegram: "axvara_support"');
  });

  it("panel detail akun hanya tampil bila kredensial siap; estimasi dibedakan per kelas pengiriman", () => {
    const statusPage = read("src/app/pesanan/[code]/page.tsx");
    // Render kondisional — bukan lagi `isPaid` saja (form mati untuk produk manual).
    expect(statusPage).toContain("order.credentialsReady");
    expect(statusPage).toMatch(/isPaid && \(order\.credentialsReady \?/);
    // Fallback: info pengiriman ke kontak checkout, bukan form verifikasi WA.
    expect(statusPage).toContain("Pengiriman Produk");
    // Kabar web lewat email (bot WA mati); WA hanya untuk order tanpa email.
    expect(statusPage).toContain("const destination = order.email");
    expect(statusPage).toContain("Detail produk dikirim ke {destination}");
    // Kelas antrean TIDAK boleh dijanjikan 5–15 menit (plafon 12 jam).
    expect(statusPage).toContain("order.queuedDelivery");
    expect(statusPage).toContain("Made By Order");
    expect(statusPage).toContain("WR_QUEUED_MAX_HOURS} jam pada jam layanan");
    // Polling terbatas agar panel muncul sendiri tanpa reload manual, dan
    // lebih pendek untuk antrean (polling tak mungkin menutup 12 jam).
    expect(statusPage).toContain('orderStatus !== "lunas" || credentialsReady');
    expect(statusPage).toContain("handedToAdmin ? 3 : 30");
    expect(statusPage).toContain("attempts >= maxAttempts");
    // Flag berasal dari server, tidak diakali di client.
    expect(statusPage).toContain("credentialsReady: value.credentials_ready === true");
    expect(statusPage).toContain("queuedDelivery: value.queued_delivery === true");
    expect(statusPage).toContain("instantDelivery: value.instant_delivery === true");
  });

  it("blok tombol bantuan 2-tier: navigasi di atas, WA/Telegram pill ringan di bawah (anti wrap/gepeng)", () => {
    for (const file of ["src/app/pesanan/[code]/page.tsx", "src/app/lacak-pesanan/lacak-pesanan-client.tsx"]) {
      const src = read(file);
      // Tier 1 navigasi: grid 2 kolom + nowrap + text-sm (proporsional, tidak wrap).
      expect(src, file).toContain("grid grid-cols-2 gap-2.5");
      expect(src, file).toContain("whitespace-nowrap");
      // Tier 2 bantuan: konteks mikro + label pendek + ikon brand, bukan solid full-bleed.
      expect(src, file).toContain("Butuh bantuan?");
      expect(src, file).toContain("WA Admin");
      expect(src, file).toContain("/brand/whatsapp-circle.svg");
      expect(src, file).toContain("/brand/telegram.svg");
      // Tidak ada lagi tombol solid hijau/biru full-bleed + label panjang penyebab wrap 2 baris.
      expect(src, file).not.toContain("bg-[#25D366]");
      expect(src, file).not.toContain("bg-[#2AABEE]");
      expect(src, file).not.toContain("WhatsApp Admin");
      expect(src, file).not.toContain("Telegram Admin");
      // Kontrak tidak berubah: message WA + link support Telegram tetap ada.
      expect(src, file).toContain("StoreWhatsAppLink");
      expect(src, file).toContain("supportTelegramLink()");
    }
  });

  it("URL gambar 404 lama tidak ada di seed dan migrasi memperbarui production", () => {
    const products = read("src/lib/products.ts");
    const migration = read("drizzle/migrations/0003_checkout_integrity.sql");
    for (const dead of ["1639322537224-f012857c7c2e", "1639322537504-fcfecb546b11", "1626785774573-6dd65b279390"]) {
      expect(products).not.toContain(dead);
      expect(migration).toContain(dead);
    }
  });
});
