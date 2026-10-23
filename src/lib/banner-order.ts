import { getD1, queryAll, type D1Statement } from "@/lib/db";
import { getBannerMem } from "@/lib/db/client";

export class BannerOrderConflict extends Error {}
const columns = ["title", "body", "image_url", "cta_label", "cta_href", "is_active"];
type Fields = Record<string, unknown>;
const orderedIds = (rows: Fields[]) => [...rows].sort((a,b) => Number(a.sort_order)-Number(b.sort_order) || Number(b.id)-Number(a.id)).map(row => Number(row.id));
const conflict = () => new BannerOrderConflict("Daftar banner berubah. Muat ulang sebelum mengubah urutan.");

/** All positions are staged outside the nonnegative range, then normalized in
 * the same transaction. The snapshot guard also detects concurrent create/delete.
 * An error rolls back staging, content and position together. */
async function mutate(kind: "save" | "delete" | "reorder", data: Fields, id: number | null, desired?: number[], expected?: number[]) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const snapshot = await queryAll("SELECT id,sort_order FROM banners ORDER BY sort_order,id DESC");
    const before = orderedIds(snapshot);
    if (expected && before.join(",") !== expected.join(",")) throw conflict();
    if (id !== null && !before.includes(id)) return { id, sort_order: -1, changes: 0 };
    if (kind === "save" && id === null && before.length >= 1000) throw new BannerOrderConflict("Maksimal 1.000 banner. Hapus banner lama terlebih dahulu.");
    let after = before.filter(n => n !== id);
    const position = id === null ? after.length : before.indexOf(id);
    if (kind === "save") after.splice(position, 0, id ?? 0);
    if (kind === "reorder") {
      if (!desired || desired.length !== before.length || new Set(desired).size !== before.length || desired.some(n => !before.includes(n))) throw conflict();
      after = desired;
    }
    const db = getD1();
    if (!db) {
      if (process.env.NODE_ENV === "production") throw new Error("database_unavailable");
      // Synchronous dev commit; recheck the live array after the async snapshot.
      const rows = getBannerMem();
      if (orderedIds(rows).join(",") !== before.join(",")) { if (expected) throw conflict(); continue; }
      const fields = Object.fromEntries(columns.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
      let savedId = id;
      if (kind === "save" && id === null) { savedId = Math.max(0,...before)+1; rows.push({id:savedId,...fields,created_at:new Date().toISOString()}); }
      else if (kind === "save") Object.assign(rows.find(row => Number(row.id) === id)!,fields);
      else if (kind === "delete") rows.splice(rows.findIndex(row => Number(row.id) === id),1);
      after.forEach((value,index) => { const row=rows.find(row => Number(row.id) === (value || savedId)); if(row) Object.assign(row,{sort_order:index,updated_at:new Date().toISOString()}); });
      return { id:savedId,sort_order:position,changes:1 };
    }
    const guard = `banner-order:${crypto.randomUUID()}`;
    const statements: D1Statement[] = [
      db.prepare(`INSERT INTO operation_guards(operation_id,valid) SELECT ?,CASE WHEN
        (SELECT COALESCE(group_concat(id,','),'') FROM (SELECT id FROM banners ORDER BY sort_order,id DESC))=? THEN 1 ELSE 0 END`).bind(guard,before.join(",")),
      db.prepare("UPDATE banners SET sort_order=-sort_order-1"),
    ];
    const fields = columns.filter(key => data[key] !== undefined);
    let writeIndex = -1;
    if (kind === "save") {
      writeIndex = statements.length;
      statements.push(id === null
        ? db.prepare(`INSERT INTO banners(${fields.join(",")},sort_order) VALUES(${fields.map(()=>"?").join(",")},?)`).bind(...fields.map(key=>data[key]),position)
        : db.prepare(`UPDATE banners SET ${fields.map(key=>`${key}=?`).concat("updated_at=datetime('now')").join(",")} WHERE id=?`).bind(...fields.map(key=>data[key]),id));
    } else if (kind === "delete") statements.push(db.prepare("DELETE FROM banners WHERE id=?").bind(id));
    const cases = after.map((value,index) => value ? `WHEN ${value} THEN ${index}` : "").filter(Boolean);
    if (cases.length) statements.push(db.prepare(`UPDATE banners SET sort_order=CASE id ${cases.join(" ")} END,updated_at=datetime('now') WHERE sort_order<0`));
    statements.push(db.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guard));
    try {
      const result = await db.batch(statements);
      return { id:id ?? Number(result[writeIndex]?.meta?.last_row_id),sort_order:position,changes:1 };
    } catch (error) {
      if (!/operation_guards|CHECK constraint/i.test(String(error))) throw error;
      if (expected) throw conflict();
    }
  }
  throw conflict();
}
// Content writes preserve position; only reorderBanners can move existing rows.
export const saveBanner = (data: Fields, id: number | null) => mutate("save",data,id);
export const deleteBanner = (id: number) => mutate("delete",{},id);
export const reorderBanners = (ids: number[], expected: number[]) => mutate("reorder",{},null,ids,expected);
