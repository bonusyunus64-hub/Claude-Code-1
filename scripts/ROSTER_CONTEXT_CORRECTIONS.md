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

A third broken shape turned up on 2026-08-08: a bare slug with no route segment
at all (`https://www.rostr.cc/salome`), which also 404s. It survived because
*retained* artists — those the new collection didn't find — are copied out of
the previous roster verbatim and never pass through `buildRostrUrl()`, so their
URL is frozen in whatever shape it was first written. `merge-roster.mjs` now
canonicalises on the retain path via `canonicalRostrUrl()`. Any URL field that
bypasses the build step needs the same treatment.

**3. Export limits are firmer than "a few thousand."** Measured server-side,
any single filtered query is capped at exactly **2,000 records**. Worse, the
reported result count is *clamped* to 2000, so a filter matching 3,163 artists
and one matching exactly 2,000 look identical. When batching exports, do not
trust a count of exactly 2000 to mean you got everything — narrow the filter
until it reports fewer, then widen back.

**4. The roster was never complete — until 2026-08-08.** The June 2026 import
(7,975 artists) had a hard floor at exactly 100,000 Spotify followers and was
truncated above it. The real population above that floor was estimated at
roughly 21,500.

That estimate was close. The completed collection holds **21,591 artists**,
and the collector reports `complete: true` with `pending: 0`. This is no
longer a sample — it is the full population above the follower floor. Of those,
**14,362 have no manager email at all** and are dropped at build time, which is
why `roster.json` holds 7,230 rather than 21,591. The dropped artists aren't
missing data to go and fetch; ROSTR simply lists no contact route for them.

**5. `generatedAt` has been wrong before.** A `generatedAt` of 2026-07-29 was
once hand-added to data actually sourced on 2026-06-18, so the dashboard's
"Artist roster… updated ‹date›" note under-reported staleness by six weeks. It
must always mean *when the data was pulled from rostr.cc*, never when a script
ran. See the comment in `strip-roster.mjs`.

**6. Roster counts are stale in the parent doc.** "Current roster (last
import): 7,975 artists, 2,983 with manager emails, 709 unique genres" described
the pre-2026-07-29 file. Artists without emails are no longer carried in
`roster.json` at all — they're dropped at build time, so the "Emails: ~37% of
artists" note no longer describes the file.

As of **2026-08-08**: **7,230 artists, all with at least one manager email,
4,220 unique manager addresses, 636 unique genres.**

These numbers move with every collection pass, so treat any figure written down
here as a snapshot. Read the current ones instead of trusting the doc:

```bash
node -e "const r=require('./data/roster.json');const e=new Set(r.artists.flatMap(a=>a.managerEmails||[]));console.log(r.artists.length+' artists, '+e.size+' unique emails, '+r.genres.length+' genres, generated '+r.generatedAt)"
```

**Artist count and unique-email count are different measures and both matter.**
4,220 addresses across 7,230 artists means managers are shared — one address
often covers a whole management roster. Sending "to every artist" is not the
same as sending to 7,230 mailboxes, and a single bounce can take out contact
for many artists at once.

---

---

## Collection has converged — 2026-08-08

The collector's passes are finished. Across the last four downloads the unique
manager-email count went 7,106 → 7,106 → 7,107 → 7,107: the final three passes
resolved **one address each**. The artist list was complete from the very first
dump (21,591 in all ten files); what each pass actually accumulated was contact
coverage, 4,354 → 7,107 raw addresses.

**So another pass will not find more.** If someone proposes re-running the
collector to "fill the gaps," the gaps are not fillable this way — the 14,362
artists without an address don't have one listed on ROSTR at all. Weigh that
against the incident at the top of this document before touching rostr.cc again.

A practical note for the next refresh: **each download is cumulative, not a
segment.** Every file contains the entire dataset to that point, so the newest
one is a strict superset and the earlier ones can be discarded. Verify that
rather than assume it — check that the union of all files matches the newest
one before deleting anything.

---

## Merge is convergent, not idempotent — 2026-08-08

Re-running `merge-roster.mjs` on the *same* source added 2 artists (Nate Smith,
Sasha) and lost nothing. That is expected, and worth understanding before it
looks like a bug:

`mergeMappedArtists` matches a new artist to a prior one by id first, then falls
back to name. The name index is built with `byName.set(nameKey(a.name), a)` —
**last writer wins** — and the roster contains **19 same-name artist pairs**
that ROSTR distinguishes only by an id suffix (`belly` / `belly2`, `gus` /
`gus0`, `hana` / `hana0`). Where a name collides, the fallback can only point at
one of them, so two distinct artists can collapse into one record on a run where
neither had a usable URL yet. Once canonical URLs are in place, id-matching
succeeds and they separate again.

The direction of the error is safe: because emails are **unioned**, a collapse
merges two artists' addresses rather than deleting either. The failure mode is a
duplicate address, not a lost contact.

Merging a third time produced byte-identical output, so the current file is at a
fixed point. Still: **verify losses are zero on every run** rather than assuming
a stable count means a correct one.

---

## Scripts

| Script | Use |
|---|---|
| `parse-roster.mjs` | The sanctioned path: parses a manual XLSX export. Unchanged. |
| `build-roster.mjs` | Maps a raw collection JSON to the roster schema. Writes `data/roster.json` directly — **destructive on its own**, use `merge-roster.mjs` instead unless you mean to replace. |
| `merge-roster.mjs` | Merges a raw collection JSON into the existing `roster.json`. The normal path. |
| `import-roster-xlsx.mjs` | Merges one or more manual XLSX exports, same non-destructive rules. Use for spreadsheet exports, not collector JSON. |

Both merge paths share one implementation of the union/retain rules
(`mergeMappedArtists`) — fix a merge bug there, not in a caller.

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
