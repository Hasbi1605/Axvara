import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBudgetedDatabase, createDatabaseAccess, QueryBudgetExceeded } from "@/lib/db-access";
import { checkCopyReviewChanges } from "@/lib/product-copy/review-alert";
import { supplierFingerprint } from "@/lib/product-copy/text";
import { sendMessage } from "@/lib/telegram/api";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/lib/telegram/api", () => ({ sendMessage: vi.fn() }));
const checkedKey = "copy_review_checked_at";
const alertedKey = "copy_review_alerted";
const t0 = 1_800_000_000_000;
const windowMs = 30 * 60 * 1000;
let fx: ReturnType<typeof createD1Fixture>;

beforeEach(() => {
  fx = createD1Fixture();
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-1000");
  vi.stubEnv("NOWPAYMENTS_API_KEY", "");
  vi.mocked(sendMessage).mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function seed(id = 1, supplier: "WR" | "SK" = "WR", override = true) {
  const terms = `Supplier terms ${id}`;
  fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock) VALUES(?,?,?,10000,10)")
    .run(id, `Product ${id}`, `product-${id}`);
  fx.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,wr_variant_id,sk_variant_id,admin_terms,admin_copy_fingerprint)
    VALUES(?,?,?,?,10000,10,?,?,?,?)`)
    .run(id, id, `sku-${id}`, `Variant ${id}`, supplier === "WR" ? `wr-${id}` : null,
      supplier === "SK" ? `sk-${id}` : null, override ? "Admin rules" : null, supplierFingerprint("Previous supplier terms", null));
  if (supplier === "WR") {
    fx.sql.prepare("INSERT INTO wr_products(wr_product_id,wr_product_name) VALUES(?,?)").run(`wr-p-${id}`, `Product ${id}`);
    fx.sql.prepare("INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_terms) VALUES(?,?,?,10000,?)")
      .run(`wr-${id}`, `wr-p-${id}`, `Variant ${id}`, terms);
  } else {
    fx.sql.prepare("INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_description) VALUES(?,?,?,?,10000,?)")
      .run(`sk-${id}`, `sk-p-${id}`, `Product ${id}`, `Variant ${id}`, terms);
  }
  return supplierFingerprint(terms, null);
}
function setting(key: string) {
  return fx.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(key)?.value;
}
function setSetting(key: string, value: string) {
  fx.sql.prepare("INSERT OR REPLACE INTO store_settings(key,value) VALUES(?,?)").run(key, value);
}
const run = (now = t0) => checkCopyReviewChanges(createDatabaseAccess(fx.db), now);

describe("copy review Telegram alerts", () => {
  it("alerts changed WR overrides + reviewed SK text in one message and <=4 statements, ignoring raw/inactive/archived/manual variants", async () => {
    const wrKey = seed();
    const skKey = seed(2, "SK", false);
    for (let id = 3; id <= 7; id++) seed(id);
    fx.sql.exec(`UPDATE product_variants SET admin_terms=NULL,admin_copy_fingerprint=NULL WHERE id=3;
      UPDATE product_variants SET is_active=0 WHERE id=4;
      UPDATE products SET is_active=0 WHERE id=5;
      UPDATE products SET is_active=0,archived_at=datetime('now') WHERE id=6;
      UPDATE product_variants SET wr_variant_id=NULL WHERE id=7;`);
    const b = createBudgetedDatabase(4, 0, fx.db);
    const reads = vi.spyOn(b.access, "queryAll");
    vi.mocked(sendMessage).mockImplementationOnce(async () => {
      expect(setting(alertedKey)).toBeUndefined(); // persist additions only after success
      return { ok: true };
    });
    expect(await checkCopyReviewChanges(b.access, t0)).toEqual({ checked: true, changed: 2, alerted: 2 });
    expect(b.used).toBe(4);
    expect(reads).toHaveBeenCalledTimes(2); // settings + one joined variants SELECT
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({
      chat_id: "-1000", disable_web_page_preview: true,
      text: "⚠️ Teks supplier berubah — S&K perlu ditinjau (2 varian)\n• Product 1 — Variant 1 (WR)\n• Product 2 — Variant 2 (SK)\nVarian yang sudah kamu sunting tetap menampilkan suntinganmu ke pembeli. Tinjau di admin: Produk → filter Tinjauan S&K.\nhttps://axvara.tech/admin?section=products",
    });
    expect(JSON.parse(String(setting(alertedKey)))).toEqual({ 1: wrKey, 2: skKey });
    expect(setting(checkedKey)).toBe(new Date(t0).toISOString());
  });

  it("skips within 30 minutes, then checks without re-alerting the same supplierKey", async () => {
    seed();
    await run();
    expect(await run(t0 + windowMs - 1)).toEqual({ checked: false, skipped: "interval" });
    const b = createBudgetedDatabase(4, 0, fx.db);
    expect(await checkCopyReviewChanges(b.access, t0 + windowMs)).toEqual({ checked: true, changed: 1, alerted: 0 });
    expect(b.used).toBe(3);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("re-alerts only the variant whose supplierKey changes again", async () => {
    seed(); seed(2, "SK", false);
    await run();
    fx.sql.exec("UPDATE sk_products SET sk_seller_note='New activation instructions' WHERE sk_variant_id='sk-2'");
    expect(await run(t0 + windowMs)).toEqual({ checked: true, changed: 2, alerted: 1 });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendMessage).mock.calls[1][0].text).toContain("(1 varian)\n• Product 2 — Variant 2 (SK)");
    expect(JSON.parse(String(setting(alertedKey)))[2]).toBe(supplierFingerprint("Supplier terms 2", "New activation instructions"));
  });

  it("prunes fixed, deactivated, archived and deleted variants without sending; allows a later change to alert again", async () => {
    const key = seed();
    seed(2); seed(3); seed(4);
    await run();
    fx.sql.prepare("UPDATE product_variants SET admin_copy_fingerprint=? WHERE id=1").run(key);
    fx.sql.exec("UPDATE product_variants SET is_active=0 WHERE id=2; UPDATE products SET is_active=0,archived_at=datetime('now') WHERE id=3; DELETE FROM product_variants WHERE id=4;");
    expect(await run(t0 + windowMs)).toEqual({ checked: true, changed: 0, alerted: 0 });
    expect(setting(alertedKey)).toBe("{}");
    expect(sendMessage).toHaveBeenCalledTimes(1);
    fx.sql.exec("UPDATE wr_variants SET wr_terms='Updated after review' WHERE wr_variant_id='wr-1'");
    expect(await run(t0 + 2 * windowMs)).toEqual({ checked: true, changed: 1, alerted: 1 });
  });

  it.each(["rejected", "throws"])("Telegram %s leaves the entire map unchanged and retries next window", async (failure) => {
    seed();
    const previousMap = JSON.stringify({ 99: "obsolete-but-not-yet-pruned" });
    setSetting(alertedKey, previousMap);
    if (failure === "throws") vi.mocked(sendMessage).mockRejectedValueOnce(new Error("outage"));
    else vi.mocked(sendMessage).mockResolvedValueOnce({ ok: false });
    expect(await run()).toEqual({ checked: true, changed: 1, alerted: 0, error: "telegram_failed" });
    expect(setting(alertedKey)).toBe(previousMap);
    expect(await run(t0 + 1)).toEqual({ checked: false, skipped: "interval" });
    expect(await run(t0 + windowMs)).toEqual({ checked: true, changed: 1, alerted: 1 });
    expect(JSON.parse(String(setting(alertedKey)))).toEqual({ 1: supplierFingerprint("Supplier terms 1", null) });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("skips before any DB work when fewer than four statements remain", async () => {
    seed();
    const b = createBudgetedDatabase(5, 2, fx.db);
    expect(await checkCopyReviewChanges(b.access, t0)).toEqual({ checked: false, skipped: "query_budget" });
    expect(b.used).toBe(0);
    expect(setting(checkedKey)).toBeUndefined();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("caps at 15 literal name lines plus +M lainnya and stays below Telegram's message limit", async () => {
    for (let id = 1; id <= 18; id++) seed(id, "SK", false);
    fx.sql.prepare("UPDATE products SET name=? WHERE id=1").run("<b>A&B</b>\nNew line " + "x".repeat(500));
    fx.sql.prepare("UPDATE product_variants SET label=? WHERE id=1").run("_[unsafe] <label> " + "y".repeat(500));
    expect(await run()).toEqual({ checked: true, changed: 18, alerted: 18 });
    const message = vi.mocked(sendMessage).mock.calls[0][0];
    expect(message.parse_mode).toBeUndefined();
    expect(message.text).toContain("(18 varian)");
    expect(message.text).toContain("• <b>A&B</b> New line");
    expect(message.text.match(/^• /gm)).toHaveLength(15);
    expect(message.text).toContain("\n+3 lainnya\n");
    expect(message.text.length).toBeLessThanOrEqual(4096);
    expect(Object.keys(JSON.parse(String(setting(alertedKey))))).toHaveLength(18);
  });

  it.each([false, true])("CAS permits one sender when concurrent runs see the same checkpoint (existing=%s)", async (exists) => {
    seed();
    if (exists) setSetting(checkedKey, new Date(t0 - windowMs).toISOString());
    const results = await Promise.all([run(), run()]);
    expect(results.filter(result => result.checked)).toHaveLength(1);
    expect(results).toContainEqual({ checked: false, skipped: "claimed" });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it.each(["false", "no-chat"])("disabled Telegram (%s) is a quiet no-op", async (mode) => {
    if (mode === "no-chat") vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", " ");
    else vi.stubEnv("TELEGRAM_BOT_ENABLED", mode);
    expect(await run()).toEqual({ checked: false, skipped: "telegram_disabled" });
    expect(fx.control.queries).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each(["null", "[]", '{"1":5}', "broken-json"])("invalid persisted dedupe state (%s) never throws or sends", async (raw) => {
    seed(); setSetting(alertedKey, raw);
    expect(await run()).toMatchObject({ checked: false, error: expect.any(String) });
    expect(setting(alertedKey)).toBe(raw);
    expect(setting(checkedKey)).toBeUndefined();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("isolates a SELECT failure after claiming, preserving the map and retrying next window", async () => {
    seed(); setSetting(alertedKey, "{}");
    fx.control.fail = query => query.includes("FROM product_variants");
    expect(await run()).toEqual({ checked: true, error: "check_failed" });
    expect(setting(alertedKey)).toBe("{}");
    expect(sendMessage).not.toHaveBeenCalled();
    fx.control.fail = null;
    expect(await run(t0 + windowMs)).toMatchObject({ checked: true, alerted: 1 });
  });

  it("catches an unexpected query-budget exception without leaking it to cron", async () => {
    const db = createDatabaseAccess(fx.db);
    vi.spyOn(db, "queryAll").mockRejectedValueOnce(new QueryBudgetExceeded());
    expect(await checkCopyReviewChanges(db, t0)).toEqual({ checked: false, error: "query_budget" });
  });
});

describe("cron lite cleanup integration", () => {
  async function cleanup() {
    vi.stubEnv("CRON_SECRET", "fixture-secret");
    const { POST } = await import("@/app/api/cron/lite/route");
    const { NextRequest } = await import("next/server");
    const res = await POST(new NextRequest("http://localhost/api/cron/lite?job=cleanup", {
      method: "POST", headers: { authorization: "Bearer fixture-secret" },
    }));
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  }

  it("runs the alert on the existing cleanup job and returns its small log status", async () => {
    seed();
    const result = await cleanup();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, job: "cleanup", pairs_decided: expect.any(Number),
      copy_review: { checked: true, changed: 1, alerted: 1 } });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("alert database failure does not fail cleanup or its success checkpoint", async () => {
    seed();
    fx.control.fail = (query, params) => query.includes("SELECT key, value") && params.includes(checkedKey);
    const result = await cleanup();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, job: "cleanup", copy_review: { checked: false, error: "check_failed" } });
    expect(setting("cron_lite_cleanup_ok_at")).toBeTruthy();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
