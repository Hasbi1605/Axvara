// src/lib/notify-buyer.ts — Kabar untuk PEMBELI, lintas kanal.
//
// KENAPA ADA (audit ronde 2, 2026-09-23): keputusan sistem dan aksi admin
// selama ini berhenti di sisi admin. Tiga lubang yang ditutup modul ini:
//   1. Serah terima manual menandai item `delivered` tanpa satu pun pesan,
//      padahal pesan lunas Telegram sudah TERLANJUR berjanji "Produk akan
//      dikirim admin melalui DM Telegram pribadi ini".
//   2. Bukti pembayaran ditolak hanya menulis `status='rejected'` — pembeli
//      melihat "Pending" selamanya tanpa alasan dan tanpa jalan keluar.
//   3. Bukti QRIS disetujui membalas `payment_updated:false` (QRIS Hook tetap
//      otoritatif) sehingga order SENGAJA tetap pending — benar secara sistem,
//      tetapi pembeli tidak pernah diberi tahu harus menunggu apa.
//
// Kanal WEB lewat EMAIL (audit ronde 4, 2026-09-24). Dulu web memakai outbox
// WhatsApp seperti kanal WA, padahal bot WA mati (outbox produksi 18–19 Sep:
// `dead` / `whatsapp_not_connected`), sehingga keempat kabar di atas tidak
// pernah sampai ke pembeli web. Email wajib di checkout sejak 2026-09-23.
// Order web lama tanpa email tetap jatuh ke outbox WA.
//
// Pengiriman sengaja best-effort dan TIDAK PERNAH melempar: kabar yang gagal
// terkirim tidak boleh membatalkan serah terima atau review bukti yang sudah
// sah tercatat. Idempotensi: WA lewat `idempotency_key` outbox; email dan
// Telegram lewat `buyer_notice_log` (migrasi 0039), karena satu order bisa
// memicu kabar yang sama berkali-kali (beberapa item/link WR yang gagal).
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { escapeHtml } from "@/lib/telegram/messages/format";
import type { Locale } from "@/lib/i18n/locale";

type Notice = {
  subject: string;
  /** HTML sederhana Telegram (`<b>`, `<code>`, baris baru) + teks WA. */
  body: string;
  /** Bagian HTML kredensial + panduan Telegram yang sudah dibatasi panjangnya. */
  chatMessages?: string[];
  /** Ajakan khusus chat, mis. "balas pesan ini" (tidak berlaku untuk email noreply). */
  chatCta?: string;
  /**
   * Isi email bermerek (shell Midnight + Cyan yang sama dengan email WR,
   * 2026-09-25). Tanpa emoji; paragraf teks polos di-escape saat render.
   */
  email: { title: string; subtitle: string; paragraphs: string[]; callout?: { text: string; tone: "info" | "warning" } | null };
  /** Email yang sudah jadi (mis. "Pesanan Siap" berisi detail produk). */
  emailOverride?: { subject: string; html: string; text: string };
  refKey: string;
};

/** Batas kirim per kabar: dipanggil dari webhook/cron yang punya deadline. */
const NOTICE_EMAIL_TIMEOUT_MS = 8_000;


/** Salinan email EN untuk kabar pembeli; ID default byte-identik. */
function localizeNotice(notice: Notice, locale: Locale): Notice {
  if (locale !== "en") return notice;
  const code = String(notice.refKey.split(":")[1] ?? "");
  const key = String(notice.refKey.split(":")[0] ?? "");
  const set = (subject: string, title: string, subtitle: string, paragraphs: string[], callout?: Notice["email"]["callout"]): Notice => ({
    ...notice,
    subject,
    email: { ...notice.email, title, subtitle, paragraphs, ...(callout === undefined ? {} : { callout }) },
  });
  switch (key) {
    case "handover":
      return set(`Order ${code} has been delivered`, "Order Delivered", "The admin has sent your product.", [
        `The admin has sent the product for order ${code}.`,
        "Have not received it? Contact the admin using the button below with the order code.",
      ]);
    case "proof-rejected": {
      const reason = String(notice.email.callout?.text ?? "").replace(/^Alasan:\s*/i, "").trim();
      const out = set(`Payment proof for order ${code} was rejected`, "Payment Proof Rejected", "Your order is not paid yet.", [
        `We could not accept the payment proof for order ${code}.`,
        "Please pay again via QRIS on the order page, or contact the admin if you believe this is a mistake.",
      ], reason ? { text: `Reason: ${reason}`, tone: "warning" } : null);
      return out;
    }
    case "proof-pending-hook":
      return set(`Payment proof for order ${code} received`, "Payment Proof Received", "Waiting for automatic verification.", [
        `We have received the payment proof for order ${code}.`,
        "QRIS payments are confirmed automatically by the system, so the status is still awaiting verification. We will let you know once the payment is recorded as paid.",
      ]);
    case "delivery-failed":
      return set(`Delivery for order ${code} has an issue`, "Delivery Delayed", "Your payment is safe and received.", [
        `We received the payment for order ${code}, but the product failed to deliver automatically.`,
        "The admin has been notified and will send it manually. If you have not heard back, contact the admin with the button below.",
      ]);
    case "wr-blocked":
    case "sk-blocked":
      return set(`Order ${code} is temporarily delayed`, "Order Temporarily Delayed", "Your payment is safe and received.", [
        `We received the payment for order ${code}, but the product stock is being restocked so delivery is delayed.`,
        "Your order remains queued and will be processed automatically once stock is ready — no need to pay again. If you have not heard back, contact the admin with the button below.",
      ]);
    case "sk-processing":
      return set(`Order ${code} is being processed — AXVARA`, "Order Processing", "There is a status update for your order.", [
        `Your order ${code} is being processed. Product details will be available shortly in this email and on the order page.`,
        "No need to wait — we will let you know by email as soon as it is ready. You can also reopen the order page anytime with the button below.",
      ]);
    case "payment-received": {
      const name = String(notice.email.paragraphs[0] ?? "").replace(/^Terima kasih\s+/i, "").replace(/\s+telah berbelanja.*$/i, "").trim();
      return set(`Payment for order ${code} received`, "Payment Received", "Your order is being processed.", [
        `Thank you ${name} for shopping at Axvara.`,
        `The payment for order ${code} has been recorded and the order is being processed.`,
        "Product details are sent to this email and also shown on the order page.",
      ]);
    }
    default:
      return notice;
  }
}

function siteUrl(): string {
  return (process.env.SITE_URL || "https://axvara.tech").replace(/\/$/, "");
}

/** true = pemanggil ini berhak mengirim; false = sudah terkirim / sedang dikirim worker lain. */
export async function claimNotice(database: DatabaseAccess, key: string, orderCode: string, channel: "email" | "telegram"): Promise<boolean> {
  try {
    const result = await database.execRun(
      `INSERT INTO buyer_notice_log (idempotency_key, order_code, channel, status)
       VALUES (?, ?, ?, 'sending')
       ON CONFLICT(idempotency_key) DO UPDATE SET status='sending', error=NULL, updated_at=datetime('now')
       WHERE buyer_notice_log.status='failed'
          OR (buyer_notice_log.status='sending'
              AND julianday(buyer_notice_log.updated_at) < julianday('now','-10 minutes'))`,
      key, orderCode, channel,
    );
    return Number(result.changes ?? 0) > 0;
  } catch {
    // Ledger tak terbaca: lebih baik kabar berisiko ganda daripada hilang.
    return true;
  }
}

export async function settleNotice(database: DatabaseAccess, key: string, ok: boolean, providerId?: string, error?: string) {
  await database.execRun(
    `UPDATE buyer_notice_log SET status=?, provider_id=?, error=?, updated_at=datetime('now') WHERE idempotency_key=?`,
    ok ? "sent" : "failed", providerId ?? null, ok ? null : String(error || "send_failed").slice(0, 300), key,
  ).catch(() => undefined);
}

async function sendEmailNotice(database: DatabaseAccess, orderCode: string, to: string, notice: Notice, locale: Locale = "id"): Promise<boolean> {
  const key = `email:${notice.refKey}`;
  if (!(await claimNotice(database, key, orderCode, "email"))) return true;
  const orderUrl = `${siteUrl()}/pesanan/${encodeURIComponent(orderCode)}`;
  let result: { ok: boolean; providerId?: string; error?: string };
  try {
    const { sendForwardEmail } = await import("@/lib/warung-rebahan/forward-sender");
    const { renderBrandedNotice } = await import("@/lib/warung-rebahan/email-forward");
    const { SITE } = await import("@/lib/site");
    const localized = localizeNotice(notice, locale);
    const rendered = localized.emailOverride ?? {
      subject: localized.subject,
      ...renderBrandedNotice({ orderCode, orderUrl, supportWa: SITE.adminWaLocal, ...localized.email, locale }),
    };
    result = await sendForwardEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      timeoutMs: NOTICE_EMAIL_TIMEOUT_MS,
    });
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : "resend_failed" };
  }
  await settleNotice(database, key, result.ok, result.providerId, result.error);
  return result.ok;
}

/** DM Telegram pribadi pembeli (kanal otoritatif order Telegram). */
async function sendTelegramNotice(
  orderCode: string, notice: Notice, order: Record<string, unknown>, database: DatabaseAccess, chatText: string,
): Promise<boolean> {
  const { queryFirst } = database;
  // HANYA chat pribadi terverifikasi — tidak pernah ke id grup (issue #5).
  const buyerId = String(order.telegram_user_id || "");
  if (!buyerId) return false;
  const row = await queryFirst(`SELECT chat_id FROM telegram_users WHERE user_id=?`, buyerId).catch(() => null);
  const chatId = String(row?.chat_id || "");
  if (!chatId || Number(chatId) <= 0) return false;
  const key = `telegram:${notice.refKey}`;
  if (!(await claimNotice(database, key, orderCode, "telegram"))) return true;
  if (notice.chatMessages) {
    try {
      const { sendTelegramCredentialParts } = await import("@/lib/telegram/credential-delivery");
      const sent = await sendTelegramCredentialParts(chatId, notice.chatMessages);
      await settleNotice(database, key, true, sent.messageId);
      return true;
    } catch {
      await settleNotice(database, key, false, undefined, "telegram_credential_part_failed");
      return false;
    }
  }
  const { sendMessage } = await import("@/lib/telegram/api");
  const sent = await sendMessage({ chat_id: chatId, text: chatText, parse_mode: "HTML" })
    .catch(() => ({ ok: false, description: "telegram_send_failed" }));
  await settleNotice(database, key, Boolean(sent?.ok), undefined, sent?.description);
  return Boolean(sent?.ok);
}

/**
 * Salinan email untuk pembeli Telegram yang pesanannya memuat produk wajib-email
 * (keputusan owner 2026-11-04). Best-effort: tidak pernah melempar dan tidak
 * memengaruhi hasil DM Telegram. Idempoten lewat kunci `email:<refKey>`.
 * Mengembalikan true hanya bila email berhak dikirim DAN terkirim.
 */
async function sendTelegramEmailCopy(orderCode: string, notice: Notice, database: DatabaseAccess, locale: Locale = "id"): Promise<boolean> {
  try {
    const { telegramEmailCopyTarget } = await import("@/lib/telegram/email-copy");
    const email = await telegramEmailCopyTarget(orderCode, database);
    if (!email) return false;
    return await sendEmailNotice(database, orderCode, email, notice, locale);
  } catch {
    return false;
  }
}

/**
 * Kirim satu kabar ke pembeli lewat kanal asal order.
 * `emailOnly` (hanya order Telegram): lewati DM Telegram dan kirim salinan email
 * saja, untuk kabar yang DM-nya sudah dikirim jalur lain (mis. pesan lunas).
 */
async function sendToBuyer(
  orderCode: string,
  notice: Notice,
  database: DatabaseAccess,
  options: { whatsappFallback?: boolean; emailOnly?: boolean } = {},
): Promise<boolean> {
  const { queryFirst } = database;
  const order = await queryFirst(
    `SELECT code, sales_channel, customer_wa, customer_email, telegram_user_id, locale
     FROM orders WHERE code=?`,
    orderCode,
  ).catch(() => null);
  if (!order) return false;
  const locale: Locale = String(order.locale ?? "id") === "en" ? "en" : "id";

  const channel = String(order.sales_channel || "web");
  const chatText = notice.chatCta ? `${notice.body}\n\n${notice.chatCta}` : notice.body;

  if (channel === "telegram") {
    if (options.emailOnly) return await sendTelegramEmailCopy(orderCode, notice, database, locale);
    const delivered = await sendTelegramNotice(orderCode, notice, order, database, chatText);
    // Salinan email dicoba apa pun hasil DM; nilai kembalian tetap hasil DM.
    await sendTelegramEmailCopy(orderCode, notice, database, locale);
    return delivered;
  }

  if (channel === "web") {
    const email = String(order.customer_email || "").trim();
    if (email) return await sendEmailNotice(database, orderCode, email, notice, locale);
  }

  if (options.whatsappFallback === false) return false;
  const target = String(order.customer_wa || "").trim();
  if (!target) return false;
  const { enqueueWhatsAppMessage, waOutboxKey } = await import("@/lib/whatsapp/outbox");
  return await enqueueWhatsAppMessage(waOutboxKey("text", notice.refKey), target, chatText).catch(() => false);
}

/** Accepted supplier work only; never replay processing mail for terminal/manual orders. */
export async function notifyBuyerTunvnProcessing(orderCode:string,linkId:number,database:DatabaseAccess=createDatabaseAccess()):Promise<boolean> {
  if (!database.canSpend(6)) return false;
  const meta=await database.queryFirst(`SELECT l.kind,o.locale FROM tunvn_order_links l
    JOIN orders o ON o.code=l.order_code JOIN fulfillment_items f ON f.tunvn_link_id=l.id
    WHERE l.id=? AND l.order_code=? AND o.sales_channel='web' AND o.status='lunas' AND o.payment_status='paid'
      AND o.supplier_purchase_disabled=0 AND f.status NOT IN ('delivered','sending')
      AND l.request_sent_at IS NOT NULL AND l.attempt_count>0
      AND ((l.kind='buff' AND l.status='processing' AND l.provider_batch_id IS NOT NULL)
        OR (l.kind='account' AND l.status='claimed' AND l.provider_order_group IS NOT NULL AND l.receipt_http_status=200))`,linkId,orderCode).catch(()=>null);
  if (!meta) return false;
  const en=meta.locale==="en",buff=meta.kind==="buff";
  return sendToBuyer(orderCode,{
    subject:en ? `Order ${orderCode} is being processed - AXVARA` : `Pesanan ${orderCode} sedang diproses - AXVARA`,
    body:en ? "Your order is being processed automatically." : "Pesananmu sedang diproses otomatis.",
    email:{title:en ? "Order Processing" : "Pesanan Diproses",subtitle:en ? "Your order is being processed automatically." : "Pesananmu sedang diproses otomatis.",paragraphs:[
      buff ? (en ? "Your Muse token top-up has been accepted and is being processed. No account credentials are needed." : "Isi ulang token Muse sudah diterima dan sedang diproses. Isi ulang ini tidak memerlukan kredensial akun.")
        : (en ? "Your product is being prepared automatically." : "Produkmu sedang disiapkan otomatis."),
      en ? "We will email you when it is complete. You can check the latest status on your order page." : "Kami akan mengabari lewat email setelah selesai. Status terbaru dapat dilihat di halaman pesanan.",
    ]},refKey:`tunvn-processing:${orderCode}:${linkId}`,
  },database,{whatsappFallback:false}).catch(()=>false);
}

/** Noncredential completion: never include the supplied invite code. */
export async function notifyBuyerBuffCompleted(orderCode:string,itemIndex:number,database:DatabaseAccess=createDatabaseAccess()):Promise<boolean> {
  const order=await database.queryFirst("SELECT locale FROM orders WHERE code=?",orderCode);
  const en=order?.locale==="en";
  return sendToBuyer(orderCode,{
    subject:en ? `Muse token top-up complete - ${orderCode}` : `Isi ulang token Muse selesai - ${orderCode}`,
    body:en ? "Your Muse token top-up is complete." : "Isi ulang token Muse selesai diproses.",
    email:{ title:en ? "Top-up Complete" : "Isi Ulang Selesai",subtitle:en ? "Your Muse tokens have been credited." : "Token Muse sudah ditambahkan.",paragraphs:[en ? "No account credentials are needed for this top-up." : "Isi ulang ini tidak memerlukan kredensial akun."] },
    refKey:`buff-completed:${orderCode}:${itemIndex}`,
  },database,{ whatsappFallback:false });
}

/** Manual handover uses the same private ready-email/Telegram pipeline. */
export async function notifyBuyerHandover(
  orderCode: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  // Handover is a Market concept (credentials/delivery). Pedia rejects safely
  // here; its followup flow lives in PediaManager, and AXV behavior is unchanged.
  // A kind-lookup failure MUST return false, never fall through to Market.
  try {
    const kind = await database.queryFirst(`SELECT order_kind FROM orders WHERE code=?`, orderCode).catch(() => null);
    if (!kind) return false;
    if (String(kind.order_kind || "apps") === "pedia") return false;
  } catch {
    return false;
  }
  try {
    const { readDeliveredSnapshots } = await import("@/lib/fulfillment/delivery/buyer-email");
    const contents = await readDeliveredSnapshots(orderCode, database, { manualOnly: true });
    if (!contents.length) {
      return await sendToBuyer(orderCode, {
        subject: `Pesanan ${orderCode} sudah diserahkan`,
        body: `✅ <b>Pesanan selesai diserahkan</b>\nOrder: <code>${orderCode}</code>\n\nAdmin sudah mengirimkan produkmu.`,
        chatCta: "Jika belum menerimanya, balas pesan ini.",
        email: {
          title: "Pesanan Diserahkan",
          subtitle: "Admin sudah mengirimkan produkmu.",
          paragraphs: [
            `Admin sudah mengirimkan produk untuk pesanan ${orderCode}.`,
            "Belum menerimanya? Hubungi admin lewat tombol di bawah dengan menyebut kode pesanan.",
          ],
        },
        refKey: `handover:${orderCode}`,
      }, database);
    }
    const order = await database.queryFirst(`SELECT code, customer_name, sales_channel, buyer_access_version,buyer_access_format, locale FROM orders WHERE code=?`, orderCode).catch(() => null);
    let chatMessages: string[] | undefined;
    if (String(order?.sales_channel) === "telegram") {
      const { resolveCredentialTermsByItem } = await import("@/lib/orders/credential-terms");
      const { credentialMessages } = await import("@/lib/telegram/messages/credential");
      const copies = await resolveCredentialTermsByItem(orderCode, database);
      chatMessages = contents.flatMap(content => credentialMessages({
        orderCode, productName: content.label, plaintext: content.details, copy: copies.get(content.itemIndex),
      }));
    }
    const { buildOrderReadyTemplate } = await import("@/lib/warung-rebahan/email-forward");
    const { SITE } = await import("@/lib/site");
    // Serah terima manual ke email privat memakai template yang sama — kode
    // akses ephemeral dari versi tersimpan aktual; legacy = "" tanpa blok.
    const { deriveOrderAccessCode } = await import("@/lib/order-access");
    const handoverAccessCode = await deriveOrderAccessCode({
      code: String(order?.code ?? orderCode),
      buyer_access_version: (order as { buyer_access_version?: unknown; buyer_access_format?: unknown } | null)?.buyer_access_version, buyer_access_format: order?.buyer_access_format,
    });
    const template = buildOrderReadyTemplate({
      locale: String(order?.locale ?? "id") === "en" ? "en" : "id",
      axvaraOrderCode: orderCode,
      buyerName: String(order?.customer_name ?? ""),
      invoiceUrl: `${siteUrl()}/pesanan/${encodeURIComponent(orderCode)}`,
      supportWa: SITE.adminWaLocal,
      items: contents.map((c) => ({ label: c.label, details: c.details })),
      buyerAccessCode: handoverAccessCode || undefined,
    });
    const chatBody = `✅ <b>Pesanan siap</b>\nOrder: <code>${orderCode}</code>\n`
      + contents.map((c) => `\n<b>${escapeHtml(c.label)}</b>\n<code>${escapeHtml(c.details)}</code>`).join("\n")
      + "\n\nSimpan baik-baik dan jangan bagikan ke siapa pun.";
    return await sendToBuyer(orderCode, {
      subject: template.subject,
      body: chatBody,
      chatMessages,
      chatCta: "Ada kendala? Balas pesan ini.",
      email: { title: String(order?.locale ?? "id") === "en" ? "Order Ready" : "Pesanan Siap", subtitle: String(order?.locale ?? "id") === "en" ? "Your product is ready to use." : "Produkmu sudah siap dipakai.", paragraphs: [] },
      emailOverride: template,
      refKey: `handover:${orderCode}`,
      // Isi kredensial TIDAK boleh masuk outbox WA (disimpan teks polos dan
      // bot WA mati): order web tanpa email = pembeli tidak dikabari, dan
      // admin melihat peringatan "pembeli belum dikabari".
    }, database, { whatsappFallback: false });
  } catch {
    return false;
  }
}

/** Pesan saat bukti pembayaran ditolak — alasan WAJIB disertakan. */
export async function notifyBuyerProofRejected(
  orderCode: string,
  reason: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  const clean = String(reason || "").trim();
  return await sendToBuyer(orderCode, {
    subject: `Bukti pembayaran pesanan ${orderCode} ditolak`,
    body: `⚠️ <b>Bukti pembayaran ditolak</b>\nOrder: <code>${orderCode}</code>\n`
      + (clean ? `Alasan: ${escapeHtml(clean)}\n` : "")
      + "\nPesananmu belum lunas. Silakan bayar ulang lewat QRIS atau hubungi admin bila merasa ini keliru.",
    email: {
      title: "Bukti Pembayaran Ditolak",
      subtitle: "Pesananmu belum lunas.",
      paragraphs: [
        `Bukti pembayaran untuk pesanan ${orderCode} belum bisa kami terima.`,
        "Silakan bayar ulang lewat QRIS di halaman pesanan, atau hubungi admin bila merasa ini keliru.",
      ],
      callout: clean ? { text: `Alasan: ${clean}`, tone: "warning" } : null,
    },
    // Alasan ikut kunci: penolakan kedua dengan alasan berbeda tetap terkirim.
    refKey: `proof-rejected:${orderCode}:${clean.slice(0, 40)}`,
  }, database).catch(() => false);
}

/**
 * Pesan saat screenshot QRIS disetujui admin TETAPI status lunas masih
 * menunggu QRIS Hook. Order sengaja tetap pending — tanpa pesan ini pembeli
 * mengira sudah beres.
 */
export async function notifyBuyerProofPendingHook(
  orderCode: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  return await sendToBuyer(orderCode, {
    subject: `Bukti pembayaran pesanan ${orderCode} diterima`,
    body: `ℹ️ <b>Bukti diterima</b>\nOrder: <code>${orderCode}</code>\n\n`
      + "Pembayaran QRIS dikonfirmasi otomatis oleh sistem, jadi statusnya masih "
      + "menunggu verifikasi. Kamu akan dikabari lagi begitu pembayaran tercatat lunas.",
    email: {
      title: "Bukti Pembayaran Diterima",
      subtitle: "Menunggu verifikasi otomatis.",
      paragraphs: [
        `Bukti pembayaran untuk pesanan ${orderCode} sudah kami terima.`,
        "Pembayaran QRIS dikonfirmasi otomatis oleh sistem, jadi statusnya masih menunggu verifikasi. Kamu akan dikabari lagi begitu pembayaran tercatat lunas.",
      ],
    },
    refKey: `proof-pending-hook:${orderCode}`,
  }, database).catch(() => false);
}

/**
 * Pesan saat pengiriman produk GAGAL permanen padahal order sudah lunas.
 *
 * Dulu kegagalan terminal hanya membunyikan Telegram ADMIN
 * (`adminDeliveryFailedNotification`); pembeli yang sudah membayar tidak
 * pernah diberi tahu dan menunggu tanpa batas — pasangan alami dari
 * ketiadaan alur refund. Nada pesan sengaja menjanjikan tindak lanjut manual
 * (admin memang sudah dapat notifikasi + tombol "Serahkan manual").
 * Dipanggil dari jalur fulfillment biasa DAN jalur Warung Rebahan; kunci
 * idempoten per order menjaga pembeli hanya menerima satu kabar.
 */
export async function notifyBuyerDeliveryFailed(
  orderCode: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  return await sendToBuyer(orderCode, {
    subject: `Pengiriman pesanan ${orderCode} bermasalah`,
    body: `⚠️ <b>Pengiriman produk bermasalah</b>\nOrder: <code>${orderCode}</code>\n\n`
      + "Pembayaranmu sudah kami terima, tetapi produk gagal dikirim otomatis. "
      + "Admin sudah mendapat notifikasi dan akan menyerahkannya manual.",
    email: {
      title: "Pengiriman Tertunda",
      subtitle: "Pembayaranmu aman dan sudah kami terima.",
      paragraphs: [
        `Pembayaran untuk pesanan ${orderCode} sudah kami terima, tetapi produk gagal dikirim otomatis.`,
        "Admin sudah mendapat notifikasi dan akan mengirimkannya manual. Bila belum ada kabar, hubungi admin lewat tombol di bawah.",
      ],
    },
    chatCta: "Balas pesan ini bila belum ada kabar.",
    refKey: `delivery-failed:${orderCode}`,
  }, database).catch(() => false);
}

/**
 * Kabar saat order WR tertahan karena saldo Warung Rebahan habis
 * (2026-09-28, zombie-order fix): order sudah lunas tetapi pembelian ke
 * upstream tertunda — pembeli diberi tahu agar tidak menunggu buta.
 * Idempoten per order (`wr-blocked:<kode>`); satu kabar walau beberapa
 * link blocked. Best-effort, tidak pernah melempar.
 */
export async function notifyBuyerWrBlocked(
  orderCode: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  return await sendToBuyer(orderCode, {
    subject: `Pesanan ${orderCode} tertunda sementara`,
    body: `⏳ <b>Pesanan tertunda sementara</b>\nOrder: <code>${orderCode}</code>\n\n`
      + "Pembayaranmu sudah kami terima, tetapi stok produk sedang disiapkan ulang "
      + "sehingga pengiriman tertunda. Pesananmu tetap antre dan diproses otomatis "
      + "begitu stok siap — tidak perlu bayar ulang.",
    email: {
      title: "Pesanan Tertunda Sementara",
      subtitle: "Pembayaranmu aman dan sudah kami terima.",
      paragraphs: [
        `Pembayaran untuk pesanan ${orderCode} sudah kami terima, tetapi stok produk sedang disiapkan ulang sehingga pengiriman tertunda.`,
        "Pesananmu tetap antre dan diproses otomatis begitu stok siap — tidak perlu bayar ulang. Bila belum ada kabar, hubungi admin lewat tombol di bawah.",
      ],
    },
    chatCta: "Balas pesan ini bila belum ada kabar.",
    refKey: `wr-blocked:${orderCode}`,
  }, database).catch(() => false);
}

/**
 * Kabar saat order SK tertahan karena saldo Sekalipay habis (cermin
 * notifyBuyerWrBlocked): order sudah lunas tetapi pembelian ke upstream
 * tertunda — pembeli diberi tahu agar tidak menunggu buta.
 * Idempoten per order (`sk-blocked:<kode>`); satu kabar walau beberapa
 * link blocked. Best-effort, tidak pernah melempar.
 */
export async function notifyBuyerSkBlocked(
  orderCode: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  return await sendToBuyer(orderCode, {
    subject: `Pesanan ${orderCode} tertunda sementara`,
    body: `⏳ <b>Pesanan tertunda sementara</b>\nOrder: <code>${orderCode}</code>\n\n`
      + "Pembayaranmu sudah kami terima, tetapi stok produk sedang disiapkan ulang "
      + "sehingga pengiriman tertunda. Pesananmu tetap antre dan diproses otomatis "
      + "begitu stok siap — tidak perlu bayar ulang.",
    email: {
      title: "Pesanan Tertunda Sementara",
      subtitle: "Pembayaranmu aman dan sudah kami terima.",
      paragraphs: [
        `Pembayaran untuk pesanan ${orderCode} sudah kami terima, tetapi stok produk sedang disiapkan ulang sehingga pengiriman tertunda.`,
        "Pesananmu tetap antre dan diproses otomatis begitu stok siap — tidak perlu bayar ulang. Bila belum ada kabar, hubungi admin lewat tombol di bawah.",
      ],
    },
    chatCta: "Balas pesan ini bila belum ada kabar.",
    refKey: `sk-blocked:${orderCode}`,
  }, database).catch(() => false);
}

/**
 * Kabar saat lisensi SK sedang diproses upstream (cermin template WR
 * "Pesanan Diproses"): SK mengirim event order.paid / order.item.sent
 * SEBELUM order.completed — celah menit ini dulu sunyi total, pembeli hanya
 * melihat spinner halaman. Idempoten per invoice (`sk-processing:<kode>:<inv>`)
 * agar retry webhook tidak mengirim kabar kedua.
 */
export async function notifyBuyerSkProcessing(
  orderCode: string,
  skInvoice: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  const invoice = String(skInvoice || "").slice(0, 40);
  // Telegram: TIDAK dikirim (2026-10-04). Pesan lunas Telegram sudah memberi
  // ekspektasi (kirim otomatis / Made By Order) dan lisensi menyusul langsung
  // ke chat yang sama. Kabar ini dulu membocorkan kata "Pemasok" dan
  // menjanjikan "email ini" kepada pembeli Telegram yang tidak punya email.
  // Juga dilewati bila item SK order ini sudah terkirim (webhook paid/
  // completed balapan) agar pembeli tidak menerima "diproses" setelah "siap".
  const meta = await database.queryFirst(
    `SELECT o.sales_channel,
            (SELECT COUNT(*) FROM fulfillment_items fi WHERE fi.order_code=o.code
               AND fi.status='delivered' AND fi.delivered_message_id LIKE 'sk:%') AS sk_delivered
     FROM orders o WHERE o.code=?`,
    orderCode,
  ).catch(() => null);
  if (String(meta?.sales_channel || "") === "telegram") return false;
  if (Number(meta?.sk_delivered ?? 0) > 0) return false;
  return await sendToBuyer(orderCode, {
    subject: `Pesanan ${orderCode} sedang diproses — AXVARA`,
    body: `⏳ <b>Pesanan sedang diproses</b>\nOrder: <code>${orderCode}</code>\n\n`
      + "Tim Axvara sedang menyiapkan produkmu. Detail produk dikirim otomatis "
      + "dan juga tampil di halaman pesanan begitu siap.",
    email: {
      title: "Pesanan Diproses",
      subtitle: "Ada pembaruan status untuk pesananmu.",
      paragraphs: [
        `Pesanan ${orderCode} kamu sedang diproses. Detail produk akan segera tersedia di email ini dan juga di halaman pesanan.`,
        "Tidak perlu menunggu — begitu siap, kami kabari lewat email ini. Kamu juga bisa membuka lagi halaman pesanan kapan saja lewat tombol di bawah.",
      ],
    },
    refKey: `sk-processing:${orderCode}:${invoice}`,
  }, database, { whatsappFallback: false }).catch(() => false);
}

/**
 * Tanda terima pembayaran untuk pembeli WEB (audit ronde 4, B-H1).
 *
 * Telegram sudah punya `notifyTelegramBuyerPaid`. Pembeli web dulu tidak
 * menerima apa pun sampai produknya terkirim — untuk produk Made By Order
 * bisa sampai 12 jam — jadi yang menutup tab setelah bayar tidak tahu
 * uangnya sudah tercatat. Tanpa fallback WA: bot WA mati.
 */
export async function notifyBuyerPaymentReceived(
  orderCode: string,
  database: DatabaseAccess = createDatabaseAccess(),
  // Telegram: `emailOnly` = hanya salinan email; DM lunas sudah dikirim
  // notifyTelegramBuyerPaid sehingga tidak boleh ada pesan Telegram ganda.
  options: { emailOnly?: boolean } = {},
): Promise<boolean> {
  // Pedia never promises Market credentials: route to the Pedia paid email.
  // A kind-lookup failure MUST return false (silent), never fall through to
  // the Market credential promise for a possibly-Pedia order.
  try {
    const kind = await database.queryFirst(`SELECT order_kind FROM orders WHERE code=?`, orderCode).catch(() => null);
    if (!kind) return false;
    if (String(kind.order_kind || "apps") === "pedia") {
      const { notifyPediaPaid } = await import("@/lib/pedia/notify");
      return await notifyPediaPaid(database, orderCode);
    }
  } catch {
    return false;
  }
  const order = await database.queryFirst(
    `SELECT code, customer_name, buyer_access_version,buyer_access_format FROM orders WHERE code=?`,
    orderCode,
  ).catch(() => null);
  const firstName = String(order?.customer_name ?? "").trim().split(/\s+/)[0] || "Kak";
  // Kode akses di-derive ephemeral dari versi tersimpan aktual (NEVER tebak
  // v1 untuk order lama/reused); legacy (versi 0) = "" dan paragraf identik.
  return await sendToBuyer(orderCode, {
    subject: `Pembayaran pesanan ${orderCode} diterima`,
    body: `✅ <b>Pembayaran diterima</b>\nOrder: <code>${orderCode}</code>\n\n`
      + `Terima kasih ${escapeHtml(firstName)} telah berbelanja di Axvara. `
      + "Pembayaranmu sudah tercatat dan pesanan sedang diproses. Detail produk dikirim "
      + "ke email ini dan juga tampil di halaman pesanan.",
    email: {
      title: "Pembayaran Diterima",
      subtitle: "Pesananmu sedang diproses.",
      paragraphs: [
        `Terima kasih ${firstName} telah berbelanja di Axvara.`,
        `Pembayaran untuk pesanan ${orderCode} sudah tercatat dan pesanan sedang diproses.`,
        "Detail produk dikirim ke email ini dan juga tampil di halaman pesanan.",
      ],
    },
    refKey: `payment-received:${orderCode}`,
  }, database, { whatsappFallback: false, emailOnly: options.emailOnly }).catch(() => false);
}
