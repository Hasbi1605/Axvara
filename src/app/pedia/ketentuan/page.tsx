// src/app/pedia/ketentuan/page.tsx — S&K Pedia (PRD §11, 7 poin + larangan klaim).
export default function PediaTermsPage() {
  const points = [
    "Layanan meningkatkan angka interaksi; AXVARA tidak menjamin jangkauan, penjualan, atau FYP.",
    "Akun/postingan wajib publik dan tidak boleh diganti username/dihapus selama proses. Pelanggaran → pesanan dianggap selesai tanpa kredit.",
    "Penurunan jumlah (drop) dapat terjadi. Produk bergaransi berhak refill dalam masa garansi; produk tanpa garansi tidak.",
    "Pesanan selesai sebagian/dibatalkan supplier → sisa dana menjadi Kode Kredit Pedia (berlaku 180 hari, hanya untuk belanja di Pedia, tidak dapat diuangkan).",
    "Salah memasukkan link yang tetap valid (akun orang lain) bukan tanggung jawab AXVARA.",
    "Penggunaan layanan dapat bertentangan dengan ketentuan platform media sosial; risiko akun sepenuhnya pada pembeli.",
    "Dilarang untuk konten melanggar hukum, judi, penipuan, politik praktis/kampanye, atau pelecehan. Pesanan semacam itu dibatalkan tanpa kredit.",
  ];
  return (
    <div className="mx-auto max-w-xl pt-8">
      <h1 className="font-display text-[22px] font-bold text-white sm:text-[32px]">Ketentuan Pedia</h1>
      <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-white/75">
        {points.map((p) => <li key={p.slice(0, 24)}>{p}</li>)}
      </ol>
    </div>
  );
}
