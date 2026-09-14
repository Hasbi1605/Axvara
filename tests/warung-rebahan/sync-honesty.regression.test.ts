// tests/warung-rebahan/sync-honesty.regression.test.ts
//
// Dua kontrak:
//  1. Force Sync tidak boleh memberi "sukses palsu". Route dulu selalu
//     membalas {ok:true}, sehingga admin melihat "Sync selesai" walau seluruh
//     katalog gagal atau berhenti di batas budget. Status harus dibedakan:
//     success / partial / failed.
//  2. Migrasi 0030 menambahkan admin_description_override ke DB production
//     lama dan aman dijalankan pada DB yang sudah memilikinya.
import fs from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "../helpers/d1-fixture";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => {
    exec: (sql: string) => void;
    prepare: (sql: string) => { run: (...p: unknown[]) => unknown; get: (...p: unknown[]) => Record<string, unknown> | undefined; all: (...p: unknown[]) => Record<string, unknown>[] };
    close: () => void;
  };
};

let fixture: ReturnType<typeof createD1Fixture>;

async function adminSyncRequest() {
  const { createAdminToken, createIdleToken } = await import("@/lib/auth");
  const { NextRequest } = await import("next/server");
  const { token, sid } = await createAdminToken("admin@axvara.tech");
  const idle = await createIdleToken(sid);
  return new NextRequest("http://localhost/api/admin/warung/sync", {
    method: "POST",
    headers: { cookie: `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(idle)}` },
  });
}

beforeEach(() => {
  fixture = createD1Fixture();
  vi.stubEnv("ADMIN_EMAIL", "admin@axvara.tech");
  vi.stubEnv("ADMIN_JWT_SECRET", "test-secret-sync-honesty");
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
});

afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Force Sync melaporkan status apa adanya", () => {
  it("sync yang seluruhnya gagal TIDAK dilaporkan ok:true", async () => {
    vi.doMock("@/lib/warung-rebahan/sync", () => ({
      syncProducts: async () => ({
        total: 5, synced: 0, excluded: 0, newProducts: 0, newVariants: 0,
        variantsSynced: 0, stockChanges: 0, priceChanges: 0,
        errors: ["wr_http_502"], durationMs: 12, budgetYielded: false, snapshotComplete: false,
      }),
    }));
    const { POST } = await import("@/app/api/admin/warung/sync/route");
    const res = await POST(await adminSyncRequest());
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(body.ok).toBe(false);
    expect(body.errors).toContain("wr_http_502");
  });

  it("sync sebagian (ada error tapi ada yang tersimpan) berstatus partial", async () => {
    vi.doMock("@/lib/warung-rebahan/sync", () => ({
      syncProducts: async () => ({
        total: 5, synced: 3, excluded: 0, newProducts: 1, newVariants: 2,
        variantsSynced: 4, stockChanges: 1, priceChanges: 0,
        errors: ["prod-x: D1_ERROR"], durationMs: 30, budgetYielded: false, snapshotComplete: false,
      }),
    }));
    const { POST } = await import("@/app/api/admin/warung/sync/route");
    const body = await (await POST(await adminSyncRequest())).json();
    expect(body.status).toBe("partial");
  });

  it("berhenti karena budget juga partial, bukan sukses penuh", async () => {
    vi.doMock("@/lib/warung-rebahan/sync", () => ({
      syncProducts: async () => ({
        total: 48, synced: 12, excluded: 0, newProducts: 0, newVariants: 0,
        variantsSynced: 20, stockChanges: 3, priceChanges: 1,
        errors: [], durationMs: 40, budgetYielded: true, snapshotComplete: false,
      }),
    }));
    const { POST } = await import("@/app/api/admin/warung/sync/route");
    const body = await (await POST(await adminSyncRequest())).json();
    expect(body.status).toBe("partial");
    expect(body.ok).toBe(true);
  });

  it("sweep tuntas tanpa error berstatus success", async () => {
    vi.doMock("@/lib/warung-rebahan/sync", () => ({
      syncProducts: async () => ({
        total: 48, synced: 48, excluded: 0, newProducts: 0, newVariants: 0,
        variantsSynced: 80, stockChanges: 0, priceChanges: 0,
        errors: [], durationMs: 55, budgetYielded: false, snapshotComplete: true,
      }),
    }));
    const { POST } = await import("@/app/api/admin/warung/sync/route");
    const body = await (await POST(await adminSyncRequest())).json();
    expect(body.status).toBe("success");
    expect(body.ok).toBe(true);
  });
});

describe("migrasi 0030 admin_description_override", () => {
  function createPre0030Database() {
    const schema = fs.readFileSync("drizzle/schema.sql", "utf8");
    const snippet = `  -- Migrasi 0030: deskripsi milik admin. NULL = pakai \`description\` (milik WR).
  -- Sync WR tidak pernah menulis kolom ini.
  admin_description_override TEXT,
`;
    if (!schema.includes(snippet)) throw new Error("snippet 0030 tidak ditemukan di schema.sql");
    const sql = new DatabaseSync(":memory:");
    sql.exec(schema.replace(snippet, ""));
    sql.exec("DELETE FROM product_variants; DELETE FROM products;");
    return sql;
  }

  it("menambah kolom pada DB lama tanpa menyentuh deskripsi yang ada", () => {
    const sql = createPre0030Database();
    try {
      sql.prepare("INSERT INTO products(id,name,slug,description,price,stock) VALUES(1,'Lama','lama','Deskripsi lama',1000,5)").run();
      sql.exec(fs.readFileSync("drizzle/migrations/0030_wr_admin_ownership.sql", "utf8"));
      const row = sql.prepare("SELECT description, admin_description_override FROM products WHERE id=1").get() as {
        description: string; admin_description_override: string | null;
      };
      expect(row.description).toBe("Deskripsi lama");
      expect(row.admin_description_override).toBeNull();
    } finally { sql.close(); }
  });

  it("schema.sql bootstrap sudah setara migrasi (kolom tersedia tanpa migrasi manual)", () => {
    const columns = fixture.sql.prepare("PRAGMA table_info(products)").all() as { name: string }[];
    expect(columns.map((c) => c.name)).toContain("admin_description_override");
  });
});
