// tests/whatsapp-buyer-retired.integration.test.ts — Alur pembeli WhatsApp
// dipensiunkan 13 November 2026 (keputusan owner): hard off di kode. Pesan yang
// dulu memicu pencarian/pemesanan/bukti manual dijawab SATU arahan ke website/
// Telegram; percakapan biasa tetap tidak dibalas; perintah admin `.d` dan info
// garansi tetap bekerja.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import { POST as webhook } from "@/app/api/whatsapp/webhook/route";
import { welcomeNewMemberMessage, warrantyMessage } from "@/lib/whatsapp/messages";

vi.mock("@/lib/whatsapp/gateway", async (original) => ({
  ...await original<typeof import("@/lib/whatsapp/gateway")>(),
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "fixture" })),
}));

const groupId = "120363123456789012@g.us";
let fixture: ReturnType<typeof createD1Fixture>;

beforeEach(() => {
  fixture = createD1Fixture();
  vi.stubEnv("WHATSAPP_ENABLED", "true");
  vi.stubEnv("WHATSAPP_WEBHOOK_TOKEN", "fixture");
  vi.stubEnv("WHATSAPP_GROUP_ALLOWLIST", groupId);
  vi.stubEnv("WHATSAPP_GROUP_PAYMENT", "true");
  vi.stubEnv("WHATSAPP_GROUP_DISCOVERY", "true");
  vi.stubEnv("WHATSAPP_PROOF_INTAKE", "true");
});
afterEach(async () => {
  fixture.close();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

let counter = 0;
function message(body: Record<string, unknown>) {
  counter += 1;
  return new NextRequest("http://localhost/api/whatsapp/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-token": "fixture" },
    body: JSON.stringify({ sender: groupId, member: "628123456789", name: "THNS", isGroup: true, inboxid: `retired-${counter}`, ...body }),
  });
}
const sent = async () => (await import("@/lib/whatsapp/gateway")).sendTextMessage as unknown as ReturnType<typeof vi.fn>;

describe("alur pembeli WhatsApp dipensiunkan", () => {
  it.each([
    ["list"],
    ["list 2"],
    ["cari chatgpt"],
    ["pay"],
    ["payment"],
    ["QRIS"],
    ["seabank"],
  ])("menjawab satu arahan untuk pesan %s meski env flag lama masih true", async (text) => {
    const res = await webhook(message({ message: text }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "buyer_flows_retired" });
    const send = await sent();
    expect(send).toHaveBeenCalledTimes(1);
    const copy = String(send.mock.calls[0][0].message);
    expect(copy).toContain("axvara.tech");
    expect(copy).toContain("Telegram");
    expect(copy).toContain("Pesanan lama tetap diproses");
    // Tidak ada order/sesi baru dari grup.
    expect(fixture.sql.prepare("SELECT count(*) AS n FROM orders").get()!.n).toBe(0);
  });

  it.each([["15000"], ["1"]])("tidak membalas angka biasa %s di obrolan grup (anti-spam)", async (text) => {
    const res = await webhook(message({ message: text }));
    expect(await res.json()).toEqual({ ok: true });
    expect(await sent()).not.toHaveBeenCalled();
    expect(fixture.sql.prepare("SELECT count(*) AS n FROM orders").get()!.n).toBe(0);
  });

  it("bukti pembayaran (media) dijawab arahan, bukan diproses", async () => {
    const res = await webhook(message({ message: "QRIS", url: "https://media.example/proof.jpg" }));
    expect(await res.json()).toMatchObject({ status: "buyer_flows_retired" });
    const send = await sent();
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0][0].message)).toContain("bukti pembayaran");
    expect(fixture.sql.prepare("SELECT count(*) AS n FROM payment_proofs").get()!.n).toBe(0);
  });

  it("percakapan biasa tetap tidak dibalas", async () => {
    for (const text of ["halo semuanya", "🔥", "", "assalamualaikum"]) {
      expect((await webhook(message({ message: text }))).status).toBe(200);
    }
    expect(await sent()).not.toHaveBeenCalled();
  });

  it("info garansi tetap dijawab copy kanonis", async () => {
    await webhook(message({ message: "garansi" }));
    const send = await sent();
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0][0].message)).toBe(warrantyMessage());
  });

  it("perintah admin .d tetap menyelesaikan order lunas", async () => {
    await insertTestProduct(fixture.sql);
    insertTestOrder(fixture.sql, "AXV-20261113-DONE0001", { status: "lunas" });
    fixture.sql.prepare("UPDATE orders SET fulfillment_status='queued' WHERE code='AXV-20261113-DONE0001'").run();
    vi.stubEnv("WHATSAPP_ADMIN_NUMBERS", "628123456789");
    const res = await webhook(message({ message: ".d AXV-20261113-DONE0001" }));
    expect(res.status).toBe(200);
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-20261113-DONE0001'").get()!.fulfillment_status).toBe("delivered");
    expect(await sent()).toHaveBeenCalledTimes(1);
  });

  it("welcome copy tetap mengarahkan ke web/Telegram dan tidak menawarkan order grup", () => {
    const copy = welcomeNewMemberMessage("THNS!!");
    expect(copy).toContain("axvara.tech");
    expect(copy).toContain("Telegram");
    expect(copy).not.toContain("Ketik *list*");
  });
});
