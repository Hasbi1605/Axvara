export async function fetchAdminAuth(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(path, { ...init, redirect: "manual" });
  if (response.type === "opaqueredirect"
    || (response.status === 401 && response.headers?.get("x-axvara-admin-access") === "access_required")) {
    // A full navigation lets Access renew its session outside the fetch/CORS flow.
    window.location.assign("/admin");
    throw new Error("Verifikasi Cloudflare Access diperlukan.");
  }
  return response;
}
