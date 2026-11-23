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
    const checkout = read("src/app/(shop)/checkout/page.tsx");
    const orders = read("src/app/api/orders/route.ts");
    expect(checkout).toContain("expected_price");
    expect(checkout).toContain("quote_token: quoteToken");
    // 3B-6: quote verification + item matching moved verbatim to
    // checkout/validate.ts; the route still awaits it before reuse.
    const validate = read("src/lib/orders/checkout/validate.ts");
    expect(validate).toContain("verifyCheckoutQuoteToken");
    expect(validate).toContain("sameItems");
    expect(orders).toContain("await validateCheckoutInput(");
    expect(orders).toContain("quote.subtotal");
    expect(checkout).toContain("quoteRequestId");
    expect(checkout).toContain("() => isDirect");
  });

  it("stok tidak tersedia menghasilkan issue terstruktur yang dipahami UI", () => {
    const quote = read("src/app/api/checkout/quote/route.ts");
    const checkout = read("src/app/(shop)/checkout/page.tsx");
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
    expect(read("src/app/(shop)/produk/[slug]/product-detail-client.tsx")).toMatch(/formatVariantLabel\(v, prices\.locale\)/);
    expect(read("src/components/storefront/QuickVariantModal.tsx")).toMatch(/formatVariantLabel\(v, displayLocale\)/);
  });

  it("layout revamp ala Sekalipay (2026-09-23): metode dulu, ringkasan 1x, CTA 1x per viewport", () => {
    const checkout = read("src/app/(shop)/checkout/page.tsx");
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
    // Satu form + handler untuk Enter dan kedua CTA; tepat satu CTA per rail.
    expect(checkout).toContain("ctaDisabled");
    expect(checkout).toContain("ctaLabel");
    const form = checkout.match(/<form\b[\s\S]*?<\/form>/)?.[0] ?? "";
    const mobileCta = form.match(/<div className="lg:hidden fixed bottom-0\b[\s\S]*?<\/div>/)?.[0] ?? "";
    const desktopRail = form.match(/<aside className="hidden lg:block\b[\s\S]*?<\/aside>/)?.[0] ?? "";
    const submitButtons = /<button type="submit" disabled=\{ctaDisabled\}/g;
    expect(form).toContain("onSubmit=");
    expect(form).toContain("if (!ctaDisabled && !issueDialogOpen) void submit();");
    expect(form.match(/<button\b[^>]*\btype="submit"/g)).toHaveLength(2);
    expect(mobileCta.match(submitButtons)).toHaveLength(1);
    expect(desktopRail.match(submitButtons)).toHaveLength(1);
    // Mobile: accordion ringkasan di atas + sticky bottom CTA + spacer.
    expect(checkout).toContain("Ringkasan accordion");
    expect(checkout).toContain("checkout-summary-mobile");
    expect(checkout).toContain("Sticky bottom CTA");
    expect(checkout).toContain("fixed bottom-0");
    // Pola struk 2026-10-01: total tampil 1x per state — header total hanya
    // saat accordion TERTUTUP (atau saat quote loading), agar tidak kembar
    // 2-3x dengan footer Total saat body terbuka.
    expect(checkout).toContain("(!summaryOpen || quoteLoading)");
    // Subline qty: "Qty N × unit" hanya bila qty > 1; qty 1 cukup "Qty 1"
    // karena angka kanan sudah = harga (jangan ulang yang sama).
    expect(checkout).toContain("it.qty > 1");
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
    const detail = read("src/app/(shop)/produk/[slug]/product-detail-client.tsx");
    expect(quote).toContain('type: "variant_required"');
    expect(products).toContain("variant_count");
    expect(card).toContain("hasVariants");
    expect(detail).toContain("variant_catalog_unavailable");
  });

  it("panel upload bukti tetap tidak ada; flag maintenance manual sudah pensiun (picker dari quote)", () => {
    const checkout = read("src/app/(shop)/checkout/page.tsx");
    // Kontrak 2026-11-04: tidak ada input file bukti dan tidak ada flag
    // MANUAL_PAYMENTS_MAINTENANCE; hanya metode dari quote yang bisa dipilih.
    expect(checkout).not.toContain("MANUAL_PAYMENTS_MAINTENANCE");
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
    const home = read("src/app/(shop)/home-client.tsx");
    expect(home).toContain("useState<Product[]>(initialProducts ?? [])");
    expect(home).not.toMatch(/import \{[^}]*\bproducts\b[^}]*\} from "@\/lib\/products"/);
    expect(read("src/app/(shop)/page.tsx")).toContain("@/app/api/products/route");
    // PDP interaktif kini di product-detail-client.tsx (page.tsx server-only, #11).
    expect(read("src/app/(shop)/produk/[slug]/product-detail-client.tsx")).toContain("useState<Product[]>([])");
    expect(read("src/app/(shop)/checkout/page.tsx")).not.toContain("products.find");
  });

  it("admin tidak memakai order localStorage dan payment methods dapat diedit", () => {
    const admin = read("src/app/(shop)/admin/page.tsx");
    expect(admin).not.toContain('localStorage.getItem("axvara-orders")');
    expect(admin).not.toContain('localStorage.setItem("axvara-orders")');
    expect(admin).toContain("PaymentMethodsManager");
    const paymentApi = read("src/app/api/payment-methods/route.ts");
    expect(paymentApi).toContain("requireAdmin");
    expect(paymentApi).toContain("UPDATE payment_methods");
    expect(paymentApi).toContain("INSERT INTO payment_methods");
    expect(paymentApi).toContain("export async function POST");
    expect(paymentApi).toContain("QRIS statis tidak lagi digunakan");
    expect(read("src/app/(shop)/checkout/page.tsx")).not.toContain('pmQris.qris_url || "/qris/axvara-qris.jpg"');
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
    const statusPage = read("src/app/(shop)/pesanan/[code]/page.tsx");
    expect(statusPage).toContain("statusVisual");
    expect(statusPage).toContain("/icons/ios11/close-96.png");
    expect(statusPage).toContain("Status terbaru gagal dimuat");
  });

  it("framing QRIS menempel di QR: label Scan QRIS + lockup resmi + kontrak gambar utuh", () => {
    const statusPage = read("src/app/(shop)/pesanan/[code]/page.tsx");
    const copyFile = read("src/lib/i18n/order-copy.tsx");
    // Label instruksi persis di atas QR, di cabang QR aktif saja.
    expect(statusPage).toContain("ui.qris.scan");
    expect(copyFile).toContain("Scan QRIS");
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
    const statusPage = read("src/app/(shop)/pesanan/[code]/page.tsx");
    expect(statusPage).toContain("supportTelegramLink()");
    expect(statusPage).not.toContain("adminTelegramLink()");
    const site = read("src/lib/site.ts");
    expect(site).toContain('supportTelegram: "axvara_support"');
  });

  it("panel detail akun hanya tampil bila kredensial siap; estimasi dibedakan per kelas pengiriman", () => {
    const statusPage = read("src/app/(shop)/pesanan/[code]/page.tsx");
    const copyFile = read("src/lib/i18n/order-copy.tsx");
    const copySource = statusPage + copyFile;
    // Render kondisional — bukan lagi `isPaid` saja (form mati untuk produk manual).
    expect(statusPage).toContain("order.credentialsReady");
    expect(statusPage).toContain("credentialsReady={order.credentialsReady}");
    expect(read("src/components/storefront/WrCredentialsPanel.tsx")).toContain("if (!credentialsReady) return null;");
    // Fallback: email + halaman pesanan, atau halaman pesanan saja tanpa email.
    expect(copySource).toContain("Pengiriman Produk");
    expect(statusPage).toMatch(/const toBuyer = order\.email\s*\? <>{ui\.delivery\.toBuyerEmail}<\/>\s*: <>{ui\.delivery\.toBuyerPanel}<\/>/);
    expect(copySource).toContain("Detail pesanan akan otomatis dikirimkan di email saat order dan akan tampil di halaman ini.");
    expect(copyFile).toContain("Cek detail produk di halaman ini, atau hubungi admin dengan kode pesanan jika butuh bantuan.");
    // Kelas antrean TIDAK boleh dijanjikan 5–15 menit (C1: <1 jam + plafon 12 jam,
    // tanpa jam layanan spesifik — revisi copy 2026-10-02).
    expect(statusPage).toContain("order.queuedDelivery");
    expect(copySource).toContain("Pesanan Made By Order");
    expect(copySource).toContain("kurang dari 1 jam");
    expect(statusPage).toContain("mboNote(WR_QUEUED_MAX_HOURS)");
    expect(copySource).toContain("${hours} jam.");
    expect(copySource).not.toContain("WR_QUEUED_MAX_HOURS} jam pada jam layanan");
    // C2 instan-gagal menjelaskan kenapa (alasan stok), C1 MBO tidak pakai alasan itu.
    expect(copySource).toContain("Stok otomatis habis, jadi admin menyiapkan manual");
    // Jalur otomatis berjudul sendiri dan tidak bocorkan admin/12 jam.
    // Fase menyiapkan (±30 dtk pertama) = skeleton tanpa teks pengiriman.
    expect(copySource).toContain("Menyiapkan detail produkmu…");
    expect(statusPage).toContain("skeleton: true");
    // Polling terbatas agar panel muncul sendiri tanpa reload manual, dan
    // lebih pendek untuk antrean (polling tak mungkin menutup 12 jam).
    expect(statusPage).toContain('orderStatus !== "lunas" || (credentialsReady && !uniqueUnitsPending && !automaticPending)');
    expect(statusPage).toContain("handedToAdmin ? 3 : automaticPending ? 48 : 30");
    expect(statusPage).toContain("attempts >= maxAttempts");
    // Flag berasal dari server, tidak diakali di client.
    expect(statusPage).toContain("credentialsReady: value.credentials_ready === true");
    expect(statusPage).toContain("queuedDelivery: value.queued_delivery === true");
    expect(statusPage).toContain("instantDelivery: value.instant_delivery === true");
  });

  it("blok tombol bantuan 2-tier: navigasi di atas, WA/Telegram pill ringan di bawah (anti wrap/gepeng)", () => {
    const copyFile = read("src/lib/i18n/order-copy.tsx");
    for (const file of ["src/app/(shop)/pesanan/[code]/page.tsx", "src/app/(shop)/lacak-pesanan/lacak-pesanan-client.tsx"]) {
      const src = read(file);
      // Tier 1 navigasi: grid 2 kolom + nowrap + text-sm (proporsional, tidak wrap).
      expect(src, file).toContain("grid grid-cols-2 gap-2.5");
      expect(src, file).toContain("whitespace-nowrap");
      // Tier 2 bantuan: konteks mikro + label pendek + ikon brand, bukan solid full-bleed.
      expect(src + copyFile, file).toContain("Butuh bantuan?");
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
