// Paginasi katalog kadang memunculkan pesan katalog BARU (laporan owner
// 24 Sep + screenshot): `safeEditOrSend` dulu mengirim pesan baru untuk
// kegagalan edit APA PUN. Ketuk ▶️ dua kali cepat = dua callback halaman yang
// sama → edit kedua ditolak "message is not modified" → pesan baru.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeEditOrSend } from "@/lib/telegram/api";

type TgReply = { ok: boolean; error_code?: number; description?: string; result?: unknown };
let editReply: TgReply | Error;
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const method = String(url).split("/").pop() ?? "";
    calls.push(method);
    if (method === "editMessageText") {
      if (editReply instanceof Error) throw editReply;
      return { json: async () => editReply };
    }
    return { json: async () => ({ ok: true, result: { message_id: 2 } }) };
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const edit = () => safeEditOrSend({ chat_id: 1, message_id: 10, text: "Katalog", parse_mode: "HTML" });

describe("safeEditOrSend tidak membuat pesan ganda", () => {
  it("'message is not modified' (ketuk ganda) = berhasil, tanpa pesan baru", async () => {
    editReply = { ok: false, error_code: 400, description: "Bad Request: message is not modified: specified new message content and reply markup are exactly the same" };
    expect((await edit()).ok).toBe(true);
    expect(calls).toEqual(["editMessageText"]);
  });

  it("rate limit 429: tidak mengirim pesan baru", async () => {
    editReply = { ok: false, error_code: 429, description: "Too Many Requests: retry after 3" };
    expect((await edit()).ok).toBe(false);
    expect(calls).toEqual(["editMessageText"]);
  });

  it("timeout/jaringan (edit mungkin sudah mendarat): tidak mengirim pesan baru", async () => {
    editReply = new Error("network down");
    await edit();
    expect(calls).toEqual(["editMessageText"]);
  });

  it("pesan target berupa foto (tak bisa diedit sebagai teks): tetap kirim pesan baru", async () => {
    editReply = { ok: false, error_code: 400, description: "Bad Request: there is no text in the message to edit" };
    expect((await edit()).ok).toBe(true);
    expect(calls).toEqual(["editMessageText", "sendMessage"]);
  });
});
