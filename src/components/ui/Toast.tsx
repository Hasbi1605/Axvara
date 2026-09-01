"use client";
import { createContext, useContext, useState, useCallback, ReactNode } from "react";

type Toast = { id: number; msg: string; kind: "error" | "success" | "info" };
type Ctx = {
  toasts: Toast[];
  push: (msg: string, kind?: Toast["kind"]) => void;
  error: (msg: string) => void;
  success: (msg: string) => void;
};

const ToastCtx = createContext<Ctx | null>(null);
let nid = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((msg: string, kind: Toast["kind"] = "info") => {
    const id = nid++;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  const error = useCallback((m: string) => push(m, "error"), [push]);
  const success = useCallback((m: string) => push(m, "success"), [push]);
  return (
    <ToastCtx.Provider value={{ toasts, push, error, success }}>
      {children}
      <div className="fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none px-4 w-full max-w-[420px]">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto w-full rounded-2xl border px-4 py-3 text-sm font-medium shadow-xl backdrop-blur-xl animate-[fadeInUp_0.28s_var(--ease-apple)] ${
              t.kind === "error"
                ? "bg-red-500/95 border-red-400 text-white"
                : t.kind === "success"
                ? "bg-emerald-500/95 border-emerald-400 text-white"
                : "ax-glass-strong text-white border-white/15"
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error("useToast outside provider");
  return v;
}
