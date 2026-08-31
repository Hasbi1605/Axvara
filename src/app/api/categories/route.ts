import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM categories ORDER BY sort_order").all() as unknown[];
  return NextResponse.json({ categories: rows });
}
