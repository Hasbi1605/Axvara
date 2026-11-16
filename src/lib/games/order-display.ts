/** Shared SQL label; gp = Games product, gm = optional admin game metadata. */
export const GAMES_ORDER_LABEL_SQL = `COALESCE(NULLIF(gm.display_name,''),NULLIF(gp.sk_product_name,''),NULLIF(gp.game_brand,''),'Game')
  || ' — ' || COALESCE(NULLIF(gp.product_name,''),'Produk Games')`;
