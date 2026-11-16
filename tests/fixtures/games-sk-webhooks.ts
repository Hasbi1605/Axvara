// Recorded supplier payload, not a production API call.
export const gamesSkPaidWebhook = {"event":"order.paid","timestamp":"2026-11-16T20:17:49+07:00","data":{"invoice":"SPY1794835064NFVO","ref_id":"AXG202611164206447D","status":"processed","price":14825,"fees":0,"amount":14825,"payment_code":"saldo","created_at":"2026-11-16T20:17:44+07:00","updated_at":"2026-11-16T20:17:44+07:00","items":[{"variant_id":10691,"variant_name":"Mobilelegend - 50 Diamond","product_id":33,"product_name":"Mobile Legends","seller_note":null,"order_process":"h2h","quantity":1,"price":14825,"subtotal":14825,"status":"sent","h2h_results":{"sn":null,"dispatch_status":null,"dispatch_message":"Transaksi Sukses","ref_id":null,"total_units":1,"delivered_units":0,"failed_units":0,"units":[{"unit":1,"dispatch_status":"pending","sn":null,"ref_id":"SPY1794835064NFVO9L2W8","dispatch_message":"Transaksi Pending"}]},"target":"161586434|5030"}]}};

export const gamesSkCompletedWebhook = {
  ...gamesSkPaidWebhook, event: "order.completed",
  data: {
    ...gamesSkPaidWebhook.data, status: "completed",
    items: [{
      ...gamesSkPaidWebhook.data.items[0], status: "completed",
      h2h_results: {"sn":"MLBB1611263232621","dispatch_status":"completed","dispatch_message":"Transaksi Sukses","ref_id":null,"total_units":1,"delivered_units":1,"failed_units":0,"units":[{"unit":1,"dispatch_status":"completed","sn":"MLBB1611263232621","ref_id":"SPY1794835064NFVO9L2W8","dispatch_message":"Transaksi Sukses"}]},
    }],
  },
};
