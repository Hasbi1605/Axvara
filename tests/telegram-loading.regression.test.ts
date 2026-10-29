import { afterEach, expect, it, vi } from "vitest";
import { showLoadingBar, withLoadingIndicator } from "@/lib/telegram/api";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function transport(failedEdit = false) {
  vi.useFakeTimers();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture-only");
  const requests: { method: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const method = url.split("/").at(-1)!;
    requests.push({ method, body: JSON.parse(String(init.body)) });
    return Response.json({ ok: !(failedEdit && method === "editMessageText"), result: { message_id: 17 } });
  }));
  return requests;
}

it.each(["🚀 Menyiapkan AXVARA", "📦 Memuat produk", "💳 Memuat QRIS pembayaran"])("restores original percentage frames and deletion for %s", async label => {
  const requests = transport();
  const loading = showLoadingBar(12345, label);
  await vi.runAllTimersAsync();
  await loading;
  expect(requests.map(r => r.method)).toEqual(["sendMessage", "editMessageText", "editMessageText", "editMessageText", "deleteMessage"]);
  expect(requests.slice(0, 4).map(r => r.body.text)).toEqual([
    `${label}\n░░░░░░░░░░ 0%`, `${label}\n▓▓▓▓░░░░░░ 40%`,
    `${label}\n▓▓▓▓▓▓▓░░░ 70%`, `${label}\n▓▓▓▓▓▓▓▓▓▓ 100%`,
  ]);
  expect(requests.at(-1)?.body).toEqual({ chat_id: 12345, message_id: 17 });
});

it("finishes and deletes the old animation before publishing welcome/product", async () => {
  const requests = transport();
  const work = vi.fn(async beforeResult => { await beforeResult(); return 42; });
  const loading = withLoadingIndicator(12345, "Memuat", work);
  expect(work).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1599);
  expect(work).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await loading).toBe(42);
  expect(requests.at(-1)?.method).toBe("deleteMessage");
});

it("cleans up a rejected edit and continues real work", async () => {
  const requests = transport(true);
  const loading = withLoadingIndicator(12345, "Memuat", async () => 42);
  await vi.runAllTimersAsync();
  expect(await loading).toBe(42);
  expect(requests.map(r => r.method)).toEqual(["sendMessage", "editMessageText", "deleteMessage"]);
});

it("failed decoration cannot block real work", async () => {
  transport();
  vi.mocked(fetch).mockRejectedValue(new Error("offline"));
  expect(await withLoadingIndicator(12345, "Memuat", async () => 42)).toBe(42);
});
