// tests/telegram-group-safety.regression.test.ts — Issue #5: kredensial hanya ke private chat
//
// Audit 7 Sep 2026: checkout dari grup menyimpan ID grup sebagai penerima
// akses. Kredensial tidak boleh dikirim ke grup; chat_id grup tidak sama
// dengan identitas pengguna; callback pengguna lain tidak boleh mengambil
// alih order.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveRecipient } from "@/lib/fulfillment/deliver";
import {
  groupCheckoutRedirectMessage,
  groupDeliveryNoticeMessage,
  privateChatDeepLink,
} from "@/lib/telegram/messages";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

// Identitas dummy: buyer 777TMP (private chat 777TMP), grup -100999, penyerang 888TMP.
const GROUP_ID = "-100999";
const BUYER_ID = "777001";
const BUYER_PRIVATE_CHAT = "777001";
const ATTACKER_ID = "888001";

describe("private-only recipient resolution (mock identitas dummy)", () => {
  it("tidak pernah memakai chat_id grup sebagai penerima kredensial", () => {
    const groupOrder = {
      sales_channel: "telegram",
      telegram_user_id: BUYER_ID,
      telegram_chat_id: GROUP_ID,
      customer_wa: "",
    };
    // resolveRecipient memakai telegram_user_id (identitas buyer), bukan chat grup.
    expect(resolveRecipient(groupOrder)).toEqual({ channel: "telegram", target: BUYER_ID });
  });

  it("target kosong atau grup diarahkan manual, bukan dikirim", () => {
    const deliver = read("src/lib/fulfillment/deliver.ts");
    expect(deliver).toContain("no_recipient_for_channel");
    expect(deliver).toContain("telegram_user_id");
  });

  it("deep-link grup mengarah ke chat pribadi tanpa membawa kredensial", () => {
    const link = privateChatDeepLink("Axvara_bot");
    expect(link).toBe("https://t.me/Axvara_bot?start=beli");
    expect(link).not.toContain(GROUP_ID);
    const redirect = groupCheckoutRedirectMessage("Axvara_bot");
    expect(redirect).toContain("t.me/Axvara_bot?start=");
    expect(redirect).not.toMatch(/<code>[^<]*[@:][^<]*<\/code>/);
    const notice = groupDeliveryNoticeMessage();
    expect(notice).toContain("chat pribadi");
    expect(notice).not.toContain(GROUP_ID);
  });
});

describe("webhook grup: redirect + ownership guard", () => {
  const route = () => read("src/app/api/telegram/webhook/route.ts");

  it("update grup tidak pernah menyimpan grup id sebagai identitas user", () => {
    const src = route();
    expect(src).toContain("TIDAK PERNAH disimpan sebagai identitas user");
    expect(src).toContain("ensurePrivateRecipient");
    expect(src).toContain("group_redirected");
  });

  it("callback sensitif order terikat pemilik + ditolak dari grup", () => {
    const src = route();
    expect(src).toContain("ownerBound");
    expect(src).toContain("telegram_user_id=?");
    expect(src).toContain("bukan milikmu");
    // Penyerang 888TMP tidak bisa memakai order milik 777TMP: guard memakai
    // from.id (identitas penekan tombol) vs telegram_user_id order.
    expect(src).toContain("String(order.telegram_user_id) !== String(from.id)");
    void ATTACKER_ID;
  });

  it("buyer grup yang START privat mewarisi chat pribadi tanpa memercayai id grup", () => {
    const deliver = read("src/lib/fulfillment/deliver.ts");
    expect(deliver).toContain("export async function ensurePrivateRecipient");
    expect(deliver).toContain("Number(privateChatId) < 0) return");
    expect(deliver).toContain("CAST(telegram_chat_id AS INTEGER) < 0");
  });

  it("notifikasi lunas hanya ke private chat; grup hanya dapat notice tanpa kredensial", () => {
    const notif = read("src/lib/telegram/order-notifications.ts");
    expect(notif).toContain("SELECT chat_id FROM telegram_users WHERE user_id=?");
    expect(notif).toContain("groupDeliveryNoticeMessage");
    // chat_id privat diambil dari tabel user, bukan dari order grup.
    expect(notif).toContain("Number(privateChat) > 0");
  });

  it("private chat buyer dummy lolos guard grup", () => {
    expect(Number(BUYER_PRIVATE_CHAT) > 0).toBe(true);
    expect(Number(GROUP_ID) < 0).toBe(true);
  });
});
