"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminToast } from "@/components/admin/useProductManager";

// Hook otentikasi admin dipisah dari page.tsx karena siklus sesi (cek awal, login PBKDF2,
// heartbeat idle 90 detik, cek saat window focus) adalah satu domain yang berdiri sendiri
// dan tidak berhubungan dengan katalog produk. Memisahkannya menjaga page.tsx tetap tipis
// dan membuat aturan sesi mudah diaudit. Tidak ada perubahan perilaku — hanya pengelompokan
// state/handler yang sudah ada. Kepemilikan state tetap di React (useState/useEffect).

type LoginChallenge = {
  mode: "password" | "pbkdf2-proof";
  algorithm?: "PBKDF2-SHA-256";
  iterations?: number;
  salt?: string;
  challenge?: string;
};

function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function makePasswordProof(password: string, config: LoginChallenge): Promise<string> {
  if (config.mode !== "pbkdf2-proof" || !config.salt || !config.iterations || !config.challenge) throw new Error("Konfigurasi login tidak lengkap.");
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(config.salt), iterations: config.iterations, hash: "SHA-256" }, passwordKey, 256));
  const hmacKey = await crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hexFromBytes(new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(config.challenge))));
}

export function useAdminAuth(toast: AdminToast, onAuthenticated: () => void | Promise<void>) {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const sessionEndedRef = useRef(false);
  const checkAuth = useCallback(async()=>{
    // Satu sesi yang sudah berakhir hanya boleh memberitahu SEKALI. Tanpa
    // guard ini, setiap render ulang / remount / StrictMode memanggil
    // checkAuth lagi dan setiap panggilan mendorong toast yang sama —
    // persis tumpukan belasan toast merah di screenshot laporan.
    if (sessionEndedRef.current) { setAuthed(false); setCheckingAuth(false); return; }
    setCheckingAuth(true);
    try {
      const r = await fetch("/api/auth/me", { cache: "no-store" });
      const j = await r.json().catch(()=>({}));
      if (r.ok && j.authed) { sessionEndedRef.current = false; setAuthed(true); setAuthEmail(j.email || ""); }
      else {
        setAuthed(false);
        if (r.status === 401) {
          // Tandai SEBELUM toast agar panggilan bersamaan yang sudah
          // terlanjur jalan tidak ikut mendorong toast kedua dst.
          sessionEndedRef.current = true;
          if (j.reason === "idle_timeout") toast.error("Sesi habis karena 2 jam tidak aktif. Silakan login ulang.");
          else if (j.reason === "revoked") toast.error("Sesi dicabut (kredensial berubah). Silakan login ulang.");
          else if (j.reason === "session_mismatch") toast.error("Sesi tidak cocok. Silakan login ulang.");
          // 401 tanpa reason (absolute 8h / belum login) — diam ke gerbang login.
        }
      }
    } catch { setAuthed(false); }
    finally { setCheckingAuth(false); }
  },[toast]);

  useEffect(()=>{ checkAuth(); },[checkAuth]);

  // Login sukses = sesi BARU: buka lagi guard toast agar sesi berikutnya
  // yang berakhir tetap memberitahu tepat sekali.

  // Heartbeat: refresh idle window tiap 90 detik saat tab aktif (sliding 2h)
  useEffect(()=>{
    if(!authed) return;
    const tick = async()=>{
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/auth/refresh", { method:"POST", cache:"no-store" });
        if (r.status === 401) { setAuthed(false); toast.error("Sesi habis. Silakan login ulang."); }
      } catch {}
    };
    const id = window.setInterval(tick, 90_000);
    const onVis = ()=> { if(document.visibilityState==="visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return ()=> { window.clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  },[authed,toast]);

  // Juga cek saat window focus (user kembali setelah lama). Diam-diam kembali
  // ke gerbang login — checkAuth yang memberitahu, supaya tidak ada toast
  // ganda dari dua jalur berbeda untuk satu sesi yang sama.
  useEffect(()=>{
    if(!authed) return;
    const onFocus = async()=>{
      try {
        const r = await fetch("/api/auth/me", { cache:"no-store" });
        if (r.status === 401) { setAuthed(false); }
      } catch {}
    };
    window.addEventListener("focus", onFocus);
    return ()=> window.removeEventListener("focus", onFocus);
  },[authed]);

  const login = async()=>{
    setLoginError(null);
    if (!email.trim() || !pass) { setLoginError("Email dan password wajib diisi."); return; }
    setLoginLoading(true);
    try {
      const challengeResponse = await fetch("/api/auth/login", { cache: "no-store" });
      const challenge = await challengeResponse.json().catch(()=>({})) as LoginChallenge & { error?: string };
      if (!challengeResponse.ok) throw new Error(challenge.error || "Layanan login sedang tidak siap.");
      const body = challenge.mode === "pbkdf2-proof"
        ? { email: email.trim(), password_proof: await makePasswordProof(pass, challenge), challenge: challenge.challenge }
        : { email: email.trim(), password: pass };
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(body)
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(j.error || "Gagal masuk");
      sessionEndedRef.current = false;
      setAuthed(true);
      setAuthEmail(j.email || email.trim());
      setPass("");
      toast.success("Berhasil masuk.");
      await onAuthenticated();
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : "Gagal masuk");
    } finally { setLoginLoading(false); }
  };

  return {
    checkingAuth, authed, authEmail, email, pass, loginLoading, loginError,
    setAuthed, setEmail, setPass, login,
  };
}
