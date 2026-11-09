import { createD1Fixture, insertTestOrder, insertTestProduct } from "./d1-fixture";

export type GamesFixture = ReturnType<typeof createD1Fixture>;

/** Env Digiflazz + proxy lengkap (panggil di beforeEach; bersihkan dengan vi.unstubAllEnvs). */
export const gamesEnv = (stub: (name: string, value: string) => void) => {
  stub("DIGIFLAZZ_USERNAME", "demouser");
  stub("DIGIFLAZZ_API_KEY", "dev-key");
  stub("DIGIFLAZZ_TESTING", "");
  stub("WARUNG_REBAHAN_PROXY_URL", "https://proxy.test");
  stub("WARUNG_REBAHAN_PROXY_TOKEN", "tok");
};

export async function seedGamesProduct(fx: GamesFixture, over: Partial<{
  backup_sku_code: string | null; backup_cost: number | null; backup_seller_active: number;
}> = {}) {
  await insertTestProduct(fx.sql); // products id 1 + variant 1 untuk FK orders
  const p = { backup_sku_code: "ml86b", backup_cost: 20000, backup_seller_active: 1, ...over };
  fx.sql.prepare(`INSERT INTO games_products(id,buyer_sku_code,backup_sku_code,product_name,cost,backup_cost,seller_active,backup_seller_active,sell_price,enabled)
    VALUES(1,'ml86',?,'ML 86',19000,?,1,?,21000,1)`).run(p.backup_sku_code, p.backup_cost, p.backup_seller_active);
}

/** Satu pesanan Games. `paid` → orders lunas/paid; item mulai `awaiting_payment` kecuali `itemStatus`. */
export function seedGamesOrder(fx: GamesFixture, code: string, o: {
  paid?: boolean; orderStatus?: string; itemStatus?: string; attemptNo?: number; maxPrice?: number;
} = {}) {
  insertTestOrder(fx.sql, code, { channel: "web", status: o.paid === false ? "pending" : "lunas" });
  if (o.orderStatus) {
    fx.sql.prepare("UPDATE orders SET status=?, payment_status=? WHERE code=?").run(o.orderStatus, o.orderStatus === "lunas" ? "paid" : "expired", code);
  }
  fx.sql.prepare(`INSERT INTO games_order_items(order_code,product_id,buyer_sku_code,customer_no,unit_price,total,cost_snapshot,max_price,status,attempt_no)
    VALUES(?,1,'ml86','12345(6789)',21000,21000,19000,?,?,?)`).run(code, o.maxPrice ?? 21000, o.itemStatus ?? "awaiting_payment", o.attemptNo ?? 1);
}

export const itemRow = (fx: GamesFixture, code: string) =>
  fx.sql.prepare("SELECT * FROM games_order_items WHERE order_code=?").get(code) as Record<string, unknown>;
export const attemptRows = (fx: GamesFixture, code: string) =>
  fx.sql.prepare("SELECT * FROM games_dispatch_attempts WHERE order_code=? ORDER BY attempt_no").all(code) as Record<string, unknown>[];

export const txReply = (ref_id: string, status: "Sukses" | "Pending" | "Gagal", extra: Record<string, unknown> = {}, http = 200) =>
  new Response(JSON.stringify({ data: {
    ref_id, status, rc: status === "Sukses" ? "00" : status === "Pending" ? "03" : "02", message: `msg ${status}`,
    sn: status === "Sukses" ? "SN-123" : "", price: 19000, buyer_sku_code: "ml86", customer_no: "12345(6789)", ...extra,
  } }), { status: http });
