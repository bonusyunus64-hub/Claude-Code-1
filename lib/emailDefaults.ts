// Single source of truth for the app's default subject-line templates.
//
// This lives in lib/, not app/dashboard/constants.ts, because the server-side
// send routes (lib/demosSend.ts, lib/broadcastSend.ts, app/api/test-email/route.ts,
// lib/followUpSend.ts) each fall back to a default subject when the caller's
// subjectTemplate reaches them blank, and lib/ must never import from app/ (the
// app -> lib direction only goes one way in this codebase). app/dashboard/
// constants.ts re-exports DEFAULT_DEMOS_SUBJECT/DEFAULT_FOLLOWUP_SUBJECT/
// DEFAULT_RADIO_SUBJECT from here unchanged, so every existing dashboard
// importer of those names keeps working without knowing this module exists.
export const DEFAULT_DEMOS_SUBJECT = `{{trackTitle}} for {{artistName}}`;

// "Re: " + the demos subject's own shape, matching how a real mail client would
// thread a reply — see DEFAULT_FOLLOWUP_TEMPLATE's comment (app/dashboard/
// constants.ts) on why the follow-up body reads as a reply too.
export const DEFAULT_FOLLOWUP_SUBJECT = `Re: {{trackTitle}} for {{artistName}}`;

/**
 * Default subject for a broadcast send (radio or curator). sendBroadcast
 * (lib/broadcastSend.ts) serves both radio stations and playlist curators
 * through one function, keyed by `nameVar`, so the default subject has to vary
 * the same way the message body's {{stationName}}/{{curatorName}} variable
 * does — a hardcoded "{{stationName}}" would silently mislabel a curator send.
 */
export function defaultBroadcastSubject(nameVar: 'stationName' | 'curatorName'): string {
  return `{{trackTitle}} for {{${nameVar}}}`;
}

// The dashboard's Radio tab only ever sends to stations (see PromotionSection.tsx),
// so this is what DEFAULT_RADIO_SUBJECT reduces to. Kept as a plain string constant,
// rather than exposing defaultBroadcastSubject directly, because app/dashboard/
// constants.ts's existing callers (useTemplateDrafts.ts, PromotionSection.tsx)
// want a static default, not a nameVar-aware function.
export const DEFAULT_RADIO_SUBJECT = defaultBroadcastSubject('stationName');

/**
 * Default subject for the multi-artist pitch — sent to a manager who reps 2+
 * of a campaign's matched artists (see lib/artistFit.ts) rather than picking
 * one of them to lead with. Uses {{artistNames}} (buildArtistNameVars'
 * prose-formatted list), not {{artistName}}: there is no single artist this
 * subject can commit to without reintroducing the exact "which one did we
 * pick" problem this whole feature exists to fix.
 */
export const DEFAULT_MULTI_ARTIST_SUBJECT = `{{trackTitle}} for {{artistNames}}`;
