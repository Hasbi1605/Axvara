export function securityHeaders() {
  return {
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...securityHeaders(),
    },
  });
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/time") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return json({ error: "method_not_allowed" }, 405);
      }
      const now = Date.now();
      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-axvara-time": String(now),
            ...securityHeaders(),
          },
        });
      }
      return json({ now });
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not_found" }, 404);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "method_not_allowed" }, 405);
    }

    if (env?.ASSETS?.fetch) {
      const res = await env.ASSETS.fetch(request);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(securityHeaders())) {
        headers.set(k, v);
      }
      const isHtml = url.pathname === "/" || url.pathname.endsWith(".html");
      headers.set("cache-control", isHtml ? "no-store" : "public, max-age=3600");
      return new Response(res.body, { status: res.status, headers });
    }

    return new Response("AXVARA 2FA", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        ...securityHeaders(),
      },
    });
  },
};

export default worker;
