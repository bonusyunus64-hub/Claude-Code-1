# TrackPitch

TrackPitch is a password-gated, single-tenant bulk email tool for pitching a track to three kinds of contacts:

- **Song Demos** — pitches an unsigned/independent artist's manager on picking up a track, drawn from a bundled roster of artists (`lib/roster.ts`) filtered by genre/audience/etc., plus any manager contacts you add by hand or import via CSV.
- **Radio Stations** — pitches station contacts on airplay.
- **Playlist Curators** — pitches curators on adding the track to a playlist.

All three channels share the same underlying machinery: a template with `{{variables}}` per recipient, a live preview before anything goes out, batched sending through a chosen SMTP account (so a large send doesn't time out a single serverless request), a shared Do Not Contact / unsubscribe list, a daily send cap (plus optional per-account warmup limits), and campaign history that can trigger an automatic follow-up email to non-responders a few days later (via Vercel Cron).

There's no multi-user support and no database beyond Redis-as-a-settings-store — this is built for one person/team running their own outreach, not a multi-tenant SaaS.

## Running it locally

```bash
npm install
cp .env.local.example .env.local   # then fill in the values — see the table below
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll land on a password prompt (`SITE_PASSWORD`) before you can reach `/dashboard`.

Without Upstash Redis configured (`KV_REST_API_URL` / `KV_REST_API_TOKEN`), the app still runs, but everything falls back to browser-only `localStorage`: no cross-device sync, no server-side campaign history, and the daily send cap isn't enforced. It's fine for poking around, but not for real sends.

## Tests

```bash
npm test          # vitest run
npx tsc --noEmit  # typecheck
npx eslint        # lint (a handful of pre-existing warnings, no errors)
```

## Environment variables

Copy `.env.local.example` to `.env.local` and fill these in. Locally these live in `.env.local`; on Vercel they're set in the project's Environment Variables settings (and, for `CRON_SECRET`, they matter in production specifically — see below).

| Variable | Required? | What it does | What breaks without it |
|---|---|---|---|
| `SITE_PASSWORD` | Yes | The single shared password that gates the whole app behind `/api/auth` (`lib/auth.ts`, `proxy.ts`). Also the fallback encryption/HMAC key — see `ACCOUNTS_SECRET` below. | Login always fails; `/api/auth` returns a 500 explaining `SITE_PASSWORD` isn't set. |
| `ACCOUNTS_SECRET` | Recommended | The key used to encrypt saved SMTP account passwords at rest (`lib/accounts.ts`) and to sign unsubscribe-link tokens (`lib/unsubscribe.ts`). If unset, both fall back to `SITE_PASSWORD` so the app works without extra setup — but see the gotcha below. | If *neither* `ACCOUNTS_SECRET` nor `SITE_PASSWORD` is set, saving an email account throws outright, and unsubscribe links are silently omitted from outgoing mail rather than failing the send. |
| `ZOHO_USER` / `ZOHO_PASS` | Fallback | Default SMTP login (`lib/mailSend.ts`) used only when a send has no saved Account selected. | Sends only work once you've added at least one Account (Account settings) with its own SMTP credentials. |
| `NEXT_PUBLIC_BASE_URL` | Optional | Base URL used to build the unsubscribe links in outgoing mail and the "back to TrackPitch" link in test emails. Falls back to the production Vercel URL. (`/api/logout` deliberately doesn't use this — it redirects to whatever origin the request arrived on.) | Locally, outgoing test emails' unsubscribe/back links point at the production domain instead of your dev server. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN`  (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) | Recommended | Upstash Redis connection (`lib/kv.ts`) backing saved accounts, campaign history, the Do Not Contact list, synced settings, and the daily send-quota counters. Vercel's own KV/Upstash integration injects the `KV_REST_API_*` names; the `UPSTASH_REDIS_REST_*` names are read as a fallback for a database connected some other way. | The app falls back to browser-only `localStorage`: no cross-device sync, saved accounts/campaign history/blacklist don't persist server-side, and the daily send cap can't be enforced (`checkCapAllows` no-ops). |
| `CRON_SECRET` | Required for auto follow-ups | Authenticates Vercel Cron's daily call to `/api/cron/auto-followup` (see the `crons` entry in `vercel.json`, `0 14 * * *`) — Vercel signs that request with `Authorization: Bearer $CRON_SECRET`. | The cron route always returns 401, so Automatic Follow-ups (Account settings) never actually sends anything even when switched on. Must be set in the Vercel project's env vars too, not just locally — a value only in `.env.local` doesn't help the deployed cron job. |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Optional | Spotify Web API Client Credentials flow (`lib/spotify.ts`) that resolves an artist's name to their real `open.spotify.com/artist/...` page for the Spotify badge in the recipients preview. | The badge falls back to linking a Spotify *search* for the artist's name instead of their exact page. |

### Gotcha: rotating `ACCOUNTS_SECRET` / `SITE_PASSWORD`

Whichever of the two is actually in effect (`ACCOUNTS_SECRET` if set, otherwise `SITE_PASSWORD`) is used both to encrypt stored SMTP passwords and to sign unsubscribe tokens. Changing it — setting `ACCOUNTS_SECRET` for the first time, rotating it, or changing `SITE_PASSWORD` while `ACCOUNTS_SECRET` was never set — has two consequences at once:

1. Every previously-saved email Account becomes undecryptable; each has to have its password re-entered (`AccountUndecryptableError` in `lib/accounts.ts` surfaces this per-account rather than taking down the whole account list).
2. Every unsubscribe link already mailed out stops verifying (`verifyUnsubscribeToken` in `lib/unsubscribe.ts`), so anyone who unsubscribes using an old email gets a failed link instead of being honored — by design, a stale/forged link should fail closed rather than silently unsubscribe the wrong address.

Treat whichever secret you land on as effectively permanent once you've saved accounts and sent mail.
