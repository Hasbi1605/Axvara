import type { Metadata } from "next";
import { faviconIcons } from "@/lib/favicons";
import { SITE } from "@/lib/site";

export function gamesMetadata(path: string, title: string, description: string): Metadata {
  const url = `${SITE.gamesUrl}${path === "/" ? "/" : `/${path.replace(/^\/+/, "")}`}`;
  return { title, description, icons: faviconIcons("games"), alternates: { canonical: url }, openGraph: { title, description, url, siteName: "AXVARA Games", type: "website" } };
}
