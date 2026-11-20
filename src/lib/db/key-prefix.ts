// src/lib/db/key-prefix.ts — indexable TEXT key-namespace predicates.
//
// SQLite's default LIKE is case-insensitive, so `col LIKE 'prefix%'` cannot use
// a BINARY index on that column and degrades to a full SCAN. Audited hot paths
// (buyer_notice_log sweeps) therefore filter by a byte range instead
// (`col >= prefix AND col < prefix+1`) which SEARCHes the primary-key index.
// Keys in these namespaces are ASCII, so incrementing the last code unit gives
// the exclusive upper bound of the prefix.

export function keyPrefixRange(prefix: string): { start: string; end: string } {
  if (!prefix) throw new Error("invalid_key_prefix");
  const last = prefix.charCodeAt(prefix.length - 1);
  if (!Number.isInteger(last) || last >= 0xffff) throw new Error("invalid_key_prefix");
  return { start: prefix, end: `${prefix.slice(0, -1)}${String.fromCharCode(last + 1)}` };
}
