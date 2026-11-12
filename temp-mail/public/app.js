"use strict";
const $ = (id) => document.getElementById(id);
const els = { address: $("address"), custom: $("custom"), list: $("list"), detail: $("detail"), status: $("status"), formError: $("form-error") };
let current = "", timer = null, selectedId = null;
let listSeq = 0, detailSeq = 0, navSeq = 0;
let listController = null, detailController = null;
const navControllers = new Set();

function setStatus(t) { els.status.textContent = t; }
function el(tag, text, cls) { const n = document.createElement(tag); if (cls) n.className = cls; n.textContent = text ?? ""; return n; }
const isAbort = (e) => e && e.name === "AbortError";

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
  const ctrl = new AbortController(); navControllers.add(ctrl);
  try {
    const data = await api(path, opts, ctrl.signal);
    if (seq !== navSeq) return null;
    setAddress(data.address);
    return data;
  } catch (e) {
    if (isAbort(e) || seq !== navSeq) return null;
    throw e;
  } finally { navControllers.delete(ctrl); }
}

async function loadInbox() {
  if (!current) return;
  if (listController) return; // no overlapping list requests
  const seq = ++listSeq; const mine = current;
  const ctrl = new AbortController(); listController = ctrl;
  setStatus("Memuat…");
  try {
    const data = await api(`/api/inbox/${encodeURIComponent(mine)}/messages`, {}, ctrl.signal);
    if (seq !== listSeq || mine !== current) return; // discard stale
    renderList(data.messages || []);
    setStatus(`${(data.messages || []).length} pesan · muat ulang otomatis aktif`);
  } catch (e) {
    if (isAbort(e)) return;
    if (seq === listSeq && mine === current) { setStatus("Gagal memuat kotak masuk. Akan dicoba lagi."); renderList(null); }
  } finally { if (listController === ctrl) listController = null; }
}
function renderList(messages) {
  const focusId = document.activeElement?.dataset?.msgId;
  els.list.replaceChildren();
  if (messages === null) { els.list.append(el("li", "Gagal memuat pesan.", "empty")); return; }
  if (!messages.length) { els.list.append(el("li", "Belum ada pesan. Menunggu email masuk…", "empty")); return; }
  let refocus = null;
  for (const m of messages) {
    const li = document.createElement("li");
    const b = document.createElement("button"); b.type = "button"; b.dataset.msgId = String(m.id);
    if (String(m.id) === String(selectedId)) b.setAttribute("aria-current", "true");
    b.append(el("span", m.subject || "(tanpa subjek)", "subj"), el("span", m.sender || "", "meta"),
      el("span", new Date(m.received_at).toLocaleString("id-ID"), "meta"), el("span", m.preview || "", "prev"));
    b.addEventListener("click", () => openMessage(m.id));
    if (focusId && focusId === String(m.id)) refocus = b;
    li.append(b); els.list.append(li);
  }
  // Preserve keyboard focus across polling re-renders when the focused
  // message button was replaced by an identical one.
  if (refocus && focusId && document.activeElement !== refocus && !els.list.contains(document.activeElement)) refocus.focus();
}
async function openMessage(id) {
  const seq = ++detailSeq; const mine = current; selectedId = id;
  if (detailController) detailController.abort();
  const ctrl = new AbortController(); detailController = ctrl;
  els.detail.replaceChildren(el("p", "Memuat…", "empty"));
  try {
    const { message } = await api(`/api/inbox/${encodeURIComponent(mine)}/messages/${id}`, {}, ctrl.signal);
    if (seq !== detailSeq || mine !== current) return; // stale detail must not overwrite
    const frag = document.createDocumentFragment();
    frag.append(el("h3", message.subject || "(tanpa subjek)"));
    const meta = el("p", "", "meta");
    meta.append(el("span", `Dari: ${message.sender}`), document.createElement("br"), el("span", new Date(message.received_at).toLocaleString("id-ID")));
    frag.append(meta, el("pre", message.body_text || "(pesan kosong)"));
    els.detail.replaceChildren(frag); // text nodes only
  } catch (e) {
    if (isAbort(e)) return;
    if (seq === detailSeq && mine === current) els.detail.replaceChildren(el("p", "Gagal memuat pesan ini.", "error"));
  } finally { if (detailController === ctrl) detailController = null; }
}
function setAddress(address) {
  current = address; els.address.value = address; selectedId = null;
  listSeq++; detailSeq++;
  if (listController) { listController.abort(); listController = null; }
  if (detailController) { detailController.abort(); detailController = null; }
  try { localStorage.setItem("axvara-temp-mail-address", address); } catch {}
  els.list.replaceChildren(el("li", "Memuat…", "empty"));
  els.detail.replaceChildren(el("p", "Pilih pesan untuk membacanya di sini.", "empty"));
  loadInbox(); startTimer();
}
function startTimer() {
  stopTimer();
  timer = setInterval(() => { if (!document.hidden) loadInbox(); }, 10_000);
}
function stopTimer() { if (timer) clearInterval(timer); timer = null; }
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadInbox(); });

$("refresh").addEventListener("click", loadInbox);
$("copy").addEventListener("click", async () => {
  let ok = false;
  try { await navigator.clipboard.writeText(current); ok = true; }
  catch { els.address.select(); try { ok = document.execCommand("copy") === true; } catch { ok = false; } }
  // Only claim success after the write/exec actually succeeded.
  setStatus(ok ? "Alamat tersalin." : "Gagal menyalin. Salin alamat secara manual.");
});
$("random").addEventListener("click", async (e) => {
  const btn = e.currentTarget; // capture NOW: currentTarget is null after await
  btn.disabled = true;
  try { await navigate("/api/address/random", { method: "POST", body: "{}" }); }
  catch { setStatus("Gagal membuat alamat. Coba lagi."); }
  finally { btn.disabled = false; }
});
$("open-form").addEventListener("submit", async (e) => {
  e.preventDefault(); els.formError.hidden = true;
  try { await navigate("/api/address/open", { method: "POST", body: JSON.stringify({ address: els.custom.value }) }); }
  catch (error) {
    els.formError.textContent = error.message === "invalid_address"
      ? "Alamat tidak valid atau dicadangkan. Gunakan 3–32 huruf kecil, angka, titik, garis bawah, atau tanda hubung pada domain ini."
      : "Gagal membuka inbox. Coba lagi sebentar lagi.";
    els.formError.hidden = false;
  }
});
(async () => {
  let saved = ""; try { saved = localStorage.getItem("axvara-temp-mail-address") || ""; } catch {}
  if (saved) {
    const bootSeq = navSeq + 1;
    try { if (await navigate("/api/address/open", { method: "POST", body: JSON.stringify({ address: saved }) })) return; } catch {}
    if (navSeq !== bootSeq) return;
  }
  try { await navigate("/api/address/random", { method: "POST", body: "{}" }); }
  catch { setStatus("Gagal memulai. Periksa koneksi lalu muat ulang halaman."); }
})();
