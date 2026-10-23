import { NextRequest } from "next/server";
import { GET as getOrder } from "../route";

export const runtime = "edge";
export const dynamic = "force-dynamic";

// Both public status URLs share one serializer and the same payment recovery,
// supplier flags and unit progress. Credentials still require buyer proof.
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const url = new URL(req.url);
  url.pathname = "/api/orders";
  url.searchParams.set("code", code || "invalid");
  const response = await getOrder(new NextRequest(url, { headers: req.headers }));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
