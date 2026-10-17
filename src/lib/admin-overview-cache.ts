import { getD1, type D1 } from "@/lib/db";

type Snapshot<T> = { value: T; cacheable: boolean; expiresAt?: number };
type Entry = { expiresAt: number; value: Promise<Snapshot<unknown>> };
const snapshots = new WeakMap<D1, Map<string, Entry>>();
function report(status: "HIT" | "MISS") {
  try { console.info("[overview-cache]", JSON.stringify({ status })); } catch { /* best-effort telemetry */ }
}

/** Private process memory only. Caller MUST authenticate/validate before this.
 * Scope includes admin + canonical period + WIB day/hour. No public Cache API.
 */
export async function readAdminOverviewSnapshot<T>(key: string, load: () => Promise<Snapshot<T>>): Promise<T> {
  const db = getD1();
  if (!db || process.env.NODE_ENV !== "production") return (await load()).value;
  let entries = snapshots.get(db);
  if (!entries) { entries = new Map(); snapshots.set(db, entries); }
  const cached = entries.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    report("HIT");
    return (await cached.value).value as T;
  }
  report("MISS");
  const entry: Entry = { expiresAt: Date.now() + 60_000, value: Promise.resolve().then(load) };
  if (entries.size >= 16) entries.delete(entries.keys().next().value!);
  entries.set(key, entry);
  try {
    const result = await entry.value as Snapshot<T>;
    // A shared financial snapshot can predate this load. Do not extend its TTL.
    if (result.expiresAt != null) entry.expiresAt = Math.min(entry.expiresAt, result.expiresAt);
    if (!result.cacheable && entries.get(key) === entry) entries.delete(key);
    return result.value;
  } catch (error) {
    if (entries.get(key) === entry) entries.delete(key);
    throw error;
  }
}
