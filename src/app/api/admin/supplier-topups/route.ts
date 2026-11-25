import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { readBoundedText, RequestBodyError } from "@/lib/bounded-body";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  createSupplierTopup,
  listSupplierTopups,
  supplierTopupGates,
  SupplierTopupError,
  type SupplierTopupSupplier,
} from "@/lib/supplier/topup";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_000;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

function errorResponse(error: unknown): NextResponse {
  if (error instanceof SupplierTopupError) return json({ ok: false, error: error.code }, error.status);
  return json({ ok: false, error: "topup_failed" }, 500);
}

export async function GET(request: NextRequest) {
  if (!await requireAdmin(request)) return json({ ok: false, error: "unauthorized" }, 401);
  const supplier = new URL(request.url).searchParams.get("supplier");
  if (supplier !== null && supplier !== "" && supplier !== "sekalipay" && supplier !== "tunvn" && supplier !== "storebat") {
    return json({ ok: false, error: "invalid_supplier" }, 400);
  }
  try {
    const items = await listSupplierTopups(createDatabaseAccess(), {
      supplier: (supplier || null) as SupplierTopupSupplier | null,
    });
    return json({ ok: true, items, gates: supplierTopupGates() });
  } catch {
    return json({ ok: false, error: "load_failed" }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (!await requireAdmin(request)) return json({ ok: false, error: "unauthorized" }, 401);
  let text: string;
  try {
    text = await readBoundedText(request, MAX_BODY_BYTES);
  } catch (error) {
    const failure = error instanceof RequestBodyError ? error : new RequestBodyError(400, "invalid_body");
    return json({ ok: false, error: failure.code }, failure.status);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }
  try {
    const item = await createSupplierTopup(createDatabaseAccess(), parsed);
    return json({ ok: true, item });
  } catch (error) {
    return errorResponse(error);
  }
}
