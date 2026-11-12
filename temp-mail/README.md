# AXVARA Temp Mail

Standalone Cloudflare Worker: public, no-login temporary email on a configurable
domain (`MAIL_DOMAIN`, default/production `isturaiky.page`; the public website
may be served at `mail.axvara.tech` via Worker custom domain — API URLs stay
relative). Plain JS, Workers static
assets, isolated D1 — it never uses the root `axvara-db`.

## How it works
- `fetch`: serves the public UI from `public/` and a JSON API under `/api/`.
  No persistent mailbox row exists: an address is just a normalized string;
  messages are looked up in `temp_mail_messages` by `recipient` with an indexed
  expiry filter. Legacy prototype table `messages` is left untouched, never
  exposed/copied into public inboxes, and excluded from cleanup.
- `email`: validates the exact envelope recipient against `MAIL_DOMAIN`,
  rejects raw mail over 1 MiB, parses real MIME with `postal-mime`
  (base64 / quoted-printable / multipart / Unicode subjects), stores text only.
  HTML-only mail is converted to readable text server-side (links kept as text).
  Attachments are ignored — never stored, never downloadable. Failure
  semantics: invalid recipients and oversize mail get `setReject` (a permanent
  refusal — the sender is told delivery failed; it is NOT a retry request).
  Storage/parse failures instead throw, so the runtime marks delivery failed
  and nothing is silently acknowledged as stored.
- `scheduled` (hourly cron): deletes up to 500 expired rows per run; ingestion
  also performs a bounded cleanup. Reads exclude expired rows immediately.
  Messages live 24 hours;
  the address itself remains reusable forever.

Limits: 100 messages per mailbox (oldest dropped), 50 shown per list,
100k chars per body, 60 API requests/minute/IP via the native Workers
rate-limit binding (isolated namespace). A missing/failing native limiter returns
503; unit tests explicitly inject a local checker, not a production fallback.

There is deliberately no send/reply/forward, no delete API (any visitor could
erase a public inbox), and no inbox-enumeration API.

## Commands (run inside `temp-mail/`)
```bash
npm ci
npm run d1:migrate:local
npx wrangler dev --config wrangler.jsonc            # local dev
npx wrangler deploy --dry-run --config wrangler.jsonc # bundle check, no cloud mutation
```
Focused tests from repo root: `npx vitest run tests/temp-mail-worker.test.ts tests/temp-mail-api.test.ts tests/temp-mail-ui.behavior.test.ts --maxWorkers=2`

## Publication and receiving setup
1. Publish only through the repository's `.github/workflows/ci.yml` push-main
   pipeline. It installs this package before root tests, audits its runtime,
   preflights receiving DNS/private rules, applies this module's migrations to
   isolated D1 `axvara-temp-mail` (`a507b69c-7493-4e76-9d63-68a38d9202de`),
   and deploys the Worker with the locked local Wrangler version. Never point
   this Worker at `axvara-db`; do not deploy manually outside owner-approved recovery.
2. The custom web domain `mail.axvara.tech` is declared in `wrangler.jsonc`.
   Read-only preflight found no conflicting A/AAAA/CNAME record on12November2026;
   a later conflict must be investigated, never forcibly overwritten.
3. **Email routing:** receive domain is the apex `isturaiky.page`. After Worker
   deployment, `node scripts/ci-temp-mail-routing.cjs --apply` (from repo root)
   checks deployed DB/domain/reserved bindings and only enables its catch-all.
   The same command without `--apply` is read-only. Four existing private
   forwarding rules remain intact; their addresses and role names are denied by
   every public API/ingestion path. New private routes require matching exclusions.
   Per current
   Cloudflare docs, subdomains support *literal* rules only and catch-all is
   apex-only — so no subdomain catch-all is promised anywhere.
4. Never route the `axvara.tech` apex business mail to this Worker; the
   website hostname `mail.axvara.tech` serves HTTP only.

Source: [Cloudflare subdomain configuration](https://developers.cloudflare.com/email-routing/setup/subdomains/).
Implementation/local QA is not proof of deployment or live SMTP receipt.

The initial CI run failed because prototype `messages` already existed with
`inbox`/`text` columns instead of `recipient`/`body_text`. Read-only production
migration metadata confirmed no migration had been applied, so `0001_inbox.sql`
now creates a distinct table and distinct indexes without renaming/deleting old
data. For an existing local dev database that applied the earlier `0001`, execute
the corrected idempotent SQL once (local only):
`npx wrangler d1 execute axvara-temp-mail --local --config wrangler.jsonc --file migrations/0001_inbox.sql`.
Never clear a database or edit migration history to recover this failure.

## Recovery
If intake must stop, disable only the `isturaiky.page` catch-all in Cloudflare
Email Routing. Leave its explicit private rules, MX and D1 intact. Do not enable
a different catch-all target, delete stored mail or run a manual deployment
without explicit recovery authorization. Fixes publish through CI.

## Feature limits
Public inboxes by design (anyone knowing an address can read it), 24h
retention, text-only bodies, no attachments, no sending.
