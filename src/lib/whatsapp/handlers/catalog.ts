// Handler discovery/katalog WhatsApp: daftar produk, pencarian nama, pemilihan varian.
//
// MENGAPA dipisah: ketiga handler ini murni jalur penelusuran katalog (bukan jalur
// uang) dan hanya menyentuh session + katalog. Mengelompokkannya memisahkan
// tanggung jawab "discovery" dari "payment/proof/admin", memudahkan pembacaan tanpa
// mengubah SQL, urutan statement, atau teks pesan. PURE MOVE dari route.ts.

import {
  listActiveProducts,
  getProductDetail,
  searchProductByName,
  getActiveVariant,
} from "@/lib/catalog";
import { getSession, upsertSession } from "@/lib/whatsapp/session";
import * as msg from "@/lib/whatsapp/messages";
import { sendTextMessage } from "./shared";

export async function handleList(groupId: string, _page: number, inboxId: string) {
  const products = await listActiveProducts();

  await sendTextMessage({
    target: groupId,
    message: msg.listProductsMessage(products),
    inboxId,
  });
}

export async function handleProductSearch(groupId: string, memberId: string, input: string, inboxId: string) {
  const { exact, candidates } = await searchProductByName(input);

  if (!exact && candidates.length === 0) {
    if (input.split(/\s+/).length > 3) return; // Skip long sentences
    await sendTextMessage({ target: groupId, message: msg.notFoundMessage(), inboxId });
    return;
  }

  if (!exact && candidates.length > 1) {
    await sendTextMessage({
      target: groupId,
      message: msg.ambiguousMessage(candidates.map((c) => c.name)),
      inboxId,
    });
    return;
  }

  const product = exact || candidates[0];
  const detail = await getProductDetail(product.id);
  if (!detail || detail.variants.length === 0) {
    await sendTextMessage({ target: groupId, message: msg.notFoundMessage(), inboxId });
    return;
  }

  const variantMap: Record<number, number> = {};
  detail.variants.forEach((v, i) => {
    variantMap[i + 1] = v.id;
  });

  await upsertSession("baileys", groupId, memberId, {
    selected_product_id: detail.id,
    numbered_variant_map: variantMap,
    selected_variant_id: null,
    current_order_id: null,
    current_order_code: null,
  });

  const result = await sendTextMessage({
    target: groupId,
    message: msg.productDetailMessage(msg.getWhatsAppDisplayName(detail), detail.description, detail.variants),
    inboxId,
  });

  if (result.messageId) {
    await upsertSession("baileys", groupId, memberId, {
      variant_message_id: result.messageId,
    });
  }
}

export async function handleNumberSelection(groupId: string, memberId: string, num: number, inboxId: string) {
  const session = await getSession("baileys", groupId, memberId);
  if (!session || !session.numbered_variant_map) {
    return; // Ignore number if no active session
  }

  const variantId = session.numbered_variant_map[num];
  if (!variantId) {
    await sendTextMessage({ target: groupId, message: msg.sessionExpiredMessage(), inboxId });
    return;
  }

  const variant = await getActiveVariant(variantId);
  if (!variant) {
    await sendTextMessage({ target: groupId, message: msg.variantUnavailableMessage(), inboxId });
    return;
  }

  if (variant.stock === 0) {
    await sendTextMessage({ target: groupId, message: `Varian ini sedang habis. Pilih varian lain.`, inboxId });
    return;
  }

  const detail = await getProductDetail(session.selected_product_id!);
  const productName = detail ? msg.getWhatsAppDisplayName(detail) : "PRODUK";

  await upsertSession("baileys", groupId, memberId, {
    selected_variant_id: variantId,
    ...(session.selected_variant_id !== variantId
      ? {
          current_order_id: null,
          current_order_code: null,
          current_payment_transaction_id: null,
          payment_message_id: null,
        }
      : {}),
  });

  const result = await sendTextMessage({
    target: groupId,
    message: msg.variantSelectedMessage(productName, variant),
    inboxId,
  });

  if (result.messageId) {
    await upsertSession("baileys", groupId, memberId, {
      variant_message_id: result.messageId,
    });
  }
}
