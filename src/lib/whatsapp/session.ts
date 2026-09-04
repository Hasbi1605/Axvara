// src/lib/whatsapp/session.ts — WhatsApp session per group member
// Key: provider + conversation_id + member_id

import { queryFirst, execRun, isD1Mode } from "@/lib/db";

const SESSION_TTL_MINUTES = 15;

export type WaSession = {
  id: number;
  provider: string;
  conversation_id: string;
  member_id: string;
  selected_product_id: number | null;
  numbered_variant_map: Record<number, number> | null; // number -> variant_id
  selected_variant_id: number | null;
  variant_message_id: string | null;
  payment_message_id: string | null;
  current_order_id: number | null;
  current_order_code: string | null;
  current_payment_transaction_id: number | null;
  expires_at: string;
};

export async function getSession(provider: string, conversationId: string, memberId: string): Promise<WaSession | null> {
  if (!isD1Mode()) return null;

  const row = await queryFirst(
    `SELECT * FROM whatsapp_sessions WHERE provider=? AND conversation_id=? AND member_id=? AND expires_at > datetime('now')`,
    provider, conversationId, memberId
  );

  if (!row) return null;

  return {
    id: Number(row.id),
    provider: String(row.provider),
    conversation_id: String(row.conversation_id),
    member_id: String(row.member_id),
    selected_product_id: row.selected_product_id ? Number(row.selected_product_id) : null,
    numbered_variant_map: row.numbered_variant_map ? JSON.parse(String(row.numbered_variant_map)) : null,
    selected_variant_id: row.selected_variant_id ? Number(row.selected_variant_id) : null,
    variant_message_id: row.variant_message_id ? String(row.variant_message_id) : null,
    payment_message_id: row.payment_message_id ? String(row.payment_message_id) : null,
    current_order_id: row.current_order_id ? Number(row.current_order_id) : null,
    current_order_code: row.current_order_code ? String(row.current_order_code) : null,
    current_payment_transaction_id: row.current_payment_transaction_id ? Number(row.current_payment_transaction_id) : null,
    expires_at: String(row.expires_at),
  };
}

export async function upsertSession(
  provider: string,
  conversationId: string,
  memberId: string,
  updates: Partial<Pick<WaSession,
    "selected_product_id" | "numbered_variant_map" | "selected_variant_id" |
    "variant_message_id" | "payment_message_id" |
    "current_order_id" | "current_order_code" | "current_payment_transaction_id"
  >>
): Promise<void> {
  if (!isD1Mode()) return;

  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000).toISOString();
  const variantMap = updates.numbered_variant_map ? JSON.stringify(updates.numbered_variant_map) : null;

  const existing = await queryFirst(
    `SELECT id FROM whatsapp_sessions WHERE provider=? AND conversation_id=? AND member_id=?`,
    provider, conversationId, memberId
  );

  if (existing) {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.selected_product_id !== undefined) { sets.push("selected_product_id=?"); params.push(updates.selected_product_id); }
    if (updates.numbered_variant_map !== undefined) { sets.push("numbered_variant_map=?"); params.push(variantMap); }
    if (updates.selected_variant_id !== undefined) { sets.push("selected_variant_id=?"); params.push(updates.selected_variant_id); }
    if (updates.variant_message_id !== undefined) { sets.push("variant_message_id=?"); params.push(updates.variant_message_id); }
    if (updates.payment_message_id !== undefined) { sets.push("payment_message_id=?"); params.push(updates.payment_message_id); }
    if (updates.current_order_id !== undefined) { sets.push("current_order_id=?"); params.push(updates.current_order_id); }
    if (updates.current_order_code !== undefined) { sets.push("current_order_code=?"); params.push(updates.current_order_code); }
    if (updates.current_payment_transaction_id !== undefined) { sets.push("current_payment_transaction_id=?"); params.push(updates.current_payment_transaction_id); }

    sets.push("expires_at=?");
    params.push(expiresAt);
    sets.push("updated_at=datetime('now')");
    params.push(Number(existing.id));

    await execRun(`UPDATE whatsapp_sessions SET ${sets.join(",")} WHERE id=?`, ...params);
  } else {
    await execRun(
      `INSERT INTO whatsapp_sessions (provider, conversation_id, member_id, selected_product_id, numbered_variant_map,
         selected_variant_id, variant_message_id, payment_message_id,
         current_order_id, current_order_code, current_payment_transaction_id, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      provider, conversationId, memberId,
      updates.selected_product_id ?? null,
      variantMap,
      updates.selected_variant_id ?? null,
      updates.variant_message_id ?? null,
      updates.payment_message_id ?? null,
      updates.current_order_id ?? null,
      updates.current_order_code ?? null,
      updates.current_payment_transaction_id ?? null,
      expiresAt
    );
  }
}

export async function clearSession(provider: string, conversationId: string, memberId: string): Promise<void> {
  if (!isD1Mode()) return;
  await execRun(
    `DELETE FROM whatsapp_sessions WHERE provider=? AND conversation_id=? AND member_id=?`,
    provider, conversationId, memberId
  );
}
