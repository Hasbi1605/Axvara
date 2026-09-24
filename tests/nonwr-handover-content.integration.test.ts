// tests/nonwr-handover-content.integration.test.ts — "Kirim ke pembeli":
// serah terima admin untuk produk Made By Order non-WR kini membawa isi
// (laporan owner 2026-09-25), lalu isi itu bisa dibuka lagi di halaman
// pesanan setelah verifikasi. Diuji lewat route asli di atas D1 nyata.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createOrderWithStock } from "@/lib/db";
import { ensureFulfillmentForPaidOrder } from "@/lib/fulfillment/deliver";
import { decryptSecret } from "@/lib/fulfillment/crypto";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "admin@axvara.test" })) }));

type Sent = { to: string[]; subject: string; html: string; text: string };
let fixture: ReturnType<typeof createD1Fixture>;
let emails: Sent[];

const CODE = "AXV-20260925-BBBBBBB1";
const TEMPLATE = "Undangan Canva sudah dikirim ke {email}. Hai {nama}, kode {kode}.";

beforeEach(async () => {
  fixture = createD1Fixture();
  emails = [];
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@axvara.test");
  vi.stubEnv("SITE_URL", "https://axvara.test");
  stubFulfillmentKey();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url) !== "https://api.resend.com/emails") throw new Error(`Network disabled: ${url}`);
    emails.push(JSON.parse(String(init?.body)) as Sent);
    return new Response(JSON.stringify({ id: `email-${emails.length}` }), { status: 200 });
  }));
  const { sendMessage } = await import("@/lib/telegram/api");
  (sendMessage as unknown as ReturnType<typeof vi.fn>).mockClear();
  fixture.sql.exec("INSERT INTO products(id,name,slug,price,stock,source) VALUES(1,'Canva Pro','canva-premium',5000,100,'manual')");
  fixture.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,handover_template)
    VALUES(2,1,'SKU-2','Invite Lifetime',5000,-1,'manual',?)`).run(TEMPLATE);
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function paidManualOrder(code = CODE, email: string | null = "pembeli@contoh.test") {
  await createOrderWithStock({
    code, quoteId: `q-${code}`, customerName: "Rani Putri", customerWa: "0812-3456-7890",
    customerEmail: email, items: [{ product_id: 1, variant_id: 2, name: "Canva Pro — Invite Lifetime", price: 5000, qty: 1 }],
    subtotal: 5000, paymentMethod: "qris", paymentAccount: "DANA Business", proofUrl: null,
  });
  fixture.sql.prepare("UPDATE orders SET status='lunas', payment_status='paid' WHERE code=?").run(code);
  await ensureFulfillmentForPaidOrder(code);
  emails = [];
}

function req(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method, headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 200)}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

async function handover(code: string, body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/admin/orders/[code]/handover/route");
  const res = await POST(req(`/api/admin/orders/${code}/handover`, "POST", body), { params: Promise.resolve({ code }) });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe("Kirim ke pembeli (serah terima dengan isi)", () => {
  it("dialog menerima label + template varian yang sudah terisi", async () => {
    await paidManualOrder();
    const { GET } = await import("@/app/api/admin/orders/[code]/handover/route");
    const res = await GET(req(`/api/admin/orders/${CODE}/handover`, "GET"), { params: Promise.resolve({ code: CODE }) });
    const body = await res.json() as { items: { label: string; template_text: string; status: string }[]; order: { customer_email: string } };
    expect(body.order.customer_email).toBe("pembeli@contoh.test");
    expect(body.items[0]).toMatchObject({
      status: "manual_required",
      label: "Canva Pro — Invite Lifetime",
      template_text: `Undangan Canva sudah dikirim ke pembeli@contoh.test. Hai Rani, kode ${CODE}.`,
    });
  });

  it("isi admin dikirim lewat email bermerek (ter-escape) dan tersimpan terenkripsi", async () => {
    await paidManualOrder();
    const message = "Undangan terkirim ke pembeli@contoh.test\n<b>Terima</b> undangannya dari email Canva.";
    const res = await handover(CODE, { item_index: 0, buyer_message: message, note: "via Canva admin" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, complete: true, buyer_notified: true });

    const row = fixture.sql.prepare("SELECT status, delivered_message_id, delivered_ciphertext, delivered_iv, last_error FROM fulfillment_items WHERE order_code=?").get(CODE) as Record<string, string>;
    expect(row.status).toBe("delivered");
    expect(row.delivered_message_id).toBe("manual");
    expect(row.delivered_ciphertext).not.toContain("Undangan");
    expect(await decryptSecret(row.delivered_ciphertext, row.delivered_iv)).toBe(message);
    // Catatan internal hanya masuk jejak audit, tidak ke pembeli.
    expect(row.last_error).toContain("via Canva admin");

    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe(`Canva Pro — Invite Lifetime sudah siap — AXVARA ${CODE}`);
    expect(emails[0].html).toContain("Pesanan Siap");
    expect(emails[0].html).toContain("&lt;b&gt;Terima&lt;/b&gt;");
    expect(emails[0].html).not.toContain("<b>Terima</b>");
    expect(emails[0].html).not.toContain("via Canva admin");
    expect(emails[0].text).toContain("Undangan terkirim ke pembeli@contoh.test");
  });

  it("tanpa isi (dikirim admin di luar sistem) → kabar Pesanan Diserahkan bermerek", async () => {
    await paidManualOrder();
    const res = await handover(CODE, { item_index: 0 });
    expect(res.body).toMatchObject({ ok: true, complete: true, buyer_notified: true });
    expect(fixture.sql.prepare("SELECT delivered_ciphertext FROM fulfillment_items WHERE order_code=?").get(CODE)?.delivered_ciphertext).toBeNull();
    expect(emails.map((m) => m.subject)).toEqual([`Pesanan ${CODE} sudah diserahkan`]);
    expect(emails[0].html).toContain("Pesanan Diserahkan");
    expect(emails[0].html).toContain("/brand/axvara-email-mark.png");
  });

  it("order Telegram → isi dikirim lewat DM pribadi pembeli, ter-escape", async () => {
    await paidManualOrder();
    fixture.sql.prepare("UPDATE orders SET sales_channel='telegram', telegram_user_id='555' WHERE code=?").run(CODE);
    fixture.sql.prepare("INSERT INTO telegram_users(user_id, chat_id) VALUES('555','555')").run();
    const res = await handover(CODE, { item_index: 0, buyer_message: "akun: rani@canva.test <sandi>" });
    expect(res.body).toMatchObject({ ok: true, buyer_notified: true });
    const { sendMessage } = await import("@/lib/telegram/api");
    const dm = (sendMessage as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([m]) => m as { chat_id: string; text: string }).find((m) => m.chat_id === "555");
    expect(dm?.text).toContain("akun: rani@canva.test &lt;sandi&gt;");
    expect(emails).toHaveLength(0);
  });

  it("order web tanpa email → pembeli tidak dikabari, dan isi TIDAK masuk outbox WhatsApp", async () => {
    await paidManualOrder("AXV-20260925-BBBBBBB2", null);
    const res = await handover("AXV-20260925-BBBBBBB2", { item_index: 0, buyer_message: "RAHASIA-JANGAN-DI-OUTBOX" });
    expect(res.body).toMatchObject({ ok: true, buyer_notified: false });
    const outbox = fixture.sql.prepare("SELECT payload FROM whatsapp_outbox").all() as { payload: string }[];
    expect(outbox.some((r) => r.payload.includes("RAHASIA-JANGAN-DI-OUTBOX"))).toBe(false);
  });
});

describe("halaman pesanan: isi non-WR terbuka setelah verifikasi", () => {
  it("flag credentials_ready menyala; isi hanya keluar dengan WA benar atau token", async () => {
    await paidManualOrder();
    await handover(CODE, { item_index: 0, buyer_message: "Link undangan: https://canva.com/join/ABC" });

    // Endpoint status yang dipoll /pesanan/[code] (GET /api/orders?code=).
    const { GET: getOrder } = await import("@/app/api/orders/route");
    const orderRes = await getOrder(req(`/api/orders?code=${CODE}`, "GET"));
    expect(orderRes.status).toBe(200);
    const orderBody = await orderRes.json() as { order: { credentials_ready: boolean } };
    expect(orderBody.order.credentials_ready).toBe(true);

    const { POST, GET } = await import("@/app/api/orders/[code]/credentials/route");
    const ctx = { params: Promise.resolve({ code: CODE }) };
    const denied = await POST(req(`/api/orders/${CODE}/credentials`, "POST", { wa: "081299999999" }), ctx);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(await denied.json())).not.toContain("canva.com/join");

    const ok = await POST(req(`/api/orders/${CODE}/credentials`, "POST", { wa: "+62 812-3456-7890" }), ctx);
    expect(ok.status).toBe(200);
    const body = await ok.json() as { credentials: { label?: string; details: string }[]; capability_token: string | null };
    expect(body.credentials).toEqual([expect.objectContaining({ label: "Canva Pro — Invite Lifetime", details: "Link undangan: https://canva.com/join/ABC" })]);
    expect(body.capability_token).toMatch(/^[a-f0-9]{64}$/);

    const again = await GET(req(`/api/orders/${CODE}/credentials?token=${body.capability_token}`, "GET"), ctx);
    expect(again.status).toBe(200);
    expect((await again.json() as { credentials: { details: string }[] }).credentials[0].details).toBe("Link undangan: https://canva.com/join/ABC");
    const badToken = await GET(req(`/api/orders/${CODE}/credentials?token=${"0".repeat(64)}`, "GET"), ctx);
    expect(badToken.status).toBe(403);
  });
});

describe("template pesan per varian (POST /api/admin/fulfillment)", () => {
  it("simpan, baca, hapus; terlalu panjang ditolak", async () => {
    const { POST, GET } = await import("@/app/api/admin/fulfillment/route");
    const save = await POST(req("/api/admin/fulfillment", "POST", { action: "set_handover_template", product_id: 1, variant_id: 2, handover_template: "  Akun untuk {nama}  " }));
    expect(save.status).toBe(200);
    const read = await GET(req("/api/admin/fulfillment?product_id=1&variant_id=2", "GET"));
    expect((await read.json() as { handover_template: string }).handover_template).toBe("Akun untuk {nama}");
    const tooLong = await POST(req("/api/admin/fulfillment", "POST", { action: "set_handover_template", product_id: 1, variant_id: 2, handover_template: "x".repeat(2001) }));
    expect(tooLong.status).toBe(400);
    await POST(req("/api/admin/fulfillment", "POST", { action: "set_handover_template", product_id: 1, variant_id: 2, handover_template: "" }));
    expect(fixture.sql.prepare("SELECT handover_template FROM product_variants WHERE id=2").get()?.handover_template).toBeNull();
  });
});
