# Tindak lanjut audit menyeluruh 2026-11-21

Keputusan owner 21 November 2026: hal-hal di bawah sengaja DITUNDA (bukan dilupakan).
Tidak ada nilai rahasia di file ini (repo publik); detail operasional ada di `.ops-private.md` lokal.

## Refactor (ditunda sampai batch audit stabil 1–2 hari di produksi)
Prioritas berdasarkan sering berubah × rumit. Satu modul per commit, dengan test.
1. `src/lib/warung-rebahan/sync.ts` (±1.900 baris) — pecah per tahap sync.
2. `src/app/api/cron/operations/route.ts` (±1.500 baris) — pecah per job.
3. State machine WR vs SK (`warung-rebahan/{order,deliver}.ts`, `sekalipay/{order,sync}.ts`) — logika klaim/lease/retry yang terduplikasi.
4. Empat supplier kecil (AIVault/StoreBat/Mirai/TUNVN) menyalin claim-CAS + fragmen SQL lunas — satukan helper bersama.
5. `src/components/admin/SupplierAdminPanel.tsx` (±1.150 baris) — pecah per supplier.
Kandidat lebih rendah: `product-detail-client.tsx`, `CopyEditorSheet.tsx`, `telegram/keyboards.ts`.

## Jaring pengaman refactor (21 Nov 2026 malam)
Characterization test sudah ada sebelum refactor #3/#4 (tanpa perubahan `src/`):
- `tests/characterization/small-suppliers-claim.test.ts` — 80 test, satu suite kontrak untuk 4 supplier kecil; peta: `issue/2026-11-21-small-suppliers-claim-map.md`.
- `tests/characterization/wr-sk-state-machine.test.ts` — 22 test + 7 `it.todo("BUG? …")`; tabel transisi WR/SK + perbedaan yang boleh/tidak boleh disatukan: `issue/2026-11-21-wr-sk-state-machine-map.md`.
- Verifikasi silang (Sol + Wonder independen, 21 Nov malam) → FX-20 diperbaiki: (1) WR `WrNetworkError` yang mungkin terkirim kini ambigu berdasarkan tipe (flag `preSend` untuk guard URL pra-kirim); (2) stale sweep WR mensyaratkan tanpa invoice (pengaman; state tidak terjangkau); (3)+(7) admin Retry WR/SK mensyaratkan order lunas + pembelian supplier aktif saat baca dan CAS; (5) SK menghapus lease saat status maju; (6) receipt SK yang kalah CAS dihitung `retried`.
- DITUNDA (H4): kehabisan percobaan WR masih menandai mixed cart gagal + mengabari pembeli walau item lain antre — perbaikan per item + agregat butuh 3–4 statement D1 tambahan di percobaan terakhir di luar admission `canSpend(6)`; selesaikan di refactor #3 dengan budget yang dicadangkan (`it.todo` di `wr-sk-state-machine.test.ts`).
- Belum dikerjakan (catatan Wonder): R1 sweep klaim basi WR/SK tanpa syarat order lunas/aktif (hanya mutasi riwayat); R2 receipt SK tanpa guard kepemilikan invoice lintas-link (keterjangkauan rendah).

## Ditunda (kecil/sedang)
- Backoff di proxy VPS untuk respons 409 supplier-sync (supplier nonaktif) — repo `axvara-wr-proxy`, hanya membuang request; prioritas rendah.
- Log DLQ permanen (mcp-worker) — butuh tabel D1 + binding mcp-worker + tampilan admin; dampak kecil karena cron cadangan memulihkan order dari D1.
- Monitor kesegaran backup D1 (run yang terlewat belum terdeteksi; kegagalan sudah dianotasi).

## Tindakan owner
- Setelah deploy: hapus env Pages yang tidak dibaca kode lagi (daftar final dicek ulang sebelum dihapus): WA sales (`WHATSAPP_FULFILLMENT`, `WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT`, `WHATSAPP_CREDENTIAL_DM_ENABLED`, kandidat `WHATSAPP_GROUP_PAYMENT`, `WHATSAPP_PROOF_INTAKE`) dan DANA QRIS (`DANA_QRIS_ENABLED`, `DANA_STATIC_QRIS`, `DANA_WEBHOOK_SECRET`).
- Riwayat git (repo publik): cabut API key KlikQRIS lama yang pernah ter-commit; gambar QR merchant lama ada di riwayat. Rewrite history + force push hanya dengan izin eksplisit owner (salinan clone/fork lama tetap ada).
- Status supplier terbuka untuk order yang sudah ditandai selesai manual: satu link WR `processing` (order 9 Nov) dan satu item Pedia `needs_check` (29 Okt).
