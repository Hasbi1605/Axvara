"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ToastProvider } from "@/components/ui/Toast";
import { Sun, Moon, Monitor } from "lucide-react";
import { AdminPortalContext } from "./ui/portal";
import { Button } from "./ui/button";
import { TooltipProvider } from "./ui/tooltip";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator } from "./ui/dropdown-menu";
import "./admin.css";

type Theme = "light" | "dark" | "system";
const ThemeContext = createContext<{ theme: Theme; changeTheme: (theme: Theme) => void }>({ theme: "system", changeTheme: () => {} });
export function AdminThemeMenu() {
  const { theme, changeTheme } = useContext(ThemeContext);
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="Tema admin">{theme === "dark" ? <Moon /> : theme === "light" ? <Sun /> : <Monitor />}</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>Tema admin</DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuRadioGroup value={theme} onValueChange={value => { if (value === "light" || value === "dark" || value === "system") changeTheme(value); }}><DropdownMenuRadioItem value="light"><Sun />Terang</DropdownMenuRadioItem><DropdownMenuRadioItem value="dark"><Moon />Gelap</DropdownMenuRadioItem><DropdownMenuRadioItem value="system"><Monitor />Ikuti sistem</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>;
}
const drafts = new Set<symbol>();
const writes = new Set<symbol>();
const NAVIGATE = "axvara:admin-navigate";
let historyIndex = 0;

export function pushAdminHistory(url: string | URL) {
  history.pushState({ ...history.state, adminIndex: ++historyIndex }, "", url);
}

export function navigateWithDraftGuard(proceed: () => void) {
  if (window.dispatchEvent(new CustomEvent(NAVIGATE, { cancelable: true, detail: proceed }))) proceed();
}

export function useAdminDraft(dirty: boolean, busy = false) {
  const id = useRef(Symbol());
  useEffect(() => {
    const key = id.current;
    if (dirty) drafts.add(key); else drafts.delete(key);
    if (busy) writes.add(key); else writes.delete(key);
    return () => { drafts.delete(key); writes.delete(key); };
  }, [dirty, busy]);
}

export function AdminWorkspace({ children, initialTheme = "system" }: { children: ReactNode; initialTheme?: Theme }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const pathname = usePathname();
  useEffect(() => {
    historyIndex = history.state?.adminIndex ?? 0;
    history.replaceState({ ...history.state, adminIndex: historyIndex }, "");
    let restoring = false;
    let confirmedTraversal = false;
    const navigation = (window as Window & { navigation?: EventTarget & { traverseTo: (key: string) => unknown } }).navigation;
    const traversal = (raw: Event) => {
      const event = raw as Event & { navigationType: string; destination: { key: string }; canIntercept: boolean };
      if (event.navigationType !== "traverse" || !event.cancelable || !event.canIntercept || !drafts.size || confirmedTraversal) return;
      event.preventDefault();
      if (!writes.size) setPending(() => () => { confirmedTraversal = true; navigation?.traverseTo(event.destination.key); });
    };
    const pop = (event: PopStateEvent) => {
      const next = event.state?.adminIndex ?? historyIndex;
      if (restoring) { restoring = false; event.stopImmediatePropagation(); return; }
      if (confirmedTraversal) { confirmedTraversal = false; historyIndex = next; return; }
      if (drafts.size && next !== historyIndex) {
        event.stopImmediatePropagation();
        const delta = next - historyIndex;
        restoring = true;
        history.go(-delta);
        if (!writes.size) setPending(() => () => { confirmedTraversal = true; history.go(delta); });
      } else historyIndex = next;
    };
    const navigate = (event: Event) => { if (drafts.size) { event.preventDefault(); if (!writes.size) setPending(() => (event as CustomEvent<() => void>).detail); } };
    const unload = (event: BeforeUnloadEvent) => { if (drafts.size) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener(NAVIGATE, navigate);
    window.addEventListener("beforeunload", unload);
    window.addEventListener("popstate", pop, true);
    navigation?.addEventListener("navigate", traversal);
    return () => { window.removeEventListener(NAVIGATE, navigate); window.removeEventListener("beforeunload", unload); window.removeEventListener("popstate", pop, true); navigation?.removeEventListener("navigate", traversal); };
  }, []);
  // Tema/toast admin hanya untuk panel `/admin`; `/admin/payments/test` merender checkout storefront asli.
  if (pathname !== "/admin") return <>{children}</>;
  return <ThemeContext.Provider value={{ theme, changeTheme: value => { setTheme(value); document.cookie = `axvara-admin-theme=${value}; Path=/admin; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; } }}><div ref={setPortal} className="admin-theme" data-admin-theme={theme} onClickCapture={event => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
    if (!drafts.size || !link || link.target === "_blank" || link.hasAttribute("download") || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.href === window.location.href || link.getAttribute("href")?.startsWith("#")) return;
    event.preventDefault(); event.stopPropagation(); navigateWithDraftGuard(() => { drafts.clear(); window.location.assign(link.href); });
  }}>
    <AdminPortalContext.Provider value={portal}><TooltipProvider delayDuration={250}>
    <ToastProvider admin>{children}</ToastProvider>
    <ConfirmDialog open={!!pending} title="Buang perubahan?" description="Ada perubahan yang belum disimpan. Tetap di sini untuk melanjutkan, atau buang perubahan dan pindah halaman." confirmLabel="Buang perubahan" cancelLabel="Lanjut mengedit" onClose={() => setPending(null)} onConfirm={() => { const proceed = pending; setPending(null); proceed?.(); }} />
    </TooltipProvider></AdminPortalContext.Provider>
  </div></ThemeContext.Provider>;
}
