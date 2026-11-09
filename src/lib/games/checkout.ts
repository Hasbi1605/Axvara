// src/lib/games/checkout.ts — aturan checkout pembeli Games (P5–P7).
// Quantity selalu 1; max_price tidak pernah membayar modal di atas harga jual:
// min(unit_price, ceil(cost_snapshot × 1,05)).
export function gamesMaxPrice(unitPrice: number, cost: number): number {
  const markup = Math.ceil((cost * 105) / 100);
  return Math.min(unitPrice, markup);
}

/** P7: QRIS Games berlaku 15 menit (rail lain menyusul). */
export const GAMES_QRIS_EXPIRY_MINUTES = 15;
