import { PIXELVERIF_DESCRIPTION_EN, PIXELVERIF_DESCRIPTION_ID } from "./copy";

export type PixelverifFlowType = "normal" | "full";
export type PixelverifFamilyKey = "google_ai_pro_3m";

export type PixelverifVariantSpec = {
  flow_type: PixelverifFlowType;
  validity: 3;
  sku: string;
  label: string;
  service_key: string;
};

export const PIXELVERIF_FAMILY: { key: PixelverifFamilyKey; name: string; slug: string; category: number; imageUrl: string; description: string; description_en: string | null } = {
  key: "google_ai_pro_3m",
  name: "Google AI Pro 3 Bulan",
  slug: "google-ai-pro-3-bulan",
  category: 1,
  imageUrl: "/brand/catalog/products/google-ai-pro-pv.webp",
  description: PIXELVERIF_DESCRIPTION_ID,
  description_en: PIXELVERIF_DESCRIPTION_EN,
};

export const PIXELVERIF_VARIANTS: PixelverifVariantSpec[] = [
  { flow_type: "normal", validity: 3, sku: "PV-NORMAL-3", label: "Link Redeem 3 Bulan", service_key: "normal_3" },
  { flow_type: "full", validity: 3, sku: "PV-FULL-3", label: "Aktivasi Langsung 3 Bulan", service_key: "full_3" },
];

export function pixelverifFamilyForFlow(flow: PixelverifFlowType): typeof PIXELVERIF_FAMILY {
  return PIXELVERIF_FAMILY;
}

export function pixelverifVariantForSku(sku: string): PixelverifVariantSpec | undefined {
  return PIXELVERIF_VARIANTS.find((v) => v.sku === sku);
}

export function pixelverifVariantForServiceKey(key: string): PixelverifVariantSpec | undefined {
  return PIXELVERIF_VARIANTS.find((v) => v.service_key === key);
}
