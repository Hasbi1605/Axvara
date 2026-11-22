/** Decode the stored array without validating or changing its members. */
export function parseItems<T>(raw: unknown): T[] {
  try {
    const parsed: unknown = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
