import type { Metadata } from "next";
import { SITE } from "@/lib/site";

export function gamesMetadata(path: string, title: string, description: string): Metadata {
  const url = `${SITE.gamesUrl}${path === "/" ? "/" : `/${path.replace(/^\/+/, "")}`}`;
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, url, siteName: "AXVARA Games", type: "website" } };
}
