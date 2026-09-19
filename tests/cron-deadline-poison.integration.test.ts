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

describe("cron operations — anti-starvation sync WR", () => {
  // 18 Sep 2026: sync otomatis tetap mati 2,5 jam SETELAH perbaikan deadline.
  // Sebabnya guard anti-starvation memveto dirinya sendiri: syaratnya
  // `pendingWrDue === 0 && pendingWrDelivery === 0`, padahal fase WR
  // menangani order DAN sync — selama ada order WR menggantung (dua order
  // Meitu) slot paksa tidak pernah diberikan dan sweep tidak pernah jalan.
  function seedWrHistory(hoursAgo: number) {
    fixture.sql.prepare(
      `INSERT INTO wr_sync_log(sync_type,status,products_synced,variants_synced,trigger,created_at)
       VALUES('products','success',48,87,'cron',datetime('now','-${hoursAgo} hours'))`,
    ).run();
  }
  function seedPendingWrLink(code: string) {
    fixture.sql.prepare(
      `INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel)
       VALUES(?,'Buyer','628000000000','[]',10000,'qris','lunas','paid','web')`,
    ).run(code);
    fixture.sql.prepare(
      `INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,next_attempt_at)
       VALUES(?, 'var-1',1,8000,'pending',datetime('now','-10 minutes'))`,
    ).run(code);
  }

  it("sync basi mendapat slot WALAU ada order WR menggantung", async () => {
    // Fase tersimpan 'notify' → rotasi normal TIDAK memberi slot WR
    // (active = notify, expiry, fulfillment).
    setPhase("notify");
    seedWrHistory(3);
    seedPendingWrLink("AXV-20260918-STARV001");
    const res = await run();
    expect(res.status).toBe(200);
    // Guard memaksa slot: warung_rebahan TIDAK boleh ada di deferred sebagai
    // fase yang dibuang, dan salah satu fase lain yang mengalah.
    const deferredList = (res.body.deferred as string[]) ?? [];
    expect(deferredList).not.toContain("warung_rebahan");
  });

  it("tanpa histori sync WR, komposisi fase tidak diubah (fixture tetap deterministik)", async () => {
    setPhase("notify");
    seedPendingWrLink("AXV-20260918-STARV002");
    const res = await run();
    expect(res.status).toBe(200);
    // Tidak ada baris wr_sync_log products → guard tidak menyala; WR tetap
    // di luar 3 slot aktif sehingga dilaporkan deferred.
    expect((res.body.deferred as string[]) ?? []).toContain("warung_rebahan");
  });
});

describe("cron operations — observability skip sync (issue wr-sync-observability)", () => {
  // 19 Sep 2026: gap sync 07:12→10:24 UTC tak terlihat karena semua jalur
  // skip mengembalikan `synced:0 + skipped:null` yang ambigu. Setiap jalur
  // kini WAJIB melapor jujur + heartbeat tiap hit.
  const heartbeat = () =>
    String(fixture.sql.prepare("SELECT value FROM store_settings WHERE key='cron_last_hit_at'").get()?.value ?? "");

  it("switch mati → skipped=disabled + heartbeat tertulis", async () => {
    setPhase("warung_rebahan");
    const res = await run();
    expect(res.status).toBe(200);
    // beforeEach: WARUNG_REBAHAN_ENABLED=false → no-op total, kini jujur.
    expect(res.body.wr_sync_skipped).toBe("disabled");
    expect(heartbeat()).not.toBe("");
  });

  it("fase tak aktif + tanpa antrean WR → skipped=phase_inactive", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    // Fase tersimpan notify + deferred kosong → 3 slot aktif tanpa WR,
    // dan tidak ada link WR sehingga pendingWrAny=0.
    setPhase("notify");
    const res = await run();
    expect(res.status).toBe(200);
    expect(res.body.wr_products_synced).toBe(0);
    expect(res.body.wr_sync_skipped).toBe("phase_inactive");
  });

  it("fase tak aktif TETAP membawa last_sync_at (diagnosa tanpa query D1)", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    setPhase("notify");
    // Histori SEGAR (5 menit) agar guard anti-starvation 45-menit TIDAK
    // menyala dan fase WR benar tak aktif. Dengan histori basi, guard
    // memaksa slot WR sehingga skip-nya "interval"/attempted, bukan
    // "phase_inactive" — itu skenario lain yang sudah di-cover.
    fixture.sql.prepare(
      `INSERT INTO wr_sync_log(sync_type,status,products_synced,variants_synced,trigger,created_at)
       VALUES('products','success',48,87,'cron',datetime('now','-5 minutes'))`,
    ).run();
    const res = await run();
    expect(res.status).toBe(200);
    expect(res.body.wr_sync_skipped).toBe("phase_inactive");
    // last_sync dibaca DI DEPAN, sebelum cabang fase — respons
    // phase_inactive pun bisa dinilai basi vs segar dari JSON saja.
    expect(typeof res.body.wr_last_sync_at).toBe("string");
  });

  it("sync baru saja jalan → skipped=interval + last_sync_at terisi", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    // Fase WR aktif (giliran) + histori sync segar → gerbang 30 menit
    // menolak sweep. Dulu: skipped null (ambigu). Kini: "interval".
    setPhase("warung_rebahan");
    fixture.sql.prepare(
      `INSERT INTO wr_sync_log(sync_type,status,products_synced,variants_synced,trigger,created_at)
       VALUES('products','success',48,87,'cron',datetime('now'))`,
    ).run();
    const res = await run();
    expect(res.status).toBe(200);
    expect(res.body.wr_products_synced).toBe(0);
    expect(res.body.wr_sync_skipped).toBe("interval");
    expect(typeof res.body.wr_last_sync_at).toBe("string");
  });

  it("sync dimatikan eksplisit → skipped=sync_disabled", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "false");
    setPhase("warung_rebahan");
    const res = await run();
    expect(res.status).toBe(200);
    expect(res.body.wr_sync_skipped).toBe("sync_disabled");
  });

  it("heartbeat tertulis di setiap run sehat", async () => {
    setPhase("expiry");
    const res = await run();
    expect(res.status).toBe(200);
    // Format datetime('now') SQLite: 'YYYY-MM-DD HH:MM:SS'.
    expect(heartbeat()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe("cron operations — watchdog sync basi (issue anti-macet struktural)", () => {
  // Empat insiden berulang semuanya butuh forensik manual 1–3 jam. Watchdog
  // ping admin MAKS 1x per episode basi (>90 mnt = 3x interval normal).
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "12345");
  });

  function seedStaleSync(hoursAgo: number) {
    fixture.sql.prepare(
      `INSERT INTO wr_sync_log(sync_type,status,products_synced,variants_synced,trigger,created_at)
       VALUES('products','success',48,87,'cron',datetime('now','-${hoursAgo} hours'))`,
    ).run();
  }
  const staleState = () =>
    fixture.sql.prepare("SELECT value FROM wr_sync_state WHERE key='sync_stale_alerted_at'").get()?.value ?? null;

  it("sync basi 3 jam → alert 1x + state tertulis", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    setPhase("warung_rebahan");
    seedStaleSync(3);
    const res = await run();
    expect(res.status).toBe(200);
    // Guard 45-mnt memaksa fase WR aktif; gerbang 30-mnt lolos → syncProducts
    // dipanggil (fetch asli melempar di fixture → catch → deferred). Watchdog
    // tetap menilai kebasian dari last_sync (3 jam) → alert.
    expect(res.body.wr_sync_stale_alerted).toBe(1);
    expect(staleState()).not.toBeNull();
  });

  it("run berikutnya di episode yang sama → tidak alert lagi", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    setPhase("warung_rebahan");
    seedStaleSync(3);
    const first = await run();
    expect(first.body.wr_sync_stale_alerted).toBe(1);
    const second = await run();
    expect(second.status).toBe(200);
    expect(second.body.wr_sync_stale_alerted).toBe(0);
  });

  it("sync segar → tidak alert", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    setPhase("warung_rebahan");
    fixture.sql.prepare(
      `INSERT INTO wr_sync_log(sync_type,status,products_synced,variants_synced,trigger,created_at)
       VALUES('products','success',48,87,'cron',datetime('now','-5 minutes'))`,
    ).run();
    const res = await run();
    expect(res.status).toBe(200);
    expect(res.body.wr_sync_stale_alerted ?? 0).toBe(0);
  });

  it("sweep sukses me-reset episode (basi lagi → alert ulang)", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    setPhase("warung_rebahan");
    seedStaleSync(3);
    await run();
    expect(staleState()).not.toBeNull();
    // Simulasi sweep sukses baru: last_sync berubah → state episode lama
    // (yang menyimpan lastSync lama) tak lagi cocok → alert ulang.
    fixture.sql.prepare(
      `INSERT INTO wr_sync_log(sync_type,status,products_synced,variants_synced,trigger,created_at)
       VALUES('products','success',48,87,'cron',datetime('now','-2 hours'))`,
    ).run();
    const res = await run();
    expect(res.body.wr_sync_stale_alerted).toBe(1);
  });

  it("watchdog berjalan SETIAP run walau fase WR tak aktif (pelajaran 18:26→23:32)", async () => {
    // Insiden malam 19 Sep: 5 jam basi tanpa ping karena watchdog lama hanya
    // hidup di fase WR aktif. Kini evaluasi di depan handler — fase notify
    // (tanpa slot WR) pun tetap alert. Histori 100 menit: basi untuk watchdog
    // (90 mnt) tapi SEGAR untuk guard 45-mnt... tidak — 100 > 45, guard tetap
    // menyala. Kunci test ini: TANPA antrean WR dan fase notify, guard tetap
    // bisa memaksa slot; yang diuji adalah HASIL (alert=1) + bukan dari blok
    // 3c (yang butuh fase WR aktif + budget). Regresi sejati: hapus blok
    // watchdog depan → run ini tak alert (terbukti di verifikasi RED).
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    setPhase("notify");
    fixture.sql.prepare(
      `INSERT INTO wr_sync_log(sync_type,status,products_synced,variants_synced,trigger,created_at)
       VALUES('products','success',48,87,'cron',datetime('now','-100 minutes'))`,
    ).run();
    const res = await run();
    expect(res.status).toBe(200);
    expect(res.body.wr_sync_stale_alerted).toBe(1);
    expect(staleState()).not.toBeNull();
  });

  it("refresh konteks presisi 1x saat fase WR aktif (tanpa ping ganda episode)", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    const { refreshStaleWrSyncContext } = await import("@/lib/warung-rebahan/order");
    // Episode terbuka: state = lastSync basi.
    fixture.sql.prepare(
      `INSERT INTO wr_sync_state (key,value) VALUES ('sync_stale_alerted_at','2026-09-19 18:26:32')
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).run();
    const first = await refreshStaleWrSyncContext("2026-09-19 18:26:32", "interval");
    expect(first).toBe(1);
    // Konteks sama → diam; episode lain → diam.
    expect(await refreshStaleWrSyncContext("2026-09-19 18:26:32", "interval")).toBe(0);
    expect(await refreshStaleWrSyncContext("2026-09-19 19:00:00", "interval")).toBe(0);
    // Tanpa konteks presisi → diam.
    expect(await refreshStaleWrSyncContext("2026-09-19 18:26:32", "pre_phase")).toBe(0);
  });
});

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
