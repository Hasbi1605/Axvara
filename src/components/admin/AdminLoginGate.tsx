"use client";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button, Card, CardHeader, CardContent, CardDescription, Input, Label } from "./ui";
import { AdminThemeMenu } from "./AdminWorkspace";

export function AdminAuthChecking() {
  return <div className="mx-auto max-w-[420px] px-4 py-16"><Card><CardContent className="flex flex-col items-center gap-4 pt-6" role="status"><Loader2 className="size-7 animate-spin" aria-hidden="true" /><p className="text-sm text-admin-muted">Memeriksa sesi admin…</p></CardContent></Card></div>;
}
export function AdminLoginGate({ email, pass, loginLoading, loginError, onEmailChange, onPassChange, onLogin }: {
  email: string; pass: string; loginLoading: boolean; loginError: string | null; onEmailChange: (value: string) => void; onPassChange: (value: string) => void; onLogin: () => void;
}) {
  return <div className="mx-auto max-w-[420px] px-4 py-10 sm:py-16"><Card><CardHeader><div className="flex items-center justify-between gap-3"><Link href="/" className="text-sm font-medium tracking-wide text-admin-muted">AXVARA Admin</Link><AdminThemeMenu /></div><h1 className="pt-3 text-xl font-semibold tracking-tight">Masuk Panel Admin</h1><CardDescription>Otentikasi diperlukan untuk mengelola katalog &amp; pesanan.</CardDescription></CardHeader><CardContent><form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!loginLoading) onLogin(); }}><div className="space-y-2"><Label htmlFor="admin-email">Email</Label><Input id="admin-email" type="email" value={email} onChange={event => onEmailChange(event.target.value)} placeholder="admin@axvara.tech" autoComplete="username" /></div><div className="space-y-2"><Label htmlFor="admin-password">Password</Label><Input id="admin-password" type="password" value={pass} onChange={event => onPassChange(event.target.value)} autoComplete="current-password" /></div>{loginError && <p role="alert" className="rounded-md border border-admin-danger/20 bg-admin-danger/10 px-3 py-2 text-sm text-admin-danger">{loginError}</p>}<Button type="submit" disabled={loginLoading} className="w-full">{loginLoading && <Loader2 className="animate-spin" />}{loginLoading ? "Memproses…" : "Masuk"}</Button><p className="text-center text-xs text-admin-muted">Akses terbatas — hanya akun terotorisasi.</p></form></CardContent></Card></div>;
}
