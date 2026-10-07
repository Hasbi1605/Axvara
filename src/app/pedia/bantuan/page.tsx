export const runtime = "edge";

// src/app/pedia/bantuan/page.tsx + ketentuan (PD-14).
export default function PediaHelpPage() {
  const groups = [
    { title: "Sebelum order", items: [
      ["Apakah akun harus publik?", "Ya. Akun dikunci tidak bisa diproses — buka kunci dulu. Jangan ganti username selama proses."],
      ["Link apa yang didukung?", "Link profil (followers), postingan/reel/video (likes/views). Tempel saja — sistem mengenali otomatis."],
    ]},
    { title: "Setelah bayar", items: [
      ["Kapan mulai?", "Mulai dalam ±5–30 menit. Progres live di halaman pesanan."],
      ["QRIS kedaluwarsa?", "QRIS 15 menit. Order ulang bila habis waktu."],
    ]},
    { title: "Garansi & kredit", items: [
      ["Bagaimana garansi?", "Produk bergaransi bisa refill gratis dalam masa garansi via tombol di halaman pesanan."],
      ["Apa itu Kode Kredit?", "Sisa dana partial/cancel jadi kode PDK-XXXX-XXXX, berlaku 180 hari untuk belanja Pedia. Bukan uang tunai."],
    ]},
  ];
  return (
    <div className="mx-auto max-w-xl pt-8">
      <h1 className="font-display text-[22px] font-bold text-white sm:text-[32px]">Bantuan</h1>
      {groups.map((g) => (
        <section key={g.title} className="mt-6">
          <h2 className="text-sm font-bold text-white/70">{g.title}</h2>
          <div className="mt-2 space-y-2">
            {g.items.map(([q, a]) => (
              <details key={q} className="ax-glass-card rounded-[20px] p-4">
                <summary className="cursor-pointer text-[15px] font-semibold text-white">{q}</summary>
                <p className="mt-2 text-sm text-white/65">{a}</p>
              </details>
            ))}
          </div>
        </section>
      ))}
      <a href="https://wa.me/6282135277434?utm_source=pedia&utm_medium=help" className="mt-6 flex h-12 items-center justify-center rounded-[14px] bg-[#00E5FF] text-sm font-bold text-[#070a1e]">
        WA Admin
      </a>
    </div>
  );
}
