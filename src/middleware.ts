import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Security headers — applied to all routes (edge)
  // CSP: strict for admin, slightly relaxed for storefront (unsplash + inline styles for Tailwind)
  const isAdmin = req.nextUrl.pathname.startsWith("/admin") || req.nextUrl.pathname.startsWith("/api/admin");
  const csp = isAdmin
    ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https://images.unsplash.com data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    : "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https://images.unsplash.com https://picsum.photos https://cdn.axvara.id data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // HSTS — only meaningful on https, but safe to set
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.headers.set("X-DNS-Prefetch-Control", "off");

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg|favicon.ico).*)"],
};
