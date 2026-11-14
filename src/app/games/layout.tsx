import type { Metadata } from "next";
import { DisplayPreferencesProvider } from "@/hooks/useDisplayPrices";
import { Footer } from "@/components/storefront/Footer";
import { CrossAppTransition } from "@/components/ui/CrossAppTransition";
import { GamesNavbar, GamesBottomNav } from "@/components/games/GamesNavbar";
import { requestLocale } from "@/lib/i18n/server-locale";
import { gamesCopy } from "@/lib/games/copy";
import { getGamesCatalog } from "@/lib/games/catalog";
import { gamesMetadata } from "@/lib/games/metadata";

export async function generateMetadata(): Promise<Metadata> {
  const t = gamesCopy(await requestLocale());
  return gamesMetadata("/", t.title, t.description);
}

export default async function GamesLayout({ children }: { children: React.ReactNode }) {
  const games = await getGamesCatalog();
  return <DisplayPreferencesProvider><div className="min-h-screen overflow-x-clip bg-[#080C1E] text-[#F1F5FF]">
    <GamesNavbar games={games} /><main className="pb-10">{children}</main><Footer pediaLayout /><GamesBottomNav /><CrossAppTransition />
  </div></DisplayPreferencesProvider>;
}
