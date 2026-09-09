// Kelas error jalur uang dipisah agar dapat diimpor baik oleh helper
// pembuatan order maupun helper transisi tanpa saling bergantung pada modul
// besar. PURE MOVE: pesan error TIDAK diubah — konsumen (UI checkout, daftar
// pesanan) mengandalkan teks persis ini.

export class StockReservationError extends Error {
  constructor() {
    super("Stok atau status produk berubah. Muat ulang checkout.");
    this.name = "StockReservationError";
  }
}

export class OrderTransitionError extends Error {
  constructor() {
    super("Status pesanan sudah berubah. Muat ulang daftar pesanan.");
    this.name = "OrderTransitionError";
  }
}
