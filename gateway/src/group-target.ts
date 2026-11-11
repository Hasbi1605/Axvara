export const GROUP_NAME = "AXVARA'S";

// WhatsApp preserves typographic apostrophes in subjects. Match equivalent
// spelling, never a substring: a different group must not receive invoices.
export function isNotificationGroupName(subject: string): boolean {
  return subject.normalize("NFKC").trim().replace(/[\u2018\u2019\u02bc]/g, "'").toUpperCase() === GROUP_NAME;
}

export function selectNotificationGroup<T extends { id: string; subject: string }>(groups: T[]): T {
  const matches = groups.filter(group => isNotificationGroupName(group.subject));
  if (matches.length !== 1) throw new Error(matches.length
    ? "Ada beberapa grup bernama AXVARA'S; tujuan harus diperiksa."
    : "Grup AXVARA'S belum ditemukan. Periksa nama grup dan keanggotaan bot, lalu cek koneksi kembali.");
  return matches[0];
}

/** Only call with a group whose identity and sending permissions were verified. */
export function notificationGroupStatus(group: { id: string; subject: string } | null) {
  return { groupId: group?.id, groupName: group ? GROUP_NAME : undefined, groupSubject: group?.subject };
}

export const PROMO_IMAGE_URL = "https://axvara.tech/banners/ready-promo.webp";

export async function loadPromoImage(): Promise<Buffer> {
  const response = await fetch(PROMO_IMAGE_URL, { redirect: "error", signal: AbortSignal.timeout(8000) });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/webp") || !response.body) throw new Error("promo_image_unavailable");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw new Error("promo_image_too_large");
    chunks.push(chunk);
  }
  if (!size) throw new Error("promo_image_empty");
  return Buffer.concat(chunks);
}

export function notificationContent(message: string, kind: boolean | "welcome" | "promo") {
  return kind === "promo" ? { image: { url: PROMO_IMAGE_URL }, caption: message } : { text: message };
}

export function currentPromoKey(key: string, now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value;
  const hour = Number(part("hour"));
  const slot = hour >= 9 && hour < 12 ? "morning" : hour >= 17 && hour < 20 ? "evening" : null;
  return slot !== null && key === `wa:promo:${part("year")}-${part("month")}-${part("day")}:${slot}`;
}

export function validNotificationKey(key: unknown, kind: boolean | "welcome" | "promo"): boolean {
  if (typeof key !== "string") return false;
  if (kind === "promo") return /^wa:promo:\d{4}-\d{2}-\d{2}:(morning|evening)$/.test(key);
  if (kind === "welcome") return /^wa:welcome:[a-f0-9]{64}$/.test(key);
  return kind
    ? /^wa:broadcast:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(key)
    : /^wa:sale-completed:AX[VP]-\d{8}-[A-Z0-9]{8}$/.test(key);
}
