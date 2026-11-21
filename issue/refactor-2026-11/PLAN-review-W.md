> Review independen atas draf `issue/2026-11-21-refactor-roadmap.md` (21 Nov 2026). Koreksinya sudah dimasukkan ke versi yang di-commit; baris yang dirujuk adalah baris draf.

# PLAN-REVIEW-W — architecture / feature-foundations / identity review of issue/2026-11-21-refactor-roadmap.md

Reviewer W (read-only). Spot-verified against source @ad711d6f: orders INSERT sites, `agent-auth.ts`, schema CHECKs, cron `LITE_JOBS`, MAP-3 §4 (floor 24 confirmed, MAP-3-wr-sk.md:63-67), MAP-1(d) (40 test importers of orders route confirmed, MAP-1-hotspots.md:431,464). No factual errors found in the roadmap's §5 summary or §3.10 (39-40 test files import the route). Findings ordered blocking → should-fix → nit.

## BLOCKING

**B-1. Affiliate attribution has no foundation step, and F1's signature cannot carry it.**
§8 item 4 promises affiliate with "atribusi di `placeOrder`", but F1 (roadmap:218) fixes the signature as `placeOrder(actor, lines, paymentInstruction)` and no F-step adds an attribution field to `orders` (schema.sql:67-140 has no affiliate/referral column; MAP-4 §7 item 4-5 keys attribution off member + order). Built as written, affiliate arrives after F1 freezes the signature and must reopen F1 + add retroactive schema — exactly the drift the roadmap exists to prevent.
Replacement for F1 row, Prasyarat/Isi cell: "`placeOrder(actor, lines, paymentInstruction)` lintas kanal; `actor` wajib memuat konteks atribusi opsional (`memberId?`, `affiliateMemberId?`) yang ditulis ke kolom aditif `orders.member_id`/`orders.affiliate_member_id` (F4); web route + `commerce.ts` (Telegram) jadi adapter tipis…"

**B-2. F3's proof obligation proves the wrong (one-shot) subset.**
F3 (roadmap:220) is "dibuktikan dengan memigrasi satu supplier kecil yang sudah lewat 2A" — but every small supplier is one-shot purchase→credentials; none exercises `awaiting_event`, intermediate artifacts, `cancel()` or refund hooks. As written, an agent can declare contract v2 "proven" without the multi-step paths virtual number depends on ever running, and the first real test becomes the paid feature build.
Replacement for F3 Isi cell, append: "…plus satu supplier fixture multi-langkah (bukan produksi) yang membuktikan `awaiting_event → event → completed` dan `cancel() → refund ke agregat` di test; migrasi supplier kecil saja tidak cukup sebagai bukti kontrak."

## SHOULD-FIX

**S-1. F1 prerequisite "characterization web+TG" has no owning Phase-1 step.** Fase 1 table (roadmap:147-154) contains T5 for `orders/route.ts` only; no T-step covers Telegram order creation in `src/lib/commerce.ts` (handlers invoice.ts:297, payment-dispatch.ts:175, cart-invoice.ts:115). F1 will either stall or start on an assumed baseline.
Fix: add row "| T7 | Characterization pembuatan order Telegram via `commerce.ts` (createChannelOrderAtomic: sukses, idempotent `isExisting`, race stok) | MAP-4 §1 | F1 |" and change F1 Prasyarat to "3B, T5, T7".

**S-2. §3 frozen contracts contain no identity/API-key invariants.** §3 (roadmap:43-76) freezes money, platform and test rules, but the prohibitions that protect Phase 4 identity live only in the F4/F7 table cells. An agent executing F4/F7 against §3 alone could reuse `requireAdmin`, the admin JWT, or buyer PIN proof and not violate any frozen clause.
Add to §3, new subsection "**Identitas & API (berlaku mulai Fase 4)**": "13. Auth aktor baru (member, reseller, API key) tidak boleh memakai JWT admin/`requireAdmin`, Cloudflare Access admin, atau PIN/proof pembeli; secret dan cakupan cookie terpisah per aktor. 14. API key hanya disimpan sebagai hash (bentuk `agent-auth.ts`), scoped, dan setiap pembuatan order API wajib idempotency key dari pemanggil — retry dengan key sama tidak membuat order kedua. 15. `orders.member_id` bersifat aditif nullable; checkout tamu dan jalur web/TG lama tidak berubah oleh F4/F5."

**S-3. Reseller-API idempotency is missing from F1/F7 scope.** Web dedupes via `orders_quote_id_unique` and Telegram via `idempotencyKey` (commerce.ts:35,68), but neither F6 nor F7 mentions a caller-supplied idempotency contract; for a paid public API this is a double-charge foundation, not a feature detail. Covered by proposed §3.14 above; also append to F7 Isi: "…+ kontrak `Idempotency-Key` per pembuatan order (unik per API key)."

**S-4. Quote-token compatibility is not frozen for F1/F2.** §3.10 freezes route exports, but `CheckoutQuotePayload` tokens are signed and verified across deploys (`src/lib/auth.ts:626,648`); F2 changes price resolution under live tokens. Add §3 item: "16. Payload token quote bertanda tangan yang sudah terbit harus tetap terverifikasi sampai kedaluwarsa alaminya; perubahan F1/F2 tidak mengubah bentuk payload tanpa masa transisi baca-ganda."

**S-5. F6 needs a buyer-contact decision that no D-item covers.** F6 (roadmap:223) includes "kontrak kontak pembeli API (`customer_wa NOT NULL`)" but §11 D3 only asks payment mode. Whether API orders require WA, email-only, or reseller-supplied contact is a product decision that changes the migration.
Add §11 row: "| D9 | Kontak pembeli via API: wajib WA, cukup email, atau kontak reseller? | F6 |" and add D9 to F6's Keputusan cell.

**S-6. Phase 4 parallelism is unstated; F4/F5 are an independent track.** Phase 2/3 state parallelism explicitly (roadmap:191,210) but Fase 4 does not, inviting needless serialisation (F4 has prasyarat "—"). Add after the F-table: "F4–F5 boleh berjalan sebagai jalur independen sejajar F1–F3 (file dan skema tidak beririsan); F6–F7 menunggu F1. Inti ledger F5 (tabel + posting idempoten) tidak diblokir D6/D7 — yang diblokir hanya aturan posting komisi (D6) dan rail deposit (D7)."

## NIT

**N-1.** 2A's closed table whitelist (`src/lib/suppliers/link-lease.ts`, roadmap:162-164) could be misread as the shape F3 must extend. Add to F3 Isi: "Kontrak v2 boleh menggantikan, bukan memperluas, helper link-lease Tier-1 untuk link multi-langkah."
**N-2.** SK retry/WR frozen item §3.4 is accurate; consider mirroring in §3 that H4 (2C) is the only sanctioned exception path to the current WR exhaustion behaviour, so an E-step agent does not "fix" it early. (Acceptable as-is via §10 status.)
**N-3.** §4.6's CI gate is consistent with AGENTS.md (check once at next step start; no post-push monitoring) — no change; noted so the PM does not "fix" a non-conflict.

## AGENTS.md / agent-rules cross-check (packet item 6)
No conflicts found: §4.5 PM full-suite + tsc before commit/push matches AGENTS.md Aturan Test; writer-doesn't-commit matches orchestration policy; DoD docs+CHANGELOG matches Aturan Dokumentasi; §3.5's budget freeze is scoped to extraction steps, so 2C's class-B floor (decision D1) does not contradict it; §2's no-new-cron rule aligns with platform-ops.
