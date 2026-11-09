import type { Metadata } from "next";
import { gamesCopy } from "@/lib/games/copy";
import { requestLocale } from "@/lib/i18n/server-locale";
import { GameStatus } from "./status-client";
import { gamesMetadata } from "@/lib/games/metadata";

export const runtime = "edge";
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const t = gamesCopy(await requestLocale());
  return gamesMetadata(`/pesanan/${encodeURIComponent((await params).code)}`, `${t.statusTitle} — AXVARA Games`, t.contactPrompt);
}
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  return <GameStatus code={(await params).code.toUpperCase()} />;
}
