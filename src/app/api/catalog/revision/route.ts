import { NextResponse } from "next/server";
import { getCatalogRevision, type CatalogScope } from "@/lib/catalog-cache";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

function isCatalogScope(value: string): value is CatalogScope {
  return value === "market" || value === "pedia" || value === "games";
}

export async function GET(request: Request) {
  const rawScope = new URL(request.url).searchParams.get("scope");
  const scope = rawScope === null ? "market" : rawScope;
  if (!isCatalogScope(scope)) {
    return NextResponse.json({ error: "invalid_scope" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  let revision = "0";
  try {
    revision = await getCatalogRevision(scope);
  } catch {
    revision = "0";
  }
  return NextResponse.json({ scope, revision }, { headers: NO_STORE_HEADERS });
}
