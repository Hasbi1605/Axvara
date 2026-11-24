"use strict";
const $ = (id) => document.getElementById(id);
const els = {
  address: $("address"),
  addrField: $("addr-field"),
  copy: $("copy"),
  toggleCustom: $("toggle-custom"),
  customDrawer: $("custom-drawer"),
  custom: $("custom"),
  domainSuffix: $("domain-suffix"),
  openForm: $("open-form"),
  formError: $("form-error"),
  random: $("random"),
  historyWrap: $("history-wrap"),
  historyToggle: $("history-toggle"),
  historyMenu: $("history-menu"),
  historyList: $("history-list"),
  historyClear: $("history-clear"),
  workspace: $("workspace"),
  msgCount: $("msg-count"),
  status: $("status"),
  refresh: $("refresh"),
  searchWrap: $("search-wrap"),
  searchInbox: $("search-inbox"),
  list: $("list"),
  detail: $("detail"),
  toast: $("toast"),
};

const STORAGE_ADDR = "axvara-temp-mail-address";
const STORAGE_HISTORY = "axvara-temp-mail-history";
const STORAGE_READ = "axvara-temp-mail-read";
const POLL_MS = 5_000;
const BASE_TITLE = "AXVARA Temp Mail — Email Sementara";
const MAX_HISTORY = 8;

let current = "";
let timer = null;
let selectedId = null;
let activeMessage = null;
let rawMode = false;
let cachedMessages = [];
let seenIds = new Set();
let unreadNewCount = 0;
let toastTimer = null;
let copyBtnTimer = null;
let listSeq = 0;
let detailSeq = 0;
let navSeq = 0;
let listController = null;
let detailController = null;
const navControllers = new Set();

const isAbort = (e) => e && e.name === "AbortError";

function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function setStatus(text) {
  if (els.status) els.status.textContent = text;
}

function showToast(text, isError = false) {
  if (!els.toast) return;
  els.toast.textContent = text;
  els.toast.className = isError ? "toast is-error" : "toast";
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2200);
}

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function getReadSet() {
  const arr = readJsonStorage(STORAGE_READ, []);
  return new Set(Array.isArray(arr) ? arr.slice(-200) : []);
}

function markRead(address, id) {
  const set = getReadSet();
  set.add(`${address}:${id}`);
  writeJsonStorage(STORAGE_READ, [...set].slice(-200));
}

function isRead(address, id) {
  return getReadSet().has(`${address}:${id}`);
}

function saveHistory(address) {
  if (!address) return;
  const list = readJsonStorage(STORAGE_HISTORY, []);
  const next = [address, ...(Array.isArray(list) ? list : []).filter((a) => typeof a === "string" && a !== address)].slice(0, MAX_HISTORY);
  writeJsonStorage(STORAGE_HISTORY, next);
  renderHistory();
}

function renderHistory() {
  if (!els.historyWrap || !els.historyList) return;
  const list = readJsonStorage(STORAGE_HISTORY, []).filter((a) => typeof a === "string");
  els.historyWrap.hidden = list.length <= 1;
  els.historyList.replaceChildren();
  for (const addr of list) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "history-item";
    if (addr === current) btn.setAttribute("aria-current", "true");
    btn.append(el("span", addr));
    btn.addEventListener("click", () => {
      closeHistory();
      if (addr !== current) {
        void navigate("/api/address/open", { method: "POST", body: JSON.stringify({ address: addr }) })
          .catch(() => showToast("Gagal membuka alamat tersimpan.", true));
      }
    });
    li.append(btn);
    els.historyList.append(li);
  }
}

function closeHistory() {
  if (!els.historyMenu || !els.historyToggle) return;
  els.historyMenu.hidden = true;
  els.historyToggle.setAttribute("aria-expanded", "false");
}

async function copyText(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fallback below */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.className = "sr-only";
    document.body.append(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = typeof document.execCommand === "function" && document.execCommand("copy") === true;
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function flashButtonCopied(btn, labelEl, idleText, copiedText = "Tersalin") {
  if (!btn) return;
  btn.classList.add("is-copied");
  if (labelEl) labelEl.textContent = copiedText;
  const prev = btn._copyTimer;
  if (prev) clearTimeout(prev);
  btn._copyTimer = setTimeout(() => {
    btn.classList.remove("is-copied");
    if (labelEl) labelEl.textContent = idleText;
    btn._copyTimer = null;
  }, 1800);
}

/* ---------- Smart formatting & parsing (text-only, zero HTML execution) ---------- */

const GENERIC_MAIL_HOSTS = new Set([
  "mail", "mg", "em", "e", "m", "send", "smtp", "bounce", "bounces", "notify",
  "noreply", "no-reply", "outbound", "email", "alerts", "mailer", "news", "info", "msg", "transactional",
]);
const GENERIC_LOCALS = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply", "support", "info", "hello",
  "team", "security", "account", "accounts", "notifications", "notification", "updates",
  "mailer-daemon", "bounces", "bounce", "postmaster", "admin", "help", "service",
]);

function domainToBrand(domain) {
  const parts = String(domain || "").toLowerCase().split(".").filter(Boolean);
  if (parts.length < 2) return domain || "Pengirim";
  let idx = parts.length - 2;
  // Handle common 2-level ccTLDs like co.id, co.uk, com.au
  if (idx > 0 && ["co", "com", "org", "net", "ac", "go"].includes(parts[idx]) && parts[parts.length - 1].length === 2) {
    idx -= 1;
  }
  const core = parts[idx];
  if (!core) return domain;
  return core.charAt(0).toUpperCase() + core.slice(1);
}

function parseSender(raw) {
  const s = String(raw || "").trim();
  if (!s) return { name: "Pengirim tidak dikenal", email: "" };
  const angle = s.match(/^(.*?)\s*<([^<>@\s]+@[^<>@\s]+)>$/);
  if (angle) {
    const cleanName = angle[1].trim().replace(/^["']+|["']+$/g, "");
    const email = angle[2].trim();
    return { name: cleanName || domainToBrand(email.split("@")[1]), email };
  }
  // Space-separated legacy stored format: "ElevenLabs no-reply@elevenlabs.io"
  const spaced = s.match(/^(.+?)\s+([^\s<>@]+@[^\s<>@]+)$/);
  if (spaced) {
    const cleanName = spaced[1].trim().replace(/^["']+|["']+$/g, "");
    const email = spaced[2].trim();
    return { name: cleanName || domainToBrand(email.split("@")[1]), email };
  }
  if (s.includes("@")) {
    const [localRaw, domainRaw = ""] = s.split("@");
    const local = localRaw.toLowerCase();
    const isBounce = /^(?:bounces?|srs\d?|prvs|verp|return)[+=_-]/i.test(local) || local.includes("=") || local.length > 26;
    if (isBounce || GENERIC_LOCALS.has(local)) {
      const hostParts = domainRaw.toLowerCase().split(".").filter(Boolean);
      const meaningful = hostParts.filter((p) => !GENERIC_MAIL_HOSTS.has(p) && !/^em\d+$/i.test(p));
      const cleanDomain = meaningful.length >= 2 ? meaningful.join(".") : domainRaw;
      return { name: domainToBrand(cleanDomain), email: s };
    }
    return { name: local.charAt(0).toUpperCase() + local.slice(1), email: s };
  }
  return { name: s, email: "" };
}

function avatarBucket(seed) {
  let h = 0;
  const str = String(seed || "");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 6;
}

function avatarInitial(name) {
  const m = String(name || "").match(/[A-Za-z0-9]/);
  return m ? m[0].toUpperCase() : "@";
}

function formatRelativeTime(ts) {
  const diffSec = Math.max(0, Math.floor((Date.now() - Number(ts || 0)) / 1000));
  if (diffSec < 45) return "Baru saja";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min} mnt`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} jam`;
  const d = new Date(ts);
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

function formatExpiryRemaining(expiresAt) {
  const ms = Number(expiresAt || 0) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "Segera terhapus";
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `Sisa ${mins} mnt`;
  const hrs = Math.ceil(mins / 60);
  return `Sisa ${hrs} jam`;
}

function cleanPreview(text) {
  return String(text || "")
    .replace(/\(\s*https?:\/\/[^\s)]+\s*\)/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[*=\-_~#]{4,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

function safeHttpUrl(raw) {
  if (typeof raw !== "string") return null;
  let cleaned = raw.trim();
  while (/[.,;:!?)\]>'"]$/.test(cleaned)) {
    // Keep balanced closing parens in URLs like Wikipedia
    if (cleaned.endsWith(")") && (cleaned.match(/\(/g) || []).length >= (cleaned.match(/\)/g) || []).length) break;
    cleaned = cleaned.slice(0, -1);
  }
  try {
    const u = new URL(cleaned);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.href;
  } catch {
    return null;
  }
}

const OTP_CONTEXT_RE = /(?:otp|verification\s*code|verify\s*code|security\s*code|login\s*code|confirmation\s*code|passcode|one[- ]time|auth(?:entication)?\s*code|kode(?:\s+(?:otp|verifikasi|keamanan|masuk|konfirmasi))?|pin\s*(?:code|verifikasi|anda|kamu)?|code\s*(?:is|:))\s*[:\-–—]?\s*(?:\n\s*)?([0-9]{4,8}|[0-9]{3}[- ][0-9]{3})\b/i;
const OTP_STANDALONE_LINE_RE = /^\s*([0-9]{4,8}|[0-9]{3}[- ][0-9]{3})\s*$/;
const OTP_HINT_WORD_RE = /\b(?:otp|code|kode|verif\w*|confirm\w*|passcode|pin|one[- ]time|sign[- ]?in|log[- ]?in|masuk|keamanan)\b/i;

function isLikelyYear(digits) {
  const n = Number(digits);
  return digits.length === 4 && n >= 1990 && n <= 2039;
}

function extractOtp(subject, body) {
  const stripUrls = (s) => String(s || "").replace(/https?:\/\/\S+/gi, " ");
  const cleanSubj = stripUrls(subject);
  const cleanBody = stripUrls(body);

  for (const src of [cleanSubj, cleanBody]) {
    const m = src.match(OTP_CONTEXT_RE);
    if (m && m[1]) {
      const normalized = m[1].replace(/[\s-]/g, "");
      if (!isLikelyYear(normalized)) return normalized;
    }
  }
  if (OTP_HINT_WORD_RE.test(cleanSubj) || OTP_HINT_WORD_RE.test(cleanBody)) {
    const lines = cleanBody.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(OTP_STANDALONE_LINE_RE);
      if (m && m[1]) {
        const normalized = m[1].replace(/[\s-]/g, "");
        if (!isLikelyYear(normalized)) return normalized;
      }
    }
  }
  return null;
}

const IGNORED_ACTION_HOSTS = /(?:^|\.)(?:x\.com|twitter\.com|instagram\.com|facebook\.com|linkedin\.com|youtube\.com|youtu\.be|tiktok\.com|discord\.gg|t\.me|wa\.me)$/i;
const IGNORED_ACTION_PATH = /(?:unsubscribe|opt[-_]?out|privacy|terms|legal|policy|help|support|status|preferences|manage[-_]?notifications|cookie)/i;
const ACTION_URL_SIGNAL = /(?:verify|confirm|activate|reset|token|code|auth|magic|signin|sign-in|login|callback|accept|invite|validation|verification|recover|action|update-email|challenge)/i;
const ACTION_LABEL_SIGNAL = /(?:confirm|verify|verifikasi|aktivasi|activate|reset|sign in|log in|masuk|accept|join|gabung|lanjut|open|buka|complete|continue)/i;

function extractActionLink(body) {
  const text = String(body || "");
  const candidates = [];
  const seen = new Set();

  // Pattern 1: "Label → ( https://... )" or "Label ( https://... )"
  const labeledRe = /([^\n()]{2,64}?)\s*(?:→|->|:)?\s*\(\s*(https?:\/\/[^\s)]+)\s*\)/g;
  let m;
  while ((m = labeledRe.exec(text)) !== null) {
    const href = safeHttpUrl(m[2]);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const label = m[1].trim().replace(/^[\-*•>\s]+/, "").replace(/[:→\-\s]+$/, "");
    candidates.push({ label, href, hasLabel: Boolean(label) });
  }

  // Pattern 2: bare URLs
  const bareRe = /https?:\/\/[^\s<>()]+/g;
  while ((m = bareRe.exec(text)) !== null) {
    const href = safeHttpUrl(m[0]);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    candidates.push({ label: "", href, hasLabel: false });
  }

  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    let u;
    try { u = new URL(c.href); } catch { continue; }
    if (IGNORED_ACTION_HOSTS.test(u.hostname)) continue;
    if (IGNORED_ACTION_PATH.test(`${u.pathname}${u.search}`)) continue;
    let score = 0;
    const pathAndQuery = `${u.pathname}${u.search}`;
    if (pathAndQuery.length > 2) score += 1;
    if (ACTION_URL_SIGNAL.test(pathAndQuery)) score += 5;
    if (u.search.length > 16) score += 2;
    if (c.hasLabel && ACTION_LABEL_SIGNAL.test(c.label)) score += 4;
    if (score > bestScore && score >= 5) {
      bestScore = score;
      best = {
        label: c.label || "Buka Tautan Verifikasi",
        href: c.href,
        host: u.hostname.replace(/^www\./i, ""),
      };
    }
  }
  return best;
}

function appendLinkifiedInline(parent, text) {
  // Handle "Label → ( https://... )" / "Label ( https://... )" AND bare URLs via DOM nodes only.
  const tokenRe = /(?:([A-Za-z0-9][^\n()]{1,56}?)\s*(?:→|->)\s*\(\s*(https?:\/\/[^\s)]+)\s*\))|(?:\(\s*(https?:\/\/[^\s)]+)\s*\))|(https?:\/\/[^\s<>()]+)/g;
  let last = 0;
  let match;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > last) parent.append(document.createTextNode(text.slice(last, match.index)));
    const labeledText = match[1];
    const labeledUrl = match[2];
    const parenUrl = match[3];
    const bareUrl = match[4];

    if (labeledUrl) {
      const href = safeHttpUrl(labeledUrl);
      if (href) {
        const a = document.createElement("a");
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener noreferrer nofollow";
        a.className = "msg-link-chip";
        a.title = href;
        a.textContent = `${labeledText.trim()} ↗`;
        parent.append(a);
      } else {
        parent.append(document.createTextNode(match[0]));
      }
    } else {
      const rawUrl = parenUrl || bareUrl;
      const href = safeHttpUrl(rawUrl);
      if (href) {
        if (parenUrl) parent.append(document.createTextNode("("));
        const a = document.createElement("a");
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener noreferrer nofollow";
        a.className = "msg-link";
        a.textContent = href;
        parent.append(a);
        const tail = rawUrl.slice(href.length);
        if (tail) parent.append(document.createTextNode(tail));
        if (parenUrl) parent.append(document.createTextNode(")"));
      } else {
        parent.append(document.createTextNode(match[0]));
      }
    }
    last = tokenRe.lastIndex;
  }
  if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
}

function buildSmartBody(bodyText) {
  const wrap = el("div", "", "msg-body");
  const lines = String(bodyText || "").replace(/\r\n?/g, "\n").split("\n");
  const dividerRe = /^\s*([*=\-_~#])\1{4,}\s*$/;

  // Convert ***Heading*** blocks surrounded by ASCII dividers into headings/dividers cleanly.
  let paraBuf = [];
  const flushPara = () => {
    if (!paraBuf.length) return;
    const p = document.createElement("p");
    appendLinkifiedInline(p, paraBuf.join("\n"));
    wrap.append(p);
    paraBuf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect decorative heading pattern:
    // ***********
    // Title here
    // ***********
    if (dividerRe.test(trimmed)) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      let k = j + 1;
      while (k < lines.length && !lines[k].trim()) k++;
      if (j < lines.length && k < lines.length && !dividerRe.test(lines[j].trim()) && dividerRe.test(lines[k].trim())) {
        flushPara();
        wrap.append(el("h4", lines[j].trim(), "msg-heading"));
        i = k;
        continue;
      }
      flushPara();
      if (wrap.lastChild && wrap.lastChild.nodeName !== "HR") {
        wrap.append(el("hr", "", "msg-divider"));
      }
      continue;
    }

    if (!trimmed) {
      flushPara();
      continue;
    }

    paraBuf.push(line);
  }
  flushPara();

  if (!wrap.childNodes.length) {
    wrap.append(el("p", "(pesan kosong)", "empty-sub"));
  }
  return wrap;
}

/* ---------- Network & State ---------- */

async function api(path, opts, signal) {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, signal, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "request_failed");
  return data;
}

// Address navigation (random/open/boot): each call supersedes the previous
// one; a stale response must never switch the visible inbox.
async function navigate(path, opts) {
  const seq = ++navSeq;
  for (const c of navControllers) c.abort();
  const ctrl = new AbortController();
  navControllers.add(ctrl);
  try {
    const data = await api(path, opts, ctrl.signal);
    if (seq !== navSeq) return null;
    setAddress(data.address);
    return data;
  } catch (e) {
    if (isAbort(e) || seq !== navSeq) return null;
    throw e;
  } finally {
    navControllers.delete(ctrl);
  }
}

function updateTabTitle() {
  if (!document.hidden) {
    unreadNewCount = 0;
    document.title = BASE_TITLE;
    return;
  }
  document.title = unreadNewCount > 0 ? `(${unreadNewCount}) AXVARA Temp Mail` : BASE_TITLE;
}

async function loadInbox(manual = false) {
  if (!current) return;
  if (listController) return; // no overlapping list requests
  const seq = ++listSeq;
  const mine = current;
  const ctrl = new AbortController();
  listController = ctrl;
  if (els.refresh) els.refresh.classList.add("is-loading");
  if (manual || !cachedMessages.length) setStatus("Memuat…");
  try {
    const data = await api(`/api/inbox/${encodeURIComponent(mine)}/messages`, {}, ctrl.signal);
    if (seq !== listSeq || mine !== current) return; // discard stale
    const messages = data.messages || [];

    // Count newly arrived messages while tab is hidden for title badge.
    if (seenIds.size > 0 && document.hidden) {
      let newlyArrived = 0;
      for (const m of messages) {
        if (!seenIds.has(String(m.id))) newlyArrived += 1;
      }
      if (newlyArrived > 0) {
        unreadNewCount += newlyArrived;
        updateTabTitle();
      }
    }
    seenIds = new Set(messages.map((m) => String(m.id)));
    cachedMessages = messages;
    renderList(messages);
    const nowTime = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setStatus(`Diperbarui ${nowTime}`);
  } catch (e) {
    if (isAbort(e)) return;
    if (seq === listSeq && mine === current) {
      setStatus("Gagal memuat kotak masuk. Mencoba lagi…");
      if (!cachedMessages.length) renderList(null);
    }
  } finally {
    if (listController === ctrl) listController = null;
    if (els.refresh) els.refresh.classList.remove("is-loading");
  }
}

function updateCountBadge(count) {
  if (!els.msgCount) return;
  els.msgCount.textContent = String(count);
  els.msgCount.className = count > 0 ? "count-pill has-msg" : "count-pill";
}

function renderList(messages) {
  const focusId = document.activeElement?.dataset?.msgId;
  els.list.replaceChildren();
  if (messages === null) {
    updateCountBadge(0);
    if (els.searchWrap) els.searchWrap.hidden = true;
    const li = el("li", "", "empty-list");
    li.append(el("strong", "Gagal memuat pesan"), document.createTextNode("Periksa koneksi lalu coba muat ulang."));
    els.list.append(li);
    return;
  }

  updateCountBadge(messages.length);
  if (els.searchWrap) els.searchWrap.hidden = messages.length < 3;

  const query = (els.searchInbox?.value || "").trim().toLowerCase();
  const filtered = query
    ? messages.filter((m) =>
        `${m.subject || ""} ${m.sender || ""} ${m.preview || ""}`.toLowerCase().includes(query)
      )
    : messages;

  if (!messages.length) {
    const li = el("li", "", "empty-list");
    li.append(
      el("strong", "Menunggu email masuk…"),
      document.createTextNode("Salin alamat di atas untuk mendaftar. Pesan baru tampil otomatis setiap beberapa detik.")
    );
    els.list.append(li);
    return;
  }

  if (!filtered.length) {
    const li = el("li", "", "empty-list");
    li.append(el("strong", "Tidak ada pesan cocok"), document.createTextNode(`Tidak ditemukan hasil untuk "${query}".`));
    els.list.append(li);
    return;
  }

  let refocus = null;
  for (const m of filtered) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = isRead(current, m.id) ? "msg-row" : "msg-row is-unread";
    b.dataset.msgId = String(m.id);
    if (String(m.id) === String(selectedId)) b.setAttribute("aria-current", "true");

    const parsedSender = parseSender(m.sender);
    const av = el("span", avatarInitial(parsedSender.name), `avatar av-${avatarBucket(parsedSender.name)}`);
    av.setAttribute("aria-hidden", "true");

    const body = el("span", "", "msg-row-body");
    const top = el("span", "", "msg-row-top");
    const senderEl = el("span", "", "msg-sender-name");
    if (!isRead(current, m.id)) senderEl.append(el("span", "", "unread-dot"));
    senderEl.append(document.createTextNode(parsedSender.name));
    top.append(senderEl, el("span", formatRelativeTime(m.received_at), "msg-time"));

    const subj = el("span", m.subject || "(tanpa subjek)", "msg-subj");
    const prev = el("span", cleanPreview(m.preview) || "(tanpa pratinjau)", "msg-prev");
    body.append(top, subj, prev);

    const quickOtp = extractOtp(m.subject, m.preview);
    if (quickOtp) {
      body.append(el("span", `OTP · ${quickOtp}`, "msg-otp-pill"));
    }

    b.append(av, body);
    b.addEventListener("click", () => { void openMessage(m.id); });
    if (focusId && focusId === String(m.id)) refocus = b;
    li.append(b);
    els.list.append(li);
  }

  // Preserve keyboard focus across polling re-renders when the focused
  // message button was replaced by an identical one.
  if (refocus && focusId && document.activeElement !== refocus && !els.list.contains(document.activeElement)) {
    refocus.focus();
  }
}

function renderDetailEmpty() {
  const wrap = el("div", "", "empty-state");
  wrap.append(
    el("p", "Pilih pesan untuk membacanya di sini.", "empty-title"),
    el("p", "Kode OTP dan tautan verifikasi akan disorot otomatis di bagian atas pesan.", "empty-sub")
  );
  els.detail.replaceChildren(wrap);
}

function renderMessageDetail(message) {
  const frag = document.createDocumentFragment();

  // Mobile back button
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "btn btn-ghost btn-compact mobile-back";
  backBtn.textContent = "← Kembali ke Inbox";
  backBtn.addEventListener("click", () => {
    if (els.workspace) els.workspace.classList.remove("is-detail-open");
  });
  frag.append(backBtn);

  // Header
  const header = el("div", "", "detail-header");
  const topRow = el("div", "", "detail-top-row");
  topRow.append(el("h3", message.subject || "(tanpa subjek)", "detail-subject"));

  const tools = el("div", "", "detail-tools");
  const modeBtn = document.createElement("button");
  modeBtn.type = "button";
  modeBtn.className = rawMode ? "btn btn-ghost btn-compact is-active" : "btn btn-ghost btn-compact";
  modeBtn.textContent = rawMode ? "Tampilan Rapi" : "Teks Mentah";
  modeBtn.addEventListener("click", () => {
    rawMode = !rawMode;
    if (activeMessage) renderMessageDetail(activeMessage);
  });

  const copyBodyBtn = document.createElement("button");
  copyBodyBtn.type = "button";
  copyBodyBtn.className = "btn btn-ghost btn-compact";
  const copyBodyLabel = el("span", "Salin Teks");
  copyBodyBtn.append(copyBodyLabel);
  copyBodyBtn.addEventListener("click", async () => {
    const ok = await copyText(message.body_text || "");
    if (ok) {
      flashButtonCopied(copyBodyBtn, copyBodyLabel, "Salin Teks", "Tersalin");
      showToast("Isi pesan tersalin.");
    } else {
      showToast("Gagal menyalin isi pesan.", true);
    }
  });
  tools.append(modeBtn, copyBodyBtn);
  topRow.append(tools);
  header.append(topRow);

  const parsedSender = parseSender(message.sender);
  const metaRow = el("div", "", "detail-meta-row");
  const av = el("span", avatarInitial(parsedSender.name), `avatar av-${avatarBucket(parsedSender.name)}`);
  av.setAttribute("aria-hidden", "true");

  const senderInfo = el("div", "", "detail-sender-info");
  const senderLine = el("div", "", "detail-sender-line");
  senderLine.append(el("span", parsedSender.name, "detail-sender-title"));
  if (parsedSender.email && parsedSender.email.toLowerCase() !== parsedSender.name.toLowerCase()) {
    senderLine.append(el("span", parsedSender.email, "detail-sender-addr"));
  }
  const dates = el("div", "", "detail-dates");
  dates.append(el("span", new Date(message.received_at).toLocaleString("id-ID", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  })));
  if (message.expires_at) {
    dates.append(el("span", formatExpiryRemaining(message.expires_at), "expiry-chip"));
  }
  senderInfo.append(senderLine, dates);
  metaRow.append(av, senderInfo);
  header.append(metaRow);
  frag.append(header);

  // Smart extraction cards (OTP & Action Link)
  const otp = extractOtp(message.subject, message.body_text);
  const actionLink = extractActionLink(message.body_text);
  if (otp || actionLink) {
    const smartWrap = el("div", "", "smart-cards");

    if (otp) {
      const card = el("div", "", "smart-card smart-otp");
      const info = el("div", "", "smart-info");
      info.append(el("div", "Kode Verifikasi Terdeteksi", "smart-eyebrow"), el("div", otp, "otp-code"));
      const btns = el("div", "", "smart-btns");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      const lbl = el("span", "Salin Kode");
      btn.append(lbl);
      btn.addEventListener("click", async () => {
        const ok = await copyText(otp);
        if (ok) {
          flashButtonCopied(btn, lbl, "Salin Kode", "Tersalin");
          showToast(`Kode ${otp} tersalin.`);
        } else {
          showToast("Gagal menyalin kode.", true);
        }
      });
      btns.append(btn);
      card.append(info, btns);
      smartWrap.append(card);
    }

    if (actionLink) {
      const card = el("div", "", "smart-card smart-action");
      const info = el("div", "", "smart-info");
      info.append(
        el("div", "Tautan Aksi Terdeteksi", "smart-eyebrow"),
        el("div", actionLink.label, "smart-action-title"),
        el("div", actionLink.host, "smart-action-host")
      );
      const btns = el("div", "", "smart-btns");
      const openLink = document.createElement("a");
      openLink.href = actionLink.href;
      openLink.target = "_blank";
      openLink.rel = "noopener noreferrer nofollow";
      openLink.className = "btn btn-primary";
      openLink.textContent = "Buka Tautan ↗";

      const copyLinkBtn = document.createElement("button");
      copyLinkBtn.type = "button";
      copyLinkBtn.className = "btn btn-secondary";
      const copyLinkLbl = el("span", "Salin Link");
      copyLinkBtn.append(copyLinkLbl);
      copyLinkBtn.addEventListener("click", async () => {
        const ok = await copyText(actionLink.href);
        if (ok) {
          flashButtonCopied(copyLinkBtn, copyLinkLbl, "Salin Link", "Tersalin");
          showToast("Tautan tersalin.");
        } else {
          showToast("Gagal menyalin tautan.", true);
        }
      });

      btns.append(openLink, copyLinkBtn);
      card.append(info, btns);
      smartWrap.append(card);
    }

    frag.append(smartWrap);
  }

  // Message body
  if (rawMode) {
    frag.append(el("pre", message.body_text || "(pesan kosong)", "msg-raw"));
  } else {
    frag.append(buildSmartBody(message.body_text || ""));
  }

  els.detail.replaceChildren(frag);
}

function syncActiveListItem(id) {
  for (const btn of els.list.querySelectorAll("button[data-msg-id]")) {
    const isTarget = btn.dataset.msgId === String(id);
    if (isTarget) {
      btn.setAttribute("aria-current", "true");
      btn.classList.remove("is-unread");
      const dot = btn.querySelector(".unread-dot");
      if (dot) dot.remove();
    } else {
      btn.removeAttribute("aria-current");
    }
  }
}

async function openMessage(id) {
  const seq = ++detailSeq;
  const mine = current;
  selectedId = id;
  rawMode = false;
  markRead(mine, id);
  if (els.workspace) els.workspace.classList.add("is-detail-open");
  syncActiveListItem(id);

  if (detailController) detailController.abort();
  const ctrl = new AbortController();
  detailController = ctrl;
  els.detail.replaceChildren(el("p", "Memuat…", "empty-sub"));
  try {
    const { message } = await api(`/api/inbox/${encodeURIComponent(mine)}/messages/${id}`, {}, ctrl.signal);
    if (seq !== detailSeq || mine !== current) return; // stale detail must not overwrite
    activeMessage = message;
    renderMessageDetail(message);
  } catch (e) {
    if (isAbort(e)) return;
    if (seq === detailSeq && mine === current) {
      els.detail.replaceChildren(el("p", "Gagal memuat pesan ini. Coba klik lagi.", "error-state"));
    }
  } finally {
    if (detailController === ctrl) detailController = null;
  }
}

function setAddress(address) {
  current = address;
  els.address.value = address;
  const atIdx = address.indexOf("@");
  if (atIdx > 0 && els.domainSuffix) els.domainSuffix.textContent = address.slice(atIdx);
  selectedId = null;
  activeMessage = null;
  cachedMessages = [];
  seenIds = new Set();
  unreadNewCount = 0;
  updateTabTitle();
  if (els.workspace) els.workspace.classList.remove("is-detail-open");
  if (els.searchInbox) els.searchInbox.value = "";
  if (els.customDrawer) els.customDrawer.hidden = true;
  if (els.toggleCustom) els.toggleCustom.setAttribute("aria-expanded", "false");
  if (els.formError) els.formError.hidden = true;

  listSeq++;
  detailSeq++;
  if (listController) { listController.abort(); listController = null; }
  if (detailController) { detailController.abort(); detailController = null; }
  try { localStorage.setItem(STORAGE_ADDR, address); } catch {}
  saveHistory(address);
  els.list.replaceChildren(el("li", "Memuat…", "empty-list"));
  renderDetailEmpty();
  void loadInbox(true);
  startTimer();
}

function startTimer() {
  stopTimer();
  timer = setInterval(() => { if (!document.hidden) void loadInbox(false); }, POLL_MS);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

document.addEventListener("visibilitychange", () => {
  updateTabTitle();
  if (!document.hidden) void loadInbox(false);
});

async function handleCopyAddress() {
  if (!current) return;
  const ok = await copyText(current);
  const label = els.copy?.querySelector(".btn-label");
  if (ok) {
    flashButtonCopied(els.copy, label, "Salin", "Tersalin");
    showToast("Alamat email tersalin.");
  } else {
    els.address.focus();
    els.address.select();
    showToast("Gagal menyalin otomatis. Tekan Ctrl/Cmd+C.", true);
  }
  clearTimeout(copyBtnTimer);
  copyBtnTimer = null;
}

els.copy?.addEventListener("click", () => { void handleCopyAddress(); });
els.address?.addEventListener("click", () => {
  els.address.select();
  void handleCopyAddress();
});

els.toggleCustom?.addEventListener("click", () => {
  if (!els.customDrawer) return;
  const opening = els.customDrawer.hidden;
  els.customDrawer.hidden = !opening;
  els.toggleCustom.setAttribute("aria-expanded", String(opening));
  closeHistory();
  if (opening && els.custom) {
    els.custom.focus();
    els.custom.select();
  }
});

els.historyToggle?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!els.historyMenu) return;
  const opening = els.historyMenu.hidden;
  els.historyMenu.hidden = !opening;
  els.historyToggle.setAttribute("aria-expanded", String(opening));
});

els.historyClear?.addEventListener("click", () => {
  writeJsonStorage(STORAGE_HISTORY, current ? [current] : []);
  closeHistory();
  renderHistory();
  showToast("Riwayat alamat dibersihkan.");
});

document.addEventListener("click", (e) => {
  if (els.historyMenu && !els.historyMenu.hidden && els.historyWrap && !els.historyWrap.contains(e.target)) {
    closeHistory();
  }
});

els.refresh?.addEventListener("click", () => { void loadInbox(true); });

els.searchInbox?.addEventListener("input", () => {
  renderList(cachedMessages);
});

els.random?.addEventListener("click", async (e) => {
  const btn = e.currentTarget; // capture NOW: currentTarget is null after await
  btn.disabled = true;
  try {
    const res = await navigate("/api/address/random", { method: "POST", body: "{}" });
    if (res) showToast("Alamat baru siap digunakan.");
  } catch {
    setStatus("Gagal membuat alamat. Coba lagi.");
    showToast("Gagal membuat alamat acak.", true);
  } finally {
    btn.disabled = false;
  }
});

els.openForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.formError.hidden = true;
  try {
    const res = await navigate("/api/address/open", { method: "POST", body: JSON.stringify({ address: els.custom.value }) });
    if (res) {
      els.custom.value = "";
      showToast(`Membuka ${res.address}`);
    }
  } catch (error) {
    els.formError.textContent = error.message === "invalid_address"
      ? "Alamat tidak valid atau dicadangkan. Gunakan 3–32 huruf kecil, angka, titik, garis bawah, atau tanda hubung."
      : "Gagal membuka inbox. Coba lagi sebentar lagi.";
    els.formError.hidden = false;
  }
});

document.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName;
  const typing = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;
  if (e.key === "Escape") {
    if (els.historyMenu && !els.historyMenu.hidden) { closeHistory(); return; }
    if (els.customDrawer && !els.customDrawer.hidden) {
      els.customDrawer.hidden = true;
      els.toggleCustom?.setAttribute("aria-expanded", "false");
      return;
    }
    if (els.workspace?.classList.contains("is-detail-open")) {
      els.workspace.classList.remove("is-detail-open");
      return;
    }
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "r" || e.key === "R") { void loadInbox(true); }
  else if (e.key === "c" || e.key === "C") {
    const sel = typeof window.getSelection === "function" ? String(window.getSelection() || "") : "";
    if (!sel) void handleCopyAddress();
  }
});

(async () => {
  renderHistory();
  let saved = "";
  try { saved = localStorage.getItem(STORAGE_ADDR) || ""; } catch {}
  if (saved) {
    const bootSeq = navSeq + 1;
    try {
      if (await navigate("/api/address/open", { method: "POST", body: JSON.stringify({ address: saved }) })) return;
    } catch {}
    if (navSeq !== bootSeq) return;
  }
  try {
    await navigate("/api/address/random", { method: "POST", body: "{}" });
  } catch {
    setStatus("Gagal memulai. Periksa koneksi lalu muat ulang halaman.");
  }
})();
