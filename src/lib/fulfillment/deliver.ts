// src/lib/fulfillment/deliver.ts — Outbox delivery: claim job, send via Telegram, retry
// Decrypts secrets in memory only. Never logs plaintext.
//
// MENGAPA barrel: file ini dulu monolit 1752 baris/40 fungsi. Ia dipecah ke
// `delivery/*` per tanggung jawab (types, manifest, inventory-binding, claim,
// send, process, reconcile, handover) agar tiap unit <~450 baris dan tiap
// fungsi <100 baris — lebih mudah ditinjau dan diuji. deliver.ts DIPERTAHANKAN
// sebagai gerbang publik yang me-re-export SELURUH symbol yang dulu diekspor,
// sehingga tidak ada import di seluruh repo (`@/lib/fulfillment/deliver`) yang
// putus. Ini PURE MOVE: tidak ada perubahan perilaku, SQL, atau signature.

export type {
  FulfillmentOrderItem,
  FulfillmentRecipient,
  FencedJobMutation,
  JobUnitResult,
  ManualHandoverResult,
  FulfillmentLineMismatch,
} from "./delivery/types";
export {
  COST_PER_DELIVERY_ITEM,
  COST_PER_JOB_FRAME,
  COST_PER_ORPHAN_LIGHT,
} from "./delivery/types";

export {
  resolveRecipient,
  ensurePrivateRecipient,
  parseOrderItems,
  allItemsSettled,
  allItemsDelivered,
  findMissingFulfillmentLines,
  findFulfillmentLineMismatches,
  fulfillmentLineMismatches,
} from "./delivery/manifest";

export {
  resolveItemMode,
  ensureFulfillmentItems,
} from "./delivery/inventory-binding";

export {
  createFulfillmentJob,
  claimJob,
  markJobDelivered,
  scheduleRetry,
  scheduleRetryFenced,
  getDueJobs,
  releaseStaleJobs,
  releaseStaleItemsMem,
} from "./delivery/claim";

export {
  processJobItems,
  processJob,
} from "./delivery/process";

export {
  ensureFulfillmentForPaidOrder,
} from "./delivery/ensure";

export {
  reconcileOrphanLight,
  reconcileSettledJobs,
  reconcileMissingFulfillmentJobs,
  backfillMissingFulfillmentItems,
} from "./delivery/reconcile";

export {
  reconcileHandoverWrites,
  readHandoverStamp,
  recordManualHandover,
  recordManualHandoverDetailed,
} from "./delivery/handover";
