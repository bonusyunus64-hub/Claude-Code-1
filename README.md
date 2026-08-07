# TrackPitch

TrackPitch is a password-gated, single-tenant bulk email tool for pitching a track to two kinds of contacts:

- **Song Demos** — pitches an unsigned/independent artist's manager on picking up a track, drawn from a bundled roster of artists (`lib/roster.ts`) filtered by genre/audience/etc., plus any manager contacts you add by hand or import via CSV.
- **Radio Stations** — pitches station contacts on airplay.

Both channels share the same underlying machinery: a template with `{{variables}}` per recipient, a live preview before anything goes out, batched sending through a chosen SMTP account with a pooled, single connection reused across a batch (so a large send doesn't time out a single serverless request, and doesn't pay for a fresh TCP/TLS/AUTH handshake per message either), a shared Do Not Contact suppression list, a daily send cap (plus optional per-account warmup limits), an optional Send Window that queues a send started outside chosen hours instead of firing it right away (`lib/sendWindow.ts`, backstopped by a daily cron — see "The Send Window backstop" below), and campaign history that can trigger an automatic follow-up email to non-responders a few days later (via Vercel Cron).

There's no multi-user support and no database beyond Redis-as-a-settings-store — this is built for one person/team running their own outreach, not a multi-tenant SaaS.

## Running it locally

```bash
npm install
cp .env.local.example .env.local   # then fill in the values — see the table below
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll land on a password prompt (`SITE_PASSWORD`) before you can reach `/dashboard`.

Without Upstash Redis configured (`KV_REST_API_URL` / `KV_REST_API_TOKEN`), the app still runs, but everything falls back to browser-only `localStorage`: no cross-device sync, no server-side campaign history, and the daily send cap isn't enforced. It's fine for poking around, but not for real sends.

## Refreshing the artist roster

The Song Demos channel pitches managers from `data/roster.json`, sourced from ROSTR. It goes stale — follower counts drift, artists change management — so it gets refreshed periodically.

**The whole procedure lives in the header comment of [`scripts/collect-rostr.js`](scripts/collect-rostr.js).** Open that file and follow the numbered steps at the top; it needs no other setup and no AI agent. In short: copy the file, paste it into the browser console on a logged-in `rostr.cc` tab, wait, click Download, then:

```bash
node scripts/merge-roster.mjs ~/Downloads/rostr-raw-collection.json
```

**Always merge, never replace.** A refresh only re-resolves contacts for some artists, so writing new data straight over `roster.json` deletes every contact it didn't happen to find — that would have been 1,745 lost contacts on the August 2026 refresh, with the script reporting success. `merge-roster.mjs` unions instead, and prints `artists lost: 0 / emails lost: 0`. If either number isn't zero, don't commit.

`scripts/import-roster-xlsx.mjs` does the same for manual XLSX exports (accepts several batch files at once), and `scripts/parse-roster.mjs` is the original single-spreadsheet parser.

Before changing anything in this pipeline, read `scripts/ROSTER_CONTEXT.md` and `scripts/ROSTER_CONTEXT_CORRECTIONS.md` — between them they cover ROSTR's terms, the 2,000-record query cap, and several ways this has silently produced wrong data before.

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
| `ACCOUNTS_SECRET` | Recommended | The key used to encrypt saved SMTP account passwords at rest (`lib/accounts.ts`). If unset, falls back to `SITE_PASSWORD` so the app works without extra setup — but see the gotcha below. | If *neither* `ACCOUNTS_SECRET` nor `SITE_PASSWORD` is set, saving an email account throws outright. |
| `ZOHO_USER` / `ZOHO_PASS` | Fallback | Default SMTP login (`lib/mailSend.ts`) used only when a send has no saved Account selected. | Sends only work once you've added at least one Account (Account settings) with its own SMTP credentials. |
| `NEXT_PUBLIC_BASE_URL` | Optional | Base URL used to build the "back to TrackPitch" link in test emails. Falls back to the production Vercel URL. (`/api/logout` deliberately doesn't use this — it redirects to whatever origin the request arrived on.) | Locally, that link in a test email points at the production domain instead of your dev server. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN`  (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) | Recommended | Upstash Redis connection (`lib/kv.ts`) backing saved accounts, campaign history, the Do Not Contact list, synced settings, and the daily send-quota counters. Vercel's own KV/Upstash integration injects the `KV_REST_API_*` names; the `UPSTASH_REDIS_REST_*` names are read as a fallback for a database connected some other way. | The app falls back to browser-only `localStorage`: no cross-device sync, saved accounts/campaign history/Do Not Contact list don't persist server-side, and the daily send cap can't be enforced (`checkCapAllows` no-ops). |
| `CRON_SECRET` | Required for the daily reply refresh and the Send Window backstop | Authenticates Vercel Cron's daily calls to `/api/cron/refresh-replies` and `/api/cron/drain-send-window` (see the `crons` entry in `vercel.json`) — Vercel signs those requests with `Authorization: Bearer $CRON_SECRET`. The secret authorises **only those two cron routes** — it is deliberately not accepted by `proxy.ts` as a substitute for a dashboard session anywhere else. `refresh-replies` only ever reads over IMAP (it never sends mail), and the drain route runs a queued send by calling the send functions directly in-process (`lib/sendDispatch.ts`), so it reuses the same dedupe/cap/blacklist logic without `/api/send` ever becoming reachable by bearer token. That distinction matters: `/api/send` accepts an arbitrary recipient list and an arbitrary message body, so if a leaked `CRON_SECRET` could reach it, that secret alone would be enough to send anything to anyone through your own mailbox. | Both cron routes always return 401. Campaign reply/bounce data (and therefore the dashboard's follow-up reminders) goes stale without the manual "Check replies" action, and a campaign queued by the Send Window only goes out once the dashboard is opened (see `app/dashboard/hooks/useCampaignHistory.ts`'s drain effect) — there's no backstop for whenever it isn't. Must be set in the Vercel project's env vars too, not just locally — a value only in `.env.local` doesn't help the deployed cron jobs. |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Optional | Spotify Web API Client Credentials flow (`lib/spotify.ts`) that resolves an artist's name to their real `open.spotify.com/artist/...` page for the Spotify badge in the recipients preview. | The badge falls back to linking a Spotify *search* for the artist's name instead of their exact page. |
| `ANTHROPIC_API_KEY` | Optional | Claude API key (`lib/replyClassifier.ts`) used to classify replies as interested/pass/unclassified from what they actually say — catches paraphrases like "we'd need to hear the stems first" or "circle back after the album drops" that `classifyReply`'s hand-picked keyword lists in `lib/checkReplies.ts` would otherwise leave `unclassified`. Auto-replies (vacation responders etc.) are always detected from headers/subject alone and never sent to the model, whether or not this is set. Get a key at [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys). | Reply checking (`app/api/check-replies`, the daily `refresh-replies` cron) falls back to the plain keyword classifier for every reply — the same behavior as before this was added, just less accurate on ambiguous or paraphrased replies. A configured key that fails at request time (timeout, rate limit, malformed response) falls back the same way per-reply; it never fails reply checking outright. |

### Gotcha: rotating `ACCOUNTS_SECRET` / `SITE_PASSWORD`

Whichever of the two is actually in effect (`ACCOUNTS_SECRET` if set, otherwise `SITE_PASSWORD`) encrypts stored SMTP passwords. Changing it — setting `ACCOUNTS_SECRET` for the first time, rotating it, or changing `SITE_PASSWORD` while `ACCOUNTS_SECRET` was never set — makes every previously-saved email Account undecryptable; each has to have its password re-entered. `AccountUndecryptableError` in `lib/accounts.ts` surfaces this per-account rather than taking down the whole account list.

Treat whichever secret you land on as effectively permanent once you've saved accounts.

(This used to cut deeper: the same secret also signed the tokens in outgoing unsubscribe links, so rotating it silently broke every unsubscribe link already mailed out. Those links are gone — see below — so a rotation is now recoverable by re-entering a few passwords, rather than something with a permanent outward-facing consequence.)

### Cross-device sync and the Do Not Contact list

Most Account/template/preset settings sync through a small server-side key-value blob (`lib/remoteSync.ts`, `/api/state`) that mirrors `localStorage`: on load, whichever device has a value for a given key wins; a key with no server value gets pushed up from whichever device has it locally. Deleting a value (e.g. removing the saved signature image) writes a short-lived tombstone server-side instead of just clearing the key, so a second device that still has the old value locally doesn't mistake "nothing on the server" for "never synced" and push the deleted value back — tombstones expire automatically after 90 days. `/api/state` also caps a single synced value at 2MB (comfortably above the largest legitimate value, a signature image) so a buggy client write can't push megabytes into Redis.

The Do Not Contact list is *not* part of that blob — it lives in its own Redis set (`lib/doNotContact.ts`, `SADD`/`SREM`/`SMEMBERS`) so that two writes landing at nearly the same moment can't race and silently lose one of them, which the old "read the whole list, modify, write the whole list back" approach could. The dashboard reads and writes it through `/api/blacklist`. On first request after this shipped, any existing Do Not Contact list (previously stored as a JSON array in the settings blob) is migrated into the set automatically and the old field is deleted — no action needed, and nothing is lost in the process (the migration only ever adds addresses to the new set, then deletes the now-redundant old field once that's done).

Addresses land on it three ways, none of which involve the recipient: a bounce or hard rejection picked up by reply checking (`lib/refreshReplies.ts`), the "move failed sends to Do Not Contact" action, and adding an address by hand in Account settings. Every send path unions this list with whatever the client posted before sending, so an address added on one device is honored immediately rather than on the next sync.

### Why there's no unsubscribe link

Outgoing pitches carry no unsubscribe footer and no RFC 8058 `List-Unsubscribe` header, and there's no public unsubscribe page or API route. That's deliberate, and it's a judgement call tied to how this tool is actually used rather than a general recommendation.

The case for carrying an unsubscribe link is deliverability: mailbox providers judge what they observe, not intent, so a sender pushing hundreds of near-identical messages a day out of one mailbox needs to give unwilling recipients a cheap exit — otherwise they take the expensive one and hit "Report Spam", which damages the sending domain for everyone. That reasoning is real, and if this tool's volume ever climbs toward a few hundred a day off one template, it's worth revisiting.

At its actual usage — a handful of hand-picked recipients a week, each pitch meant to read as personally written — the footer buys nothing and costs something: it tells a manager the email they're reading was a mass mailing. There was also a concrete failure mode while the link existed. It performed its write on a plain `GET` page render, and corporate mail gateways (Defender Safe Links, Proofpoint, Mimecast) fetch every URL in an inbound message to scan it. Those scans silently added recipients to Do Not Contact who had never clicked anything, which is a particularly bad way to lose a contact: no error, no signal, and every later campaign quietly skips them.

Suppression itself is unaffected — see the Do Not Contact list above, which never depended on the link.

### The Send Window backstop

A send started outside Account settings' chosen Send Window hours isn't sent — it's saved with `pendingSend` set, `emails` still empty, and `scheduledFor` set to the next time the window opens. The primary way that queue drains is client-side: a polling effect in `app/dashboard/hooks/useCampaignHistory.ts` that checks once a minute while the dashboard tab is open. `app/api/cron/drain-send-window` exists for whenever it isn't — the tab got closed, or never reopened, before the window came around.

That cron only gets one guaranteed run a day on Vercel's Hobby plan, at some point within its scheduled hour rather than an exact minute (see `vercel.com/docs/cron-jobs/usage-and-pricing`), which is scheduled for 10:00 UTC in `vercel.json`. That hour is a deliberate compromise, not an arbitrary pick: it falls inside typical 9-5 working hours for UK/EU timezones and still inside them (morning) for US-East, covering most plausible Send Window configurations for a single-operator tool without the schedule needing to know which timezone any given user actually chose. It is not a guarantee for every timezone a user could configure — a window set somewhere the 10:00 UTC run doesn't land inside it just waits an extra day, the same way it would if the dashboard tab is never opened.

Because the schedule can't guarantee landing inside the window, the cron also re-checks the configured Send Window itself immediately before sending anything, using `isWithinSendWindow` (`lib/sendWindow.ts`) against the same settings Account settings writes to Redis. If the window is currently closed, it skips every campaign that was otherwise due and leaves them queued for a later run — including a campaign it already partially sent on an earlier run, since the point of the feature is not mailing people at odd hours regardless of how many recipients already got their email. Nothing is lost either way; a queued campaign just sits a while longer, which is the same trade-off "queue it" already makes over blocking the send outright.

Bottom line: this is a genuinely coarse, best-effort backstop, not a real-time drain. A send window's actual guarantee comes from the dashboard being open; the cron only closes the gap for whenever it isn't, at daily granularity.

### Login rate limiting and IP trust

`/api/auth` (the `SITE_PASSWORD` prompt) locks an address out for 15 minutes after 8 failed attempts (`lib/rateLimit.ts`), keyed by client IP. It reads that IP in preference order: `x-vercel-forwarded-for`, then `x-real-ip`, then (only if neither is present, i.e. local dev) the left-most entry of `x-forwarded-for`. The first two are set by Vercel's own edge network and can't be spoofed by the request; a client-supplied `x-forwarded-for` normally can't either — Vercel overwrites it by default — but that guarantee has more edge cases (a proxy of your own in front of the deployment, the Enterprise "Trusted Proxy" feature), so it's kept as the fallback rather than the primary signal. See the comment on `clientIp()` for the full reasoning and the source (`vercel.com/docs/headers/request-headers`).
