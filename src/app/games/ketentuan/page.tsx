import type { Metadata } from "next";
import { GamesInformation } from "@/components/games/GamesInformation";
import { requestLocale } from "@/lib/i18n/server-locale";
import { gamesCopy } from "@/lib/games/copy";
import { gamesMetadata } from "@/lib/games/metadata";

export const runtime = "edge";

export async function generateMetadata(): Promise<Metadata> { const t = gamesCopy(await requestLocale()); return gamesMetadata("/ketentuan", `${t.termsTitle} — AXVARA Games`, t.description); }
export default function Page() { return <GamesInformation kind="terms" />; }
