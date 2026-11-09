/** Username checks spend supplier balance; they are utilities, never buyer SKUs. */
export function isGamesNicknameProduct(row: { buyer_sku_code?: unknown; product_name?: unknown }): boolean {
  return /^(ff|ml|pubg)cekusername$/i.test(String(row.buyer_sku_code ?? "").trim())
    || /cek\s*username/i.test(String(row.product_name ?? ""));
}

export function sanitizeGamesNickname(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/[<>\u0000-\u001f\u007f]/g, "").trim().slice(0, 64);
}
