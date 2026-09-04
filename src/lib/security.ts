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

export function aggregateQty(items: { product_id: number; variant_id?: number; qty: number }[]): Map<string | number, number> {
  const m = new Map<string | number, number>();
  for (const it of items) {
    if (it.variant_id) {
      const key = `${it.product_id}:${it.variant_id}`;
      m.set(key, (m.get(key) ?? 0) + it.qty);
    } else {
      m.set(it.product_id, (m.get(it.product_id) ?? 0) + it.qty);
      m.set(String(it.product_id), (m.get(String(it.product_id)) ?? 0) + it.qty);
    }
  }
  return m;
}

export function isValidOrderCode(code: string): boolean {
  return /^AXV-\d{8}-[A-Z0-9]{8}$/.test(code);
}

// F-01 fix: removed all hardcoded password hashes from source code
// Dev password: "axvara-dev-only" (handled in auth.ts verifyPassword)
// Prod password: set via ADMIN_PASSWORD_SHA256 in CF Pages Variables (PBKDF2 format)
