import { createRemoteJWKSet, errors, jwtVerify } from "jose";

type AccessCheck = { ok: true } | { ok: false; reason: "access_required" | "access_unavailable" };
let cachedKeys: { issuer: string; keys: ReturnType<typeof createRemoteJWKSet> } | undefined;

export async function checkCloudflareAccess(req?: Request): Promise<AccessCheck> {
  const domain = process.env.CF_ACCESS_TEAM_DOMAIN?.trim() || "";
  const audience = process.env.CF_ACCESS_AUD?.trim() || "";
  if (!domain && !audience && process.env.NODE_ENV !== "production") return { ok: true };
  // Only the configured Cloudflare team can supply keys; never use JWT jku/iss as a URL.
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(domain)
    || !/^[a-f0-9]{64}$/.test(audience) || !process.env.ADMIN_EMAIL?.trim()) {
    return { ok: false, reason: "access_unavailable" };
  }
  const assertion = req?.headers.get("cf-access-jwt-assertion");
  const cookieTokens = (req?.headers.get("cookie") || "").split(";")
    .map(part => part.trim()).filter(part => part.startsWith("CF_Authorization="));
  // Cookie Path is disabled on the Access app so mixed public/admin API paths get this token.
  const token = assertion ?? (cookieTokens.length === 1 ? cookieTokens[0].slice("CF_Authorization=".length) : "");
  if (!token || token.length > 16_384) return { ok: false, reason: "access_required" };
  const issuer = `https://${domain}`;
  try {
    if (cachedKeys?.issuer !== issuer) {
      cachedKeys = { issuer, keys: createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
        timeoutDuration: 5_000, cooldownDuration: 30_000, cacheMaxAge: 600_000,
      }) };
    }
    const { payload } = await jwtVerify(token, cachedKeys.keys, {
      issuer, audience, algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub", "email"],
    });
    if (typeof payload.email !== "string"
      || payload.email.toLowerCase() !== process.env.ADMIN_EMAIL.trim().toLowerCase()) {
      return { ok: false, reason: "access_required" };
    }
    return { ok: true };
  } catch (error) {
    const invalidToken = error instanceof errors.JOSEError
      && (error.code.startsWith("ERR_JWT_") || error.code.startsWith("ERR_JWS_")
        || error.code === "ERR_JOSE_ALG_NOT_ALLOWED" || error.code === "ERR_JWKS_NO_MATCHING_KEY");
    return { ok: false, reason: invalidToken ? "access_required" : "access_unavailable" };
  }
}

export function accessFailureResponse(check: Extract<AccessCheck, { ok: false }>): Response {
  return Response.json({ error: check.reason === "access_required"
    ? "Verifikasi Cloudflare Access diperlukan. Buka kembali halaman admin."
    : "Verifikasi akses admin sedang tidak tersedia. Coba lagi sebentar.", reason: check.reason }, {
    status: check.reason === "access_required" ? 401 : 503,
    headers: { "Cache-Control": "private, no-store", "X-AXVARA-Admin-Access": check.reason },
  });
}
