// src/lib/pedia/help-content.ts — Isi halaman Bantuan Pedia (cara order + FAQ), 2026-11-01.
export const PEDIA_ORDER_STEPS = [
  ["1", "Pilih layanan", "Pilih platform dan kebutuhan, isi jumlah, lalu bandingkan layanannya. Harga, estimasi mulai, dan refill tampil di tiap layanan."],
  ["2", "Tempel link target", "Tempel link profil atau postingan sesuai layanan. Pastikan akun publik dan link tidak diganti selama proses."],
  ["3", "Isi kontak", "Isi nomor WhatsApp dan email. Kontak dipakai untuk melacak pesanan dan dihubungi admin bila pengiriman gagal."],
  ["4", "Bayar QRIS & pantau", "Scan QRIS dan bayar sesuai nominal dalam 15 menit. Pembayaran terdeteksi otomatis, lalu progres tampil di halaman pesanan."],
] as const;

export const PEDIA_HELP_GROUPS = [
  { title: "Sebelum order", items: [
    ["Apakah akun harus publik?", "Ya. Akun yang dikunci tidak bisa diproses, jadi buka kuncinya dulu. Jangan ganti username atau menghapus postingan selama proses."],
    ["Link apa yang didukung?", "Link profil untuk followers, serta link postingan, reel, atau video untuk likes dan views. Tempel saja; formatnya diperiksa otomatis."],
  ] },
  { title: "Setelah bayar", items: [
    ["Kapan pesanan mulai diproses?", "Mengikuti estimasi mulai di tiap layanan, misalnya “Mulai 0–4 jam”. Progresnya bisa dipantau di halaman pesanan."],
    ["QRIS kedaluwarsa?", "QRIS berlaku 15 menit. Bila waktunya habis, pesanan berakhir otomatis dan kamu bisa memesan ulang."],
    ["Bagaimana membatalkan pesanan?", "Pesanan yang belum dibayar bisa dibatalkan di halaman pembayaran lewat tombol Batalkan Pesanan, dengan memasukkan WA atau email checkout. Pesanan yang sudah dibayar tidak bisa dibatalkan sendiri; hubungi admin."],
  ] },
  { title: "Garansi & kendala pesanan", items: [
    ["Bagaimana cara refill?", "Layanan dengan Refill (mis. Refill 30 Days) bisa diisi ulang gratis saat drop: Refill N hari sejak pesanan dibuat atau selesai (sesuai layanan), selama layanan masih tersedia. Ajukan di halaman Refill Pedia atau halaman pesanan, maksimal 1× per 24 jam. Layanan No Refill tidak bisa diajukan refill."],
    ["Apa itu No Drop, Less Drop, dan High Drop?", "Label perkiraan drop tiap layanan. No Drop: saat ini belum terlihat drop, tetapi tetap bisa drop. Less Drop: bisa drop sedikit. High Drop: drop besar, cocok bila harga lebih penting dan kamu menerima risikonya. Penjelasan lengkap ada di halaman Refill Pedia."],
    ["Pesanan selesai sebagian atau dibatalkan?", "Hubungi admin dengan kode pesanan. Admin memeriksa dan menyelesaikannya secara manual. Pedia tidak memakai saldo, kredit, atau refund otomatis di website."],
  ] },
] as const;

// Versi pembeli EN (2026-11-07): kunci, urutan, angka, dan kebijakan sama.
const PEDIA_ORDER_STEPS_EN = [
  ["1", "Choose a service", "Pick a platform and what you need, enter the quantity, then compare the services. Price, start estimate, and refill are shown on each service."],
  ["2", "Paste the target link", "Paste the profile or post link that matches the service. Make sure the account is public and the link does not change during processing."],
  ["3", "Enter contact details", "Enter a WhatsApp number and email. They are used to track the order and to contact you if delivery fails."],
  ["4", "Pay QRIS & track", "Scan the QRIS and pay the exact amount within 15 minutes. Payment is detected automatically, then progress appears on the order page."],
] as const;

const PEDIA_HELP_GROUPS_EN = [
  { title: "Before ordering", items: [
    ["Does the account have to be public?", "Yes. Locked accounts cannot be processed, so unlock it first. Don't change the username or delete posts during processing."],
    ["Which links are supported?", "Profile links for followers, and post, reel, or video links for likes and views. Just paste it; the format is checked automatically."],
  ] },
  { title: "After paying", items: [
    ["When does the order start processing?", "It follows the start estimate on each service, for example “Starts in 0–4 hours”. You can track progress on the order page."],
    ["QRIS expired?", "QRIS is valid for 15 minutes. When the time runs out, the order ends automatically and you can order again."],
    ["How do I cancel an order?", "An unpaid order can be canceled on the payment page with the Cancel Order button, by entering the checkout WhatsApp number or email. A paid order cannot be canceled yourself; contact admin."],
  ] },
  { title: "Warranty & order issues", items: [
    ["How do I request a refill?", "Services with Refill (e.g. Refill 30 Days) can be topped up free when they drop: Refill N days since the order was created or completed (depending on the service), while the service is still available. Request it on the Pedia Refill page or the order page, at most once per 24 hours. No Refill services cannot be refilled."],
    ["What are No Drop, Less Drop, and High Drop?", "Estimated drop labels for each service. No Drop: no drop is visible right now, but it can still drop. Less Drop: a small drop is possible. High Drop: a large drop, suitable when price matters more and you accept the risk. Full explanations are on the Pedia Refill page."],
    ["What if the order is partially completed or canceled?", "Contact admin with the order code. Admin checks and resolves it manually. Pedia does not use balances, credits, or automatic refunds on the website."],
  ] },
] as const;

export function pediaOrderSteps(locale: "id" | "en") { return locale === "en" ? PEDIA_ORDER_STEPS_EN : PEDIA_ORDER_STEPS; }
export function pediaHelpGroups(locale: "id" | "en") { return locale === "en" ? PEDIA_HELP_GROUPS_EN : PEDIA_HELP_GROUPS; }
