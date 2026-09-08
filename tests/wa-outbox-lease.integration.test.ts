import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/lib/whatsapp/gateway", () => ({
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "dummy" })),
}));

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(() => { fixture = createD1Fixture(); });
afterEach(() => { fixture.close(); vi.clearAllMocks(); });

// R10: dua worker konkuren tidak boleh mengirim pesan yang sama dua kali.
// Klaim lease (status+sending, worker_id, locked_until) membuat worker kedua
// kalah CAS; baris ter-lease tak terlihat di getDue sampai lease lewat.
describe("R10 WA outbox lease prevents concurrent double-send", () => {
  it("concurrent workers send exactly once", async () => {
    const outbox = await import("@/lib/whatsapp/outbox");
    const gateway = await import("@/lib/whatsapp/gateway");
    await outbox.enqueueWhatsAppMessage("r10-one", "628000000000", "DUMMY NOTICE");

    // Tahan pengiriman pertama di tengah jalan agar worker kedua membaca
    // snapshot basi yang sama — persis pola review harness.
    const send = gateway.sendTextMessage as unknown as ReturnType<typeof vi.fn>;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let enteredResolve!: () => void;
    const entered = new Promise<void>((r) => { enteredResolve = r; });
    let calls = 0;
    send.mockImplementationOnce(async () => {
      calls++;
      enteredResolve();
      await gate;
      return { ok: true, messageId: "dummy" };
    });

    const first = outbox.processWhatsAppOutboxRow((await outbox.getDueWhatsAppOutbox())[0]);
    await entered;
    // Worker kedua: snapshot diambil saat lease sudah ditulis → tak ada lagi
    // baris due; kalaupun memaksa dengan snapshot basi, CAS kalah.
    expect(await outbox.getDueWhatsAppOutbox()).toHaveLength(0);
    const stale = { id: 1, attempt_count: 0, destination: "628000000000", payload: "DUMMY NOTICE" };
    expect(await outbox.processWhatsAppOutboxRow(stale)).toBe(false);
    release();
    await first;

    expect(calls).toBe(1);
    expect(fixture.sql.prepare("SELECT status,attempt_count FROM whatsapp_outbox").get())
      .toMatchObject({ status: "sent", attempt_count: 1 });
  });

  it("expired lease is recovered by RUNTIME recovery, not test SQL", async () => {
    const outbox = await import("@/lib/whatsapp/outbox");
    await outbox.enqueueWhatsAppMessage("r10-crash", "628000000000", "DUMMY");
    const row = (await outbox.getDueWhatsAppOutbox())[0];
    // Simulasi worker mati tepat setelah klaim: paksa status sending dengan
    // lease yang sudah lewat. Pemulihan HARUS lewat fungsi runtime
    // (recoverStaleWhatsAppLeases / processDueWhatsAppOutbox) — tes dilarang
    // memperbaiki baris lewat SQL sendiri.
    fixture.sql.prepare("UPDATE whatsapp_outbox SET status='sending', worker_id='dead-worker', locked_until=datetime('now','-10 minutes') WHERE id=?")
      .run(Number(row.id));
    expect(await outbox.getDueWhatsAppOutbox()).toHaveLength(0);
    const recovered = await outbox.recoverStaleWhatsAppLeases();
    expect(recovered).toBe(1);
    const due = await outbox.getDueWhatsAppOutbox();
    expect(due).toHaveLength(1);
    expect(await outbox.processWhatsAppOutboxRow(due[0])).toBe(true);
    expect(fixture.sql.prepare("SELECT status FROM whatsapp_outbox WHERE id=?").get(Number(row.id))?.status).toBe("sent");
  });

  it("processDue recovers stale leases without test SQL repair", async () => {
    const outbox = await import("@/lib/whatsapp/outbox");
    await outbox.enqueueWhatsAppMessage("r10-crash-due", "628000000000", "DUMMY");
    const row = (await outbox.getDueWhatsAppOutbox())[0];
    fixture.sql.prepare("UPDATE whatsapp_outbox SET status='sending', worker_id='dead-worker', locked_until=datetime('now','-20 minutes') WHERE id=?")
      .run(Number(row.id));
    const result = await outbox.processDueWhatsAppOutbox();
    expect(result.recovered).toBe(1);
    expect(result.sent).toBe(1);
    expect(fixture.sql.prepare("SELECT status FROM whatsapp_outbox WHERE id=?").get(Number(row.id))?.status).toBe("sent");
  });

  it("two concurrent workers produce exactly one active sender", async () => {
    const outbox = await import("@/lib/whatsapp/outbox");
    await outbox.enqueueWhatsAppMessage("r10-concurrent", "628000000000", "DUMMY");
    const due = await outbox.getDueWhatsAppOutbox();
    const first = await outbox.claimWhatsAppOutboxRow(due[0]);
    expect(first.outcome).toBe("claimed");
    // Worker kedua dengan snapshot basi kalah claim — bukan db_error.
    const second = await outbox.claimWhatsAppOutboxRow({ id: due[0].id, attempt_count: 0 });
    expect(second.outcome).toBe("lost");
  });

  it("sent and dead rows are never resurrected by recovery", async () => {
    const outbox = await import("@/lib/whatsapp/outbox");
    await outbox.enqueueWhatsAppMessage("r10-terminal", "628000000000", "DUMMY");
    const row = (await outbox.getDueWhatsAppOutbox())[0];
    expect(await outbox.processWhatsAppOutboxRow(row)).toBe(true);
    const sentId = Number(row.id);
    expect(fixture.sql.prepare("SELECT status FROM whatsapp_outbox WHERE id=?").get(sentId)?.status).toBe("sent");
    expect(await outbox.recoverStaleWhatsAppLeases()).toBe(0);
    // Jalur dead: paksa gagal sampai budget habis via gateway mock gagal.
    const gateway = await import("@/lib/whatsapp/gateway");
    const send = gateway.sendTextMessage as unknown as ReturnType<typeof vi.fn>;
    send.mockImplementation(async () => ({ ok: false, error: "boom" }));
    await outbox.enqueueWhatsAppMessage("r10-dead", "628000000000", "DUMMY");
    for (let i = 0; i < 6; i++) {
      // Paksa due SEBELUM fetch: kegagalan menyetel backoff masa depan.
      fixture.sql.prepare("UPDATE whatsapp_outbox SET next_attempt_at=datetime('now','-1 minute') WHERE idempotency_key='r10-dead'").run();
      const due = await outbox.getDueWhatsAppOutbox(1);
      if (!due.length) break;
      await outbox.processWhatsAppOutboxRow(due[0]);
    }
    const dead = fixture.sql.prepare("SELECT id, status FROM whatsapp_outbox WHERE idempotency_key='r10-dead'").get()!;
    expect(dead.status).toBe("dead");
    expect(await outbox.recoverStaleWhatsAppLeases()).toBe(0);
    expect(await outbox.getDueWhatsAppOutbox()).toHaveLength(0);
    expect(fixture.sql.prepare("SELECT status FROM whatsapp_outbox WHERE id=?").get(sentId)?.status).toBe("sent");
  });

  it("claim DB failure reports db_error, not a quiet loss", async () => {
    const outbox = await import("@/lib/whatsapp/outbox");
    await outbox.enqueueWhatsAppMessage("r10-dberr", "628000000000", "DUMMY");
    const due = (await outbox.getDueWhatsAppOutbox())[0];
    // Simulasikan outage schema: hapus kolom worker_id sementara sehingga
    // UPDATE klaim gagal di database.
    fixture.sql.exec("ALTER TABLE whatsapp_outbox RENAME TO whatsapp_outbox_backup_tmp");
    fixture.sql.exec(`CREATE TABLE whatsapp_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, idempotency_key TEXT NOT NULL UNIQUE,
      channel TEXT NOT NULL DEFAULT 'whatsapp', destination TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text', payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT, last_error TEXT, provider_message_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    fixture.sql.exec(`INSERT INTO whatsapp_outbox (id, idempotency_key, channel, destination, message_type, payload, status, attempt_count, next_attempt_at)
      SELECT id, idempotency_key, channel, destination, message_type, payload, status, attempt_count, next_attempt_at FROM whatsapp_outbox_backup_tmp`);
    try {
      const claim = await outbox.claimWhatsAppOutboxRow(due);
      expect(claim.outcome).toBe("db_error");
      await expect(outbox.processWhatsAppOutboxRow(due)).rejects.toThrow(/wa_outbox_claim_failed/);
    } finally {
      fixture.sql.exec("DROP TABLE whatsapp_outbox");
      fixture.sql.exec("ALTER TABLE whatsapp_outbox_backup_tmp RENAME TO whatsapp_outbox");
    }
  });
});
