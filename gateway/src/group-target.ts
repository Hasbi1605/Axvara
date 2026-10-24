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

export function validNotificationKey(key: unknown, kind: boolean | "welcome"): boolean {
  if (typeof key !== "string") return false;
  if (kind === "welcome") return /^wa:welcome:[a-f0-9]{64}$/.test(key);
  return kind
    ? /^wa:broadcast:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(key)
    : /^wa:sale-completed:AX[VP]-\d{8}-[A-Z0-9]{8}$/.test(key);
}
