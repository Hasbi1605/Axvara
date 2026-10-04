// 2026-10-04 darurat kuota D1: digest yang sudah terkirim lengkap tidak boleh
// menjalankan query katalog berat lagi di sisa jendela slot (±36 tick).
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendDueAdminPromoDigest } from "@/lib/telegram/promo-digest";

afterEach(() => vi.unstubAllEnvs());

describe("promo digest — guard murah", () => {
  it("slot sudah terkirim → tanpa queryAll katalog", async () => {
    for (const [k, v] of [["TELEGRAM_PROMO_DIGEST_ENABLED", "true"], ["TELEGRAM_BOT_ENABLED", "true"], ["TELEGRAM_BOT_TOKEN", "t"], ["TELEGRAM_ADMIN_CHAT_ID", "-1"]]) vi.stubEnv(k, v);
    const queryAll = vi.fn(async () => []);
    const db = { queryAll, queryFirst: vi.fn(async () => ({ full_message_id: "1", short_message_id: "2" })), execRun: vi.fn() };
    const res = await sendDueAdminPromoDigest(db as never, new Date("2026-10-04T11:00:00Z")); // 18.00 WIB
    expect(res).toMatchObject({ due: true, complete: true, skipped: "already_sent" });
    expect(queryAll).not.toHaveBeenCalled();
  });
});
