"use client";
import Link from "next/link";
import { Spinner } from "@/components/ui/Loading";

// Dipisah dari page.tsx karena layar "cek sesi" dan "form login" adalah gerbang
// pra-otentikasi yang murni presentational: mereka tidak butuh state katalog/produk
// sama sekali. Memindahkannya ke sini menjaga page.tsx fokus pada orkestrasi state
// admin setelah login, sekaligus menghindari dua early-return panjang di komponen utama.

export function AdminAuthChecking() {
  return (
    <div className="mx-auto max-w-[420px] px-4 py-16">
      <div className="admin-surface rounded-[24px] p-8 flex flex-col items-center gap-4">
        <Spinner size={28} />
        <p className="text-sm text-admin-muted">Memeriksa sesi admin…</p>
      </div>
    </div>
  );
}

export function AdminLoginGate({
  email,
  pass,
  loginLoading,
  loginError,
  onEmailChange,
  onPassChange,
  onLogin,
}: {
  email: string;
  pass: string;
  loginLoading: boolean;
  loginError: string | null;
  onEmailChange: (value: string) => void;
  onPassChange: (value: string) => void;
  onLogin: () => void;
}) {
  return (
    <div className="mx-auto max-w-[420px] px-4 py-10 sm:py-16">
      <div className="admin-surface rounded-[24px] p-6">
        <Link href="/" className="flex items-center gap-2 text-admin-muted text-sm"><span className="w-6 h-5 text-admin-fg flex items-center justify-center"><svg viewBox="0 0 120 110" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round"><path d="M60 4 L6.5 104 L113.5 104 Z"/><path d="M60 4 L60 49.5"/><path d="M60 49.5 L35.8 78.5 L84.2 78.5 Z"/><path d="M35.8 78.5 L84.2 78.5"/><path d="M35.8 78.5 L6.5 104"/><path d="M84.2 78.5 L113.5 104"/></svg></span> AXVARA Admin</Link>
        <h1 className="font-display font-bold text-admin-fg text-xl mt-3">Masuk Panel Admin</h1>
        <p className="text-xs text-admin-muted mt-1">Otentikasi diperlukan untuk mengelola katalog & pesanan.</p>
        <div className="mt-5 space-y-3">
          <label className="block space-y-1.5"><span className="text-xs font-semibold text-admin-muted">Email</span><input value={email} onChange={e=>onEmailChange(e.target.value)} onKeyDown={e=> e.key==="Enter" && onLogin()} placeholder="admin@axvara.tech" autoComplete="username" className="w-full h-11 px-4 rounded-xl bg-admin-subtle border border-admin-border text-sm text-admin-fg placeholder:text-admin-muted focus:outline-none focus:border-admin-accent/40" /></label>
          <label className="block space-y-1.5"><span className="text-xs font-semibold text-admin-muted">Password</span><input value={pass} onChange={e=>onPassChange(e.target.value)} onKeyDown={e=> e.key==="Enter" && onLogin()} type="password" placeholder="••••••••" autoComplete="current-password" className="w-full h-11 px-4 rounded-xl bg-admin-subtle border border-admin-border text-sm text-admin-fg placeholder:text-admin-muted focus:outline-none focus:border-admin-accent/40" /></label>
          {loginError && <p className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-admin-danger">{loginError}</p>}
          <button onClick={onLogin} disabled={loginLoading} className="w-full h-11 rounded-xl bg-admin-primary text-admin-inverse font-bold hover:bg-admin-primary transition disabled:opacity-60 inline-flex items-center justify-center gap-2">
            {loginLoading && <Spinner size={16} className="border-[#080C1E]/20 border-t-[#080C1E]" />} {loginLoading ? "Memproses…" : "Masuk"}
          </button>
          <p className="text-xs text-admin-muted text-center">Akses terbatas — hanya akun terotorisasi.</p>
        </div>
      </div>
    </div>
  );
}
