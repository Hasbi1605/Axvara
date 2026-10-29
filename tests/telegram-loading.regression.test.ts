import { afterEach, expect, it, vi } from "vitest";
import { showLoadingBar } from "@/lib/telegram/api";
import { homeKeyboard, qrisInvoiceKeyboard } from "@/lib/telegram/keyboards";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("animates the existing temporary loading message and deletes it after the final frame", async () => {
  vi.useFakeTimers();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture-only");
  const requests: { method: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ method: url.split("/").at(-1)!, body: JSON.parse(String(init.body)) });
    return Response.json({ ok: true, result: { message_id: 17 } });
  }));
  const loading = showLoadingBar(12345, "📦 Memuat produk");
  await vi.runAllTimersAsync();
  await loading;
  expect(requests.map(r => r.method)).toEqual(["sendMessage", "editMessageText", "editMessageText", "editMessageText", "deleteMessage"]);
  expect(requests.slice(0, 4).map(r => r.body.text)).toEqual([
    "📦 Memuat produk\n░░░░░░░░░░ 0%", "📦 Memuat produk\n▓▓▓▓░░░░░░ 40%",
    "📦 Memuat produk\n▓▓▓▓▓▓▓░░░ 70%", "📦 Memuat produk\n▓▓▓▓▓▓▓▓▓▓ 100%",
  ]);
  expect(requests.at(-1)?.body).toEqual({ chat_id: 12345, message_id: 17 });
});

it("uses one semantic icon with readable navigation labels and unchanged callback routing", () => {
  const home = homeKeyboard().inline_keyboard.flat();
  expect(home.find(b => b.callback_data === "catalog:0")?.text).toBe("🛍 Katalog");
  const refresh = qrisInvoiceKeyboard("AXV-FIXTURE").inline_keyboard.flat().find(b => b.callback_data === "refresh:AXV-FIXTURE");
  expect(refresh?.text).toBe("🔄 Cek Pembayaran");
  for (const button of home) {
    expect((button.text.match(/\p{Extended_Pictographic}/gu) ?? []).length).toBeLessThanOrEqual(1);
    expect(button.text.replace(/\p{Extended_Pictographic}|\uFE0F/gu, "").trim().length).toBeGreaterThan(1);
  }
});
