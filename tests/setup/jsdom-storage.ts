// tests/setup/jsdom-storage.ts — Shim Web Storage untuk environment jsdom.
//
// Kenapa perlu: Node 26 mempunyai global `localStorage` eksperimental sendiri
// yang hanya aktif bila proses dijalankan dengan `--localstorage-file`. Global
// itu menaungi `window.localStorage` milik jsdom, sehingga di dalam test
// `typeof localStorage === "undefined"` meskipun jsdom sudah berjalan pada
// origin http yang sah. Akibatnya middleware `persist` Zustand langsung
// melempar `Cannot read properties of undefined (reading 'setItem')`.
//
// Shim ini HANYA dipasang bila storage benar-benar tidak ada, dan hanya di
// environment yang punya `window` (test node tidak tersentuh). Implementasinya
// in-memory dan direset antar file test oleh isolasi vitest, jadi tidak ada
// kebocoran state antar test.

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(String(key)) ? String(this.store.get(String(key))) : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(String(key));
  }
  setItem(key: string, value: string): void {
    this.store.set(String(key), String(value));
  }
}

function ensureStorage(name: "localStorage" | "sessionStorage"): void {
  const target = globalThis as unknown as Record<string, unknown>;
  let existing: unknown;
  try {
    existing = target[name];
  } catch {
    existing = undefined; // getter Node bisa melempar tanpa flag CLI
  }
  if (existing && typeof (existing as Storage).setItem === "function") return;

  const storage = new MemoryStorage();
  Object.defineProperty(target, name, {
    value: storage,
    writable: true,
    configurable: true,
  });
  if (typeof window !== "undefined" && window !== (target as unknown as Window)) {
    Object.defineProperty(window, name, { value: storage, writable: true, configurable: true });
  }
}

if (typeof window !== "undefined") {
  ensureStorage("localStorage");
  ensureStorage("sessionStorage");
}
