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
