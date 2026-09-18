// tests/cron-deadline-poison.integration.test.ts
//
// Insiden 17–18 Sep 2026: sync otomatis WR mati ~16 jam. Rantai sebabnya
// bukan auth dan bukan D1, melainkan:
//   1. satu invocation cron merangkai banyak panggilan jaringan (notify 14×10 s,
//      WR 3×30 s) sampai dipotong platform pada wallTime ~125 s
//      (outcome `canceled`, cpuTime hanya ~175 ms), dan
//   2. penanda fase HANYA ditulis di ekor handler, sehingga run yang dibunuh
//      meninggalkan fase yang sama → run berikutnya mengulang pekerjaan berat
//      yang sama → mati lagi tiap 5 menit (poison pill). Bukti prod:
//      store_settings.cron_phase beku di 'warung_rebahan' (17 Sep 13:06 UTC)
//      dan baris cron terakhir di wr_sync_log 17 Sep 11:37 UTC.
//
// Test ini mengunci dua obat itu: fase SELALU maju walau run gagal, dan
// deadline wall-clock menahan pekerjaan baru + melaporkannya sebagai deferred.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  sendPhoto: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  answerCallbackQuery: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
  showLoadingBar: vi.fn(async () => {}),
  sendChatAction: vi.fn(async () => ({ ok: true })),
}));

let fixture: ReturnType<typeof createD1Fixture>;

beforeEach(async () => {
  fixture = createD1Fixture();
  await insertTestProduct(fixture.sql, "manual", 1);
  vi.stubEnv("CRON_SECRET", "c");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false");
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in fixture"); }));
});

afterEach(() => {
  fixture.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function run() {
  const { POST } = await import("@/app/api/cron/operations/route");
  const { NextRequest } = await import("next/server");
  const res = await POST(new NextRequest("http://localhost/api/cron/operations", {
    method: "POST", headers: { authorization: "Bearer c" },
  }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const phase = () =>
  String(fixture.sql.prepare("SELECT value FROM store_settings WHERE key='cron_phase'").get()?.value ?? "");
const deferred = () =>
  String(fixture.sql.prepare("SELECT value FROM store_settings WHERE key='cron_deferred'").get()?.value ?? "");

function setPhase(value: string, deferredList: string[] = []) {
  for (const [key, val] of [["cron_phase", value], ["cron_deferred", JSON.stringify(deferredList)]] as const) {
    fixture.sql.prepare(
      `INSERT INTO store_settings (key,value,updated_at) VALUES (?,?,datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).run(key, val);
  }
}

describe("cron operations — poison-pill guard", () => {
  it("fase maju di AWAL run, sebelum pekerjaan berat dijalankan", async () => {
    setPhase("warung_rebahan");
    await run();
    // nextPhase('warung_rebahan') === 'notify'
    expect(phase()).toBe("notify");
  });

  it("run yang gagal di tengah jalan TIDAK mengulang fase yang sama (anti-loop)", async () => {
    setPhase("fulfillment", ["fulfillment", "warung_rebahan"]);
    // Simulasikan run yang mati: paksa error non-budget pada query fase
    // fulfillment sehingga handler keluar 500 tanpa menulis ekor.
    fixture.control.fail = (query) => query.includes("LEFT JOIN fulfillment_jobs fj");
    const first = await run();
    fixture.control.fail = null;
    expect(first.status).toBe(500);
    // Penanda fase sudah dimajukan di awal → run berikutnya BUKAN fase yang
    // sama, dan deferred yang beracun sudah dikosongkan.
    expect(phase()).toBe("warung_rebahan");
    expect(deferred()).toBe("[]");
  });

  it("run normal tetap menulis fase + deferred final di ekor", async () => {
    setPhase("expiry");
    const res = await run();
    expect(res.status).toBe(200);
    // Ekor menimpa penulisan awal: fase berikutnya setelah 'expiry'.
    expect(phase()).toBe("fulfillment");
    expect(res.body.run_deadline_ms).toBe(45_000);
    expect(typeof res.body.run_duration_ms).toBe("number");
  });
});

describe("cron operations — deadline wall-clock", () => {
  it("tidak memulai unit kerja baru setelah deadline dan menandainya deferred", async () => {
    setPhase("expiry");
    // Seed satu order kedaluwarsa agar fase expiry punya pekerjaan nyata.
    fixture.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,expires_at)
      VALUES ('AXV-20260918-DEADLINE','X','6280',?,10000,'qris','pending','pending','web',datetime('now','-5 minutes'))`)
      .run(JSON.stringify([{ product_id: 1, variant_id: 1, qty: 1 }]));

    // Lompatkan waktu 60 s setelah beberapa pemanggilan Date.now() pertama,
    // meniru invocation yang sudah kehabisan waktu di tengah jalan.
    const realNow = Date.now.bind(Date);
    let calls = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      calls += 1;
      return calls > 3 ? realNow() + 60_000 : realNow();
    });

    const res = await run();
    expect(res.status).toBe(200);
    const deferredList = (res.body.deferred as string[]) ?? [];
    // Semua fase yang belum kebagian waktu dilaporkan jujur…
    expect(deferredList.length).toBeGreaterThan(0);
    // …dan ekor tetap jalan sehingga fase tersimpan (tidak ada loop beku).
    expect(phase()).toBe("fulfillment");
  });
});
