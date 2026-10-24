export const DEFAULT_SALES_BOT_NUMBER = "6283181632507";
export function normalizeBotNumber(value: unknown): string | null {
  if (typeof value !== "string" || !/^\+?[\d\s()-]+$/.test(value.trim())) return null;
  let phone = value.replace(/[^\d]/g, "");
  if (phone.startsWith("08")) phone = "62" + phone.slice(1);
  return /^[1-9]\d{9,14}$/.test(phone) ? phone : null;
}
export function validBotRevision(value: unknown): value is string {
  return typeof value === "string" && /^(initial|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(value);
}
