import type { PayOption } from "@/lib/payment-ui";
import { getCryptoAsset } from "@/lib/payments/crypto-assets";

/**
 * Logo dekoratif untuk kartu metode di picker checkout. Berkas lokal saja (tanpa
 * hotlink/SDK); sumber tiap berkas dicatat di docs/DESIGN.md ("Payment logos").
 *
 * Logo hanya MENGHIASI opsi yang ditawarkan server dan tidak membuktikan kanal
 * itu aktif. Merek gateway dikenali dari LABEL tampilan dari server (dinormalisasi:
 * trim, huruf kecil, spasi tunggal) dengan kecocokan PERSIS terhadap daftar kecil
 * di bawah, bukan dari kode kanal, ID bertanda tangan, atau substring. Label tidak
 * dikenal/ambigu memakai pelat netral + glyph generik. Tidak ada efek ke routing.
 */
/** `darken`: aset mono putih (dibuat untuk latar gelap) harus digelapkan agar terbaca di pelat putih. */
export type MethodLogo = { src: string; darken?: boolean };

const GATEWAY_BRANDS: ReadonlyArray<{ file: string; labels: readonly string[] }> = [
  { file: "bca", labels: ["bca", "bca va", "bca virtual account"] },
  { file: "bri", labels: ["bri", "bri va", "bri virtual account", "briva"] },
  { file: "mandiri", labels: ["mandiri", "mandiri va", "mandiri virtual account"] },
  { file: "bni", labels: ["bni", "bni va", "bni virtual account"] },
  { file: "permata", labels: ["permata", "permata va", "permata virtual account"] },
  { file: "cimb-niaga", labels: ["cimb", "cimb va", "cimb niaga", "cimb niaga va", "cimb virtual account", "cimb niaga virtual account"] },
  { file: "danamon", labels: ["danamon", "danamon va", "danamon virtual account"] },
  { file: "bsi", labels: ["bsi", "bsi va", "bsi virtual account"] },
  { file: "seabank", labels: ["seabank", "seabank va", "seabank virtual account"] },
  { file: "gopay", labels: ["gopay"] },
  { file: "ovo", labels: ["ovo"] },
  { file: "linkaja", labels: ["linkaja", "link aja"] },
];

const BY_LABEL = new Map(GATEWAY_BRANDS.flatMap(({ file, labels }) => labels.map((label) => [label, `/payments/${file}.svg`] as const)));

const normalizeLabel = (label: string) => label.trim().toLowerCase().replace(/\s+/g, " ");

export function methodLogo(option: PayOption): MethodLogo | null {
  if (option.kind === "qris") return { src: "/brand/qris.svg", darken: true };
  if (option.kind === "crypto") {
    // Logo koin hanya dari katalog kurasi (berkas lokal /payments/coins/<ticker>.svg); id harus cocok dengan ticker.
    const asset = getCryptoAsset(option.payCurrency);
    return asset && option.id === `nowpayments:${asset.ticker}` ? { src: asset.logo } : null;
  }
  const src = BY_LABEL.get(normalizeLabel(option.label));
  return src ? { src } : null;
}
