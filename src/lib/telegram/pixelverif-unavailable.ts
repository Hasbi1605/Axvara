export const PIXELVERIF_UNAVAILABLE_ID = "Pixel Verification belum tersedia untuk dipesan. Jangan kirim password atau kunci 2FA. Lihat katalog di https://axvara.tech/";

export function pixelverifUnavailable(locale?: "id" | "en"): string {
  return locale === "en"
    ? "Pixel Verification is not available to order. Do not send passwords or 2FA keys. Browse https://axvara.tech/"
    : PIXELVERIF_UNAVAILABLE_ID;
}
