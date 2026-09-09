// Edge-safe DB — prod: D1 binding, dev: in-memory seed from products.ts
// No fs / better-sqlite3 imports — fully edge-compatible for @cloudflare/next-on-pages.
//
// Barrel entry point: file ini SENGAJA hanya me-re-export dari folder
// src/lib/db/* agar tetap menjadi satu-satunya titik impol publik (`@/lib/db`)
// untuk ~80 pemakai di repo. Isi nyata dipisah demi maintainability:
//   - db/types.ts            → kontrak tipe D1 + DbProduct + AtomicOrderItem
//   - db/client.ts           → getD1 + state in-memory dev (SATU sumber) + query helpers
//   - db/expiry.ts           → predikat kadaluarsa kanonis
//   - db/errors.ts           → kelas error jalur uang
//   - db/orders-create.ts    → reservasi stok atomik (createOrderWithStock)
//   - db/orders-transition.ts→ transisi status order/pembayaran (jalur uang)
// PURE MOVE: tidak ada perubahan perilaku; hanya pemindahan kode.

export type { DbProduct, D1Result, D1Statement, D1, AtomicOrderItem } from "./db/types";
export { getD1, getDbSync, isD1Mode, queryAll, queryFirst, execRun } from "./db/client";
export { D1_EXPIRY_PREDICATE, D1_NOT_EXPIRED_PREDICATE } from "./db/expiry";
export { StockReservationError, OrderTransitionError } from "./db/errors";
export { createOrderWithStock } from "./db/orders-create";
export {
  transitionPendingOrder,
  transitionPendingPaymentOrder,
  transitionPendingPaymentToPaid,
  incrementSoldCountForOrder,
} from "./db/orders-transition";
