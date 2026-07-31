import type { NewAccountForm } from './types';

export const DEFAULT_DEMOS_TEMPLATE = `Hi {{managerName}},

My name is {{senderName}}, and I'm reaching out to submit a track for your consideration for {{artistName}}.

I've attached the track "{{trackTitle}}" — you can listen here:
{{driveLink}}

I believe this would be a strong fit for {{artistName}}'s sound and audience. I'd love to discuss any potential collaboration or placement.

Please let me know if you need anything further.`;

export const DEFAULT_FOLLOWUP_TEMPLATE = `Hi {{managerName}},

I hope you're doing well. I wanted to follow up on my recent submission for {{artistName}}.

I sent over "{{trackTitle}}" and would love to hear any feedback when you have a moment. Here's the link again:
{{driveLink}}

Thank you for your time, and I look forward to connecting.`;

export const DEFAULT_RADIO_TEMPLATE = `Hi,

My name is {{senderName}}, and I'm submitting a track for consideration for airplay on {{stationName}}.

I've attached the track "{{trackTitle}}" — you can listen here:
{{driveLink}}

I believe this would be a great fit for your station and listeners. Please let me know if you'd like any additional information.`;

export const DEFAULT_DEMOS_SUBJECT = `Music Submission: {{trackTitle}} for {{artistName}}`;
export const DEFAULT_FOLLOWUP_SUBJECT = `Following Up: {{trackTitle}} for {{artistName}}`;
export const DEFAULT_RADIO_SUBJECT = `Music Submission: {{trackTitle}} for {{stationName}}`;

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
