import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "../helpers/d1-fixture";
import {
  parseWrEmail,
  buildAxvaraForwardTemplate,
} from "@/lib/warung-rebahan/email-forward";

let fixture: ReturnType<typeof createD1Fixture>;

function seedOrder(code: string, email: string, wa: string) {
  fixture.sql.prepare(
    `INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,sales_channel)
     VALUES(?,?,?,?,?,?, 'qris','lunas','paid','web')`,
  ).run(code, "Uji Buyer", wa, email, "[]", 3500);
}

const INVITE_HTML = `
<div><h1>Invite Berhasil ✅</h1>
<p>Undangan Apple Music sudah dikirim ke email kamu.</p>
<p>NO. INVOICE: <b>#RBHN-20260916-DCB922</b></p>
<p>Halo Kak, invite <b>Apple Music</b> telah dikirim. Cek email tujuan lalu klik tautannya untuk mulai menggunakan layanan</p>
<div>PRODUK<br>Apple Music</div>
<div>EMAIL TUJUAN<br>uji.wr.tes@gmail.com</div>
<a>Lihat Invoice →</a>
<p>Terima kasih sudah berbelanja di Warung Rebahan</p></div>`;

const UPDATE_HTML = `
<div><h1>Update Pesanan 🔔</h1>
<p>NO. INVOICE: <b>#RBHN-20260916-DCB922</b></p>
<p>STATUS: PROCESSING</p>
<div>PRODUK<br>Apple Music</div>
<div>VARIAN<br>Premium - 28 Hari - Invite</div>
<div>TOTAL<br>Rp3.500</div></div>`;

beforeEach(() => {
  fixture = createD1Fixture();
  vi.stubEnv("WR_EMAIL_WEBHOOK_SECRET", "wr-email-test-secret");
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@axvara.id");
  vi.stubEnv("SITE_URL", "https://axvara.tech");
});

afterEach(() => {
  fixture.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parser email WR", () => {
  it("invite: ambil invoice + produk + email tujuan, tanpa jejak WR di template", () => {
    const parsed = parseWrEmail("Apple Music invite berhasil dikirim", INVITE_HTML);
    expect(parsed.kind).toBe("invite_sent");
    expect(parsed.wrInvoice).toBe("RBHN-20260916-DCB922");
    expect(parsed.product).toBe("Apple Music");
    expect(parsed.targetEmail).toBe("uji.wr.tes@gmail.com");
    const tpl = buildAxvaraForwardTemplate({
      axvaraOrderCode: "AXV-20260916-AAAAAA",
      buyerName: "Uji Buyer",
      invoiceUrl: "https://axvara.tech/pesanan/AXV-20260916-AAAAAA",
      supportWa: "089519388264",
      parsed,
    });
    expect(tpl.subject).toContain("AXV-20260916-AAAAAA");
    expect(tpl.html).not.toMatch(/warung.?rebahan/i);
    expect(tpl.html).toContain("uji.wr.tes@gmail.com");
    expect(tpl.html).toContain("https://axvara.tech/pesanan/AXV-20260916-AAAAAA");
    expect(tpl.text).not.toMatch(/warung.?rebahan/i);
  });

  it("update: ambil invoice + status + total, template tanpa brand WR", () => {
    const parsed = parseWrEmail("Update pesanan #RBHN-20260916-DCB922", UPDATE_HTML);
    expect(parsed.kind).toBe("order_update");
    expect(parsed.wrInvoice).toBe("RBHN-20260916-DCB922");
    expect(parsed.status).toBe("PROCESSING");
    expect(parsed.variant).toContain("Premium");
    expect(parsed.total).toBe(3500);
    const tpl = buildAxvaraForwardTemplate({
      axvaraOrderCode: "AXV-20260916-AAAAAA",
      buyerName: "Uji",
      invoiceUrl: "https://axvara.tech/pesanan/AXV-20260916-AAAAAA",
      supportWa: "089519388264",
      parsed,
    });
    expect(tpl.html).not.toMatch(/warung.?rebahan/i);
    expect(tpl.html).toContain("Pesanan Diproses");
  });

  it("tanpa invoice → unknown → webhook skip tanpa kirim", async () => {
    const { POST } = await import("@/app/api/webhook/wr-email/route");
    const req = new Request("http://localhost/api/webhook/wr-email", {
      method: "POST",
      headers: { "content-type": "application/json", "x-wr-email-secret": "wr-email-test-secret" },
      body: JSON.stringify({ gmail_message_id: "msg-noreceipt", subject: "Halo", body_text: "promo biasa" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "skipped" });
  });
});

describe("POST /api/webhook/wr-email", () => {
  it("401 tanpa secret; 503 tanpa secret server", async () => {
    const { POST } = await import("@/app/api/webhook/wr-email/route");
    const bad = await POST(new Request("http://localhost/api/webhook/wr-email", {
      method: "POST",
      headers: { "content-type": "application/json", "x-wr-email-secret": "salah" },
      body: JSON.stringify({ gmail_message_id: "x", subject: "s", body_text: "t" }),
    }) as never);
    expect(bad.status).toBe(401);
    vi.stubEnv("WR_EMAIL_WEBHOOK_SECRET", "");
    const noserver = await POST(new Request("http://localhost/api/webhook/wr-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }) as never);
    expect(noserver.status).toBe(503);
  });

  it("invoice tak dikenal → unmatched (bertahan untuk reconciler manual)", async () => {
    const { POST } = await import("@/app/api/webhook/wr-email/route");
    const res = await POST(new Request("http://localhost/api/webhook/wr-email", {
      method: "POST",
      headers: { "content-type": "application/json", "x-wr-email-secret": "wr-email-test-secret" },
      body: JSON.stringify({ gmail_message_id: "msg-asing", subject: "Update pesanan #RBHN-20990101-ZZZZZZ", body_html: UPDATE_HTML.replaceAll("DCB922", "ZZZZZZ") }),
    }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "unmatched" });
  });

  it("happy path: join invoice → kirim Resend → log forwarded; retry = duplicate", async () => {
    seedOrder("AXV-20260916-DCB922", "buyer@axvara.id", "628111");
    fixture.sql.prepare(
      "INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-20260916-DCB922','RBHN-20260916-DCB922','v-music',1,3500,'processing')",
    ).run();
    const sent: { to: string; subject: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      sent.push({ to: "buyer@axvara.id", subject: "invite" });
      return new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
    }));
    const { POST } = await import("@/app/api/webhook/wr-email/route");
    const make = () => new Request("http://localhost/api/webhook/wr-email", {
      method: "POST",
      headers: { "content-type": "application/json", "x-wr-email-secret": "wr-email-test-secret" },
      body: JSON.stringify({ gmail_message_id: "msg-invite-1", subject: "Apple Music invite berhasil dikirim", body_html: INVITE_HTML }),
    });
    const res = await POST(make() as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "forwarded", channel: "email", order_code: "AXV-20260916-DCB922" });
    expect(sent.length).toBe(1);
    const log = fixture.sql.prepare("SELECT kind, buyer_email, buyer_notified_at, channel FROM wr_email_forward_log WHERE gmail_message_id='msg-invite-1'").get() as Record<string, unknown>;
    expect(log.kind).toBe("invite_sent");
    expect(log.buyer_email).toBe("buyer@axvara.id");
    expect(log.buyer_notified_at).toBeTruthy();
    expect(log.channel).toBe("email");
    // Retry forwarder → duplicate, Resend TIDAK dipanggil lagi.
    const dup = await POST(make() as never);
    expect(await dup.json()).toMatchObject({ status: "duplicate" });
    expect(sent.length).toBe(1);
  });

  it("buyer tanpa email → fallback antrekan WA (idempoten), bukan gagal", async () => {
    seedOrder("AXV-20260916-NOMAIL", "", "628999");
    fixture.sql.prepare(
      "INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-20260916-NOMAIL','RBHN-20260916-NOMAIL','v-x',1,1000,'processing')",
    ).run();
    const { POST } = await import("@/app/api/webhook/wr-email/route");
    const res = await POST(new Request("http://localhost/api/webhook/wr-email", {
      method: "POST",
      headers: { "content-type": "application/json", "x-wr-email-secret": "wr-email-test-secret" },
      body: JSON.stringify({ gmail_message_id: "msg-nomail", subject: "Update pesanan #RBHN-20260916-NOMAIL", body_html: UPDATE_HTML.replaceAll("DCB922", "NOMAIL") }),
    }) as never);
    expect(await res.json()).toMatchObject({ status: "forwarded", channel: "whatsapp" });
    const outbox = fixture.sql.prepare("SELECT destination FROM whatsapp_outbox WHERE idempotency_key LIKE 'wr-email:%'").get() as Record<string, unknown>;
    expect(outbox.destination).toBe("628999");
  });

  it("Resend gagal → 502 + log error, retry forwarder mencoba lagi TANPA duplikat log", async () => {
    seedOrder("AXV-20260916-FAIL", "gagal@axvara.id", "628111");
    fixture.sql.prepare(
      "INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-20260916-FAIL','RBHN-20260916-FAIL','v-x',1,1000,'processing')",
    ).run();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "boom" }), { status: 500 })));
    const { POST } = await import("@/app/api/webhook/wr-email/route");
    const res = await POST(new Request("http://localhost/api/webhook/wr-email", {
      method: "POST",
      headers: { "content-type": "application/json", "x-wr-email-secret": "wr-email-test-secret" },
      body: JSON.stringify({ gmail_message_id: "msg-fail", subject: "Update pesanan #RBHN-20260916-FAIL", body_html: UPDATE_HTML.replaceAll("DCB922", "FAIL") }),
    }) as never);
    expect(res.status).toBe(502);
    const log = fixture.sql.prepare("SELECT error, buyer_notified_at FROM wr_email_forward_log WHERE gmail_message_id='msg-fail'").get() as Record<string, unknown>;
    expect(String(log.error || "")).toBeTruthy();
    expect(log.buyer_notified_at).toBeNull();
  });

  it("Resend belum dikonfigurasi → held 202 (tidak hilang, kirim setelah env diisi + forward ulang)", async () => {
    seedOrder("AXV-20260916-HELD", "tahan@axvara.id", "628111");
    fixture.sql.prepare(
      "INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-20260916-HELD','RBHN-20260916-HELD','v-x',1,1000,'processing')",
    ).run();
    vi.stubEnv("RESEND_API_KEY", "");
    const { POST } = await import("@/app/api/webhook/wr-email/route");
    const res = await POST(new Request("http://localhost/api/webhook/wr-email", {
      method: "POST",
      headers: { "content-type": "application/json", "x-wr-email-secret": "wr-email-test-secret" },
      body: JSON.stringify({ gmail_message_id: "msg-held", subject: "Update pesanan #RBHN-20260916-HELD", body_html: UPDATE_HTML.replaceAll("DCB922", "HELD") }),
    }) as never);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ status: "held" });
  });

  it("migrasi 0036: tabel log ada dengan UNIQUE gmail_message_id", () => {
    const cols = fixture.sql.prepare("PRAGMA table_info(wr_email_forward_log)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("gmail_message_id");
    const idx = fixture.sql.prepare("PRAGMA index_list(wr_email_forward_log)").all() as { name: string; unique: number }[];
    expect(idx.some((i) => i.unique === 1)).toBe(true);
  });
});
