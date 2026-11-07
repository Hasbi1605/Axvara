import type { Metadata } from "next";
import { requestLocale } from "@/lib/i18n/server-locale";
import { pediaPageMetadata } from "@/lib/pedia/metadata";
import { PediaRefillClient } from "./refill-client";

export const runtime = "edge";

// src/app/pedia/refill/page.tsx — Halaman Refill Pedia (2026-11-01).
export async function generateMetadata(): Promise<Metadata> {
  return pediaPageMetadata(await requestLocale(), "refill", "/refill");
}

export default function PediaRefillPage() {
  return <PediaRefillClient />;
}
