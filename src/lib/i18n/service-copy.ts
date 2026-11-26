import type { Locale } from "./locale";

/** Salinan kartu/menu lintas-layanan. ID = data `AXVARA_SERVICES`. */
const EN: Record<string, { name: string; description: string }> = {
  market: { name: "AXVARA Market", description: "Premium apps and AI tools" },
  pedia: { name: "AXVARA Pedia", description: "Instant social boost" },
  games: { name: "AXVARA Games", description: "Instant game top-ups" },
};

export function axvaraServiceCopy(
  service: { id: string; name: string; description: string },
  locale: Locale,
): { name: string; description: string } {
  if (locale !== "en") return { name: service.name, description: service.description };
  return EN[service.id] ?? { name: service.name, description: service.description };
}
