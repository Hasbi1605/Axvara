import type { VariantCopyEntry } from "@/lib/product-copy/format";

export type CopyStatusVariant = "success" | "accent" | "warning" | "destructive" | "secondary";

export type CopyStatusInfo = {
  label: string;
  variant: CopyStatusVariant;
  tooltip: string;
};

export function variantCopyStatus(entry: VariantCopyEntry): CopyStatusInfo {
  const supplier = entry.supplier ?? "Supplier";
  if (entry.adminStale) {
    return {
      label: "Perlu ditinjau",
      variant: "destructive",
      tooltip: `${supplier} mengubah teks. Pembeli masih melihat suntinganmu — klik Edit untuk meninjau teks baru.`,
    };
  }
  if (entry.reviewKind === "changed") {
    return {
      label: "Perlu ditinjau",
      variant: "destructive",
      tooltip: `${supplier} mengubah teks sejak terakhir ditinjau — klik Edit untuk memeriksa perubahan.`,
    };
  }
  if (entry.status === "admin") {
    return {
      label: "Disunting admin",
      variant: "success",
      tooltip: "Memakai S&K dan cara aktivasi yang disunting admin.",
    };
  }
  if (entry.status === "axvara") {
    return {
      label: "Kurasi AXVARA",
      variant: "accent",
      tooltip: "Memakai salinan kurasi otomatis AXVARA.",
    };
  }
  if (entry.status === "pemasok") {
    return {
      label: "Teks supplier",
      variant: "warning",
      tooltip: entry.reviewed
        ? `Teks ${supplier} sudah ditandai oke dan tetap ikut update supplier.`
        : `Pembeli melihat teks ${supplier} yang dirapikan — tandai oke atau sunting versi AXVARA.`,
    };
  }
  return {
    label: "Kosong",
    variant: "secondary",
    tooltip: "Belum ada S&K atau cara aktivasi khusus untuk varian ini.",
  };
}

export function statusBadgeClassName(variant: CopyStatusVariant): string {
  if (variant === "accent") {
    return "border-admin-accent/35 bg-admin-accent/10 text-admin-accent";
  }
  return "";
}

export function badgeVariantProp(variant: CopyStatusVariant): "success" | "outline" | "warning" | "destructive" | "secondary" {
  return variant === "accent" ? "outline" : variant;
}

export function hasVariantEnglishCopy(entry?: VariantCopyEntry): boolean {
  if (!entry) return false;
  return Boolean(entry.adminTermsEn?.trim() || entry.adminActivationEn?.trim());
}
