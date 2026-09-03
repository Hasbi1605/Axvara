import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryAll, queryFirst, execRun } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { slugify } from "@/lib/articles";
import { isCategoryIconName } from "@/lib/category-icons";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const wantAll = new URL(req.url).searchParams.get("all") === "1";
  if (wantAll && !(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await queryAll("SELECT c.*, COUNT(p.id) AS product_count FROM categories c LEFT JOIN products p ON p.category_id=c.id GROUP BY c.id ORDER BY c.sort_order, c.name");
  return NextResponse.json(
    { categories: rows },
    { headers: { "Cache-Control": wantAll ? "private, no-store" : "public, max-age=60, s-maxage=60, stale-while-revalidate=120" } }
  );
}
const input=z.object({
  name:z.string().trim().min(2).max(40),
  icon:z.string().trim().refine(isCategoryIconName,"Ikon kategori tidak valid").optional(),
  sort_order:z.coerce.number().int().min(0).max(999).optional(),
});
export async function POST(req:NextRequest){const admin=await requireAdmin(req);if(!admin)return NextResponse.json({error:"Unauthorized"},{status:401});const d=input.safeParse(await req.json().catch(()=>null));if(!d.success)return NextResponse.json({error:d.error.issues[0]?.message??"Validasi gagal"},{status:400});let slug=slugify(d.data.name),n=2;while(await queryFirst("SELECT id FROM categories WHERE slug=?",slug))slug=`${slugify(d.data.name)}-${n++}`;const r=await execRun("INSERT INTO categories (name,slug,icon,sort_order) VALUES (?,?,?,?)",d.data.name,slug,d.data.icon??"star",d.data.sort_order??999);return NextResponse.json({id:r.lastInsertRowid,slug},{status:201});}
export async function PUT(req:NextRequest){if(!await requireAdmin(req))return NextResponse.json({error:"Unauthorized"},{status:401});const id=new URL(req.url).searchParams.get("id");if(!id||!await queryFirst("SELECT id FROM categories WHERE id=?",id))return NextResponse.json({error:"not found"},{status:404});const d=input.partial().safeParse(await req.json().catch(()=>null));if(!d.success)return NextResponse.json({error:d.error.issues[0]?.message??"Validasi gagal"},{status:400});const fields:string[]=[],values:unknown[]=[];if(d.data.name){fields.push("name=?");values.push(d.data.name)}if(d.data.icon!==undefined){fields.push("icon=?");values.push(d.data.icon)}if(d.data.sort_order!==undefined){fields.push("sort_order=?");values.push(d.data.sort_order)}if(fields.length){values.push(id);await execRun(`UPDATE categories SET ${fields.join(",")} WHERE id=?`,...values)}return NextResponse.json({ok:true});}
export async function DELETE(req:NextRequest){if(!await requireAdmin(req))return NextResponse.json({error:"Unauthorized"},{status:401});const id=new URL(req.url).searchParams.get("id");if(!id)return NextResponse.json({error:"id diperlukan"},{status:400});if(await queryFirst("SELECT id FROM products WHERE category_id=? LIMIT 1",id))return NextResponse.json({error:"Kategori yang memiliki produk tidak dapat dihapus"},{status:409});const result=await execRun("DELETE FROM categories WHERE id=?",id);return result.changes?NextResponse.json({ok:true}):NextResponse.json({error:"not found"},{status:404});}
