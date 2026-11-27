// Matikan dekorasi custom emoji Telegram secara default di test agar
// assertion payload lama (teks tombol ber-emoji standar) tetap stabil.
// tests/telegram-custom-emoji.test.ts menyalakannya sendiri lewat vi.stubEnv.
process.env.TELEGRAM_CUSTOM_EMOJI ??= "off";
