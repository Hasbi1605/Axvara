// Darurat kuota D1: slot promo yang sudah di-enqueue tidak boleh
// menjalankan query katalog berat lagi di sisa jendela slot (±180 tick).
import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueueDueTelegramPromo, promoCampaignId } from "@/lib/telegram/promo-broadcast";

afterEach(() => vi.unstubAllEnvs());

describe("telegram promo broadcast — guard murah", () => {
  it("slot sudah di-enqueue → tanpa queryAll katalog", async () => {
    for (const [k, v] of [["TELEGRAM_BOT_ENABLED", "true"], ["TELEGRAM_BOT_TOKEN", "t"]]) vi.stubEnv(k, v);
    const queryAll = vi.fn(async () => []);
    const db = {
      d1: {} as never,
      getD1: () => ({}) as never,
      isD1Mode: () => true,
      canSpend: () => true,
      queryAll,
      queryFirst: vi.fn(async () => ({ enabled: null, campaign_status: "queued" })),
      execRun: vi.fn(),
    };
    const res = await enqueueDueTelegramPromo(db as never, new Date("2026-10-04T11:00:00Z")); // 18.00 WIB
    expect(res).toMatchObject({
      due: true,
      enqueued: 0,
      campaignId: promoCampaignId("2026-10-04", "evening"),
      skipped: "already_enqueued",
    });
    expect(queryAll).not.toHaveBeenCalled();
  });
});
