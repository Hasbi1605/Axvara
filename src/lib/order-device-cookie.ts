// HttpOnly d1 device cookie helpers. Path is scoped to one order's API routes,
// so every order has its own cookie and it is never sent elsewhere.
import type { NextResponse } from "next/server";
import { DEVICE_COOKIE_MAX_AGE, DEVICE_COOKIE_NAME, deviceCookiePath } from "@/lib/order-access";

// Parsed from the raw header so it also works with plain Request objects.
export function readDeviceCookie(request: Request): string {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === DEVICE_COOKIE_NAME) return part.slice(separator + 1).trim();
  }
  return "";
}

function cookieOptions(code: string, request: Request, maxAge: number) {
  return { path: deviceCookiePath(code), httpOnly: true, sameSite: "lax" as const, secure: new URL(request.url).protocol === "https:", maxAge };
}

export function setDeviceCookie(response: NextResponse, code: string, value: string, request: Request): void {
  response.cookies.set({ name: DEVICE_COOKIE_NAME, value, ...cookieOptions(code, request, DEVICE_COOKIE_MAX_AGE) });
}

export function clearDeviceCookie(response: NextResponse, code: string, request: Request): void {
  response.cookies.set({ name: DEVICE_COOKIE_NAME, value: "", ...cookieOptions(code, request, 0) });
}
