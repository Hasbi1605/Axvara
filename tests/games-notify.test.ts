import { afterEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/telegram/api", () => ({ sendMessage: send }));

afterEach(() => { vi.unstubAllEnvs(); send.mockReset(); });

describe("notifyGamesNeedsCheck", () => {
  it("sends an escaped HTML message to the admin chat", async () => {
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "99");
    send.mockResolvedValue({ ok: true });
    const { notifyGamesNeedsCheck } = await import("@/lib/games/notify");
    expect(await notifyGamesNeedsCheck(null, "AXV-G-1", "<b>x</b> & y")).toBe("sent");
    const arg = send.mock.calls[0][0];
    expect(arg).toMatchObject({ chat_id: "99", parse_mode: "HTML" });
    expect(arg.text).toContain("AXV-G-1");
    expect(arg.text).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
  });
  it("is unknown without a chat id and tolerates Telegram failures", async () => {
    const { notifyGamesNeedsCheck } = await import("@/lib/games/notify");
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "");
    expect(await notifyGamesNeedsCheck(null, "A", "r")).toBe("unknown");
    expect(send).not.toHaveBeenCalled();
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "99");
    send.mockRejectedValue(new Error("down"));
    expect(await notifyGamesNeedsCheck(null, "A", "r")).toBe("unknown");
    send.mockResolvedValue({ ok: false, error_code: 403 });
    expect(await notifyGamesNeedsCheck(null, "A", "r")).toBe("rejected");
  });
});
