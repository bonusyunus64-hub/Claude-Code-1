import type { EmailAccount } from './types';

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

export const DEFAULT_PLAYLIST_TEMPLATE = `Hi,

My name is {{senderName}}, and I'm submitting a track for consideration for your playlist, {{curatorName}}.

I've attached the track "{{trackTitle}}" — you can listen here:
{{driveLink}}

I believe this would be a great fit for your playlist and listeners. Please let me know if you'd like any additional information.`;

export const DEFAULT_DEMOS_SUBJECT = `Music Submission: {{trackTitle}} for {{artistName}}`;
export const DEFAULT_FOLLOWUP_SUBJECT = `Following Up: {{trackTitle}} for {{artistName}}`;
export const DEFAULT_RADIO_SUBJECT = `Music Submission: {{trackTitle}} for {{stationName}}`;
export const DEFAULT_PLAYLIST_SUBJECT = `Music Submission: {{trackTitle}} for {{curatorName}}`;

export const DEFAULT_SIGN_OFF = `Best regards,
{{senderName}}`;

export const LOCATION_OPTIONS = ['National', 'ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'International'];

export const PLATFORM_OPTIONS = ['Spotify', 'Apple Music', 'YouTube Music', 'Amazon Music', 'Deezer', 'Tidal', 'SoundCloud'];

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

export const BLANK_ACCOUNT: Omit<EmailAccount, 'id'> = {
  name: '', email: '', smtpHost: 'smtp.zoho.com', smtpPort: '465', smtpUser: '', smtpPass: '',
};
