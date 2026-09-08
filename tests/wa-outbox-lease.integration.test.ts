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

  it("expired lease is recoverable to failed for normal retry", async () => {
    const outbox = await import("@/lib/whatsapp/outbox");
    await outbox.enqueueWhatsAppMessage("r10-crash", "628000000000", "DUMMY");
    const row = (await outbox.getDueWhatsAppOutbox())[0];
    // Simulasi worker mati tepat setelah klaim: paksa status sending dengan
    // lease yang sudah lewat, lalu jalankan pemulihan migrasi 0018.
    fixture.sql.prepare("UPDATE whatsapp_outbox SET status='sending', worker_id='dead-worker', locked_until=datetime('now','-10 minutes') WHERE id=?")
      .run(Number(row.id));
    expect(await outbox.getDueWhatsAppOutbox()).toHaveLength(0);
    fixture.sql.exec("UPDATE whatsapp_outbox SET status='failed', worker_id=NULL, locked_until=NULL WHERE status='sending' AND (locked_until IS NULL OR datetime(locked_until) <= datetime('now'))");
    const due = await outbox.getDueWhatsAppOutbox();
    expect(due).toHaveLength(1);
    expect(await outbox.processWhatsAppOutboxRow(due[0])).toBe(true);
    expect(fixture.sql.prepare("SELECT status FROM whatsapp_outbox WHERE id=?").get(Number(row.id))?.status).toBe("sent");
  });
});
