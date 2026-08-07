# Corrections to ROSTER_CONTEXT.md — 2026-08-07

Read this alongside `ROSTER_CONTEXT.md`. That document is still the operating
guide; this file records where it is wrong or out of date, plus one incident
that happened because its warnings were ignored.

---

## Incident: the "What NOT to do" list was ignored, and it cost something

On 2026-08-07 an agent (me) was asked to refresh the roster. The operator
pointed at `ROSTER_CONTEXT.md` in their second message. I checked local git
only, did not run `git fetch`, found nothing, and told the operator the file
had never existed. It was on the remote the whole time, pushed from another
machine.

Not having read it, I built exactly what its "What NOT to do" section
prohibits: fetch loops against rostr.cc, roughly 13,000 requests, driven from
a logged-in browser tab.

Result: the account was blocked mid-run — the UI shows **error code RS-4290** —
and the operator lost access to the site.

Two things made it worse than it had to be:

- **rostr.cc signals overload with HTTP `529`, not `429`.** The collector's
  backoff only covered 429/503, so it treated 8,878 consecutive 529s as
  ordinary failures and kept going at full rate. The server spent nearly nine
  thousand responses asking it to stop.
- Because the backoff counter only incremented on 429/503, every progress
  report said "0 rate limits" while the run was being actively throttled. The
  run looked healthy right up until the operator couldn't load the site.

**So: the guidance in "What NOT to do" is correct. Don't re-litigate it.**
If a future refresh needs automation, that is a decision for the operator to
make knowingly, with rostr.cc's actual terms in hand — not a default.

The one factual correction to that section: rostr.cc *does* have an internal
JSON API behind the web UI. Its absence from this document was reasonable but
is not accurate. That changes nothing about whether it should be used —
undocumented internal endpoints are still covered by their terms, and the 529s
were them enforcing it.

---

## Factual corrections

**1. `data/roster_new.xlsx` was NOT gitignored.** The "What NOT to do" section
states it is. It wasn't — `.gitignore` had no `xlsx` entry at all, so nothing
prevented a spreadsheet of real manager names and emails from being committed.
Fixed on 2026-08-07 by adding `data/*.xlsx` and `rostr-raw-collection.json`.
This is the correction most worth knowing about, because it read as a safety
guarantee that wasn't there.

**2. The `ROSTR URL` example is a dead link.** The column table gives
`https://www.rostr.cc/artists/brunomars`. That plural `/artists/` route renders
rostr.cc's 404 page. Every such link in the roster was broken — 1,621 of them.
The working form is `https://www.rostr.cc/profile/<id>`, which redirects to the
canonical `/artist/<id>`. Fixed in the current roster.

**3. Export limits are firmer than "a few thousand."** Measured server-side,
any single filtered query is capped at exactly **2,000 records**. Worse, the
reported result count is *clamped* to 2000, so a filter matching 3,163 artists
and one matching exactly 2,000 look identical. When batching exports, do not
trust a count of exactly 2000 to mean you got everything — narrow the filter
until it reports fewer, then widen back.

**4. The roster was never complete.** The June 2026 import (7,975 artists) had
a hard floor at exactly 100,000 Spotify followers and was truncated above it.
The real population above that floor is roughly 21,500. Whatever the roster
holds, treat it as a sample, not the database.

**5. `generatedAt` has been wrong before.** A `generatedAt` of 2026-07-29 was
once hand-added to data actually sourced on 2026-06-18, so the dashboard's
"Artist roster… updated ‹date›" note under-reported staleness by six weeks. It
must always mean *when the data was pulled from rostr.cc*, never when a script
ran. See the comment in `strip-roster.mjs`.

**6. Roster counts are stale in the parent doc.** "Current roster (last
import): 7,975 artists, 2,983 with manager emails, 709 unique genres" described
the pre-2026-07-29 file. As of 2026-08-07: **3,569 artists, all with at least
one manager email, 555 unique genres.** Artists without emails are no longer
carried in `roster.json` at all — they're dropped at build time, so the
"Emails: ~37% of artists" note no longer describes the file.

---

## Scripts

| Script | Use |
|---|---|
| `parse-roster.mjs` | The sanctioned path: parses a manual XLSX export. Unchanged. |
| `build-roster.mjs` | Maps a raw collection JSON to the roster schema. |
| `merge-roster.mjs` | Merges new roster data into the existing `roster.json`. |

**Always merge; never replace.** A refresh that only resolves contacts for some
artists will, if written straight over `roster.json`, delete every contact it
didn't happen to re-resolve. On the 2026-08-07 data that would have cut the
roster from 2,983 reachable artists to 1,238 — a silent loss of 1,745 contacts,
with the script reporting success.

`merge-roster.mjs` is built to be non-destructive:
- metadata (followers, genres, management company, URL) comes from the new data
- manager emails are **unioned**, not replaced — a fresh lookup returning fewer
  managers is not proof the others are gone
- artists the new data didn't find at all are retained

The asymmetry is deliberate. A stale address self-corrects: it bounces, and the
bounce puts it on the Do Not Contact list. A deleted contact is simply gone and
nothing downstream notices.

Verify any refresh is non-destructive before committing it — compare artist
count and the unique-email set against the previous `roster.json` and confirm
both losses are zero.
