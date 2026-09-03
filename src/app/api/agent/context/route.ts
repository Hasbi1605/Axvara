import { NextRequest, NextResponse } from "next/server";
import { queryAll } from "@/lib/db";
import { requireAgent } from "@/lib/agent-auth";

export const runtime="edge"; export const dynamic="force-dynamic";
export async function GET(req:NextRequest){const access=await requireAgent(req,"context:read");if("error" in access)return NextResponse.json({error:access.error},{status:access.status});const [categories,products,recent]=await Promise.all([queryAll("SELECT id,name,slug,icon FROM categories ORDER BY sort_order"),queryAll("SELECT name,slug,description FROM products WHERE is_active=1 ORDER BY sort_order LIMIT 50"),queryAll("SELECT title,excerpt,slug,status FROM articles ORDER BY updated_at DESC LIMIT 20")]);return NextResponse.json({brand:{name:"AXVARA",positioning:"Gerbang Semua Tools Premium"},categories,products,recent_articles:recent,editorial_guide:["Tulis Bahasa Indonesia yang akurat dan berguna.","Jangan membuat klaim harga, stok, atau fitur yang tidak dapat diverifikasi.","Sertakan sumber URL primer; artikel dari agent selalu masuk Draft." ]},{headers:{"Cache-Control":"private, no-store"}});}
