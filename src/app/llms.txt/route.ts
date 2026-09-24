// GET /llms.txt — ringkasan toko untuk mesin jawab AI (GEO, llmstxt.org).
//
// Crawler AI jarang menjalankan JavaScript; file ini memberi fakta yang bisa
// dikutip langsung: apa AXVARA, cara beli & bayar, garansi, kontak, dan
// produk yang SAAT INI bisa dibeli beserta harga mulai (dari D1, aturan
// stok yang sama dengan katalog web & Telegram).
import { queryAll } from "@/lib/db";
import { purchasableStockSql } from "@/lib/catalog-availability";
import { SITE } from "@/lib/site";
import { SITE_BASE } from "@/lib/site-seo";
import { formatRupiah } from "@/lib/utils";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET() {
  let products: { slug: string; name: string; price: number; category: string | null }[] = [];
  try {
    const rows = await queryAll(
      `SELECT p.slug, p.name, MIN(pv.price) AS price, c.name AS category
       FROM products p
       JOIN product_variants pv ON pv.product_id=p.id AND pv.is_active=1 AND ${purchasableStockSql("pv")}
       LEFT JOIN categories c ON c.id=p.category_id
       WHERE p.is_active=1
       GROUP BY p.id
       ORDER BY p.sort_order ASC, p.name ASC`,
    );
    products = rows.map((row) => ({
      slug: String(row.slug),
      name: String(row.name),
      price: Number(row.price),
      category: row.category ? String(row.category) : null,
    }));
  } catch { /* tetap sajikan profil toko tanpa daftar produk */ }

  const lines = [
    `# ${SITE.name}`,
    "",
    "> AXVARA adalah toko digital independen (third-party, bukan official store) di Indonesia untuk akun premium, AI gateway, dan tools pro dengan harga lebih hemat dari harga resmi. Pembayaran lewat QRIS (semua e-wallet & m-banking) terverifikasi otomatis, dan tiap produk bergaransi sesuai deskripsinya.",
    "",
    "## Cara beli",
    "",
    `- Web: pilih produk di ${SITE_BASE}, checkout dengan nomor WhatsApp + email, lalu bayar QRIS. Status berubah otomatis setelah pembayaran terdeteksi.`,
    `- Telegram: bot @${SITE.adminTelegram} (https://t.me/${SITE.adminTelegram}) melayani order otomatis 24 jam.`,
    "- QRIS berlaku 15 menit; pesanan yang QRIS-nya hangus bisa diperpanjang satu kali dari halaman pesanan.",
    "- Detail akun dikirim ke email pembeli dan tampil di halaman pesanan. Sebagian produk dibuat setelah order (Made By Order), maksimal 12 jam pada jam layanan.",
    "",
    "## Halaman penting",
    "",
    `- [Katalog](${SITE_BASE}/): semua produk beserta harga dan stok`,
    `- [Cara Order](${SITE_BASE}/cara-order): panduan pemesanan`,
    `- [Ketentuan Layanan & Garansi](${SITE_BASE}/garansi-replace): syarat garansi penggantian`,
    `- [Lacak Pesanan](${SITE_BASE}/lacak-pesanan): cek status dengan kode pesanan + nomor WA`,
    `- [Artikel](${SITE_BASE}/artikel): panduan seputar AI & aplikasi premium`,
    "",
    "## Kontak",
    "",
    `- WhatsApp admin: +${SITE.adminWaIntl} (${SITE.supportHours})`,
    `- Telegram: https://t.me/${SITE.supportTelegram}`,
    "",
    `## Produk tersedia saat ini (${products.length})`,
    "",
    ...(products.length > 0
      ? products.map((p) => `- [${p.name}](${SITE_BASE}/produk/${p.slug}): mulai ${formatRupiah(p.price)}${p.category ? ` · ${p.category}` : ""}`)
      : ["- Daftar produk sedang tidak dapat dimuat. Lihat katalog di situs."]),
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=600, s-maxage=600",
    },
  });
}
