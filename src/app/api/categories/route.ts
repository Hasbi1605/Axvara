import { NextResponse } from "next/server";
import { queryAll } from "@/lib/db-edge";

export const dynamic = "force-dynamic";
export async function GET() {
  const rows = await queryAll("SELECT * FROM categories ORDER BY sort_order");
  return NextResponse.json({ categories: rows });
}
