"use client";

import { useEffect, useState } from "react";
import { readCheckoutCredentialGrant } from "@/lib/order-access-client";
import { orderCopy } from "@/lib/i18n/order-copy";
import type { Locale } from "@/lib/i18n/locale";
import { OrderAccessNotice } from "./OrderAccessNotice";

export function BuyerOrderPin({ code, credentialToken, locale, noticeClassName = "", statusClassName = "" }: { code: string; credentialToken: string | null; locale: Locale; noticeClassName?: string; statusClassName?: string }) {
  const [pin, setPin] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "denied" | "error">("idle");
  const [retry, setRetry] = useState(0);
  const t = orderCopy(locale);
  useEffect(() => {
    const grant = readCheckoutCredentialGrant(code);
    let token = credentialToken || "";
    try { token ||= sessionStorage.getItem(`wr-cred-token:${code}`) || ""; } catch { /* Tab storage is optional. */ }
    setPin(""); setState("idle");
    // No tab proof: still try once; the HttpOnly device cookie may prove it.
    const controller = new AbortController();
    setState("loading");
    void fetch(`/api/orders/${encodeURIComponent(code)}/pin`, {
      method: "POST", cache: "no-store", signal: controller.signal,
      headers: { ...(grant ? { "x-checkout-credential-grant": grant } : {}), ...(token ? { "x-credential-token": token } : {}) },
    }).then(async response => {
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (response.ok && /^[A-Z0-9]{6}$/.test(body.pin)) { setPin(body.pin); setState("idle"); }
      else setState([400, 403, 404, 409].includes(response.status) ? "denied" : "error");
    }).catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [code, credentialToken, retry]);
  if (pin) return <OrderAccessNotice accessCode={pin} locale={locale} className={noticeClassName} />;
  if (state === "idle") return null;
  return <div className={`mt-4 text-left text-xs text-white/65${statusClassName ? ` ${statusClassName}` : ""}`} role="status">
    {state === "loading" ? t.accessNotice.loading : t.accessNotice.loadFailed}
    {state === "error" && <> <button type="button" onClick={() => setRetry(n => n + 1)} className="min-h-11 px-3 font-semibold text-[#00E5FF] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF]">{t.common.retry}</button></>}
  </div>;
}
