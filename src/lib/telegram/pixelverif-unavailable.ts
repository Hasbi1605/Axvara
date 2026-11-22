export const PIXELVERIF_UNAVAILABLE_ID = "Google AI Pro 3 Bulan belum tersedia untuk dipesan. Jangan kirim password atau kunci 2FA. Lihat katalog di https://axvara.tech/";

export function pixelverifUnavailable(locale?: "id" | "en"): string {
  return locale === "en"
    ? "Google AI Pro 3 Months is not available to order. Do not send passwords or 2FA keys. Browse https://axvara.tech/"
    : PIXELVERIF_UNAVAILABLE_ID;
}
