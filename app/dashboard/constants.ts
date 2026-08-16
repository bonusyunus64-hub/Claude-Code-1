import type { NewAccountForm } from './types';

// Deliberately doesn't reference {{managementCompany}}: this same template renders
// both roster artists (managementCompany populated from lib/roster.ts) and hand-added/
// CSV-imported custom contacts (lib/demosSend.ts's customMessages sets it to '' since
// there's no roster data for those). renderTemplate does a dumb string substitution
// with no conditionals, so a blank var would leave a grammatically broken sentence
// ("...at ." or similar) for every manually-added contact — a supported, common path
// per the README, not an edge case worth breaking the default copy over.
export const DEFAULT_DEMOS_TEMPLATE = `Hi {{managerName}},

I'm {{senderName}}. I've got a track for {{artistName}} that I think {{pronoun}} might like — "{{trackTitle}}". It's a finished, mixed and mastered record, not a rough sketch.

{{driveLink}}

If it's not the right moment, or not the right sound, a quick "not for us" is genuinely fine — I'd rather know than have it sit unopened. Otherwise, a listen when you get a chance would be great.`;

// Reads as a reply, not a reintroduction: lib/demosSend.ts sets inReplyTo/References
// from the original send's Message-ID (see threadIds in DemosSendPayload) whenever a
// follow-up is queued, so this lands in the same thread the recipient already saw.
export const DEFAULT_FOLLOWUP_TEMPLATE = `Hi {{managerName}},

Just bumping this in case it slipped past — did you get a chance to listen to "{{trackTitle}}" for {{artistName}}? No worries at all if the timing isn't right, or if it's not the direction {{pronoun}}'s looking for at the moment.

{{driveLink}}

If it's easier, a quick yes, no, or "not right now" is genuinely all I need — I just didn't want it to fall through the cracks in your inbox.`;

export const DEFAULT_RADIO_TEMPLATE = `Hi,

I'm {{senderName}}, reaching out about a track called "{{trackTitle}}" that I think could suit {{stationName}}'s playlist. It's a finished, radio-ready mix, not a rough demo, and I'd rather send the actual audio than describe it.

{{driveLink}}

If a producer or music director there has a few minutes, I'd love to know whether it's a fit — and if it's not the right sound for the station, a quick no is completely fine too.`;

export const DEFAULT_DEMOS_SUBJECT = `{{trackTitle}} for {{artistName}}`;
// "Re: " + the demos subject's own shape, matching how a real mail client would thread
// a reply — see DEFAULT_FOLLOWUP_TEMPLATE's comment on why this reads as a reply.
export const DEFAULT_FOLLOWUP_SUBJECT = `Re: {{trackTitle}} for {{artistName}}`;
export const DEFAULT_RADIO_SUBJECT = `{{trackTitle}} for {{stationName}}`;

export const DEFAULT_SIGN_OFF = `Best regards,
{{senderName}}`;

export const LOCATION_OPTIONS = ['National', 'ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'International'];

// open.spotify.com links are universal links, so mobile browsers hand off to the
// Spotify app automatically when it's installed; otherwise they fall back to the web player.
// Note: a trailing "/artists" category segment breaks the mobile app's universal link
// handoff (it drops the actual query), so keep this to the bare search path.
export const spotifyArtistSearchUrl = (name: string) => `https://open.spotify.com/search/${encodeURIComponent(name)}`;

export const SEND_DELAY_OPTIONS = [
  { label: 'None', value: 0 },
  { label: '1s', value: 1000 },
  { label: '2s', value: 2000 },
  { label: '5s', value: 5000 },
  { label: '10s', value: 10000 },
];

export const DAILY_CAP_OPTIONS = [
  { label: 'None', value: 0 },
  { label: '50', value: 50 },
  { label: '100', value: 100 },
  { label: '200', value: 200 },
  { label: '500', value: 500 },
];

// 0 = off, mirroring DAILY_CAP_OPTIONS' "None". Otherwise a manager who's been
// pitched a track recently isn't automatically off-limits for a different one —
// this only ever produces a warning (see findCooldownRecipients in utils.ts),
// same as the existing same-track duplicate check.
export const CONTACT_COOLDOWN_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
  { label: '60 days', value: 60 },
  { label: '90 days', value: 90 },
];

export const DEFAULT_CONTACT_COOLDOWN_DAYS = 30;

export const FOLLOWUP_DAYS_OPTIONS = [
  { label: '3 days', value: 3 },
  { label: '5 days', value: 5 },
  { label: '7 days', value: 7 },
  { label: '10 days', value: 10 },
  { label: '14 days', value: 14 },
];

export const BLANK_ACCOUNT: NewAccountForm = {
  name: '', email: '', smtpHost: 'smtp.zoho.com', smtpPort: '465', smtpUser: '', smtpPass: '', dailyCap: 0,
};

// Send Window defaults — a fairly conservative "normal business hours" range so
// a user who just flips the toggle on gets something sensible immediately,
// rather than an unset 0-0 (which lib/sendWindow.ts treats as "no restriction",
// silently defeating the whole point of turning the feature on).
export const DEFAULT_SEND_WINDOW_START_HOUR = 9;
export const DEFAULT_SEND_WINDOW_END_HOUR = 21;

// Hour-of-day picker options for the Send Window start/end selects, labeled in
// plain 12-hour time. Built from a fixed UTC reference date/time rather than
// whatever `new Date()` the browser happens to construct, so the label is the
// same regardless of the machine's own timezone or the time of day this module
// happens to load — only the *hour number* (0-23) is what actually gets stored
// and compared (see lib/sendWindow.ts), this is display text only.
export const SEND_WINDOW_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: new Date(Date.UTC(2000, 0, 1, hour)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }),
}));
