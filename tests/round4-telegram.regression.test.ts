// Audit ronde 4 (2026-09-24) — dua temuan Telegram yang terbukti.
//
// T-M4: router memanggil handler `wa_after_paid` PERTAMA untuk semua teks
// non-slash, jadi tombol menu persisten dibalas "Nomor WA tidak valid" dan
// pembeli terjebak sampai /start.
// T-M3: label tombol `(harga/1000).toFixed(0)` membulatkan harga ke atas.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  sendPhoto: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  answerCallbackQuery: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  editMessageText: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  showLoadingBar: vi.fn(async () => {}),
  sendChatAction: vi.fn(async () => ({ ok: true })),
}));

import { sendMessage } from "@/lib/telegram/api";
import { handleCommand } from "@/lib/telegram/handlers/command";
import { buttonPrice, MENU_LABEL_CATALOG, MENU_LABEL_SEARCH } from "@/lib/telegram/keyboards";
import { invalidWhatsAppMessage } from "@/lib/telegram/messages";

describe("T-M3: label harga tombol tidak lagi membulatkan", () => {
  it("ribuan tepat tetap ringkas, selain itu nominal utuh", () => {
    expect(buttonPrice(89_000)).toBe("Rp89rb");
    expect(buttonPrice(7_500)).toBe("Rp7.500");
    expect(buttonPrice(1_500)).toBe("Rp1.500");
    expect(buttonPrice(14_999)).toBe("Rp14.999");
    expect(buttonPrice(500)).toBe("Rp500");
  });
});

describe("T-M4: pending wa_after_paid tidak menelan tombol menu", () => {
  const CODE = "AXV-20260924-WAPAID01";
  const from = { id: 4242, first_name: "Budi" };
  let fx: ReturnType<typeof createD1Fixture>;

  beforeEach(() => {
    fx = createD1Fixture();
    vi.clearAllMocks();
    vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
    fx.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,telegram_user_id,telegram_chat_id)
      VALUES (?,?,?,'[]',10000,'qris','lunas','paid','telegram','4242','4242')`).run(CODE, "Budi", "");
    fx.sql.prepare("INSERT INTO telegram_users(user_id, chat_id, pending_action) VALUES('4242','4242',?)")
      .run(`wa_after_paid:${CODE}`);
  });
  afterEach(() => { fx.close(); vi.unstubAllEnvs(); });

  const pending = () =>
    (fx.sql.prepare("SELECT pending_action AS p FROM telegram_users WHERE user_id='4242'").get() as { p: string | null }).p;
  const repliedInvalidWa = () =>
    vi.mocked(sendMessage).mock.calls.some(([params]) => params.text === invalidWhatsAppMessage());

  it.each([MENU_LABEL_CATALOG, MENU_LABEL_SEARCH])("tombol menu %s dijalankan, bukan dibalas 'Nomor WA tidak valid'", async (label) => {
    await handleCommand(label, 4242, "private", from);
    expect(repliedInvalidWa()).toBe(false);
    expect(vi.mocked(sendMessage)).toHaveBeenCalled();
    // Handler menu membersihkan state lama (Cari lalu memasang `search:`).
    expect(pending()).not.toBe(`wa_after_paid:${CODE}`);
  });

  it("nomor WA yang valid tetap tersimpan seperti sebelumnya", async () => {
    await handleCommand("0812 3456 7890", 4242, "private", from);
    expect(repliedInvalidWa()).toBe(false);
    expect((fx.sql.prepare("SELECT customer_wa AS wa FROM orders WHERE code=?").get(CODE) as { wa: string }).wa).toBe("6281234567890");
    expect(pending()).toBeNull();
  });

  it("nomor yang salah ketik tetap dijawab 'tidak valid' dan state dipertahankan", async () => {
    await handleCommand("0812-34", 4242, "private", from);
    expect(repliedInvalidWa()).toBe(true);
    expect(pending()).toBe(`wa_after_paid:${CODE}`);
  });
});
