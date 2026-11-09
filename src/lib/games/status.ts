// src/lib/games/status.ts — peta status pembeli yang jujur (docs/GAMES.md §12.6).
// Tidak pernah melaporkan `success` kecuali item Digiflazz benar-benar sukses.
export type GamesBuyerStatus = "awaiting_payment" | "processing" | "success" | "needs_admin" | "expired";

const TERMINAL_ORDER = new Set(["kadaluarsa", "dibatalkan", "batal", "expired"]);

export function gamesBuyerStatus(orderStatus: unknown, itemStatus: unknown): GamesBuyerStatus {
  const item = String(itemStatus ?? "");
  if (item === "success") return "success";
  if (TERMINAL_ORDER.has(String(orderStatus ?? ""))) return "expired";
  if (item === "needs_check") return "needs_admin";
  if (item === "expired") return "expired";
  if (item === "awaiting_payment") return String(orderStatus) === "pending" ? "awaiting_payment" : "processing";
  if (item === "queued" || item === "submitting" || item === "pending") return "processing";
  return "processing";
}
