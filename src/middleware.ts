import { NextResponse, type NextRequest } from "next/server";

const PEDIA_HOST = (process.env.PEDIA_HOST || "pedia.axvara.tech").toLowerCase();

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") || "").toLowerCase().split(":")[0] || "";
  const path = req.nextUrl.pathname;
  const isAsset = path.startsWith("/api/") || path.startsWith("/_next/")
    || path.startsWith("/brand/") || path.startsWith("/icons/")
    || path.startsWith("/og/") || path === "/favicon.svg" || path === "/favicon.ico"
    || /\.(svg|png|jpg|jpeg|webp|ico|css|js|woff2?)$/.test(path);

  // PEDIA (2026-10-07, PEDIA-PRD §9.2): pedia.axvara.tech → rewrite /pedia/*.
  // axvara.tech/pedia/* → 308 ke subdomain (satu URL kanonis).
  if (host === PEDIA_HOST && process.env.PEDIA_ENABLED === "true" && !isAsset && !path.startsWith("/pedia")) {
    const url = req.nextUrl.clone();
    url.pathname = path === "/" ? "/pedia" : `/pedia${path}`;
    return NextResponse.rewrite(url);
  }
  if (host !== PEDIA_HOST && (path === "/pedia" || path.startsWith("/pedia/"))) {
    // Dev lokal (127.0.0.1/localhost): buka langsung tanpa redirect.
    if (host.startsWith("127.") || host === "localhost") {
      return NextResponse.next();
    }
    const url = req.nextUrl.clone();
    url.protocol = "https:";
    url.host = PEDIA_HOST;
    url.pathname = path.replace(/^\/pedia(\/|$)/, "/$1").replace(/\/$/, "") || "/";
    return NextResponse.redirect(url, 308);
  }

  const res = NextResponse.next();

  // Production stays strict. Next.js dev needs eval for webpack/React Refresh;
  // without this exception the client never hydrates on localhost.
  const devScriptEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  // F-04 fix: CSRF Origin validation for mutating requests
  // F-11 fix: removed blob: from admin img-src
  // 2026-10-03: frame-src youtube-nocookie untuk embed tutorial di /artikel
  // (player dirender server-only via <iframe>, bukan HTML mentah Markdown).
  const YOUTUBE_FRAME = "frame-src https://www.youtube-nocookie.com;";
  const isAdmin = req.nextUrl.pathname.startsWith("/admin") || req.nextUrl.pathname.startsWith("/api/admin");
  const csp = isAdmin
    ? `default-src 'self'; script-src 'self' 'unsafe-inline'${devScriptEval}; style-src 'self' 'unsafe-inline'; img-src 'self' https://images.unsplash.com data:; font-src 'self' data:; connect-src 'self'; ${YOUTUBE_FRAME} frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
    : `default-src 'self'; script-src 'self' 'unsafe-inline'${devScriptEval}; style-src 'self' 'unsafe-inline'; img-src 'self' https://images.unsplash.com https://picsum.photos data: blob:; font-src 'self' data:; connect-src 'self'; ${YOUTUBE_FRAME} frame-ancestors 'none'; base-uri 'self'; form-action 'self'`;

  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.headers.set("X-DNS-Prefetch-Control", "off");

  // F-04: CSRF — block cross-origin mutating requests on API endpoints
  const method = req.method;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && req.nextUrl.pathname.startsWith("/api/")) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
      }
    }
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg|favicon.ico).*)"],
};
