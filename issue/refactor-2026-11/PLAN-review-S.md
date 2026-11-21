> Review independen atas draf `issue/2026-11-21-refactor-roadmap.md` (21 Nov 2026). Koreksinya sudah dimasukkan ke versi yang di-commit; baris yang dirujuk adalah baris draf.

# PLAN-REVIEW-S — Jalur uang AXVARA

**Verdict: OK-with-changes.** Urutan besar T → E → B dan pemisahan mekanika SQL dari protokol pemulihan sudah tepat. Selesaikan blocker di bawah sebelum membuka paket Phase 2 yang terdampak; H4 tetap ditunda sampai D1 disetujui. Basis source `main@ad711d6f`; referensi roadmap adalah draft `issue/2026-11-21-refactor-roadmap.md`. MAP-1–4 ditinjau; MAP-4 tidak menjadi prasyarat Phase 2.

## Blocking

### 1. §3.1–2 — Larang pembelian baru dan replay buta, bukan semua POST kedua

Larangan literal bertentangan dengan pengecualian yang sudah berjalan; melaksanakannya akan mematikan sebagian recovery. Sebaliknya, frasa “rekonsiliasi saja” tanpa syarat tidak mencegah retry generik. Bukti: `docs/agent-rules/supplier-wr-sk.md:288–309,312–321,334–336`; `src/lib/warung-rebahan/order.ts:770–881`; `src/lib/aivault/orders.ts:145–182`; `src/lib/mirai/orders.ts:428–459,560–607`; `src/lib/storebat/orders.ts:123–145,185–193,221–233`; MAP-2 §§4–6 dan MAP-3 §1.

**Ganti §3.1–2:**

> 1. Setelah pembelian mungkin terkirim, jangan reset bukti kirim untuk membeli lagi, membuat identitas pembelian baru, atau melakukan replay buta. Pertahankan bukti kirim dan gunakan hanya pemulihan supplier yang sudah disetujui, dengan identitas/payload, guard, batas waktu dan batas percobaan yang berlaku: AIVault replay dengan `external_order_id` yang sama; Mirai replay key/body yang sama hanya setelah lookup GET 404 yang memenuhi syarat; StoreBat replay key/body yang sama hanya setelah match eksak `failed_no_charge` tanpa order dan masih dalam batas attempt (404 tidak cukup); TUNVN tidak auto-replay. `WrNetworkError` selain `preSend` tetap ambigu; pertahankan batas bukti penolakan definitif FX-20.
> 2. Premium WR tanpa invoice hanya boleh diikat lewat pilihan admin atas invoice eksak dengan guard ownership/binding; bila invoice sudah ada, rekonsiliasi read-only berdasarkan ID tersebut. Jaspay tanpa invoice hanya boleh replay ref dan payload identik sesuai lease/jendela recovery; bila invoice sudah ada, GET status invoice eksak. SK tanpa invoice recover dengan GET ref stabil, bukan POST ulang; 404/timeout tidak membuka fence. Poll invoice SK yang sudah terikat tetap read-only. Jangan satukan mekanisme pemulihan tersebut atau menambah fallback antar-supplier.

### 2. §6/2C dan D1 — H4 belum punya kontrak penyelesaian yang aman saat gagal sebagian

Floor 24 baru estimasi jalur final, bukan bound runtime; `canSpend` tidak mengunci slot. Kedua handler WR saat ini punya penulisan order langsung; `refreshOrderAggregate` menelan error UPDATE, lalu bisa memanggil notice. Memanggil helper lama dan menghapus marker berdasarkan return dapat kehilangan penyelesaian atau mengirim notice prematur. Dua TODO per keluarga bukan bukti crash recovery. Bukti: `src/lib/db-access.ts:50–86`; `src/lib/warung-rebahan/order.ts:398,930–956,1014–1043`; `src/lib/warung-rebahan/deliver.ts:933–979`; MAP-3 §§3–6; `FX-20-evidence.md` (H4 deferred).

**Ganti paket 2C dan perjelas D1 (penyesuaian scope 1/5):**

> D1 menyetujui floor final WR yang dibuktikan dengan pengukuran dan desain intent/replay/rollback; 24 adalah hipotesis, bukan konstanta yang sudah disetujui. Hitung prefix fresh/inline, stock/non-stock dan tail notifikasi/replay; admit sebelum klaim/fence/HTTP, tanpa menaikkan budget global atau mengubah admission SK/non-final WR. Pertahankan urutan dan uji head-of-line deferral serta progres tick berikutnya. `canSpend` bukan reservasi atau jaminan crash safety; apabila meter dipakai paralel, buktikan reservasi nyata atau serialkan.
>
> C1 (bila marker disetujui) hanya migrasi aditif: kode lama kompatibel dengan skema baru, belum ada penulis marker. C2 menyimpan bukti settlement-needed atomik bersama CAS kegagalan definitif terakhir, kemudian settle item terikat dengan CAS paid/enabled, binding dua arah, dan proteksi delivered/sending/manual. Protected, conflict, atau CAS kalah bukan unbound. Fallback order lama hanya bila benar-benar tidak terikat dan dicek ulang di write; jangan memindai kegagalan historis. Replay berdasarkan bukti tahan crash, dibatasi dan tanpa POST, melalui tick WR yang sudah ada di luar seleksi due-purchase.
>
> Reuse algoritme aggregate dengan hasil strict untuk H4: bedakan SQL gagal, CAS kalah, state sah, dan sibling masih aktif. Jangan ACK atau kirim notice berdasarkan UPDATE yang ditelan; recheck state/sibling pada write, pertahankan pekerjaan aggregate sampai sibling terakhir selesai, dan cegah Retry menyalip settlement item. D1 harus memilih kebijakan Retry saat hanya aggregate yang masih pending. Gunakan ledger notifikasi yang ada; pada replay valid maksimal satu pengiriman sukses dalam fixture, bukan janji exactly-once ketika provider timeout. Uji crash setelah link/item/aggregate, threshold floor−1/floor, tail dan next tick, single item, mixed hingga sibling terakhir, true-unbound vs protected/conflict, race paid/binding, notice dedupe dan no-POST. Bukti kompatibilitas C1/C2 dan prosedur rollback yang tidak meninggalkan marker tanpa reader wajib sebelum aktivasi.

### 3. §6/2B–2C/3A/3C — Tutup penulis yang terlewat dan beri kepemilikan file eksplisit

R1 sudah benar “unsent saja” tetapi harus tetap eksklusif ke UPDATE bulk; SK memindai sent/ref terpisah. B4b bisa dibaca hanya mencakup helper advance, padahal Premium dan Jaspay menulis completion langsung. B5 menyebut dua assignment, tetapi recovery paid/pending menulis invoice lagi setelah binder. Terakhir, “2C setelah B2” menyimpang dari MAP-3 §6 tanpa keputusan §11; klaim area terpisah salah bila H4 replay memakai kedua tick WR yang akan dipindah 3A/3C. Bukti: `src/lib/warung-rebahan/order.ts:1554–1569`; `src/lib/sekalipay/order.ts:98–119,481–490,511–539,858–894`; `src/lib/warung-rebahan/deliver.ts:71–152,573–607,697–714`; `src/app/api/cron/lite/route.ts:510–539`; `src/app/api/cron/operations/route.ts:962–996`; MAP-3 §§2,4,6–7.

**Ganti butir B3b/B4b/B5 dan paragraf urutan (penyesuaian scope 2–3/5):**

> B3b (R1): `EXISTS` lunas/paid/enabled hanya pada UPDATE bulk requeue klaim kedaluwarsa tanpa sent marker dan tanpa invoice, bukan pada jalur read-only sent/ref; pertahankan refund attempt dan guard invoice tiap supplier. B4b: kosongkan lease hanya ketika advance WR otoritatif menang, termasuk CAS completion baru Premium dan Jaspay; replay, refresh akun same-state, dan CAS kalah tidak melepas lease atau mengubah fence/attempt. B5 (R2): guard ownership lintas-link atomik pada receipt `processOneSkLink` dan `bindSkInvoiceByRef`; UPDATE processing `reconcileAmbiguousSkLink` harus mensyaratkan invoice sudah terikat, bukan menulis ulang. Konflik bukan sukses/retry beli, fence tetap; jangan menambah unique-index atau rewrite riwayat dalam langkah ini.
>
> Urutan default: B1 → B2 → B3 → B3b → B4 → B4b → B5 → 2C (C1 jika perlu, lalu C2), dengan release gate §4.6 dan satu B uang per rilis. 2C menunggu D1; bila ditunda, jangan blokir split katalog yang independen. Tetapkan satu pemilik kode tick WR di lite dan operations, termasuk file job hasil split: serialkan paket WR di 3A/3C dengan 2C, atau selesaikan split terkait dahulu lalu rebase dan verifikasi C2 pada lokasi baru. 3A job lain/3B boleh paralel hanya jika file, fixture dan ownership benar-benar tidak beririsan; 2A/2B boleh disiapkan paralel dengan syarat yang sama, tetapi rilis tetap berurutan.

### 4. §6/T1–T3 dan §9 — Kunci baseline per cabang sebelum E, aktifkan bukti penerimaan pada B

T1 saat ini dapat lulus dengan hitungan berhasil dan cap total. MAP-2 §4 memberi angka sukses/retryable dari fixture, bukan semua cabang; MAP-3 §3 adalah ledger sumber, bukan angka pengukuran. `tests/supplier-dispatch.workerd.test.ts` tidak meliputi tiap cabang. T3 tidak mengunci protokol wire lintas keluarga secara eksplisit dan tidak mewajibkan acceptance B4b. TODO bukan acceptance. Bukti: MAP-2 §§4,6; MAP-3 §§5–6; `src/lib/db-access.ts:50–86`; `tests/characterization/wr-sk-state-machine.test.ts:378–395` (fixture parametrik H4, belum menguji fase setelah sibling selesai).

**Ganti definisi T1–T3 / tambah ke DoD (penyesuaian scope 4/5):**

> T1 — Catat baseline statement delta per cabang pada basis tetap dan assert dengan fixture terinstrumentasi serta cross-check jalur kritis di workerd: WR Premium biasa/invite, Jaspay receipt/processing/completion, WR/SK claim fresh/inline/loss, final stock/non-stock, SK proof dengan settlement ketat, recovery terminal dan 404/ref. Catat scope hitungan (scan/tail terpisah), anggota batch dan failed submission, dan assert reserved tail, outcome break/throw serta urutan panggilan. Baseline T1 tidak mengesahkan floor 24; ukur jalur H4 baru pada desain/fixture C2, termasuk cabang notice termahal yang didukung.
>
> T2 — Sebelum A1–A4 pada supplier masing-masing, ukur `create*Links`, dispatch sukses/retryable dan `retry*`; pin one-UPDATE claim tanpa pre-read, batch/guard/cutoff, expiry-vs-owner StoreBat, paid tapi invalid channel, TUNVN `reconcileId`/autopolicy, rate-limit/deadline/limit dan wire recovery supplier yang disentuh. Jalankan regresi Muse Buff yang ada; tambah contract case khusus hanya bila paket nanti menyentuh delivery/null-credential. Tiap A mengunci daftar test supplier + karakterisasi + workerd sebagaimana MAP-2 §4.
>
> T3 — Sebelum B1: admin status/paid/disabled/void/invoice/fence dan race CAS, response, backoff/rank. Sebelum B2: dua runner/owner lama, expiry/due/attempt/invoice drift, veto handover forward dan reverse, H1 dan wire (Premium tanpa invoice tidak POST/auto-bind; Jaspay replay payload/ref identik dengan batas dan guard lease; SK duplicate/404 GET-only dan lost receipt bukan sukses). Sebelum B3: sweep NULL vs empty, refund/last attempt dan sent tetap recoverable. Sebelum B4: terminal/processing advance, replay, loss, webhook menang; pertahankan baseline lease masing-masing. Paket tiap E menautkan fixture/cabang T1–T3 dan nama suite MAP-3 §6, dengan statement/wire parity sebelum dan sesudah. Siapkan kasus berbadan test untuk B3b paid/disabled + sent control, B4b completion/advance menang serta replay/loss, B5 dua penulis berlomba atas invoice dan fence loser, dan 2C sesuai D1. Aktifkan dan buktikan lulus pada masing-masing B; TODO/skip atau judul bukan bukti DoD.

### 5. §4.6/§9–10 — Bedakan push diterima dari rilis terverifikasi

“Run rilis sebelumnya” belum menentukan SHA, workflow event, status pending/cancelled, atau apakah Pages sukses namun tahap sesudahnya gagal. Dokumentasi saja tidak memicu CI; run baru dapat membatalkan run yang lama. `AGENTS.md:65–73,110–113` melarang menunggu atau memantau setelah push dan membedakan status lokal/publikasi/deployment; `.github/workflows/ci.yml:3–23,106–142` menempatkan migrasi sebelum Pages dan MCP/temp-mail sesudahnya. Jangan menganggap verifikasi Pages sebagai full workflow green; jangan pula menganggap workflow gagal berarti Pages belum berubah.

**Ganti §4.6, gunakan status yang sama di §9–10:**

> Setelah `git push` diterima: catat SHA push/step sebagai dipublikasikan, rilis belum diverifikasi, lalu akhiri sesi tanpa polling atau menunggu. Pada awal sesi langkah uang berikutnya, PM sekali memeriksa bukti untuk SHA rilis kode/skema yang menjadi prasyarat: run `ci.yml` event push `main` untuk SHA itu berstatus success, langkah Pages (dan migrasi bila relevan) sukses, serta bukti health/admin read-only yang relevan bertanggal sejak deployment tidak menunjukkan regresi baru. Catat SHA, run ID/URL dan hasil pemeriksaan. Commit docs-only bukan rilis; gunakan rilis kode/skema terakhir yang relevan. Pending/missing/cancelled, SHA tidak cocok, kegagalan tahap mana pun atau kesehatan belum terbukti → gate tertahan; eskalasi ke PM/owner, jangan polling, deploy manual, atau lanjut. Jika Pages sudah sukses tetapi tahap kemudian gagal, perlakukan sebagai rilis parsial saat triase. Rilis pengganti hanya dihitung bila disetujui PM/owner dan terbukti mencakup perubahan prasyarat yang sama.

## Should-fix

### 6. §3.3–5 — Bekukan batas purchase owner, eligibility admin, dan arti parity budget

Owner lease pembelian yang kedaluwarsa bukan alasan menolak bukti receipt/webhook otoritatif; namun owner lama tidak boleh memakai bukti itu untuk mengambil alih dispatch. Predicate Admin Retry saat ini tidak cuma `lunas` dan “belum kirim”; ada payment status, bukti invoice, SK void, dua CAS WR, serta response code/ordering. Budget E perlu membekukan titik admission dan tail, bukan hanya nominal cap. Bukti: `docs/agent-rules/supplier-wr-sk.md:9–11,288–309,317–321`; `src/lib/warung-rebahan/order.ts:543–555,607–625`; `src/lib/sekalipay/order.ts:460–493`; `src/app/api/admin/warung/orders/[id]/retry/route.ts:29–52,82–115`; `src/app/api/admin/sekalipay/orders/[id]/retry/route.ts:27–65`; MAP-1 Global §4; MAP-2 §4; MAP-3 §§1–3.

**Ganti §3.3–5:**

> 3. Untuk dispatch, hanya pemilik lease yang masih berlaku dapat memenangkan CAS fence sebelum POST, dengan recheck eligibility/handover di write. Owner basi/kalah tidak mengirim, tidak reset fence dan tidak melepas lease pihak lain. Receipt/terminal otoritatif yang datang terlambat masih boleh melalui CAS identitas/status supplier (tidak wajib lease pembelian hidup); replay atau CAS kalah tidak membatalkan lease aktif. Lease recovery Jaspay tetap terpisah.
> 4. Admin Retry WR/SK hanya untuk state yang diizinkan dengan `orders.status='lunas'`, `payment_status='paid'`, `supplier_purchase_disabled=0`, tanpa `request_sent_at` DAN tanpa invoice/provider order ID. Ulangi guard di CAS, termasuk state/attempt dan aturan void SK. Pertahankan cek enablement yang ada, semantik NULL/empty, response/check order tiap route, dan pemisahan reset failed vs retry biasa. Reconcile bukan jalur re-arm.
> 5. E membekukan jumlah statement per cabang, komposisi batch (N anggota = N statement), titik/ambang admission, reserved tail, ceiling, urutan kerja dan perilaku deferral/throw; helper tidak menambah round-trip. Perubahan budget hanya di B yang secara eksplisit disetujui (mis. floor final WR 2C), tanpa perubahan budget global terselubung.

### 7. §5/§6/2A — Hilangkan celah “Tier-2 opsional” dalam paket Tier-1

“Satu-satunya perbedaan nyata” mengecilkan perbedaan status set, attempt, receipt, gates dan kebijakan recovery; “opsional, bila identik” memberi writer izin menambah abstraksi tanpa paket. MAP-2 §§1–2,4–6 membatasi rollout awal pada paid + satu claim CAS; contoh StoreBat expiry guard dan TUNVN fallback/rate-limit tetap lokal. Jangan memakai helper Tier-1 empat supplier sebagai framework untuk WR/SK.

**Ganti kalimat §5/2A yang terdampak (penyesuaian scope 5/5):**

> Keempat supplier kecil menduplikasi inti paid-gating/claim, bukan kebijakan lengkap. Tier-1 A1–A4 hanya mengganti predikat paid di tempat dan satu UPDATE claim, dengan konfigurasi tertutup dan perbedaan TUNVN tetap eksplisit. Settle, owner guard, retry/backoff, transport/recovery, receipt, delivery, dan Tier-2 di luar 2A. Tier-2 hanya boleh diajukan sebagai paket terpisah, bukan dikerjakan ketika review Tier-1.

### 8. §4.5/§9 — Acuan dokumentasi dan verifikasi sesuai dampak jangan berhenti di changelog

DoD mencontohkan ARCHITECTURE dan rules tetapi tidak eksplisit mewajibkan PRD untuk perubahan flow/kontrak atau build yang relevan untuk migrasi/routing/toolchain. Batas dua ronde juga bukan izin merilis blocker. Bukti: `AGENTS.md:76–112,130–139`; MAP-1 Global §§1–4; `docs/agent-rules/admin-security.md` dan `buyer-credentials.md` tetap mengikat paket yang menyentuh admin/checkout.

**Tambah di §4.5/§9:**

> Terapkan tabel dampak dan dokumentasi `AGENTS.md`: full suite/tsc pada tree final untuk kode, workerd untuk D1/Workers, build target bila dampak mensyaratkan, browser nyata bila interaksi berubah. Gunakan bukti sukses yang masih identik inputnya; docs-only cukup pemeriksaan dokumentasi. Perbarui PRD bila flow/requirement berubah, ARCHITECTURE bila struktur/skema/route/cron berubah, aturan area bila kontrak berubah, dan CHANGELOG sesuai aturan; jangan menandai live dari bukti lokal/push. Jika blocker tersisa setelah dua ronde, tahan rilis dan eskalasi.

## Nit

- §5 dan §10: beri kode **B4b** pada cleanup lease WR agar tidak tampak sudah selesai bersama cleanup SK di FX-20; tulis `B4b (lease cleanup WR, belum)` di daftar perubahan terbuka. Bukti: roadmap §6/2B dan MAP-3 §6 langkah 4b.
- §9: ganti `baseline T1/T4` dengan `baseline T relevan pada paket (contoh: T1+T2 untuk A; T1+T3 untuk B kelas E; T4 untuk cron)` agar pembaca tidak memakai golden cron untuk membuktikan paritas supplier.

**Batas bukti:** review sumber dan dokumen saja. Tidak menjalankan test, mengakses produksi, mengedit repo, commit atau push. Lima penyesuaian scope ditandai di atas; sisanya klarifikasi kontrak/protokol.
