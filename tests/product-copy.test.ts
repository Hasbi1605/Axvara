// tests/product-copy.test.ts — Salinan produk versi Axvara (2026-09-24).
//
// Permintaan owner: deskripsi, S&K, dan cara aktivasi seragam untuk WR dan
// non-WR, tanpa kalimat berulang, tanpa menghilangkan ketegasan pemasok.
// Test ini mengunci mekanismenya: pembersih teks pemasok, sidik jari yang
// kebal perubahan kosmetik tapi peka perubahan isi, fallback yang tidak
// pernah membuang aturan, dan parser deskripsi yang dipakai PDP + SEO.
import { describe, expect, it } from "vitest";
import snapshot from "./fixtures/product-copy-snapshot.json";
import { cleanSupplierLines, deshout, supplierFingerprint } from "@/lib/product-copy/text";
import {
  classifyTermLine,
  descriptionSummary,
  isLongDescription,
  mergeProductCopy,
  parseAdminVariantCopy,
  parseProductDescription,
  serializeVariantCopy,
  supplierVariantCopy,
  VARIANT_COPY_MAX_CHARS,
} from "@/lib/product-copy/format";
import { CURATED_VARIANT_COPY } from "@/lib/product-copy/curated";
import { curatedToCopy, needsCopyReview, resolveVariantCopy, resolveVariantCopyDetailed, withVariantCopy } from "@/lib/product-copy/resolve";
import { seoDescription } from "@/lib/product-seo";
import type { ProductDetail, VariantSummary } from "@/lib/catalog";

const pair = (prefix: string) => {
  const found = snapshot.pairs.find((p) => p.variants.some((v) => v.startsWith(prefix)));
  if (!found) throw new Error(`pair ${prefix} tidak ada di snapshot`);
  return found;
};
const texts = (lines: { text: string }[]) => lines.map((line) => line.text);

describe("cleanSupplierLines — rapikan tanpa mengubah isi", () => {
  it("buang emoji, bullet, nomor, dan penanda tak terlihat", () => {
    const lines = cleanSupplierLines("✅ Akses Pro\n— login max 1-2 device\n1. buka website\nBuat klaim trial \u200eUpcloud\n🚫");
    expect(texts(lines)).toEqual(["Akses Pro", "Login max 1-2 device", "Buka website", "Buat klaim trial Upcloud"]);
    expect(lines.map((line) => line.numbered)).toEqual([false, false, true, false]);
  });

  it("huruf besar berteriak jadi kalimat biasa, akronim & kalimat berikutnya tetap benar", () => {
    expect(deshout("JANGAN GUNAKAN PIN")).toBe("Jangan gunakan PIN");
    expect(texts(cleanSupplierLines("🚫 TIDAK ADA TOLERANSI SEDIKITPUN. MELANGGAR? AKUN KAMI TARIK!"))).toEqual([
      "Tidak ada toleransi sedikitpun. Melanggar? Akun kami tarik!",
    ]);
    expect(texts(cleanSupplierLines("WAJIB UPDATE APPS KE VERSI TERBARU !!!!!"))).toEqual(["Wajib update apps ke versi terbaru!"]);
    expect(deshout("Bisa iOS + Android")).toBe("Bisa iOS + Android");
  });

  it("huruf tebal Unicode (𝗗𝗜𝗟𝗔𝗥𝗔𝗡𝗚) dinormalkan agar terbaca pembaca layar", () => {
    expect(texts(cleanSupplierLines("— 𝗗𝗜𝗟𝗔𝗥𝗔𝗡𝗚 𝗠𝗘𝗡𝗚𝗚𝗔𝗡𝗧𝗜 𝗘𝗠𝗔𝗜𝗟 𝗔𝗧𝗔𝗨 𝗣𝗔𝗦𝗦𝗪𝗢𝗥𝗗 𝗔𝗞𝗨𝗡!"))).toEqual([
      "Dilarang mengganti email atau password akun!",
    ]);
  });

  it("baris ganda dibuang, baris berawalan angka tidak dikapitalisasi", () => {
    expect(texts(cleanSupplierLines("Mendapatkan Akun\nmendapatkan akun!\n25 - 30 hari = 1 bulan"))).toEqual([
      "Mendapatkan Akun",
      "25 - 30 hari = 1 bulan",
    ]);
  });
});

describe("supplierFingerprint — kunci salinan kurasi", () => {
  const terms = "Garansi 20 Hari 👌\nLogin max 2 Device";
  const key = supplierFingerprint(terms, "Kalo error langsung lapor admin");

  it("tidak berubah untuk perubahan kosmetik (CRLF, emoji, huruf besar, spasi, tanda baca)", () => {
    expect(supplierFingerprint("GARANSI 20 HARI\r\n  login max 2 device!!", "Kalo error, langsung lapor admin.")).toBe(key);
  });

  it("berubah bila kata atau angka berubah, atau baris pindah bagian", () => {
    expect(supplierFingerprint("Garansi 25 Hari\nLogin max 2 Device", "Kalo error langsung lapor admin")).not.toBe(key);
    expect(supplierFingerprint(`${terms}\nDilarang ganti password`, "Kalo error langsung lapor admin")).not.toBe(key);
    expect(supplierFingerprint(`${terms}\nKalo error langsung lapor admin`, "")).not.toBe(key);
  });

  it("kosong untuk varian tanpa teks pemasok", () => {
    expect(supplierFingerprint(null, "  ")).toBe("");
  });

  it("snapshot fixture konsisten dengan algoritma saat ini", () => {
    for (const p of snapshot.pairs) expect(supplierFingerprint(p.terms, p.deliveryTerms), p.variants.join()).toBe(p.key);
  });
});

describe("resolveVariantCopy — kurasi dulu, pemasok dirapikan sebagai jaring pengaman", () => {
  const legal = pair("netflix-premium · Premium Legal");

  it("teks yang sudah dikurasi memakai salinan Axvara", () => {
    const copy = resolveVariantCopy(legal.terms, legal.deliveryTerms);
    expect(copy?.source).toBe("axvara");
    expect(copy?.sections.map((s) => s.kind)).toEqual(["paket", "aturan", "garansi"]);
    expect(copy?.activation.map((g) => g.title)).toEqual(["Sebelum login", "Login di aplikasi", "Login di website"]);
  });

  it("perubahan kosmetik dari WR tetap memakai salinan Axvara", () => {
    const copy = resolveVariantCopy(`🔥 ${legal.terms!.toUpperCase()}`, legal.deliveryTerms);
    expect(copy?.source).toBe("axvara");
  });

  it("aturan baru dari WR tidak pernah tertutup salinan lama", () => {
    const copy = resolveVariantCopy(`${legal.terms}\nDilarang login di Smart TV`, legal.deliveryTerms);
    expect(copy?.source).toBe("pemasok");
    expect(copy?.sections.flatMap((s) => s.items)).toContain("Dilarang login di Smart TV");
  });

  it("tanpa teks pemasok → null", () => {
    expect(resolveVariantCopy(null, null)).toBeNull();
  });

  it("withVariantCopy mengosongkan teks mentah dan menempelkan salinan", () => {
    const variant = { id: 1, terms: legal.terms, delivery_terms: legal.deliveryTerms } as unknown as VariantSummary;
    const out = withVariantCopy({ id: 1, variants: [variant] } as unknown as ProductDetail);
    expect(out.variants[0].terms).toBeNull();
    expect(out.variants[0].delivery_terms).toBeNull();
    expect(out.variants[0].copy?.source).toBe("axvara");
  });
});

describe("supplierVariantCopy — fallback tidak membuang isi pemasok", () => {
  it("baris yang sama di S&K dan cara aktivasi tampil sekali; aturan di teks aktivasi pindah ke S&K", () => {
    const legal = pair("netflix-premium · Premium Legal");
    const copy = supplierVariantCopy(legal.terms, legal.deliveryTerms)!;
    const all = [...copy.sections.flatMap((s) => s.items), ...copy.activation.flatMap((g) => g.steps)];
    const keys = all.map((line) => line.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim());
    expect(new Set(keys).size).toBe(keys.length);
    expect(copy.sections.flatMap((s) => s.items)).toContain("Dilarang mengubah EMAIL & PASSWORD");
    expect(copy.activation.map((g) => g.title)).toEqual([null, "Cara Login Aplikasi", "Cara Login di Website"]);
  });

  it("teks aktivasi yang isinya aturan semua tidak menjadi langkah bernomor", () => {
    const vidio = pair("vidio-platinum · Mobile");
    const copy = supplierVariantCopy(vidio.terms, vidio.deliveryTerms)!;
    expect(copy.activation).toEqual([]);
    expect(copy.sections.find((s) => s.kind === "aturan")?.items.join(" ")).toMatch(/Dilarang mengubah email/i);
  });

  it("klasifikasi baris S&K", () => {
    expect(classifyTermLine("Garansi Hanya Backfree")).toBe("garansi");
    expect(classifyTermLine("DILARANG mengubah email (ketahuan? akun di tarik dan nogar)")).toBe("aturan");
    expect(classifyTermLine("Login max 2 Device")).toBe("aturan");
    expect(classifyTermLine("Proses tiap MALAM")).toBe("proses");
    expect(classifyTermLine("Masa aktif dimulai sejak akun diberikan")).toBe("paket");
    expect(classifyTermLine("Limit pencarian 300/bulan")).toBe("paket");
  });
});

describe("parseProductDescription — satu format deskripsi untuk semua produk", () => {
  const axvara = [
    "Akun GSuite siap pakai dengan pilihan durasi fleksibel.",
    "",
    "- Akun siap digunakan dengan aktivasi cepat",
    "- Pilihan durasi mulai 1 hari hingga 1 bulan",
    "",
    "Syarat & Ketentuan:",
    "- Masa aktif dimulai sejak akun diberikan atau diaktifkan",
    "- Full garansi selama masa aktif akun",
    "",
    "Cara Aktivasi:",
    "1. Login di gmail.com",
    "2. Ganti password",
  ].join("\n");

  it("paragraf pembuka + keunggulan + bagian S&K/aktivasi terpisah", () => {
    const parsed = parseProductDescription(axvara);
    expect(parsed.blocks).toEqual([
      { type: "p", text: "Akun GSuite siap pakai dengan pilihan durasi fleksibel." },
      { type: "list", items: ["Akun siap digunakan dengan aktivasi cepat", "Pilihan durasi mulai 1 hari hingga 1 bulan"] },
    ]);
    expect(parsed.terms).toEqual(["Masa aktif dimulai sejak akun diberikan atau diaktifkan", "Full garansi selama masa aktif akun"]);
    expect(parsed.activation).toEqual(["Login di gmail.com", "Ganti password"]);
    expect(parsed.sections).toEqual([]);
  });

  it("teks lama admin (emoji checklist, ⚠️ PENTING:, Contoh:) tetap terbaca", () => {
    const gsuite = snapshot.descriptions.find((d) => d.slug === "akun-gsuite")!.description!;
    const parsed = parseProductDescription(gsuite);
    expect(parsed.blocks[0]).toMatchObject({ type: "list" });
    expect(parsed.terms[0]).toMatch(/durasi aktif akun/);
    expect(parsed.sections.map((s) => s.title)).toEqual(["Contoh"]);
  });

  it("urutan asli dipertahankan (paragraf → daftar → paragraf) dan CRLF dipecah", () => {
    const adobe = snapshot.descriptions.find((d) => d.slug === "adobe-creative-cloud")!.description!;
    expect(parseProductDescription(adobe).blocks.map((b) => b.type)).toEqual(["p", "list", "p"]);
    const chatgpt = snapshot.descriptions.find((d) => d.slug === "chatgpt-premium")!.description!;
    expect(parseProductDescription(chatgpt).blocks).toHaveLength(2);
  });

  it("ringkasan SEO hanya paragraf pembuka", () => {
    expect(descriptionSummary(axvara)).toBe("Akun GSuite siap pakai dengan pilihan durasi fleksibel.");
    expect(descriptionSummary("- Satu\n- Dua")).toBe("Satu, Dua");
    expect(seoDescription({ slug: "x", name: "X", description: axvara, image: null, images: null, badge: null, sold_count: null, variants: [] }))
      .toBe("Akun GSuite siap pakai dengan pilihan durasi fleksibel.");
  });

  it("tombol lipat mobile hanya untuk deskripsi yang melebihi area terlihat", () => {
    expect(isLongDescription(parseProductDescription("Loklok adalah platform streaming."))).toBe(false);
    // Bagian S&K/aktivasi pindah ke kartunya sendiri, jadi tidak dihitung.
    expect(isLongDescription(parseProductDescription(axvara))).toBe(false);
    const youtube = "YouTube Premium menghadirkan pengalaman YouTube tanpa iklan di semua perangkat tempat kamu login, termasuk aplikasi YouTube Kids.\n\n- Tanpa iklan, bisa unduh video untuk ditonton offline\n- Putar di latar belakang (background play)\n- Termasuk YouTube Music Premium: musik bebas iklan, offline, dan background play";
    expect(isLongDescription(parseProductDescription(youtube))).toBe(true);
  });
});

describe("mergeProductCopy — S&K varian + bagian deskripsi, tiap baris sekali", () => {
  const variantCopy = {
    source: "axvara" as const,
    sections: [{ kind: "aturan" as const, items: ["Dilarang mengganti password"] }],
    activation: [{ title: null, steps: ["Login di aplikasi"] }],
    notes: [],
  };

  it("produk non-WR: S&K dari deskripsi dikelompokkan otomatis", () => {
    const merged = mergeProductCopy(null, parseProductDescription("Intro.\n\nSyarat & Ketentuan:\n- Full garansi selama masa aktif\n- Dilarang berbagi akun"));
    expect(merged.fromVariant).toBe(false);
    expect(merged.sections).toEqual([
      { kind: "aturan", items: ["Dilarang berbagi akun"] },
      { kind: "garansi", items: ["Full garansi selama masa aktif"] },
    ]);
  });

  it("override admin yang ikut menulis S&K digabung tanpa duplikat; langkahnya jadi catatan", () => {
    const desc = parseProductDescription("Intro.\n\nSyarat & Ketentuan:\n- dilarang mengganti password!\n- Garansi 7 hari\n\nCara Aktivasi:\n- Hubungi admin bila gagal");
    const merged = mergeProductCopy(variantCopy, desc);
    expect(merged.fromVariant).toBe(true);
    expect(merged.sections).toEqual([
      { kind: "aturan", items: ["Dilarang mengganti password"] },
      { kind: "garansi", items: ["Garansi 7 hari"] },
    ]);
    expect(merged.activation).toEqual([{ title: null, steps: ["Login di aplikasi"] }]);
    expect(merged.notes).toEqual(["Hubungi admin bila gagal"]);
  });
});

describe("teks editor admin (migrasi 0041) — serialize ⇄ parse", () => {
  it("semua 83 salinan kurasi bolak-balik tanpa kehilangan isi dan muat di batas kolom", () => {
    for (const entry of CURATED_VARIANT_COPY) {
      const copy = curatedToCopy(entry);
      const text = serializeVariantCopy(copy);
      expect(parseAdminVariantCopy(text.terms, text.activation), entry.label).toEqual({ ...copy, source: "admin" });
      expect(text.terms.length, entry.label).toBeLessThanOrEqual(VARIANT_COPY_MAX_CHARS);
      expect(text.activation.length, entry.label).toBeLessThanOrEqual(VARIANT_COPY_MAX_CHARS);
    }
  });

  it("format editor: judul bagian, langkah berkelompok, catatan", () => {
    const legal = pair("netflix-premium · Premium Legal");
    const text = serializeVariantCopy(resolveVariantCopy(legal.terms, legal.deliveryTerms));
    expect(text.terms.split("\n").slice(0, 2)).toEqual(["Detail paket:", "- Paket Premium Ultra HD 4K"]);
    expect(text.terms).toContain("\n\nAturan pakai:\n- Hanya login di 1 perangkat");
    expect(text.activation.split("\n").slice(0, 3)).toEqual(["Sebelum login:", "1. Wajib uninstall aplikasi Netflix dulu, lalu install ulang", "2. Wajib login memakai data seluler (atau hotspot dari HP), terutama saat login pertama, karena tidak semua WiFi bisa dipakai login Netflix"]);
    const zoom = pair("zoom-premium · Pro 14D");
    expect(serializeVariantCopy(resolveVariantCopy(zoom.terms, zoom.deliveryTerms)).activation).toMatch(/\n\nCatatan:\n- Rekaman cloud/);
  });

  it("tulisan bebas admin tetap terbaca: tanpa judul dikelompokkan otomatis, penomoran & bullet apa pun", () => {
    const copy = parseAdminVariantCopy(
      "Berupa akun siap pakai\n• Dilarang ganti password\n* Garansi 7 hari\n\nAturan pakai:\nLogin maksimal 2 perangkat\n- Login maksimal 2 perangkat",
      "1) Buka aplikasi\n2. Login\nCatatan:\nHubungi admin bila gagal",
    );
    expect(copy).toEqual({
      source: "admin",
      sections: [
        { kind: "paket", items: ["Berupa akun siap pakai"] },
        { kind: "aturan", items: ["Dilarang ganti password", "Login maksimal 2 perangkat"] },
        { kind: "garansi", items: ["Garansi 7 hari"] },
      ],
      activation: [{ title: null, steps: ["Buka aplikasi", "Login"] }],
      notes: ["Hubungi admin bila gagal"],
    });
  });

  it("kosong / hanya judul → null (kembali ke salinan otomatis)", () => {
    expect(parseAdminVariantCopy("", "  ")).toBeNull();
    expect(parseAdminVariantCopy("Garansi:\n", "Catatan:")).toBeNull();
  });
});

describe("resolveVariantCopy — suntingan admin per varian", () => {
  const legal = pair("netflix-premium · Premium Legal");
  const adminText = { terms: "Aturan pakai:\n- Dilarang berbagi akun", activation: "1. Login di aplikasi" };

  it("suntingan yang ditulis untuk teks WR saat ini menang atas kurasi", () => {
    const key = supplierFingerprint(legal.terms, legal.deliveryTerms);
    const res = resolveVariantCopyDetailed(legal.terms, legal.deliveryTerms, { ...adminText, fingerprint: key });
    expect(res.status).toBe("admin");
    expect(res.copy?.sections).toEqual([{ kind: "aturan", items: ["Dilarang berbagi akun"] }]);
    expect(res.auto?.source).toBe("axvara");
    expect(needsCopyReview(res)).toBe(false);
  });

  it("WR mengubah teks sejak disunting → suntingan dijeda, teks WR terbaru tampil, perlu ditinjau", () => {
    const key = supplierFingerprint(legal.terms, legal.deliveryTerms);
    const changed = `${legal.terms}\nDilarang login di Smart TV`;
    const res = resolveVariantCopyDetailed(changed, legal.deliveryTerms, { ...adminText, fingerprint: key });
    expect(res.status).toBe("pemasok");
    expect(res.adminStale).toBe(true);
    expect(res.copy?.sections.flatMap((s) => s.items)).toContain("Dilarang login di Smart TV");
    expect(needsCopyReview(res)).toBe(true);
  });

  it("varian non-WR: suntingan admin berlaku (sidik jari kosong), tanpa suntingan → tanpa salinan", () => {
    expect(resolveVariantCopyDetailed(null, null, { ...adminText, fingerprint: "" }).status).toBe("admin");
    expect(resolveVariantCopyDetailed(null, null, { ...adminText, fingerprint: null }).status).toBe("admin");
    const none = resolveVariantCopyDetailed(null, null, { terms: null, activation: null, fingerprint: null });
    expect(none).toMatchObject({ status: "none", copy: null, adminStale: false });
    expect(needsCopyReview(none)).toBe(false);
  });

  it("teks WR belum dikurasi tanpa suntingan → perlu ditinjau", () => {
    const res = resolveVariantCopyDetailed("Mendapatkan akun\nGaransi 3 hari", null);
    expect(res.status).toBe("pemasok");
    expect(needsCopyReview(res)).toBe(true);
  });

  it("withVariantCopy memakai suntingan admin dan tidak mengirim kolom mentahnya", () => {
    const key = supplierFingerprint(legal.terms, legal.deliveryTerms);
    const variant = {
      id: 1, terms: legal.terms, delivery_terms: legal.deliveryTerms,
      admin_terms: adminText.terms, admin_activation: adminText.activation, admin_copy_fingerprint: key,
    } as unknown as VariantSummary;
    const [out] = withVariantCopy({ id: 1, variants: [variant] } as unknown as ProductDetail).variants;
    expect(out.copy?.source).toBe("admin");
    expect(out.admin_terms).toBeUndefined();
    expect(out.admin_activation).toBeUndefined();
    expect(out.admin_copy_fingerprint).toBeUndefined();
    expect(JSON.parse(JSON.stringify(out))).not.toHaveProperty("admin_terms");
  });
});
