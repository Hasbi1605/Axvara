import { afterEach, expect, it, vi } from "vitest";
import { safeEditOrSend, withLoadingIndicator } from "@/lib/telegram/api";
import { homeKeyboard, qrisInvoiceKeyboard } from "@/lib/telegram/keyboards";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function transport() {
  vi.useFakeTimers();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture-only");
  const requests: { method: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ method: url.split("/").at(-1)!, body: JSON.parse(String(init.body)) });
    return Response.json({ ok: true, result: { message_id: 17 } });
  }));
  return requests;
}

it("starts real work immediately and skips the bubble for fast work", async () => {
  const requests = transport();
  const work = vi.fn(async () => 42);
  const result = withLoadingIndicator(12345, "📦 Memuat produk", work);
  expect(work).toHaveBeenCalledOnce();
  expect(await result).toBe(42);
  await vi.runAllTimersAsync();
  expect(requests).toEqual([]);
});

it("animates one bubble with bounded edits only while work is pending, then deletes it", async () => {
  const requests = transport();
  let finish!: (value: number) => void;
  const loading = withLoadingIndicator(12345, "📦 Memuat produk", () => new Promise<number>(resolve => { finish = resolve; }));
  await vi.advanceTimersByTimeAsync(15000);
  expect(requests.map(r => r.method)).toEqual(["sendMessage", "editMessageText", "editMessageText", "editMessageText"]);
  expect(requests.map(r => r.body.text)).toEqual([
    "📦 Memuat produk\n● ○ ○", "📦 Memuat produk\n○ ● ○", "📦 Memuat produk\n○ ○ ●", "📦 Memuat produk\nMasih memuat…",
  ]);
  finish(42);
  expect(await loading).toBe(42);
  expect(requests.at(-1)).toEqual({ method: "deleteMessage", body: { chat_id: 12345, message_id: 17 } });
  expect(vi.getTimerCount()).toBe(0);
});

it("cleans up when work fails and preserves the original error", async () => {
  const requests = transport();
  let fail!: (reason: Error) => void;
  const loading = withLoadingIndicator(12345, "Memuat", () => new Promise((_, reject) => { fail = reject; }));
  const assertion = expect(loading).rejects.toThrow("data unavailable");
  await vi.advanceTimersByTimeAsync(400);
  fail(new Error("data unavailable"));
  await assertion;
  expect(requests.at(-1)?.method).toBe("deleteMessage");
  expect(vi.getTimerCount()).toBe(0);
});

it("failed animation transport cannot prevent results", async () => {
  transport();
  vi.mocked(fetch).mockRejectedValue(new Error("offline"));
  const loading = withLoadingIndicator(12345, "Memuat", async () => {
    await new Promise(resolve => setTimeout(resolve, 600));
    return 42;
  });
  await vi.advanceTimersByTimeAsync(600);
  expect(await loading).toBe(42);
  expect(vi.getTimerCount()).toBe(0);
});

it("aborts an in-flight animation edit when work finishes", async () => {
  transport();
  let finish!: (value: number) => void;
  let aborted = false;
  vi.mocked(fetch).mockImplementationOnce(async () => Response.json({ ok: true, result: { message_id: 17 } }))
    .mockImplementationOnce(async (_url, init) => new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("aborted", "AbortError")); });
    }));
  const loading = withLoadingIndicator(12345, "Memuat", () => new Promise<number>(resolve => { finish = resolve; }));
  await vi.advanceTimersByTimeAsync(1500);
  finish(42);
  expect(await loading).toBe(42);
  expect(aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("sends directly when no editable message exists", async () => {
  const requests = transport();
  await safeEditOrSend({ chat_id: 12345, message_id: 0, text: "Jumlah: 2" });
  expect(requests.map(r => r.method)).toEqual(["sendMessage"]);
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
