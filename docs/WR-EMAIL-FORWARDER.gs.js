/**
 * AXVARA WR-INGEST forwarder — Google Apps Script.
 *
 * Pasang SEKALI di akun Gmail ingest (assidiq247@gmail.com):
 * 1. Buka https://script.google.com → New project → paste seluruh file ini.
 * 2. Ganti WEBHOOK_URL + WEBHOOK_SECRET di bawah (secret SAMA dengan Pages
 *    Secret WR_EMAIL_WEBHOOK_SECRET).
 * 3. Run setup() sekali (beri izin Gmail + URL eksternal saat diminta).
 * 4. Triggers (jam, kiri) → Add Trigger → pollWrIngest → Time-driven →
 *    Minutes timer → Every minute → Save.
 *
 * Cara kerja: tiap menit baca label WR-INGEST yang BELUM berlabel WR-SENT,
 * POST subject + body ke /api/webhook/wr-email Axvara, lalu cap WR-SENT bila
 * server menjawab ok/duplicate/unmatched/skipped/held (semua = "sudah
 * ditangani, jangan kirim ulang"). Bila server 5xx / timeout → JANGAN cap,
 * biar dicoba lagi menit berikutnya. Email lama TANPA label WR-INGEST
 * (kasus kamu) tidak tersentuh — hanya email baru pasca-filter.
 */

var WEBHOOK_URL = 'https://axvara.tech/api/webhook/wr-email';
var WEBHOOK_SECRET = 'GANTI_DENGAN_WR_EMAIL_WEBHOOK_SECRET_YANG_SAMA_DI_PAGES';
var SOURCE_LABEL = 'WR-INGEST';
var SENT_LABEL = 'WR-SENT';
var BATCH = 10;

function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('WR_EMAIL_WEBHOOK_SECRET')) {
    props.setProperty('WR_EMAIL_WEBHOOK_SECRET', WEBHOOK_SECRET);
  }
  getOrCreateLabel_(SENT_LABEL);
  Logger.log('OK: label ' + SENT_LABEL + ' siap. Pasang trigger per-menit untuk pollWrIngest.');
}

function secret_() {
  var s = PropertiesService.getScriptProperties().getProperty('WR_EMAIL_WEBHOOK_SECRET');
  if (s) return s;
  return WEBHOOK_SECRET;
}

function getOrCreateLabel_(name) {
  var label = GmailApp.getUserLabelByName(name);
  return label ? label : GmailApp.createLabel(name);
}

function pollWrIngest() {
  var source = GmailApp.getUserLabelByName(SOURCE_LABEL);
  if (!source) return;
  var sent = getOrCreateLabel_(SENT_LABEL);
  var threads = source.getThreads(0, BATCH);
  for (var i = 0; i < threads.length; i++) {
    // Skip thread yang seluruhnya sudah diproses (hemat kuota UrlFetch).
    if (threadHasLabel_(threads[i], SENT_LABEL)) continue;
    var messages = threads[i].getMessages();
    var allFinal = true;
    for (var j = 0; j < messages.length; j++) {
      var status = forwardOne_(messages[j]);
      // Cap SENT untuk semua status final server (ok/duplicate/unmatched/
      // skipped/held/4xx). Hanya "retry" (5xx/429/timeout) yang dibiarkan
      // untuk percobaan menit berikutnya.
      if (status === 'retry') allFinal = false;
    }
    if (allFinal) {
      try { threads[i].addLabel(sent); } catch (e) { /* next run */ }
    }
  }
}

function threadHasLabel_(thread, name) {
  try {
    var labels = thread.getLabels();
    for (var k = 0; k < labels.length; k++) {
      if (labels[k].getName() === name) return true;
    }
  } catch (e) { /* anggap belum */ }
  return false;
}

function forwardOne_(msg) {
  var payload = {
    gmail_message_id: msg.getId(),
    subject: msg.getSubject(),
    body_html: msg.getBody(),
    body_text: msg.getPlainBody()
  };
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-wr-email-secret': secret_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  var res;
  try {
    res = UrlFetchApp.fetch(WEBHOOK_URL, options);
  } catch (e) {
    return 'retry';
  }
  var code = res.getResponseCode();
  if (code >= 500) return 'retry';
  if (code === 429) return 'retry';
  return 'sent';
}
