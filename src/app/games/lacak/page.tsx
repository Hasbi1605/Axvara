import type { Metadata } from "next";
import { requestLocale } from "@/lib/i18n/server-locale";
import { gamesCopy } from "@/lib/games/copy";
import { GamesTrack } from "./track-client";
import { gamesMetadata } from "@/lib/games/metadata";
export const runtime = "edge";
export async function generateMetadata(): Promise<Metadata> { const t = gamesCopy(await requestLocale()); return gamesMetadata("/lacak", `${t.trackTitle} — AXVARA Games`, t.trackDescription); }
export default function Page() { return <GamesTrack />; }
