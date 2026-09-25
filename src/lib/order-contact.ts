// src/lib/order-contact.ts — Verifikasi kepemilikan pesanan lewat No. WA ATAU
// email checkout (2026-09-25, permintaan owner). Dipakai lacak pesanan dan
// pengambilan detail akun; kedua route tetap memberi pesan gagal yang generik.
import { constantTimeEqual } from "@/lib/security";

export type BuyerContact = { kind: "email"; value: string } | { kind: "wa"; value: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Input berisi "@" dianggap email, selain itu No. WA. `null` = format tidak valid. */
export function parseBuyerContact(raw: unknown): BuyerContact | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (text.includes("@")) {
    const email = text.toLowerCase();
    return email.length <= 254 && EMAIL_RE.test(email) ? { kind: "email", value: email } : null;
  }
  const compact = text.replace(/[\s-]/g, "");
  return /^(\+62|62|0)8\d{8,13}$/.test(compact) ? { kind: "wa", value: normalizeWa(compact) } : null;
}

/** 08… / +62… / 62… → 62… */
export function normalizeWa(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
}

/** Email: cocok penuh, tanpa beda huruf besar/kecil. Order tanpa email tidak pernah cocok. */
export function emailMatches(providedLower: string, storedEmail: unknown): boolean {
  const stored = String(storedEmail ?? "").trim().toLowerCase();
  return Boolean(stored) && constantTimeEqual(providedLower, stored);
}
