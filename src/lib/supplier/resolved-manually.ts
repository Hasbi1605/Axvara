/**
 * Shared SQL predicate and flag normalizer for derived manual resolution (MR1/MR2):
 * A non-completed supplier link (TUNVN/StoreBat/Mirai/AIVault) whose matching
 * `fulfillment_items(order_code, item_index)` row is already `delivered` is treated
 * as manually resolved without mutating link rows or adding schema.
 */
export function resolvedManuallySql(linkAlias: string): string {
  return `CASE WHEN ${linkAlias}.status!='completed' AND EXISTS(SELECT 1 FROM fulfillment_items fi WHERE fi.order_code=${linkAlias}.order_code AND fi.item_index=${linkAlias}.item_index AND fi.status='delivered') THEN 1 ELSE 0 END`;
}

export function isResolvedManuallyFlag(value: unknown): boolean {
  return value === true || Number(value) === 1;
}
