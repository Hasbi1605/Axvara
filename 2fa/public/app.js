import {
  errorMessageFor,
  formatOtpDisplay,
  generateTotp,
  maskSecret,
  parseInputLines,
} from "./totp.js";

const $ = (id) => document.getElementById(id);

const STORAGE_SAVED = "axvara-2fa-saved";
const MAX_SAVED = 30;
const SINGLE_CIRCUMFERENCE = 2 * Math.PI * 16; // 100.53
const MINI_CIRCUMFERENCE = 2 * Math.PI * 11; // 69.12

const els = {
  secretInput: $("secret-input"),
  pasteBtn: $("paste-btn"),
  clearBtn: $("clear-btn"),
  optionsToggle: $("options-toggle"),
  optionsBar: $("options-bar"),
  optDigits: $("opt-digits"),
  optPeriod: $("opt-period"),
  optAlgo: $("opt-algo"),
  inputError: $("input-error"),
  stateEmpty: $("state-empty"),
  stateSingle: $("state-single"),
  singleMeta: $("single-meta"),
  singleLabel: $("single-label"),
  singleSpec: $("single-spec"),
  singleCodeBtn: $("single-code-btn"),
  singleCodeValue: $("single-code-value"),
  singleRingWrap: $("single-ring-wrap"),
  singleRing: $("single-ring"),
  singleSec: $("single-sec"),
  singleCopy: $("single-copy"),
  singleNext: $("single-next"),
  singleNextValue: $("single-next-value"),
  singleSave: $("single-save"),
  stateBulk: $("state-bulk"),
  bulkCount: $("bulk-count"),
  bulkTruncated: $("bulk-truncated"),
  bulkRing: $("bulk-ring"),
  bulkSec: $("bulk-sec"),
  bulkCopyAll: $("bulk-copy-all"),
  bulkList: $("bulk-list"),
  skewBar: $("skew-bar"),
  savedSection: $("saved-section"),
  savedCount: $("saved-count"),
  savedRing: $("saved-ring"),
  savedSec: $("saved-sec"),
  savedClearAll: $("saved-clear-all"),
  savedList: $("saved-list"),
  toast: $("toast"),
  announcer: $("sr-announcer"),
};

let timeOffsetMs = 0;
let parsedState = { items: [], truncated: false, totalLines: 0 };
let savedItems = loadSaved();
let hasBlurredInput = false;
let editingSavedId = null;
let tickInterval = null;
let toastTimer = null;
let lastAnnounced = "";
const copyTimers = new WeakMap();
const lastComputedBulkCodes = new Map();
const lastComputedSavedCodes = new Map();
let singleCurrentCode = "";
let singleNextCode = "";

function nowMs() {
  return Date.now() + timeOffsetMs;
}

function getDefaults() {
  return {
    digits: Number(els.optDigits?.value || 6),
    period: Number(els.optPeriod?.value || 30),
    algorithm: String(els.optAlgo?.value || "SHA-1"),
  };
}

function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function announce(message) {
  if (!els.announcer || !message) return;
  let text = message;
  if (text === lastAnnounced) text += "\u00A0";
  lastAnnounced = text;
  els.announcer.textContent = text;
}

function showToast(message, isError = false) {
  if (!els.toast) return;
  let text = message;
  if (text === lastAnnounced) text += "\u00A0";
  lastAnnounced = text;
  els.toast.textContent = text;
  els.toast.className = isError ? "toast is-error" : "toast";
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2000);
}

/* ---------- Clipboard (async API + focus-preserving fallback) ---------- */

function legacyCopy(text) {
  const previousFocus = document.activeElement;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.className = "sr-only";
  document.body.append(field);
  field.select();
  field.setSelectionRange(0, text.length);
  try {
    return typeof document.execCommand === "function" && document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    field.remove();
    if (previousFocus && typeof previousFocus.focus === "function") {
      previousFocus.focus({ preventScroll: true });
    }
  }
}

async function writeClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to synchronous fallback
  }
  return legacyCopy(text);
}

function reportCopy(button, ok, labelText = "Salin") {
  if (!button) return;
  clearTimeout(copyTimers.get(button));
  button.removeAttribute("data-copied");
  button.removeAttribute("data-failed");

  const labelEl = button.querySelector(".btn-label");
  button.setAttribute(ok ? "data-copied" : "data-failed", "");
  if (labelEl) labelEl.textContent = ok ? "Tersalin" : "Gagal";
  showToast(ok ? "Kode tersalin" : "Gagal menyalin kode", !ok);

  copyTimers.set(
    button,
    setTimeout(() => {
      button.removeAttribute("data-copied");
      button.removeAttribute("data-failed");
      if (labelEl) labelEl.textContent = labelText;
    }, 1800),
  );
}

async function handleCopyFromTarget(button, target) {
  const raw =
    target?.dataset?.copyValue ||
    (target?.matches?.("input, textarea") ? target.value : target?.textContent || "");
  const clean = String(raw).replace(/\s+/g, "").trim();
  if (!clean || /^-+$/.test(clean)) return;
  const ok = await writeClipboard(clean);
  const idle = button?.dataset?.idleLabel || "Salin";
  reportCopy(button, ok, idle);
}

const life = new AbortController();
const { signal } = life;

// Invoker Commands (`command="--copy"`) + single-path fallback when unsupported.
if (typeof window !== "undefined" && "CommandEvent" in window) {
  document.addEventListener(
    "command",
    (event) => {
      if (event.command === "--copy") {
        void handleCopyFromTarget(event.source, event.target);
      }
    },
    { capture: true, signal },
  );
} else {
  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented) return;
      const button = event.target?.closest?.('button[command="--copy"]');
      if (!button) return;
      const targetId = button.getAttribute("commandfor");
      const target = targetId ? document.getElementById(targetId) : null;
      if (target) void handleCopyFromTarget(button, target);
    },
    { signal },
  );
}

/* ---------- Storage (Saved Keys in Browser) ---------- */

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_SAVED);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x.id === "string" && typeof x.secret === "string")
      .slice(0, MAX_SAVED);
  } catch {
    return [];
  }
}

function persistSaved() {
  try {
    localStorage.setItem(STORAGE_SAVED, JSON.stringify(savedItems.slice(0, MAX_SAVED)));
  } catch {
    // Ignore private-browsing quota errors
  }
}

function findSavedMatch(item) {
  return savedItems.find(
    (s) =>
      s.secret === item.secret &&
      Number(s.digits) === Number(item.digits) &&
      Number(s.period) === Number(item.period) &&
      String(s.algorithm) === String(item.algorithm),
  );
}

function makeSavedId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------- Input Validation & Auto-Grow ---------- */

function autoResizeTextarea() {
  const ta = els.secretInput;
  if (!ta) return;
  const approxCols = Math.max(24, Math.floor(((ta.clientWidth || 620) - 30) / 8.8));
  const visualRows = ta.value
    .split(/\r?\n/)
    .reduce((acc, line) => acc + Math.max(1, Math.ceil((line.length || 1) / approxCols)), 0);
  ta.rows = Math.min(8, Math.max(1, visualRows));
}

function setInputError(message) {
  if (!els.secretInput || !els.inputError) return;
  if (message) {
    els.inputError.textContent = message;
    els.inputError.hidden = false;
    els.secretInput.setAttribute("aria-invalid", "true");
    els.secretInput.setAttribute("aria-describedby", "input-error");
  } else {
    els.inputError.textContent = "";
    els.inputError.hidden = true;
    els.secretInput.setAttribute("aria-invalid", "false");
    els.secretInput.removeAttribute("aria-describedby");
  }
}

function shouldShowErrorImmediately(rawText, errCode) {
  if (hasBlurredInput) return true;
  if (errCode === "otp_not_secret") return true;
  const trimmed = rawText.trim();
  // Show immediately if clearly non-Base32 characters entered beyond initial typing
  if (/[^A-Za-z2-7=\s-]/.test(trimmed) && !/^otpauth:/i.test(trimmed) && trimmed.length >= 4) {
    return true;
  }
  return false;
}

/* ---------- Ring Helpers (SVG attributes only — zero inline style for strict CSP) ---------- */

function setRing(circleEl, circumference, progress, wrapEl, remaining) {
  if (!circleEl) return;
  const clamped = Math.max(0, Math.min(1, progress));
  const offset = circumference * (1 - clamped);
  circleEl.setAttribute("stroke-dashoffset", offset.toFixed(2));
  if (wrapEl) {
    wrapEl.classList.toggle("is-urgent", remaining <= 5);
  }
}

function specText(item) {
  const parts = [];
  if (Number(item.digits) !== 6) parts.push(`${item.digits} digit`);
  if (Number(item.period) !== 30) parts.push(`${item.period}d`);
  if (item.algorithm !== "SHA-1") parts.push(item.algorithm);
  return parts.join(" · ");
}

/* ---------- Rendering: Active Input (Empty / Single / Bulk) ---------- */

function rebuildBulkRows() {
  if (!els.bulkList) return;
  els.bulkList.replaceChildren();
  lastComputedBulkCodes.clear();

  const items = parsedState.items;
  const validCount = items.filter((i) => i.ok).length;
  if (els.bulkCount) {
    els.bulkCount.textContent =
      validCount === items.length
        ? `${validCount} kode`
        : `${validCount} valid · ${items.length - validCount} tidak valid`;
  }
  if (els.bulkTruncated) {
    els.bulkTruncated.hidden = !parsedState.truncated;
  }
  if (els.bulkCopyAll) {
    els.bulkCopyAll.disabled = validCount === 0;
  }

  for (const item of items) {
    const li = el("li", "", "code-row");
    li.dataset.line = String(item.lineNumber);

    const info = el("div", "", "code-row-info");
    if (item.ok) {
      const title = item.label || maskSecret(item.secret);
      info.append(el("span", title, "code-row-title"));
      const subParts = [];
      if (item.label) subParts.push(maskSecret(item.secret));
      const spec = specText(item);
      if (spec) subParts.push(spec);
      if (subParts.length) info.append(el("span", subParts.join(" · "), "code-row-sub"));

      const actions = el("div", "", "code-row-actions");
      const codeBtn = document.createElement("button");
      codeBtn.type = "button";
      codeBtn.className = "row-code-btn";
      codeBtn.textContent = "--- ---";
      codeBtn.setAttribute("aria-label", `Salin kode untuk ${title}`);
      codeBtn.dataset.line = String(item.lineNumber);
      codeBtn.addEventListener("click", async () => {
        const code = lastComputedBulkCodes.get(item.lineNumber);
        if (!code) return;
        const ok = await writeClipboard(code);
        reportCopy(codeBtn, ok);
      });

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn btn-secondary btn-compact";
      copyBtn.dataset.idleLabel = "Salin";
      copyBtn.append(el("span", "Salin", "btn-label"));
      copyBtn.setAttribute("aria-label", `Salin kode untuk ${title}`);
      copyBtn.addEventListener("click", async () => {
        const code = lastComputedBulkCodes.get(item.lineNumber);
        if (!code) return;
        const ok = await writeClipboard(code);
        reportCopy(copyBtn, ok, "Salin");
      });

      if (Number(item.period) !== 30) {
        const secTag = el("span", `${item.period}d`, "row-sec-tag");
        secTag.dataset.secFor = String(item.lineNumber);
        actions.append(secTag);
      }

      actions.append(codeBtn, copyBtn);
      li.append(info, actions);
    } else {
      const snippet = item.raw.length > 32 ? `${item.raw.slice(0, 32)}…` : item.raw;
      info.append(el("span", `Baris ${item.lineNumber} · ${snippet}`, "code-row-sub"));
      info.append(el("span", errorMessageFor(item.error), "code-row-err"));
      li.append(info);
    }

    els.bulkList.append(li);
  }
}

function updateSaveButtonState(singleItem) {
  if (!els.singleSave || !singleItem?.ok) return;
  const existing = findSavedMatch(singleItem);
  els.singleSave.textContent = existing ? "Tersimpan" : "Simpan di browser";
  els.singleSave.classList.toggle("is-saved", Boolean(existing));
}

function renderParsedLayout() {
  const raw = els.secretInput?.value || "";
  if (els.clearBtn) els.clearBtn.hidden = raw.length === 0;

  if (!raw.trim()) {
    parsedState = { items: [], truncated: false, totalLines: 0 };
    setInputError("");
    els.stateEmpty.hidden = false;
    els.stateSingle.hidden = true;
    els.stateBulk.hidden = true;
    singleCurrentCode = "";
    singleNextCode = "";
    return;
  }

  parsedState = parseInputLines(raw, getDefaults());
  const { items } = parsedState;

  if (items.length === 1) {
    const item = items[0];
    if (!item.ok) {
      els.stateEmpty.hidden = false;
      els.stateSingle.hidden = true;
      els.stateBulk.hidden = true;
      singleCurrentCode = "";
      singleNextCode = "";
      if (shouldShowErrorImmediately(raw, item.error)) {
        const msg = errorMessageFor(item.error);
        setInputError(msg);
        if (hasBlurredInput) announce(msg);
      } else {
        setInputError("");
      }
      return;
    }

    setInputError("");
    els.stateEmpty.hidden = true;
    els.stateSingle.hidden = false;
    els.stateBulk.hidden = true;

    const spec = specText(item);
    const hasMeta = Boolean(item.label || spec);
    els.singleMeta.hidden = !hasMeta;
    els.singleLabel.textContent = item.label || "";
    els.singleSpec.textContent = spec;
    els.singleSpec.hidden = !spec;
    updateSaveButtonState(item);
    return;
  }

  // Bulk mode (>= 2 lines)
  setInputError("");
  els.stateEmpty.hidden = true;
  els.stateSingle.hidden = true;
  els.stateBulk.hidden = false;
  rebuildBulkRows();
}

/* ---------- Rendering: Saved Keys List ---------- */

function createSvgIcon(paths) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}

function renderSavedList() {
  if (!els.savedSection || !els.savedList) return;
  els.savedSection.hidden = savedItems.length === 0;
  if (els.savedCount) els.savedCount.textContent = String(savedItems.length);
  els.savedList.replaceChildren();
  lastComputedSavedCodes.clear();

  for (const item of savedItems) {
    const li = el("li", "", "code-row");
    li.dataset.savedId = item.id;

    const info = el("div", "", "code-row-info");
    if (editingSavedId === item.id) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "rename-input";
      input.value = item.label;
      input.maxLength = 60;
      input.setAttribute("aria-label", "Ubah nama akun tersimpan");
      const commit = () => {
        const nextLabel = input.value.trim() || maskSecret(item.secret);
        item.label = nextLabel;
        editingSavedId = null;
        persistSaved();
        renderSavedList();
        void updateTick();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          editingSavedId = null;
          renderSavedList();
          void updateTick();
        }
      });
      input.addEventListener("blur", commit);
      info.append(input);
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
    } else {
      info.append(el("span", item.label, "code-row-title"));
    }

    const subParts = [maskSecret(item.secret)];
    const spec = specText(item);
    if (spec) subParts.push(spec);
    info.append(el("span", subParts.join(" · "), "code-row-sub"));

    const actions = el("div", "", "code-row-actions");

    if (Number(item.period) !== 30) {
      const secTag = el("span", `${item.period}d`, "row-sec-tag");
      secTag.dataset.savedSec = item.id;
      actions.append(secTag);
    }

    const codeBtn = document.createElement("button");
    codeBtn.type = "button";
    codeBtn.className = "row-code-btn";
    codeBtn.textContent = "--- ---";
    codeBtn.dataset.savedCode = item.id;
    codeBtn.setAttribute("aria-label", `Salin kode ${item.label}`);
    codeBtn.addEventListener("click", async () => {
      const code = lastComputedSavedCodes.get(item.id);
      if (!code) return;
      const ok = await writeClipboard(code);
      reportCopy(codeBtn, ok);
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "icon-btn";
    editBtn.title = "Ubah nama";
    editBtn.setAttribute("aria-label", `Ubah nama ${item.label}`);
    editBtn.append(createSvgIcon(["M11.2 2.8a1.6 1.6 0 0 1 2.2 2.2L6 12.4l-3 .8.8-3 7.4-7.4z"]));
    editBtn.addEventListener("click", () => {
      editingSavedId = item.id;
      renderSavedList();
      void updateTick();
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn is-danger";
    delBtn.title = "Hapus dari browser";
    delBtn.setAttribute("aria-label", `Hapus ${item.label}`);
    delBtn.append(createSvgIcon(["M4 4l8 8", "M12 4l-8 8"]));
    delBtn.addEventListener("click", () => {
      savedItems = savedItems.filter((s) => s.id !== item.id);
      persistSaved();
      renderSavedList();
      if (parsedState.items.length === 1 && parsedState.items[0].ok) {
        updateSaveButtonState(parsedState.items[0]);
      }
      showToast("Dihapus dari browser");
      void updateTick();
    });

    const tools = el("div", "", "saved-row-tools");
    tools.append(editBtn, delBtn);
    actions.append(codeBtn, tools);
    li.append(info, actions);
    els.savedList.append(li);
  }
}

/* ---------- Live Tick (Single + Bulk + Saved) ---------- */

let tickSeq = 0;

async function updateTick() {
  const seq = ++tickSeq;
  const ts = nowMs();

  // Standard 30s indicator for shared headers
  const stdPeriod = 30;
  const stdSec = Math.floor(ts / 1000);
  const stdRemaining = stdPeriod - (((stdSec % stdPeriod) + stdPeriod) % stdPeriod);
  const stdProgress = 1 - (((ts % (stdPeriod * 1000)) + stdPeriod * 1000) % (stdPeriod * 1000)) / (stdPeriod * 1000);

  if (parsedState.items.length === 1 && parsedState.items[0].ok) {
    const item = parsedState.items[0];
    try {
      const res = await generateTotp(item.secret, {
        digits: item.digits,
        period: item.period,
        algorithm: item.algorithm,
        timestampMs: ts,
        includeNext: true,
      });
      if (seq !== tickSeq) return;

      singleCurrentCode = res.code;
      singleNextCode = res.nextCode || "";

      els.singleCodeValue.textContent = formatOtpDisplay(res.code);
      els.singleCodeValue.dataset.copyValue = res.code;
      els.singleSec.textContent = String(res.remaining);
      setRing(els.singleRing, SINGLE_CIRCUMFERENCE, res.progress, els.singleRingWrap, res.remaining);

      if (res.remaining <= 5 && res.nextCode) {
        els.singleNextValue.textContent = formatOtpDisplay(res.nextCode);
        els.singleNextValue.dataset.copyValue = res.nextCode;
        els.singleNext.hidden = false;
      } else {
        els.singleNext.hidden = true;
      }
    } catch {
      // Ignore transient failure
    }
  } else if (parsedState.items.length > 1) {
    setRing(els.bulkRing, MINI_CIRCUMFERENCE, stdProgress, els.bulkRing?.parentElement, stdRemaining);
    if (els.bulkSec) els.bulkSec.textContent = `${stdRemaining}d`;

    for (const item of parsedState.items) {
      if (!item.ok) continue;
      try {
        const res = await generateTotp(item.secret, {
          digits: item.digits,
          period: item.period,
          algorithm: item.algorithm,
          timestampMs: ts,
        });
        if (seq !== tickSeq) return;
        lastComputedBulkCodes.set(item.lineNumber, res.code);
        const btn = els.bulkList?.querySelector(`button.row-code-btn[data-line="${item.lineNumber}"]`);
        if (btn) btn.textContent = formatOtpDisplay(res.code);
        const secTag = els.bulkList?.querySelector(`[data-sec-for="${item.lineNumber}"]`);
        if (secTag) secTag.textContent = `${res.remaining}d`;
      } catch {
        // Ignore single-row failure
      }
    }
  }

  if (savedItems.length > 0) {
    setRing(els.savedRing, MINI_CIRCUMFERENCE, stdProgress, els.savedRing?.parentElement, stdRemaining);
    if (els.savedSec) els.savedSec.textContent = `${stdRemaining}d`;

    for (const item of savedItems) {
      try {
        const res = await generateTotp(item.secret, {
          digits: item.digits,
          period: item.period,
          algorithm: item.algorithm,
          timestampMs: ts,
        });
        if (seq !== tickSeq) return;
        lastComputedSavedCodes.set(item.id, res.code);
        const btn = els.savedList?.querySelector(`button[data-saved-code="${item.id}"]`);
        if (btn) btn.textContent = formatOtpDisplay(res.code);
        const secTag = els.savedList?.querySelector(`[data-saved-sec="${item.id}"]`);
        if (secTag) secTag.textContent = `${res.remaining}d`;
      } catch {
        // Ignore corrupt saved item
      }
    }
  }
}

/* ---------- Clock Skew Sync (no secret ever leaves browser) ---------- */

async function syncServerTime() {
  if (typeof fetch !== "function") return;
  const started = Date.now();
  try {
    const res = await fetch("/api/time", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const ended = Date.now();
    if (!data || typeof data.now !== "number" || !Number.isFinite(data.now)) return;
    const rtt = Math.max(0, ended - started);
    const estimatedClientNow = started + rtt / 2;
    const offset = Math.round(data.now - estimatedClientNow);
    if (Math.abs(offset) > 2000) {
      timeOffsetMs = offset;
      const secs = Math.round(offset / 1000);
      const sign = secs > 0 ? "+" : "";
      if (els.skewBar) {
        els.skewBar.textContent = `Jam perangkat selisih ${sign}${secs} detik — kode disinkronkan otomatis.`;
        els.skewBar.hidden = false;
      }
      void updateTick();
    } else {
      timeOffsetMs = 0;
      if (els.skewBar) els.skewBar.hidden = true;
    }
  } catch {
    // Offline or local static preview: continue seamlessly on device clock
  }
}

/* ---------- Event Wiring ---------- */

function onInputChanged() {
  autoResizeTextarea();
  renderParsedLayout();
  void updateTick();
}

els.secretInput?.addEventListener("input", onInputChanged);
els.secretInput?.addEventListener("blur", () => {
  hasBlurredInput = true;
  renderParsedLayout();
});

els.pasteBtn?.addEventListener("click", async () => {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.readText === "function") {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) {
        showToast("Clipboard kosong", true);
        return;
      }
      els.secretInput.value = clip.trim();
      hasBlurredInput = true;
      onInputChanged();
      els.secretInput.focus();
      return;
    }
  } catch {
    // Permission denied: focus input so user can Ctrl/Cmd+V directly
  }
  els.secretInput?.focus();
  showToast("Tekan Ctrl+V / ⌘V untuk menempel");
});

els.clearBtn?.addEventListener("click", () => {
  if (!els.secretInput) return;
  els.secretInput.value = "";
  hasBlurredInput = false;
  onInputChanged();
  els.secretInput.focus();
});

els.optionsToggle?.addEventListener("click", () => {
  const expanded = els.optionsToggle.getAttribute("aria-expanded") === "true";
  els.optionsToggle.setAttribute("aria-expanded", String(!expanded));
  els.optionsBar.hidden = expanded;
});

for (const sel of [els.optDigits, els.optPeriod, els.optAlgo]) {
  sel?.addEventListener("change", () => {
    renderParsedLayout();
    void updateTick();
  });
}

els.singleSave?.addEventListener("click", () => {
  if (parsedState.items.length !== 1 || !parsedState.items[0].ok) return;
  const item = parsedState.items[0];
  const existing = findSavedMatch(item);
  if (existing) {
    savedItems = savedItems.filter((s) => s.id !== existing.id);
    persistSaved();
    renderSavedList();
    updateSaveButtonState(item);
    showToast("Dihapus dari tersimpan");
    return;
  }
  if (savedItems.length >= MAX_SAVED) {
    showToast(`Maksimal ${MAX_SAVED} kunci tersimpan`, true);
    return;
  }
  const label = item.label || `Akun ${savedItems.length + 1}`;
  savedItems = [
    {
      id: makeSavedId(),
      label,
      secret: item.secret,
      digits: item.digits,
      period: item.period,
      algorithm: item.algorithm,
    },
    ...savedItems,
  ];
  persistSaved();
  renderSavedList();
  updateSaveButtonState(item);
  showToast("Disimpan di browser ini");
  void updateTick();
});

els.bulkCopyAll?.addEventListener("click", async () => {
  const lines = [];
  for (const item of parsedState.items) {
    if (!item.ok) continue;
    const code = lastComputedBulkCodes.get(item.lineNumber);
    if (!code) continue;
    lines.push(item.label ? `${item.label}\t${code}` : code);
  }
  if (!lines.length) return;
  const ok = await writeClipboard(lines.join("\n"));
  reportCopy(els.bulkCopyAll, ok, "Salin semua");
});

els.savedClearAll?.addEventListener("click", () => {
  savedItems = [];
  editingSavedId = null;
  persistSaved();
  renderSavedList();
  if (parsedState.items.length === 1 && parsedState.items[0].ok) {
    updateSaveButtonState(parsedState.items[0]);
  }
  showToast("Semua kunci tersimpan dihapus");
});

document.addEventListener(
  "keydown",
  (event) => {
    const active = document.activeElement;
    const inField = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");

    if (event.key === "Escape") {
      if (els.optionsBar && !els.optionsBar.hidden) {
        els.optionsBar.hidden = true;
        els.optionsToggle?.setAttribute("aria-expanded", "false");
        els.optionsToggle?.focus();
      }
      return;
    }

    if (inField || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === "/") {
      event.preventDefault();
      els.secretInput?.focus();
    } else if ((event.key === "c" || event.key === "C") && singleCurrentCode) {
      event.preventDefault();
      void handleCopyFromTarget(els.singleCopy, els.singleCodeValue);
    }
  },
  { signal },
);

document.addEventListener(
  "visibilitychange",
  () => {
    if (!document.hidden) {
      void updateTick();
    }
  },
  { signal },
);

/* ---------- Boot ---------- */

renderSavedList();
renderParsedLayout();
void updateTick();
void syncServerTime();

if (tickInterval) clearInterval(tickInterval);
tickInterval = setInterval(() => {
  if (!document.hidden) void updateTick();
}, 250);

// Clean up timers & document listeners on page unload
window.addEventListener(
  "pagehide",
  () => {
    life.abort();
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  },
  { signal },
);
