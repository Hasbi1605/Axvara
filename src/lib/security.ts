// Helpers dipisah agar bisa di-unit test tanpa mock edge runtime.
export function generateOrderCode(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const rand = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 8).toUpperCase();
  return `AXV-${ymd}-${rand}`;
}

export function checkMagicBytes(buf: Uint8Array, type: string): boolean {
  const t = type.toLowerCase();
  if (t === "image/jpeg" || t === "image/jpg") return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (t === "image/png") return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (t === "image/webp") return buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  return false;
}

export function isAllowedImageType(type: string): boolean {
  return new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]).has(type.toLowerCase());
}

export function aggregateQty(items: { product_id: number; qty: number }[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const it of items) m.set(it.product_id, (m.get(it.product_id) ?? 0) + it.qty);
  return m;
}

export function isValidOrderCode(code: string): boolean {
  return /^AXV-\d{8}-[A-Z0-9]{8}$/.test(code);
}

// Dev hash must NOT equal prod hash — regression guard for exposed dev password finding
export const DEV_FALLBACK_SHA256 = "4dd15911ef55de049db9770568de456a4a97e3607c98ea74fe344888eae0ed95";
export const PROD_SHA256_HINT = "3e3812f3daeb315a0ac17a094bffce7d67ff7c391f5e852cc9373d33ac38adbc"; // should NOT appear in .env.example
