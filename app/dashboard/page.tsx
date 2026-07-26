'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { computeSpamScore } from '@/lib/spamScore';
import { hydrateFromRemote, syncStorage } from '@/lib/remoteSync';

const DEFAULT_DEMOS_TEMPLATE = `Hi {{managerName}},

My name is {{senderName}}, and I'm reaching out to submit a track for your consideration for {{artistName}}.

I've attached the track "{{trackTitle}}" — you can listen here:
{{driveLink}}

I believe this would be a strong fit for {{artistName}}'s sound and audience. I'd love to discuss any potential collaboration or placement.

Please let me know if you need anything further.`;

const DEFAULT_FOLLOWUP_TEMPLATE = `Hi {{managerName}},

I hope you're doing well. I wanted to follow up on my recent submission for {{artistName}}.

I sent over "{{trackTitle}}" and would love to hear any feedback when you have a moment. Here's the link again:
{{driveLink}}

Thank you for your time, and I look forward to connecting.`;

const DEFAULT_RADIO_TEMPLATE = `Hi,

My name is {{senderName}}, and I'm submitting a track for consideration for airplay on {{stationName}}.

I've attached the track "{{trackTitle}}" — you can listen here:
{{driveLink}}

I believe this would be a great fit for your station and listeners. Please let me know if you'd like any additional information.`;

const DEFAULT_PLAYLIST_TEMPLATE = `Hi,

My name is {{senderName}}, and I'm submitting a track for consideration for your playlist, {{curatorName}}.

I've attached the track "{{trackTitle}}" — you can listen here:
{{driveLink}}

I believe this would be a great fit for your playlist and listeners. Please let me know if you'd like any additional information.`;

const DEFAULT_DEMOS_SUBJECT = `Music Submission: {{trackTitle}} for {{artistName}}`;
const DEFAULT_FOLLOWUP_SUBJECT = `Following Up: {{trackTitle}} for {{artistName}}`;
const DEFAULT_RADIO_SUBJECT = `Music Submission: {{trackTitle}} for {{stationName}}`;
const DEFAULT_PLAYLIST_SUBJECT = `Music Submission: {{trackTitle}} for {{curatorName}}`;

const DEFAULT_SIGN_OFF = `Best regards,
{{senderName}}`;

const LOCATION_OPTIONS = ['National', 'ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'International'];

const PLATFORM_OPTIONS = ['Spotify', 'Apple Music', 'YouTube Music', 'Amazon Music', 'Deezer', 'Tidal', 'SoundCloud'];

// open.spotify.com links are universal links, so mobile browsers hand off to the
// Spotify app automatically when it's installed; otherwise they fall back to the web player.
const spotifyArtistSearchUrl = (name: string) => `https://open.spotify.com/search/${encodeURIComponent(name)}/artists`;

const SEND_DELAY_OPTIONS = [
  { label: 'None', value: 0 },
  { label: '1s', value: 1000 },
  { label: '2s', value: 2000 },
  { label: '5s', value: 5000 },
  { label: '10s', value: 10000 },
];

const DAILY_CAP_OPTIONS = [
  { label: 'None', value: 0 },
  { label: '50', value: 50 },
  { label: '100', value: 100 },
  { label: '200', value: 200 },
  { label: '500', value: 500 },
];

function getTodayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

interface SendResultEntry { to: string; success: boolean; error?: string }
type BatchProgress = { sent: number; failed: number; total: number };

// Send routes page through recipients (offset/limit) instead of one long request, so a
// large batch can't hit a serverless function timeout. This loops until the server
// reports no more pages, reporting live progress as each page comes back.
async function sendInBatches(
  endpoint: string,
  payload: Record<string, unknown>,
  onProgress: (progress: BatchProgress) => void
): Promise<{ ok: true; results: SendResultEntry[]; total: number } | { ok: false; error: string }> {
  let offset = 0;
  const allResults: SendResultEntry[] = [];
  let total = 0;
  for (;;) {
    let res: Response;
    let data: { error?: string; results?: SendResultEntry[]; total?: number; nextOffset?: number | null };
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, offset }),
      });
      data = await res.json();
    } catch {
      return { ok: false, error: 'Network error. Please try again.' };
    }
    if (!res.ok) return { ok: false, error: data.error || 'Failed to send.' };
    allResults.push(...(data.results ?? []));
    total = data.total ?? allResults.length;
    onProgress({
      sent: allResults.filter(r => r.success).length,
      failed: allResults.filter(r => !r.success).length,
      total,
    });
    if (data.nextOffset == null) break;
    offset = data.nextOffset;
  }
  return { ok: true, results: allResults, total };
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map(row => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseContactsCsv(text: string): { artistName: string; managerName: string; managerEmail: string }[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out: { artistName: string; managerName: string; managerEmail: string }[] = [];
  for (const line of lines) {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2) continue;
    const [artistName, managerName, managerEmail] = cols.length >= 3
      ? [cols[0], cols[1], cols[2]]
      : [cols[0], '', cols[1]];
    if (!artistName || !managerEmail || !managerEmail.includes('@')) continue;
    if (artistName.toLowerCase() === 'artist' && managerEmail.toLowerCase().includes('email')) continue;
    out.push({ artistName, managerName, managerEmail });
  }
  return out;
}

interface Artist {
  name: string;
  genres: string[];
  spotifyFollowers: number;
  managementCompany: string;
  managerNames: string[];
  managerEmails: string[];
  labels: string;
  instagramHandle: string;
  avatarUrl: string;
}

interface RadioStation {
  name: string;
  region: string;
  genres: string[];
  emails: string[];
  phone?: string;
}

interface PlaylistCurator {
  name: string;
  platform: string;
  genres: string[];
  emails: string[];
  followers?: number;
}

interface EmailAccount {
  id: string;
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
}

interface Campaign {
  id: string;
  trackTitle: string;
  date: string;
  type: 'demos' | 'radio' | 'playlists';
  emails: string[];
  accountId?: string;
  responded?: string[];
}

interface CustomContact {
  id: string;
  artistName: string;
  managerName: string;
  managerEmail: string;
}

interface DeliverabilityResult {
  domain: string;
  spf: boolean;
  spfRecord: string;
  dkim: boolean;
  dkimSelector: string;
  mx: boolean;
  mxRecords: string[];
}

interface DemosFilterPreset {
  id: string;
  name: string;
  genres: string[];
  minAudience: number;
  maxAudience: number;
  gender: string;
  artistType: string;
  minInstagram: number;
  maxInstagram: number;
  matchMode: 'any' | 'all';
}

interface RadioFilterPreset {
  id: string;
  name: string;
  genres: string[];
  locations: string[];
  matchMode: 'any' | 'all';
}

interface PlaylistFilterPreset {
  id: string;
  name: string;
  genres: string[];
  platforms: string[];
  matchMode: 'any' | 'all';
}

interface SavedTemplate {
  id: string;
  name: string;
  body: string;
  subject?: string;
}

function renderTemplateClient(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      onClick={copy}
      className={`text-xs px-2 py-1 rounded font-mono transition select-none ${
        copied
          ? 'bg-green-700/40 text-green-400 border border-green-600'
          : 'bg-zinc-800 text-violet-400 border border-zinc-700 hover:border-violet-500 hover:bg-zinc-700'
      }`}
    >
      {copied ? '✓ Copied' : value}
    </button>
  );
}

function PitchedBadge({ tracks }: { tracks: string[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (tracks.length === 1) {
    return (
      <span className="text-xs bg-amber-600/20 text-amber-400 border border-amber-600/30 px-2 py-0.5 rounded-full whitespace-nowrap">
        Pitched: {tracks[0]}
      </span>
    );
  }
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(p => !p)}
        className="text-xs bg-amber-600/20 text-amber-400 border border-amber-600/30 px-2 py-0.5 rounded-full flex items-center gap-1 whitespace-nowrap"
      >
        Pitched ({tracks.length}) <span className={`transition-transform inline-block ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl p-1.5 min-w-[180px]">
          {tracks.map(t => (
            <p key={t} className="text-xs text-zinc-300 py-1 px-2 hover:bg-zinc-700 rounded">{t}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function SpamScoreBadge({ template }: { template: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const result = useMemo(() => computeSpamScore(template), [template]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const styles = result.risk === 'high'
    ? 'bg-red-600/20 text-red-400 border-red-600/30'
    : result.risk === 'medium'
    ? 'bg-amber-600/20 text-amber-400 border-amber-600/30'
    : 'bg-green-600/20 text-green-400 border-green-600/30';

  if (result.issues.length === 0) {
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${styles}`}>
        Spam score: {result.score} (low risk)
      </span>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(p => !p)}
        className={`text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 whitespace-nowrap ${styles}`}
      >
        Spam score: {result.score} ({result.risk} risk) <span className={`transition-transform inline-block ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl p-2 min-w-[260px] max-w-[320px]">
          <p className="text-xs text-zinc-400 font-semibold mb-1">Possible deliverability issues:</p>
          {result.issues.map(issue => (
            <p key={issue} className="text-xs text-zinc-300 py-0.5">• {issue}</p>
          ))}
        </div>
      )}
    </div>
  );
}

const BLANK_ACCOUNT: Omit<EmailAccount, 'id'> = {
  name: '', email: '', smtpHost: 'smtp.zoho.com', smtpPort: '465', smtpUser: '', smtpPass: '',
};

export default function Dashboard() {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<'overview' | 'demos' | 'promotion' | 'account' | 'history'>('demos');
  const [demosTab, setDemosTab] = useState<'compose' | 'template'>('compose');
  const [promotionTab, setPromotionTab] = useState<'compose' | 'template'>('compose');
  const [promotionSection, setPromotionSection] = useState<'radio' | 'playlists'>('radio');
  const [demosMatchMode, setDemosMatchMode] = useState<'any' | 'all'>('any');
  const [radioMatchMode, setRadioMatchMode] = useState<'any' | 'all'>('any');

  // Shared track details
  const [trackTitle, setTrackTitle] = useState('');
  const [driveLink, setDriveLink] = useState('');
  const [senderName, setSenderName] = useState('');

  // Song Demos state
  const [allGenres, setAllGenres] = useState<string[]>([]);
  const [topGenres, setTopGenres] = useState<string[]>([]);
  const [genreSearch, setGenreSearch] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [showGenreDropdown, setShowGenreDropdown] = useState(false);
  const [minAudience, setMinAudience] = useState(0);
  const [maxAudience, setMaxAudience] = useState(0);
  const [gender, setGender] = useState('');
  const [artistType, setArtistType] = useState('');
  const [minInstagram, setMinInstagram] = useState(0);
  const [maxInstagram, setMaxInstagram] = useState(0);
  const [showInstagram, setShowInstagram] = useState(false);
  const [demosTemplate, setDemosTemplate] = useState(DEFAULT_DEMOS_TEMPLATE);
  const [demosSubject, setDemosSubject] = useState(DEFAULT_DEMOS_SUBJECT);
  const [demosFollowUpTemplate, setDemosFollowUpTemplate] = useState(DEFAULT_FOLLOWUP_TEMPLATE);
  const [demosFollowUpSubject, setDemosFollowUpSubject] = useState(DEFAULT_FOLLOWUP_SUBJECT);
  const [useFollowUp, setUseFollowUp] = useState(false);
  const [previewArtists, setPreviewArtists] = useState<Artist[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDone, setPreviewDone] = useState(false);
  const [sortOrder, setSortOrder] = useState<'followers-desc' | 'followers-asc' | 'alpha-asc' | 'alpha-desc' | 'random'>('followers-desc');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [outsideResults, setOutsideResults] = useState<Artist[]>([]);
  const [outsideResultsQuery, setOutsideResultsQuery] = useState('');
  const [outsideSearchLoading, setOutsideSearchLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [sendError, setSendError] = useState('');
  const [sendFailedEmails, setSendFailedEmails] = useState<string[]>([]);
  const [demosPresets, setDemosPresets] = useState<DemosFilterPreset[]>([]);
  const [newDemosPresetName, setNewDemosPresetName] = useState('');
  const [demosTemplateLibrary, setDemosTemplateLibrary] = useState<SavedTemplate[]>([]);
  const [newDemosTemplateName, setNewDemosTemplateName] = useState('');
  const [followUpTemplateLibrary, setFollowUpTemplateLibrary] = useState<SavedTemplate[]>([]);
  const [newFollowUpTemplateName, setNewFollowUpTemplateName] = useState('');

  // Track Promotion (Radio) state
  const [radioAllGenres, setRadioAllGenres] = useState<string[]>([]);
  const [radioGenreSearch, setRadioGenreSearch] = useState('');
  const [selectedRadioGenres, setSelectedRadioGenres] = useState<string[]>([]);
  const [showRadioGenreDropdown, setShowRadioGenreDropdown] = useState(false);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [radioTemplate, setRadioTemplate] = useState(DEFAULT_RADIO_TEMPLATE);
  const [radioSubject, setRadioSubject] = useState(DEFAULT_RADIO_SUBJECT);
  const [radioStations, setRadioStations] = useState<RadioStation[]>([]);
  const [radioPreviewDone, setRadioPreviewDone] = useState(false);
  const [radioPreviewLoading, setRadioPreviewLoading] = useState(false);
  const [radioSending, setRadioSending] = useState(false);
  const [radioSendResult, setRadioSendResult] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [radioSendError, setRadioSendError] = useState('');
  const [radioSendFailedEmails, setRadioSendFailedEmails] = useState<string[]>([]);
  const [radioPresets, setRadioPresets] = useState<RadioFilterPreset[]>([]);
  const [newRadioPresetName, setNewRadioPresetName] = useState('');
  const [radioTemplateLibrary, setRadioTemplateLibrary] = useState<SavedTemplate[]>([]);
  const [newRadioTemplateName, setNewRadioTemplateName] = useState('');

  // Track Promotion (Playlists) state
  const [playlistAllGenres, setPlaylistAllGenres] = useState<string[]>([]);
  const [playlistGenreSearch, setPlaylistGenreSearch] = useState('');
  const [selectedPlaylistGenres, setSelectedPlaylistGenres] = useState<string[]>([]);
  const [showPlaylistGenreDropdown, setShowPlaylistGenreDropdown] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [playlistMatchMode, setPlaylistMatchMode] = useState<'any' | 'all'>('any');
  const [playlistTemplate, setPlaylistTemplate] = useState(DEFAULT_PLAYLIST_TEMPLATE);
  const [playlistSubject, setPlaylistSubject] = useState(DEFAULT_PLAYLIST_SUBJECT);
  const [playlistCurators, setPlaylistCurators] = useState<PlaylistCurator[]>([]);
  const [playlistPreviewDone, setPlaylistPreviewDone] = useState(false);
  const [playlistPreviewLoading, setPlaylistPreviewLoading] = useState(false);
  const [playlistSending, setPlaylistSending] = useState(false);
  const [playlistSendResult, setPlaylistSendResult] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [playlistSendError, setPlaylistSendError] = useState('');
  const [playlistSendFailedEmails, setPlaylistSendFailedEmails] = useState<string[]>([]);
  const [playlistPresets, setPlaylistPresets] = useState<PlaylistFilterPreset[]>([]);
  const [newPlaylistPresetName, setNewPlaylistPresetName] = useState('');
  const [playlistTemplateLibrary, setPlaylistTemplateLibrary] = useState<SavedTemplate[]>([]);
  const [newPlaylistTemplateName, setNewPlaylistTemplateName] = useState('');

  // Account state
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({ ...BLANK_ACCOUNT });
  const [signOff, setSignOff] = useState(DEFAULT_SIGN_OFF);
  const [signOffImage, setSignOffImage] = useState<string | null>(null);
  const [testEmailTo, setTestEmailTo] = useState('');
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<'success' | 'error' | null>(null);
  const [testEmailError, setTestEmailError] = useState('');
  const [showTestEmailOptions, setShowTestEmailOptions] = useState(false);
  const [testEmailSubject, setTestEmailSubject] = useState('');
  const [testEmailMessage, setTestEmailMessage] = useState('');
  const [sendDelay, setSendDelay] = useState(0);
  const [dailySendCap, setDailySendCap] = useState(0);
  const [sendsToday, setSendsToday] = useState(0);
  const [sendsTodayByAccount, setSendsTodayByAccount] = useState<Record<string, number>>({});

  // Blacklist
  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [newBlacklistEmail, setNewBlacklistEmail] = useState('');

  // Emails that bounced/failed on a send — kept separate from the blacklist so they can
  // be reviewed (a failure can be a fluke) rather than silently blocked forever.
  const [failedEmails, setFailedEmails] = useState<string[]>([]);

  // Custom contacts
  const [customContacts, setCustomContacts] = useState<CustomContact[]>([]);
  const [newCustomContact, setNewCustomContact] = useState({ artistName: '', managerName: '', managerEmail: '' });
  const [showAddCustomContact, setShowAddCustomContact] = useState(false);

  // Campaigns
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'all' | Campaign['type']>('all');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');

  // Deliverability
  const [deliverabilityResult, setDeliverabilityResult] = useState<DeliverabilityResult | null>(null);
  const [deliverabilityLoading, setDeliverabilityLoading] = useState(false);

  // Email preview modal
  const [previewModalType, setPreviewModalType] = useState<'demos' | 'radio' | 'playlists' | null>(null);
  const [previewModalIdx, setPreviewModalIdx] = useState(0);

  // Save tracking
  const [lastSavedDemosTemplate, setLastSavedDemosTemplate] = useState(DEFAULT_DEMOS_TEMPLATE);
  const [lastSavedDemosSubject, setLastSavedDemosSubject] = useState(DEFAULT_DEMOS_SUBJECT);
  const [lastSavedFollowUpTemplate, setLastSavedFollowUpTemplate] = useState(DEFAULT_FOLLOWUP_TEMPLATE);
  const [lastSavedFollowUpSubject, setLastSavedFollowUpSubject] = useState(DEFAULT_FOLLOWUP_SUBJECT);
  const [lastSavedRadioTemplate, setLastSavedRadioTemplate] = useState(DEFAULT_RADIO_TEMPLATE);
  const [lastSavedRadioSubject, setLastSavedRadioSubject] = useState(DEFAULT_RADIO_SUBJECT);
  const [lastSavedPlaylistTemplate, setLastSavedPlaylistTemplate] = useState(DEFAULT_PLAYLIST_TEMPLATE);
  const [lastSavedPlaylistSubject, setLastSavedPlaylistSubject] = useState(DEFAULT_PLAYLIST_SUBJECT);
  const [lastSavedSignOff, setLastSavedSignOff] = useState(DEFAULT_SIGN_OFF);
  const [lastSavedSignOffImage, setLastSavedSignOffImage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/genres').then(r => r.json()).then(d => { setAllGenres(d.genres || []); setTopGenres(d.topGenres || []); });
    fetch('/api/radio-genres').then(r => r.json()).then(d => setRadioAllGenres(d.genres || []));
    fetch('/api/playlist-genres').then(r => r.json()).then(d => setPlaylistAllGenres(d.genres || []));
    (async () => {
    await hydrateFromRemote(); // pull latest settings from the server so a second device picks up what was saved elsewhere
    try {
      const accounts = JSON.parse(localStorage.getItem('tp_email_accounts') || '[]') as EmailAccount[];
      setEmailAccounts(accounts);
      const savedId = localStorage.getItem('tp_selected_account');
      if (savedId && accounts.find(a => a.id === savedId)) setSelectedAccountId(savedId);
      else if (accounts.length > 0) setSelectedAccountId(accounts[0].id);

      const savedSignOff = localStorage.getItem('tp_sign_off');
      if (savedSignOff !== null) { setSignOff(savedSignOff); setLastSavedSignOff(savedSignOff); }

      const savedImage = localStorage.getItem('tp_sign_off_image');
      if (savedImage) { setSignOffImage(savedImage); setLastSavedSignOffImage(savedImage); }

      const savedDemosTemplate = localStorage.getItem('tp_email_template');
      if (savedDemosTemplate !== null) { setDemosTemplate(savedDemosTemplate); setLastSavedDemosTemplate(savedDemosTemplate); }

      const savedDemosSubject = localStorage.getItem('tp_email_subject');
      if (savedDemosSubject !== null) { setDemosSubject(savedDemosSubject); setLastSavedDemosSubject(savedDemosSubject); }

      const savedFollowUp = localStorage.getItem('tp_followup_template');
      if (savedFollowUp !== null) { setDemosFollowUpTemplate(savedFollowUp); setLastSavedFollowUpTemplate(savedFollowUp); }

      const savedFollowUpSubject = localStorage.getItem('tp_followup_subject');
      if (savedFollowUpSubject !== null) { setDemosFollowUpSubject(savedFollowUpSubject); setLastSavedFollowUpSubject(savedFollowUpSubject); }

      const savedRadioTemplate = localStorage.getItem('tp_radio_template');
      if (savedRadioTemplate !== null) { setRadioTemplate(savedRadioTemplate); setLastSavedRadioTemplate(savedRadioTemplate); }

      const savedRadioSubject = localStorage.getItem('tp_radio_subject');
      if (savedRadioSubject !== null) { setRadioSubject(savedRadioSubject); setLastSavedRadioSubject(savedRadioSubject); }

      const savedPlaylistTemplate = localStorage.getItem('tp_playlist_template');
      if (savedPlaylistTemplate !== null) { setPlaylistTemplate(savedPlaylistTemplate); setLastSavedPlaylistTemplate(savedPlaylistTemplate); }

      const savedPlaylistSubject = localStorage.getItem('tp_playlist_subject');
      if (savedPlaylistSubject !== null) { setPlaylistSubject(savedPlaylistSubject); setLastSavedPlaylistSubject(savedPlaylistSubject); }

      const savedCampaigns = localStorage.getItem('tp_campaigns');
      if (savedCampaigns) setCampaigns(JSON.parse(savedCampaigns));

      const savedBlacklist = localStorage.getItem('tp_blacklist');
      if (savedBlacklist) setBlacklist(JSON.parse(savedBlacklist));

      const savedFailedEmails = localStorage.getItem('tp_failed_emails');
      if (savedFailedEmails) setFailedEmails(JSON.parse(savedFailedEmails));

      const savedCustomContacts = localStorage.getItem('tp_custom_contacts');
      if (savedCustomContacts) setCustomContacts(JSON.parse(savedCustomContacts));

      const savedSendDelay = localStorage.getItem('tp_send_delay');
      if (savedSendDelay !== null) setSendDelay(Number(savedSendDelay));

      const savedDemosPresets = localStorage.getItem('tp_demos_presets');
      if (savedDemosPresets) setDemosPresets(JSON.parse(savedDemosPresets));

      const savedRadioPresets = localStorage.getItem('tp_radio_presets');
      if (savedRadioPresets) setRadioPresets(JSON.parse(savedRadioPresets));

      const savedPlaylistPresets = localStorage.getItem('tp_playlist_presets');
      if (savedPlaylistPresets) setPlaylistPresets(JSON.parse(savedPlaylistPresets));

      const savedDemosTemplates = localStorage.getItem('tp_demos_templates');
      if (savedDemosTemplates) setDemosTemplateLibrary(JSON.parse(savedDemosTemplates));

      const savedFollowUpTemplates = localStorage.getItem('tp_followup_templates');
      if (savedFollowUpTemplates) setFollowUpTemplateLibrary(JSON.parse(savedFollowUpTemplates));

      const savedRadioTemplates = localStorage.getItem('tp_radio_templates');
      if (savedRadioTemplates) setRadioTemplateLibrary(JSON.parse(savedRadioTemplates));

      const savedPlaylistTemplates = localStorage.getItem('tp_playlist_templates');
      if (savedPlaylistTemplates) setPlaylistTemplateLibrary(JSON.parse(savedPlaylistTemplates));

      const savedDailyCap = localStorage.getItem('tp_daily_cap');
      if (savedDailyCap !== null) setDailySendCap(Number(savedDailyCap));

      const savedSendsToday = JSON.parse(localStorage.getItem('tp_sends_today') || '{}');
      if (savedSendsToday.date === getTodayDateStr()) {
        setSendsToday(savedSendsToday.count || 0);
        setSendsTodayByAccount(savedSendsToday.byAccount || {});
      }
    } catch {}
    })();
  }, []);

  const pitchedEmailMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const campaign of campaigns) {
      for (const email of campaign.emails) {
        const key = email.toLowerCase();
        const existing = map.get(key) ?? [];
        if (!existing.includes(campaign.trackTitle)) {
          map.set(key, [...existing, campaign.trackTitle]);
        }
      }
    }
    return map;
  }, [campaigns]);

  const demosPitchCount = useMemo(() => {
    const title = trackTitle.trim().toLowerCase();
    if (!title) return 0;
    return campaigns
      .filter(c => c.type === 'demos' && c.trackTitle.trim().toLowerCase() === title)
      .reduce((sum, c) => sum + c.emails.length, 0);
  }, [campaigns, trackTitle]);

  const radioPitchCount = useMemo(() => {
    const title = trackTitle.trim().toLowerCase();
    if (!title) return 0;
    return campaigns
      .filter(c => c.type === 'radio' && c.trackTitle.trim().toLowerCase() === title)
      .reduce((sum, c) => sum + c.emails.length, 0);
  }, [campaigns, trackTitle]);

  const playlistPitchCount = useMemo(() => {
    const title = trackTitle.trim().toLowerCase();
    if (!title) return 0;
    return campaigns
      .filter(c => c.type === 'playlists' && c.trackTitle.trim().toLowerCase() === title)
      .reduce((sum, c) => sum + c.emails.length, 0);
  }, [campaigns, trackTitle]);

  const analyticsStats = useMemo(() => {
    const totalCampaigns = campaigns.length;
    const totalEmailsSent = campaigns.reduce((s, c) => s + c.emails.length, 0);
    const demosCampaigns = campaigns.filter(c => c.type === 'demos');
    const radioCampaigns = campaigns.filter(c => c.type === 'radio');
    const playlistCampaigns = campaigns.filter(c => c.type === 'playlists');
    const demosEmailsSent = demosCampaigns.reduce((s, c) => s + c.emails.length, 0);
    const radioEmailsSent = radioCampaigns.reduce((s, c) => s + c.emails.length, 0);
    const playlistEmailsSent = playlistCampaigns.reduce((s, c) => s + c.emails.length, 0);

    const trackCounts = new Map<string, number>();
    campaigns.forEach(c => trackCounts.set(c.trackTitle, (trackCounts.get(c.trackTitle) ?? 0) + c.emails.length));
    const topTracks = Array.from(trackCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const dayCounts = new Map<string, number>();
    campaigns.forEach(c => {
      const day = c.date.slice(0, 10);
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + c.emails.length);
    });
    const today = new Date();
    const last14Days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (13 - i));
      const key = d.toISOString().slice(0, 10);
      return { date: key, count: dayCounts.get(key) ?? 0 };
    });
    const maxDayCount = Math.max(1, ...last14Days.map(d => d.count));

    return {
      totalCampaigns, totalEmailsSent,
      demosCampaignCount: demosCampaigns.length, radioCampaignCount: radioCampaigns.length, playlistCampaignCount: playlistCampaigns.length,
      demosEmailsSent, radioEmailsSent, playlistEmailsSent,
      topTracks, last14Days, maxDayCount,
      lastCampaignDate: campaigns.length ? campaigns.slice().sort((a, b) => b.date.localeCompare(a.date))[0].date : null,
    };
  }, [campaigns]);

  const filteredCampaigns = useMemo(() => {
    const search = historySearch.trim().toLowerCase();
    return campaigns.filter(c => {
      if (historyTypeFilter !== 'all' && c.type !== historyTypeFilter) return false;
      if (search && !c.trackTitle.toLowerCase().includes(search)) return false;
      const day = c.date.slice(0, 10);
      if (historyDateFrom && day < historyDateFrom) return false;
      if (historyDateTo && day > historyDateTo) return false;
      return true;
    });
  }, [campaigns, historySearch, historyTypeFilter, historyDateFrom, historyDateTo]);

  function findDuplicateRecipients(emails: string[]): string[] {
    const title = trackTitle.trim().toLowerCase();
    if (!title) return [];
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const email of emails) {
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const tracks = pitchedEmailMap.get(key) ?? [];
      if (tracks.some(t => t.trim().toLowerCase() === title)) dupes.push(email);
    }
    return dupes;
  }

  const isDirty =
    demosTemplate !== lastSavedDemosTemplate ||
    demosSubject !== lastSavedDemosSubject ||
    demosFollowUpTemplate !== lastSavedFollowUpTemplate ||
    demosFollowUpSubject !== lastSavedFollowUpSubject ||
    radioTemplate !== lastSavedRadioTemplate ||
    radioSubject !== lastSavedRadioSubject ||
    playlistTemplate !== lastSavedPlaylistTemplate ||
    playlistSubject !== lastSavedPlaylistSubject ||
    signOff !== lastSavedSignOff ||
    signOffImage !== lastSavedSignOffImage;

  function saveAll() {
    syncStorage.setItem('tp_email_template', demosTemplate);
    syncStorage.setItem('tp_email_subject', demosSubject);
    syncStorage.setItem('tp_followup_template', demosFollowUpTemplate);
    syncStorage.setItem('tp_followup_subject', demosFollowUpSubject);
    syncStorage.setItem('tp_radio_template', radioTemplate);
    syncStorage.setItem('tp_radio_subject', radioSubject);
    syncStorage.setItem('tp_playlist_template', playlistTemplate);
    syncStorage.setItem('tp_playlist_subject', playlistSubject);
    syncStorage.setItem('tp_sign_off', signOff);
    if (signOffImage) syncStorage.setItem('tp_sign_off_image', signOffImage);
    else syncStorage.removeItem('tp_sign_off_image');
    setLastSavedDemosTemplate(demosTemplate);
    setLastSavedDemosSubject(demosSubject);
    setLastSavedFollowUpTemplate(demosFollowUpTemplate);
    setLastSavedFollowUpSubject(demosFollowUpSubject);
    setLastSavedRadioTemplate(radioTemplate);
    setLastSavedRadioSubject(radioSubject);
    setLastSavedPlaylistTemplate(playlistTemplate);
    setLastSavedPlaylistSubject(playlistSubject);
    setLastSavedSignOff(signOff);
    setLastSavedSignOffImage(signOffImage);
  }

  function discardChanges() {
    setDemosTemplate(lastSavedDemosTemplate);
    setDemosSubject(lastSavedDemosSubject);
    setDemosFollowUpTemplate(lastSavedFollowUpTemplate);
    setDemosFollowUpSubject(lastSavedFollowUpSubject);
    setRadioTemplate(lastSavedRadioTemplate);
    setRadioSubject(lastSavedRadioSubject);
    setPlaylistTemplate(lastSavedPlaylistTemplate);
    setPlaylistSubject(lastSavedPlaylistSubject);
    setSignOff(lastSavedSignOff);
    setSignOffImage(lastSavedSignOffImage);
  }

  function handleSignOffImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSignOffImage(reader.result as string);
    reader.readAsDataURL(file);
  }

  function persistAccounts(accounts: EmailAccount[]) {
    setEmailAccounts(accounts);
    syncStorage.setItem('tp_email_accounts', JSON.stringify(accounts));
  }

  function addAccount() {
    if (!newAccount.name || !newAccount.smtpUser || !newAccount.smtpPass) return;
    const account: EmailAccount = { id: Date.now().toString(), ...newAccount };
    const updated = [...emailAccounts, account];
    persistAccounts(updated);
    setSelectedAccountId(account.id);
    syncStorage.setItem('tp_selected_account', account.id);
    setShowAddAccount(false);
    setNewAccount({ ...BLANK_ACCOUNT });
  }

  function removeAccount(id: string) {
    const updated = emailAccounts.filter(a => a.id !== id);
    persistAccounts(updated);
    if (selectedAccountId === id) {
      const next = updated[0]?.id ?? '';
      setSelectedAccountId(next);
      syncStorage.setItem('tp_selected_account', next);
    }
  }

  function selectAccount(id: string) {
    setSelectedAccountId(id);
    syncStorage.setItem('tp_selected_account', id);
  }

  function addToBlacklist() {
    const email = newBlacklistEmail.trim().toLowerCase();
    if (!email || blacklist.includes(email)) return;
    const updated = [...blacklist, email];
    setBlacklist(updated);
    syncStorage.setItem('tp_blacklist', JSON.stringify(updated));
    setNewBlacklistEmail('');
  }

  function removeFromBlacklist(email: string) {
    const updated = blacklist.filter(e => e !== email);
    setBlacklist(updated);
    syncStorage.setItem('tp_blacklist', JSON.stringify(updated));
  }

  function addCustomContact() {
    if (!newCustomContact.artistName || !newCustomContact.managerEmail) return;
    const contact: CustomContact = { id: Date.now().toString(), ...newCustomContact };
    const updated = [...customContacts, contact];
    setCustomContacts(updated);
    syncStorage.setItem('tp_custom_contacts', JSON.stringify(updated));
    setShowAddCustomContact(false);
    setNewCustomContact({ artistName: '', managerName: '', managerEmail: '' });
  }

  function removeCustomContact(id: string) {
    const updated = customContacts.filter(c => c.id !== id);
    setCustomContacts(updated);
    syncStorage.setItem('tp_custom_contacts', JSON.stringify(updated));
  }

  async function handleOutsideSearch(query: string) {
    setOutsideSearchLoading(true);
    try {
      const res = await fetch('/api/artist-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      setOutsideResults(data.artists || []);
      setOutsideResultsQuery(query);
    } finally { setOutsideSearchLoading(false); }
  }

  function addOutsideArtistToContacts(a: Artist) {
    const existingEmails = new Set(customContacts.map(c => c.managerEmail.toLowerCase()));
    const additions: CustomContact[] = a.managerEmails
      .filter(email => !existingEmails.has(email.toLowerCase()))
      .map((email, i) => ({
        id: `${Date.now()}-${i}`,
        artistName: a.name,
        managerName: a.managerNames[i] || '',
        managerEmail: email,
      }));
    if (!additions.length) return;
    const updated = [...customContacts, ...additions];
    setCustomContacts(updated);
    syncStorage.setItem('tp_custom_contacts', JSON.stringify(updated));
  }

  function logCampaign(type: 'demos' | 'radio' | 'playlists', title: string, emails: string[], accountId?: string) {
    if (!emails.length) return;
    const campaign: Campaign = { id: Date.now().toString(), trackTitle: title, date: new Date().toISOString(), type, emails, accountId };
    const updated = [...campaigns, campaign];
    setCampaigns(updated);
    syncStorage.setItem('tp_campaigns', JSON.stringify(updated));
  }

  const [checkingRepliesId, setCheckingRepliesId] = useState<string | null>(null);
  const [replyCheckError, setReplyCheckError] = useState('');

  async function checkReplies(c: Campaign) {
    const acc = emailAccounts.find(a => a.id === c.accountId);
    if (!acc) { setReplyCheckError('The account this was sent from is no longer available.'); return; }
    setCheckingRepliesId(c.id);
    setReplyCheckError('');
    try {
      const res = await fetch('/api/check-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails: c.emails,
          since: new Date(c.date).getTime(),
          fromAccount: { ...acc, smtpPort: Number(acc.smtpPort) },
        }),
      });
      const data = await res.json();
      if (!res.ok) { setReplyCheckError(data.error || 'Could not check replies.'); return; }
      const responded = Array.from(new Set([...(c.responded ?? []), ...(data.responded as string[])]));
      const updated = campaigns.map(x => x.id === c.id ? { ...x, responded } : x);
      setCampaigns(updated);
      syncStorage.setItem('tp_campaigns', JSON.stringify(updated));
    } catch (err) {
      setReplyCheckError(`Could not check replies: ${String(err)}`);
    } finally {
      setCheckingRepliesId(null);
    }
  }

  function clearCampaignHistory() {
    setCampaigns([]);
    syncStorage.removeItem('tp_campaigns');
  }

  function exportCampaignsCsv(list: Campaign[] = campaigns) {
    const rows = [
      ['Date', 'Type', 'Track', 'Recipients', 'Emails'],
      ...list
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(c => [new Date(c.date).toLocaleString(), c.type, c.trackTitle, String(c.emails.length), c.emails.join('; ')]),
    ];
    downloadCsv('campaign-history.csv', rows);
  }

  function addSendsToday(n: number, accountId?: string) {
    const today = getTodayDateStr();
    const updatedTotal = sendsToday + n;
    const updatedByAccount = { ...sendsTodayByAccount };
    if (accountId) updatedByAccount[accountId] = (updatedByAccount[accountId] ?? 0) + n;
    setSendsToday(updatedTotal);
    setSendsTodayByAccount(updatedByAccount);
    syncStorage.setItem('tp_sends_today', JSON.stringify({ date: today, count: updatedTotal, byAccount: updatedByAccount }));
  }

  function setDailyCap(value: number) {
    setDailySendCap(value);
    syncStorage.setItem('tp_daily_cap', String(value));
  }

  function saveDemosPreset() {
    const name = newDemosPresetName.trim();
    if (!name) return;
    const preset: DemosFilterPreset = {
      id: Date.now().toString(), name, genres: selectedGenres, minAudience, maxAudience,
      gender, artistType, minInstagram, maxInstagram, matchMode: demosMatchMode,
    };
    const updated = [...demosPresets, preset];
    setDemosPresets(updated);
    syncStorage.setItem('tp_demos_presets', JSON.stringify(updated));
    setNewDemosPresetName('');
  }

  function loadDemosPreset(preset: DemosFilterPreset) {
    setSelectedGenres(preset.genres);
    setMinAudience(preset.minAudience);
    setMaxAudience(preset.maxAudience);
    setGender(preset.gender);
    setArtistType(preset.artistType);
    setMinInstagram(preset.minInstagram);
    setMaxInstagram(preset.maxInstagram);
    setDemosMatchMode(preset.matchMode);
    setPreviewDone(false);
    setSendResult(null);
  }

  function deleteDemosPreset(id: string) {
    const updated = demosPresets.filter(p => p.id !== id);
    setDemosPresets(updated);
    syncStorage.setItem('tp_demos_presets', JSON.stringify(updated));
  }

  function saveRadioPreset() {
    const name = newRadioPresetName.trim();
    if (!name) return;
    const preset: RadioFilterPreset = {
      id: Date.now().toString(), name, genres: selectedRadioGenres, locations: selectedLocations, matchMode: radioMatchMode,
    };
    const updated = [...radioPresets, preset];
    setRadioPresets(updated);
    syncStorage.setItem('tp_radio_presets', JSON.stringify(updated));
    setNewRadioPresetName('');
  }

  function loadRadioPreset(preset: RadioFilterPreset) {
    setSelectedRadioGenres(preset.genres);
    setSelectedLocations(preset.locations);
    setRadioMatchMode(preset.matchMode);
    setRadioPreviewDone(false);
    setRadioSendResult(null);
  }

  function deleteRadioPreset(id: string) {
    const updated = radioPresets.filter(p => p.id !== id);
    setRadioPresets(updated);
    syncStorage.setItem('tp_radio_presets', JSON.stringify(updated));
  }

  function savePlaylistPreset() {
    const name = newPlaylistPresetName.trim();
    if (!name) return;
    const preset: PlaylistFilterPreset = {
      id: Date.now().toString(), name, genres: selectedPlaylistGenres, platforms: selectedPlatforms, matchMode: playlistMatchMode,
    };
    const updated = [...playlistPresets, preset];
    setPlaylistPresets(updated);
    syncStorage.setItem('tp_playlist_presets', JSON.stringify(updated));
    setNewPlaylistPresetName('');
  }

  function loadPlaylistPreset(preset: PlaylistFilterPreset) {
    setSelectedPlaylistGenres(preset.genres);
    setSelectedPlatforms(preset.platforms);
    setPlaylistMatchMode(preset.matchMode);
    setPlaylistPreviewDone(false);
    setPlaylistSendResult(null);
  }

  function deletePlaylistPreset(id: string) {
    const updated = playlistPresets.filter(p => p.id !== id);
    setPlaylistPresets(updated);
    syncStorage.setItem('tp_playlist_presets', JSON.stringify(updated));
  }

  function saveDemosTemplateToLibrary() {
    const name = newDemosTemplateName.trim();
    if (!name) return;
    const template: SavedTemplate = { id: Date.now().toString(), name, body: demosTemplate, subject: demosSubject };
    const updated = [...demosTemplateLibrary, template];
    setDemosTemplateLibrary(updated);
    syncStorage.setItem('tp_demos_templates', JSON.stringify(updated));
    setNewDemosTemplateName('');
  }

  function loadDemosTemplateFromLibrary(template: SavedTemplate) {
    setDemosTemplate(template.body);
    if (template.subject !== undefined) setDemosSubject(template.subject);
  }

  function deleteDemosTemplateFromLibrary(id: string) {
    const updated = demosTemplateLibrary.filter(t => t.id !== id);
    setDemosTemplateLibrary(updated);
    syncStorage.setItem('tp_demos_templates', JSON.stringify(updated));
  }

  function saveFollowUpTemplateToLibrary() {
    const name = newFollowUpTemplateName.trim();
    if (!name) return;
    const template: SavedTemplate = { id: Date.now().toString(), name, body: demosFollowUpTemplate, subject: demosFollowUpSubject };
    const updated = [...followUpTemplateLibrary, template];
    setFollowUpTemplateLibrary(updated);
    syncStorage.setItem('tp_followup_templates', JSON.stringify(updated));
    setNewFollowUpTemplateName('');
  }

  function loadFollowUpTemplateFromLibrary(template: SavedTemplate) {
    setDemosFollowUpTemplate(template.body);
    if (template.subject !== undefined) setDemosFollowUpSubject(template.subject);
  }

  function deleteFollowUpTemplateFromLibrary(id: string) {
    const updated = followUpTemplateLibrary.filter(t => t.id !== id);
    setFollowUpTemplateLibrary(updated);
    syncStorage.setItem('tp_followup_templates', JSON.stringify(updated));
  }

  function saveRadioTemplateToLibrary() {
    const name = newRadioTemplateName.trim();
    if (!name) return;
    const template: SavedTemplate = { id: Date.now().toString(), name, body: radioTemplate, subject: radioSubject };
    const updated = [...radioTemplateLibrary, template];
    setRadioTemplateLibrary(updated);
    syncStorage.setItem('tp_radio_templates', JSON.stringify(updated));
    setNewRadioTemplateName('');
  }

  function loadRadioTemplateFromLibrary(template: SavedTemplate) {
    setRadioTemplate(template.body);
    if (template.subject !== undefined) setRadioSubject(template.subject);
  }

  function deleteRadioTemplateFromLibrary(id: string) {
    const updated = radioTemplateLibrary.filter(t => t.id !== id);
    setRadioTemplateLibrary(updated);
    syncStorage.setItem('tp_radio_templates', JSON.stringify(updated));
  }

  function savePlaylistTemplateToLibrary() {
    const name = newPlaylistTemplateName.trim();
    if (!name) return;
    const template: SavedTemplate = { id: Date.now().toString(), name, body: playlistTemplate, subject: playlistSubject };
    const updated = [...playlistTemplateLibrary, template];
    setPlaylistTemplateLibrary(updated);
    syncStorage.setItem('tp_playlist_templates', JSON.stringify(updated));
    setNewPlaylistTemplateName('');
  }

  function loadPlaylistTemplateFromLibrary(template: SavedTemplate) {
    setPlaylistTemplate(template.body);
    if (template.subject !== undefined) setPlaylistSubject(template.subject);
  }

  function deletePlaylistTemplateFromLibrary(id: string) {
    const updated = playlistTemplateLibrary.filter(t => t.id !== id);
    setPlaylistTemplateLibrary(updated);
    syncStorage.setItem('tp_playlist_templates', JSON.stringify(updated));
  }

  function handleCustomContactsCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseContactsCsv(String(reader.result));
      if (!parsed.length) return;
      const existingEmails = new Set(customContacts.map(c => c.managerEmail.toLowerCase()));
      const fresh = parsed.filter(p => !existingEmails.has(p.managerEmail.toLowerCase()));
      const added = fresh.map(p => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, ...p }));
      const updated = [...customContacts, ...added];
      setCustomContacts(updated);
      syncStorage.setItem('tp_custom_contacts', JSON.stringify(updated));
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function addFailedToBlacklist(emails: string[]) {
    const lower = emails.map(e => e.toLowerCase());
    const merged = [...new Set([...blacklist, ...lower])];
    setBlacklist(merged);
    syncStorage.setItem('tp_blacklist', JSON.stringify(merged));
  }

  function recordFailedEmails(emails: string[]) {
    if (!emails.length) return;
    setFailedEmails(prev => {
      const merged = [...new Set([...prev, ...emails.map(e => e.toLowerCase())])];
      syncStorage.setItem('tp_failed_emails', JSON.stringify(merged));
      return merged;
    });
  }

  function removeFromFailedEmails(email: string) {
    setFailedEmails(prev => {
      const updated = prev.filter(e => e !== email);
      syncStorage.setItem('tp_failed_emails', JSON.stringify(updated));
      return updated;
    });
  }

  function moveFailedToDoNotContact(email: string) {
    addFailedToBlacklist([email]);
    removeFromFailedEmails(email);
  }

  async function handleTestEmail() {
    if (!testEmailTo) return;
    setTestEmailSending(true); setTestEmailResult(null); setTestEmailError('');
    try {
      const acc = emailAccounts.find(a => a.id === selectedAccountId);
      const res = await fetch('/api/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testEmailTo,
          fromAccount: acc ? { ...acc, smtpPort: Number(acc.smtpPort) } : undefined,
          emailTemplate: testEmailMessage.trim() || demosTemplate,
          subjectTemplate: testEmailSubject.trim() || demosSubject,
          signOff,
          signOffImage,
          senderName,
          trackTitle,
          driveLink,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setTestEmailResult('error'); setTestEmailError(data.error || 'Failed to send.'); }
      else setTestEmailResult('success');
    } catch { setTestEmailResult('error'); setTestEmailError('Network error. Please try again.'); }
    finally { setTestEmailSending(false); }
  }

  async function handleDeliverabilityCheck() {
    const acc = emailAccounts.find(a => a.id === selectedAccountId);
    const emailAddr = acc?.email || acc?.smtpUser;
    if (!emailAddr) return;
    const domain = emailAddr.split('@')[1];
    if (!domain) return;
    setDeliverabilityLoading(true); setDeliverabilityResult(null);
    try {
      const res = await fetch('/api/deliverability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      setDeliverabilityResult(data);
    } catch {}
    finally { setDeliverabilityLoading(false); }
  }

  const FOLLOWER_STEPS = [
    { label: 'Any', value: 0 },
    { label: '100K', value: 100_000 },
    { label: '250K', value: 250_000 },
    { label: '500K', value: 500_000 },
    { label: '1M', value: 1_000_000 },
    { label: '2M', value: 2_000_000 },
    { label: '3M', value: 3_000_000 },
    { label: '5M', value: 5_000_000 },
    { label: '10M', value: 10_000_000 },
    { label: '50M', value: 50_000_000 },
  ];

  const GENDER_OPTIONS = [
    { label: 'Any', value: '' },
    { label: 'Male', value: 'MALE' },
    { label: 'Female', value: 'FEMALE' },
  ];

  const ARTIST_TYPE_OPTIONS = [
    { label: 'Any', value: '' },
    { label: 'Solo', value: 'Person' },
    { label: 'Group', value: 'Group' },
  ];

  const resetFilters = () => { setPreviewDone(false); setSendResult(null); };

  const filteredGenres = useMemo(() =>
    allGenres.filter(g => g.toLowerCase().includes(genreSearch.toLowerCase()) && !selectedGenres.includes(g)).slice(0, 50),
    [allGenres, genreSearch, selectedGenres]
  );

  const toggleGenre = useCallback((genre: string) => {
    setSelectedGenres(prev => prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]);
    setPreviewDone(false); setSendResult(null);
  }, []);

  async function handlePreview(genresOverride?: string[]) {
    setPreviewLoading(true); setPreviewDone(false);
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genres: genresOverride ?? selectedGenres, minAudience, maxAudience, gender, artistType, minInstagram, maxInstagram, matchMode: demosMatchMode }),
      });
      const data = await res.json();
      setPreviewArtists(data.artists || []);
      setPreviewDone(true);
    } finally { setPreviewLoading(false); }
  }

  // Clicking a genre chip on a preview card toggles it in the active filters
  // and immediately re-runs the preview with the updated genre list, instead
  // of just clearing the results like toggleGenre does.
  function toggleGenreFromPreview(genre: string) {
    const updated = selectedGenres.includes(genre)
      ? selectedGenres.filter(g => g !== genre)
      : [...selectedGenres, genre];
    setSelectedGenres(updated);
    handlePreview(updated);
  }

  async function handleSend() {
    if (!trackTitle || !driveLink) return;
    if (dailySendCap > 0 && sendsToday + totalEmails > dailySendCap) {
      setSendError(`Daily send limit reached (${sendsToday}/${dailySendCap} sent today). Wait until tomorrow or raise the limit in Account settings.`);
      return;
    }
    setSending(true); setSendError(''); setSendResult(null); setSendFailedEmails([]);
    try {
      const acc = emailAccounts.find(a => a.id === selectedAccountId);
      const outcome = await sendInBatches('/api/send', {
        trackTitle, driveLink, genres: selectedGenres,
        emailTemplate: useFollowUp ? demosFollowUpTemplate : demosTemplate,
        subjectTemplate: useFollowUp ? demosFollowUpSubject : demosSubject,
        senderName, signOff, signOffImage, minAudience, maxAudience, gender, artistType, minInstagram, maxInstagram,
        matchMode: demosMatchMode,
        sendDelay: sendDelay > 0 ? sendDelay : undefined,
        blacklist: blacklist.length > 0 ? blacklist : undefined,
        customContacts: customContacts.length > 0
          ? customContacts.map(c => ({ artistName: c.artistName, managerName: c.managerName, managerEmail: c.managerEmail }))
          : undefined,
        fromAccount: acc ? { ...acc, smtpPort: Number(acc.smtpPort) } : undefined,
      }, progress => setSendResult(progress));
      if (!outcome.ok) { setSendError(outcome.error); }
      else {
        const sentEmails = outcome.results.filter(r => r.success).map(r => r.to);
        const failed = outcome.results.filter(r => !r.success).map(r => r.to);
        setSendFailedEmails(failed);
        recordFailedEmails(failed);
        logCampaign('demos', trackTitle, sentEmails, selectedAccountId);
        if (sentEmails.length) addSendsToday(sentEmails.length, selectedAccountId);
      }
    } finally { setSending(false); }
  }

  const sortedArtists = useMemo(() => {
    const arr = [...previewArtists];
    switch (sortOrder) {
      case 'followers-desc': return arr.sort((a, b) => b.spotifyFollowers - a.spotifyFollowers);
      case 'followers-asc':  return arr.sort((a, b) => a.spotifyFollowers - b.spotifyFollowers);
      case 'alpha-asc':      return arr.sort((a, b) => a.name.localeCompare(b.name));
      case 'alpha-desc':     return arr.sort((a, b) => b.name.localeCompare(a.name));
      case 'random':         return arr.sort(() => Math.random() - 0.5);
    }
  }, [previewArtists, sortOrder]);

  const visibleArtists = useMemo(() => {
    const q = recipientSearch.trim().toLowerCase();
    if (!q) return sortedArtists;
    return sortedArtists.filter(a => a.name.toLowerCase().includes(q));
  }, [sortedArtists, recipientSearch]);

  const totalEmails = previewArtists.reduce((acc, a) => acc + a.managerEmails.length, 0) + customContacts.length;
  const canSend = !!trackTitle && !!driveLink && (selectedGenres.length > 0 || customContacts.length > 0) &&
    (previewDone || selectedGenres.length === 0);

  const demosDuplicateRecipients = useMemo(
    () => findDuplicateRecipients([...previewArtists.flatMap(a => a.managerEmails), ...customContacts.map(c => c.managerEmail)]),
    [previewArtists, customContacts, trackTitle, pitchedEmailMap]
  );

  const filteredRadioGenres = useMemo(() =>
    radioAllGenres.filter(g => g.toLowerCase().includes(radioGenreSearch.toLowerCase()) && !selectedRadioGenres.includes(g)).slice(0, 50),
    [radioAllGenres, radioGenreSearch, selectedRadioGenres]
  );

  const toggleRadioGenre = useCallback((genre: string) => {
    setSelectedRadioGenres(prev => prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]);
    setRadioPreviewDone(false); setRadioSendResult(null);
  }, []);

  const toggleLocation = useCallback((loc: string) => {
    setSelectedLocations(prev => prev.includes(loc) ? prev.filter(l => l !== loc) : [...prev, loc]);
    setRadioPreviewDone(false); setRadioSendResult(null);
  }, []);

  async function handleRadioPreview() {
    setRadioPreviewLoading(true); setRadioPreviewDone(false);
    try {
      const res = await fetch('/api/radio-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genres: selectedRadioGenres, locations: selectedLocations, matchMode: radioMatchMode }),
      });
      const data = await res.json();
      setRadioStations(data.stations || []);
      setRadioPreviewDone(true);
    } finally { setRadioPreviewLoading(false); }
  }

  async function handleRadioSend() {
    if (!trackTitle || !driveLink) return;
    if (dailySendCap > 0 && sendsToday + radioTotalEmails > dailySendCap) {
      setRadioSendError(`Daily send limit reached (${sendsToday}/${dailySendCap} sent today). Wait until tomorrow or raise the limit in Account settings.`);
      return;
    }
    setRadioSending(true); setRadioSendError(''); setRadioSendResult(null); setRadioSendFailedEmails([]);
    try {
      const acc = emailAccounts.find(a => a.id === selectedAccountId);
      const outcome = await sendInBatches('/api/radio-send', {
        trackTitle, driveLink, genres: selectedRadioGenres, locations: selectedLocations,
        emailTemplate: radioTemplate, subjectTemplate: radioSubject, senderName, signOff, signOffImage, matchMode: radioMatchMode,
        sendDelay: sendDelay > 0 ? sendDelay : undefined,
        blacklist: blacklist.length > 0 ? blacklist : undefined,
        fromAccount: acc ? { ...acc, smtpPort: Number(acc.smtpPort) } : undefined,
      }, progress => setRadioSendResult(progress));
      if (!outcome.ok) { setRadioSendError(outcome.error); }
      else {
        const sentEmails = outcome.results.filter(r => r.success).map(r => r.to);
        const failed = outcome.results.filter(r => !r.success).map(r => r.to);
        setRadioSendFailedEmails(failed);
        recordFailedEmails(failed);
        logCampaign('radio', trackTitle, sentEmails, selectedAccountId);
        if (sentEmails.length) addSendsToday(sentEmails.length, selectedAccountId);
      }
    } finally { setRadioSending(false); }
  }

  const radioTotalEmails = radioStations.reduce((acc, s) => acc + s.emails.length, 0);
  const canSendRadio = !!trackTitle && !!driveLink && radioPreviewDone;

  const radioDuplicateRecipients = useMemo(
    () => findDuplicateRecipients(radioStations.flatMap(s => s.emails)),
    [radioStations, trackTitle, pitchedEmailMap]
  );

  const selectedAccount = emailAccounts.find(a => a.id === selectedAccountId);

  const filteredPlaylistGenres = useMemo(() =>
    playlistAllGenres.filter(g => g.toLowerCase().includes(playlistGenreSearch.toLowerCase()) && !selectedPlaylistGenres.includes(g)).slice(0, 50),
    [playlistAllGenres, playlistGenreSearch, selectedPlaylistGenres]
  );

  const togglePlaylistGenre = useCallback((genre: string) => {
    setSelectedPlaylistGenres(prev => prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]);
    setPlaylistPreviewDone(false); setPlaylistSendResult(null);
  }, []);

  const togglePlatform = useCallback((platform: string) => {
    setSelectedPlatforms(prev => prev.includes(platform) ? prev.filter(p => p !== platform) : [...prev, platform]);
    setPlaylistPreviewDone(false); setPlaylistSendResult(null);
  }, []);

  async function handlePlaylistPreview() {
    setPlaylistPreviewLoading(true); setPlaylistPreviewDone(false);
    try {
      const res = await fetch('/api/playlist-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genres: selectedPlaylistGenres, platforms: selectedPlatforms, matchMode: playlistMatchMode }),
      });
      const data = await res.json();
      setPlaylistCurators(data.curators || []);
      setPlaylistPreviewDone(true);
    } finally { setPlaylistPreviewLoading(false); }
  }

  async function handlePlaylistSend() {
    if (!trackTitle || !driveLink) return;
    if (dailySendCap > 0 && sendsToday + playlistTotalEmails > dailySendCap) {
      setPlaylistSendError(`Daily send limit reached (${sendsToday}/${dailySendCap} sent today). Wait until tomorrow or raise the limit in Account settings.`);
      return;
    }
    setPlaylistSending(true); setPlaylistSendError(''); setPlaylistSendResult(null); setPlaylistSendFailedEmails([]);
    try {
      const acc = emailAccounts.find(a => a.id === selectedAccountId);
      const outcome = await sendInBatches('/api/playlist-send', {
        trackTitle, driveLink, genres: selectedPlaylistGenres, platforms: selectedPlatforms,
        emailTemplate: playlistTemplate, subjectTemplate: playlistSubject, senderName, signOff, signOffImage, matchMode: playlistMatchMode,
        sendDelay: sendDelay > 0 ? sendDelay : undefined,
        blacklist: blacklist.length > 0 ? blacklist : undefined,
        fromAccount: acc ? { ...acc, smtpPort: Number(acc.smtpPort) } : undefined,
      }, progress => setPlaylistSendResult(progress));
      if (!outcome.ok) { setPlaylistSendError(outcome.error); }
      else {
        const sentEmails = outcome.results.filter(r => r.success).map(r => r.to);
        const failed = outcome.results.filter(r => !r.success).map(r => r.to);
        setPlaylistSendFailedEmails(failed);
        recordFailedEmails(failed);
        logCampaign('playlists', trackTitle, sentEmails, selectedAccountId);
        if (sentEmails.length) addSendsToday(sentEmails.length, selectedAccountId);
      }
    } finally { setPlaylistSending(false); }
  }

  const playlistTotalEmails = playlistCurators.reduce((acc, c) => acc + c.emails.length, 0);
  const canSendPlaylist = !!trackTitle && !!driveLink && playlistPreviewDone;

  const playlistDuplicateRecipients = useMemo(
    () => findDuplicateRecipients(playlistCurators.flatMap(c => c.emails)),
    [playlistCurators, trackTitle, pitchedEmailMap]
  );

  // Build email preview modal entries
  type PreviewEntry = { label: string; to: string; subject: string; body: string };
  const previewModalEntries = useMemo((): PreviewEntry[] => {
    if (!previewModalType) return [];
    if (previewModalType === 'demos') {
      const entries: PreviewEntry[] = [];
      sortedArtists.slice(0, 20).forEach(a => {
        a.managerEmails.forEach((email, idx) => {
          const vars = { managerName: a.managerNames[idx] || 'there', artistName: a.name, trackTitle, driveLink, senderName, managementCompany: a.managementCompany };
          const tpl = useFollowUp ? demosFollowUpTemplate : demosTemplate;
          const subjectTpl = useFollowUp ? demosFollowUpSubject : demosSubject;
          const bodyParts = [renderTemplateClient(tpl, vars)];
          if (signOff?.trim()) bodyParts.push(renderTemplateClient(signOff, vars));
          entries.push({
            label: `${a.name}${a.managerNames[idx] ? ` (${a.managerNames[idx]})` : ''} <${email}>`,
            to: email,
            subject: renderTemplateClient(subjectTpl, vars),
            body: bodyParts.join('\n\n'),
          });
        });
      });
      customContacts.forEach(cc => {
        const vars = { managerName: cc.managerName || 'there', artistName: cc.artistName, trackTitle, driveLink, senderName, managementCompany: '' };
        const tpl = useFollowUp ? demosFollowUpTemplate : demosTemplate;
        const subjectTpl = useFollowUp ? demosFollowUpSubject : demosSubject;
        const bodyParts = [renderTemplateClient(tpl, vars)];
        if (signOff?.trim()) bodyParts.push(renderTemplateClient(signOff, vars));
        entries.push({
          label: `${cc.artistName}${cc.managerName ? ` (${cc.managerName})` : ''} <${cc.managerEmail}> [Custom]`,
          to: cc.managerEmail,
          subject: renderTemplateClient(subjectTpl, vars),
          body: bodyParts.join('\n\n'),
        });
      });
      return entries;
    }
    if (previewModalType === 'playlists') {
      const entries: PreviewEntry[] = [];
      playlistCurators.slice(0, 20).forEach(c => {
        c.emails.forEach(email => {
          const vars = { curatorName: c.name, trackTitle, driveLink, senderName };
          const bodyParts = [renderTemplateClient(playlistTemplate, vars)];
          if (signOff?.trim()) bodyParts.push(renderTemplateClient(signOff, vars));
          entries.push({
            label: `${c.name} <${email}>`,
            to: email,
            subject: renderTemplateClient(playlistSubject, vars),
            body: bodyParts.join('\n\n'),
          });
        });
      });
      return entries;
    }
    const entries: PreviewEntry[] = [];
    radioStations.slice(0, 20).forEach(s => {
      s.emails.forEach(email => {
        const vars = { stationName: s.name, trackTitle, driveLink, senderName };
        const bodyParts = [renderTemplateClient(radioTemplate, vars)];
        if (signOff?.trim()) bodyParts.push(renderTemplateClient(signOff, vars));
        entries.push({
          label: `${s.name} <${email}>`,
          to: email,
          subject: renderTemplateClient(radioSubject, vars),
          body: bodyParts.join('\n\n'),
        });
      });
    });
    return entries;
  }, [previewModalType, sortedArtists, radioStations, playlistCurators, demosTemplate, demosSubject, demosFollowUpTemplate, demosFollowUpSubject, useFollowUp, radioTemplate, radioSubject, playlistTemplate, playlistSubject, signOff, trackTitle, driveLink, senderName, customContacts]);

  const NAV_ITEMS = [
    {
      id: 'overview' as const,
      label: 'Overview',
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18"/>
          <path d="M7 16l4-6 3 3 5-7"/>
        </svg>
      ),
    },
    {
      id: 'campaigns' as const,
      label: 'Campaigns',
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <circle cx="12" cy="12" r="5"/>
          <circle cx="12" cy="12" r="1"/>
        </svg>
      ),
    },
    {
      id: 'demos' as const,
      label: 'Song Demos',
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13"/>
          <circle cx="6" cy="18" r="3"/>
          <circle cx="18" cy="16" r="3"/>
        </svg>
      ),
    },
    {
      id: 'promotion' as const,
      label: 'Track Promotion',
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/>
        </svg>
      ),
    },
    {
      id: 'history' as const,
      label: 'History',
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <polyline points="12 7 12 12 15 15"/>
        </svg>
      ),
    },
    {
      id: 'account' as const,
      label: 'Account',
      icon: (
        <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4"/>
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
        </svg>
      ),
    },
  ] as const;

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between shrink-0">
        <h1 className="text-lg font-bold tracking-tight text-white">TrackPitch</h1>
        <a href="/api/logout" className="text-sm text-zinc-400 hover:text-white transition">Log out</a>
      </header>

      {/* Mobile nav */}
      <div className="md:hidden border-b border-zinc-800 bg-zinc-950 px-2 py-2 flex gap-1 overflow-x-auto">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => {
              if (item.id === 'campaigns') { router.push('/dashboard/campaigns'); return; }
              setActiveSection(item.id);
            }}
            className={`shrink-0 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition ${
              activeSection === item.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Desktop sidebar */}
        <nav className="hidden md:flex flex-col w-52 shrink-0 border-r border-zinc-800 p-3 gap-1">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => {
                if (item.id === 'campaigns') { router.push('/dashboard/campaigns'); return; }
                setActiveSection(item.id);
              }}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition text-left w-full ${
                activeSection === item.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-4 py-5 md:px-8 md:py-10 space-y-5 md:space-y-6">

            {/* ── Overview ── */}
            {activeSection === 'overview' && (
              <div className="space-y-5 pb-6">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Overview</h2>
                  <p className="text-xs text-zinc-500">All-time stats derived from your campaign history on this device.</p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                    <p className="text-2xl font-bold text-white">{analyticsStats.totalEmailsSent}</p>
                    <p className="text-xs text-zinc-500 mt-1">Emails sent</p>
                  </div>
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                    <p className="text-2xl font-bold text-white">{analyticsStats.totalCampaigns}</p>
                    <p className="text-xs text-zinc-500 mt-1">Campaigns</p>
                  </div>
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                    <p className="text-2xl font-bold text-violet-400">{analyticsStats.demosEmailsSent}</p>
                    <p className="text-xs text-zinc-500 mt-1">Via Song Demos ({analyticsStats.demosCampaignCount})</p>
                  </div>
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                    <p className="text-2xl font-bold text-sky-400">{analyticsStats.radioEmailsSent}</p>
                    <p className="text-xs text-zinc-500 mt-1">Via Track Promotion ({analyticsStats.radioCampaignCount})</p>
                  </div>
                  <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                    <p className="text-2xl font-bold text-emerald-400">{analyticsStats.playlistEmailsSent}</p>
                    <p className="text-xs text-zinc-500 mt-1">Via Playlist Curators ({analyticsStats.playlistCampaignCount})</p>
                  </div>
                </div>

                {analyticsStats.totalCampaigns === 0 ? (
                  <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 flex flex-col items-center justify-center gap-2 text-center">
                    <p className="text-sm font-semibold text-zinc-300">No activity yet</p>
                    <p className="text-xs text-zinc-500">Send your first campaign to see stats here.</p>
                  </section>
                ) : (
                  <>
                    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-3">
                      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Sends, last 14 days</h3>
                      <div className="flex items-end gap-1.5 h-24">
                        {analyticsStats.last14Days.map(d => (
                          <div key={d.date} className="flex-1 flex flex-col items-center justify-end gap-1 group relative">
                            <div
                              className={`w-full rounded-t transition-colors ${d.count > 0 ? 'bg-violet-600 group-hover:bg-violet-500' : 'bg-zinc-800'}`}
                              style={{ height: `${Math.max(2, (d.count / analyticsStats.maxDayCount) * 100)}%` }}
                              title={`${new Date(d.date).toLocaleDateString()}: ${d.count} sent`}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between text-[10px] text-zinc-600">
                        <span>{new Date(analyticsStats.last14Days[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                        <span>{new Date(analyticsStats.last14Days[13].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                      </div>
                    </section>

                    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-2">
                      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">Top pitched tracks</h3>
                      {analyticsStats.topTracks.map(([title, count]) => (
                        <div key={title} className="flex items-center justify-between text-sm">
                          <span className="text-zinc-300 truncate">{title}</span>
                          <span className="text-zinc-500 font-mono text-xs shrink-0 ml-3">{count} recipient{count !== 1 ? 's' : ''}</span>
                        </div>
                      ))}
                    </section>

                    {analyticsStats.lastCampaignDate && (
                      <p className="text-xs text-zinc-600">Last campaign: {new Date(analyticsStats.lastCampaignDate).toLocaleString()}</p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Song Demos ── */}
            {activeSection === 'demos' && (
              <>
                <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 w-fit border border-zinc-800">
                  {(['compose', 'template'] as const).map(t => (
                    <button key={t} onClick={() => setDemosTab(t)}
                      className={`px-3 py-1.5 rounded-md text-xs md:text-sm font-medium transition ${demosTab === t ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
                      {t === 'compose' ? 'Compose Pitch' : 'Email Template'}
                    </button>
                  ))}
                </div>

                {demosTab === 'template' && (
                  <div className="space-y-6">
                    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                      <div>
                        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Main Template</h2>
                        <p className="text-sm text-zinc-500 mb-2">Click a variable to copy it:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {['{{managerName}}', '{{artistName}}', '{{trackTitle}}', '{{driveLink}}', '{{senderName}}', '{{managementCompany}}'].map(v => (
                            <CopyChip key={v} value={v} />
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Subject line</label>
                        <input type="text" value={demosSubject} onChange={e => setDemosSubject(e.target.value)}
                          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
                      </div>
                      <textarea value={demosTemplate} onChange={e => setDemosTemplate(e.target.value)} rows={14}
                        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-y" />
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <button onClick={() => { setDemosTemplate(DEFAULT_DEMOS_TEMPLATE); setDemosSubject(DEFAULT_DEMOS_SUBJECT); }} className="text-xs text-zinc-500 hover:text-zinc-300 transition">
                          Reset to default
                        </button>
                        <SpamScoreBadge template={demosTemplate} />
                      </div>
                      <div className="pt-3 border-t border-zinc-800 space-y-3">
                        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Saved Templates</h3>
                        {demosTemplateLibrary.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {demosTemplateLibrary.map(t => (
                              <div key={t.id} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1">
                                <button onClick={() => loadDemosTemplateFromLibrary(t)} className="text-xs text-zinc-200 hover:text-violet-400 transition">{t.name}</button>
                                <button onClick={() => deleteDemosTemplateFromLibrary(t.id)} className="text-zinc-600 hover:text-red-400 transition text-sm leading-none px-1">×</button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <input value={newDemosTemplateName} onChange={e => setNewDemosTemplateName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveDemosTemplateToLibrary(); }}
                            placeholder="Name this template (e.g. Casual Tone)"
                            className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                          <button onClick={saveDemosTemplateToLibrary} disabled={!newDemosTemplateName.trim()}
                            className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition shrink-0">
                            Save Current
                          </button>
                        </div>
                      </div>
                    </section>

                    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                      <div>
                        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Follow-up Template</h2>
                        <p className="text-xs text-zinc-500 mb-2">Used when the follow-up toggle is enabled on the Compose tab. Click a variable to copy it:</p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {['{{managerName}}', '{{artistName}}', '{{trackTitle}}', '{{driveLink}}', '{{senderName}}'].map(v => (
                          <CopyChip key={v} value={v} />
                        ))}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-zinc-400 mb-1.5">Subject line</label>
                        <input type="text" value={demosFollowUpSubject} onChange={e => setDemosFollowUpSubject(e.target.value)}
                          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
                      </div>
                      <textarea value={demosFollowUpTemplate} onChange={e => setDemosFollowUpTemplate(e.target.value)} rows={12}
                        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-y" />
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <button onClick={() => { setDemosFollowUpTemplate(DEFAULT_FOLLOWUP_TEMPLATE); setDemosFollowUpSubject(DEFAULT_FOLLOWUP_SUBJECT); }} className="text-xs text-zinc-500 hover:text-zinc-300 transition">
                          Reset to default
                        </button>
                        <SpamScoreBadge template={demosFollowUpTemplate} />
                      </div>
                      <div className="pt-3 border-t border-zinc-800 space-y-3">
                        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Saved Templates</h3>
                        {followUpTemplateLibrary.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {followUpTemplateLibrary.map(t => (
                              <div key={t.id} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1">
                                <button onClick={() => loadFollowUpTemplateFromLibrary(t)} className="text-xs text-zinc-200 hover:text-violet-400 transition">{t.name}</button>
                                <button onClick={() => deleteFollowUpTemplateFromLibrary(t.id)} className="text-zinc-600 hover:text-red-400 transition text-sm leading-none px-1">×</button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <input value={newFollowUpTemplateName} onChange={e => setNewFollowUpTemplateName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveFollowUpTemplateToLibrary(); }}
                            placeholder="Name this template (e.g. Second Nudge)"
                            className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                          <button onClick={saveFollowUpTemplateToLibrary} disabled={!newFollowUpTemplateName.trim()}
                            className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition shrink-0">
                            Save Current
                          </button>
                        </div>
                      </div>
                    </section>
                  </div>
                )}

                {demosTab === 'compose' && (<>
                  {/* Track Info */}
                  <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                    <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Track Details</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-1.5">Your Name</label>
                        <input type="text" value={senderName} onChange={e => setSenderName(e.target.value)}
                          placeholder="Eren Senbay"
                          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-zinc-300 mb-1.5">Track Title</label>
                        <input type="text" value={trackTitle} onChange={e => setTrackTitle(e.target.value)}
                          placeholder="e.g. Give Me A Sign"
                          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
                        {demosPitchCount > 0 && (
                          <p className="text-xs text-amber-400 mt-1.5">Already pitched to {demosPitchCount} recipient{demosPitchCount !== 1 ? 's' : ''} for this track.</p>
                        )}
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-zinc-300 mb-1.5">Google Drive Link</label>
                        <input type="url" value={driveLink} onChange={e => setDriveLink(e.target.value)}
                          placeholder="https://drive.google.com/file/d/..."
                          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
                      </div>
                    </div>
                  </section>

                  {/* Saved Filter Presets */}
                  <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-3">
                    <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Saved Filters</h2>
                    {demosPresets.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {demosPresets.map(p => (
                          <div key={p.id} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1">
                            <button onClick={() => loadDemosPreset(p)} className="text-xs text-zinc-200 hover:text-violet-400 transition">{p.name}</button>
                            <button onClick={() => deleteDemosPreset(p.id)} className="text-zinc-600 hover:text-red-400 transition text-sm leading-none px-1">×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input value={newDemosPresetName} onChange={e => setNewDemosPresetName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveDemosPreset(); }}
                        placeholder="Name this filter set (e.g. Indie Pop Campaigns)"
                        className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                      <button onClick={saveDemosPreset} disabled={!newDemosPresetName.trim()}
                        className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition shrink-0">
                        Save Current
                      </button>
                    </div>
                  </section>

                  {/* Genre Selector */}
                  <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Select Genres</h2>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-zinc-500">Match:</span>
                        {(['any', 'all'] as const).map(mode => (
                          <button key={mode} onClick={() => { setDemosMatchMode(mode); setPreviewDone(false); setSendResult(null); }}
                            className={`px-3 py-1 rounded-full text-xs font-medium border transition ${demosMatchMode === mode ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                            {mode === 'any' ? 'Any genre' : 'All genres'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="text-sm text-zinc-500">
                      {demosMatchMode === 'any' ? 'Artists tagged with at least one of the selected genres.' : 'Artists tagged with every selected genre.'}
                    </p>
                    {selectedGenres.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {selectedGenres.map(g => (
                          <button key={g} onClick={() => toggleGenre(g)}
                            className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium px-3 py-1 rounded-full transition">
                            {g}<span className="text-violet-200">×</span>
                          </button>
                        ))}
                        <button onClick={() => { setSelectedGenres([]); setPreviewDone(false); setSendResult(null); }}
                          className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 transition">Clear all</button>
                      </div>
                    )}
                    <div className="relative">
                      <input type="text" value={genreSearch} onChange={e => setGenreSearch(e.target.value)}
                        onFocus={() => setShowGenreDropdown(true)}
                        onBlur={() => setTimeout(() => setShowGenreDropdown(false), 150)}
                        placeholder="Search genres (e.g. Pop, R&B, Hip Hop...)"
                        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
                      {showGenreDropdown && genreSearch.trim() === '' && topGenres.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                          <p className="px-4 pt-2 pb-1 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Most popular genres</p>
                          {topGenres.filter(g => !selectedGenres.includes(g)).map(g => (
                            <button key={g} onMouseDown={() => { toggleGenre(g); setGenreSearch(''); }}
                              className="w-full text-left px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700 transition">{g}</button>
                          ))}
                        </div>
                      )}
                      {showGenreDropdown && genreSearch.trim() !== '' && filteredGenres.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                          {filteredGenres.map(g => (
                            <button key={g} onMouseDown={() => { toggleGenre(g); setGenreSearch(''); }}
                              className="w-full text-left px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700 transition">{g}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Filters */}
                  <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-5">
                    <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Filters</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-zinc-400">Min Spotify followers</p>
                        <div className="flex flex-wrap gap-1.5">
                          {FOLLOWER_STEPS.map(opt => (
                            <button key={`min-sp-${opt.value}`} onClick={() => { setMinAudience(opt.value); resetFilters(); }}
                              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${minAudience === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-zinc-400">Max Spotify followers</p>
                        <div className="flex flex-wrap gap-1.5">
                          {FOLLOWER_STEPS.map(opt => (
                            <button key={`max-sp-${opt.value}`} onClick={() => { setMaxAudience(opt.value); resetFilters(); }}
                              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${maxAudience === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="md:col-span-2 space-y-3">
                        <button onClick={() => setShowInstagram(p => !p)}
                          className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition">
                          <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 fill-none stroke-current stroke-2 transition-transform ${showInstagram ? 'rotate-180' : ''}`} strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                          Instagram followers
                          {(minInstagram > 0 || maxInstagram > 0) && !showInstagram && (
                            <span className="text-violet-400">
                              {minInstagram > 0 && maxInstagram > 0
                                ? `${minInstagram >= 1_000_000 ? `${(minInstagram/1_000_000).toFixed(1)}M` : `${Math.round(minInstagram/1_000)}K`} – ${maxInstagram >= 1_000_000 ? `${(maxInstagram/1_000_000).toFixed(1)}M` : `${Math.round(maxInstagram/1_000)}K`}`
                                : minInstagram > 0
                                ? `min ${minInstagram >= 1_000_000 ? `${(minInstagram/1_000_000).toFixed(1)}M` : `${Math.round(minInstagram/1_000)}K`}`
                                : `max ${maxInstagram >= 1_000_000 ? `${(maxInstagram/1_000_000).toFixed(1)}M` : `${Math.round(maxInstagram/1_000)}K`}`}
                            </span>
                          )}
                        </button>
                        {showInstagram && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-1">
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-zinc-400">Min</p>
                              <div className="flex flex-wrap gap-1.5">
                                {FOLLOWER_STEPS.map(opt => (
                                  <button key={`min-ig-${opt.value}`} onClick={() => { setMinInstagram(opt.value); resetFilters(); }}
                                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${minInstagram === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-zinc-400">Max</p>
                              <div className="flex flex-wrap gap-1.5">
                                {FOLLOWER_STEPS.map(opt => (
                                  <button key={`max-ig-${opt.value}`} onClick={() => { setMaxInstagram(opt.value); resetFilters(); }}
                                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${maxInstagram === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-zinc-400">Artist gender</p>
                        <div className="flex flex-wrap gap-1.5">
                          {GENDER_OPTIONS.map(opt => (
                            <button key={`gender-${opt.value}`} onClick={() => { setGender(opt.value); resetFilters(); }}
                              className={`px-3 py-1 rounded-full text-xs font-medium border transition ${gender === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-zinc-400">Artist type</p>
                        <div className="flex flex-wrap gap-1.5">
                          {ARTIST_TYPE_OPTIONS.map(opt => (
                            <button key={`type-${opt.value}`} onClick={() => { setArtistType(opt.value); resetFilters(); }}
                              className={`px-3 py-1 rounded-full text-xs font-medium border transition ${artistType === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Custom Contacts */}
                  <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Custom Contacts</h2>
                        <p className="text-xs text-zinc-500 mt-0.5">Add contacts outside the database — always included in sends.</p>
                      </div>
                      {customContacts.length > 0 && (
                        <span className="text-xs text-zinc-500">{customContacts.length} contact{customContacts.length !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                    {customContacts.length > 0 && (
                      <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-lg overflow-hidden">
                        {customContacts.map(c => (
                          <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <div className="min-w-0">
                              <p className="text-sm text-white font-medium">{c.artistName}</p>
                              <p className="text-xs text-zinc-500">{c.managerName ? `${c.managerName} · ` : ''}{c.managerEmail}</p>
                            </div>
                            <button onClick={() => removeCustomContact(c.id)}
                              className="text-zinc-600 hover:text-red-400 transition text-lg leading-none shrink-0">×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {showAddCustomContact ? (
                      <div className="border border-zinc-700 rounded-xl p-4 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-zinc-400 mb-1">Artist / Project Name *</label>
                            <input value={newCustomContact.artistName} onChange={e => setNewCustomContact(p => ({ ...p, artistName: e.target.value }))}
                              placeholder="Artist name"
                              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                          </div>
                          <div>
                            <label className="block text-xs text-zinc-400 mb-1">Manager Name</label>
                            <input value={newCustomContact.managerName} onChange={e => setNewCustomContact(p => ({ ...p, managerName: e.target.value }))}
                              placeholder="Manager name (optional)"
                              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-xs text-zinc-400 mb-1">Email Address *</label>
                            <input type="email" value={newCustomContact.managerEmail} onChange={e => setNewCustomContact(p => ({ ...p, managerEmail: e.target.value }))}
                              placeholder="contact@example.com"
                              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                          </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button onClick={addCustomContact} disabled={!newCustomContact.artistName || !newCustomContact.managerEmail}
                            className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition">
                            Add Contact
                          </button>
                          <button onClick={() => { setShowAddCustomContact(false); setNewCustomContact({ artistName: '', managerName: '', managerEmail: '' }); }}
                            className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 text-sm text-zinc-300 transition">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-3">
                        <button onClick={() => setShowAddCustomContact(true)} className="text-sm text-violet-400 hover:text-violet-300 transition">
                          + Add custom contact
                        </button>
                        <label className="text-sm text-zinc-400 hover:text-zinc-200 transition cursor-pointer">
                          Import CSV
                          <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleCustomContactsCsv} />
                        </label>
                        <span className="text-xs text-zinc-600">Columns: Artist, Manager (optional), Email</span>
                      </div>
                    )}
                  </section>

                  {/* Preview */}
                  <div className="flex flex-wrap items-center gap-3">
                    <button onClick={() => handlePreview()} disabled={!selectedGenres.length || previewLoading}
                      className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-5 py-2.5 text-sm font-semibold text-white transition">
                      {previewLoading ? 'Loading...' : 'Preview Recipients'}
                    </button>
                    {(previewDone || customContacts.length > 0) && (
                      <button
                        onClick={() => { setPreviewModalType('demos'); setPreviewModalIdx(0); }}
                        className="rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition">
                        Preview Email
                      </button>
                    )}
                    {previewDone && (
                      <span className="text-sm text-zinc-400">{previewArtists.length} artists · {totalEmails} emails</span>
                    )}
                    {!previewDone && customContacts.length > 0 && (
                      <span className="text-sm text-zinc-400">{customContacts.length} custom contact{customContacts.length !== 1 ? 's' : ''}</span>
                    )}
                  </div>

                  {previewDone && previewArtists.length > 0 && (
                    <section className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                      <div className="px-4 md:px-6 py-3 md:py-4 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-zinc-300">Recipients Preview <span className="text-zinc-500 font-normal">· {visibleArtists.length}{visibleArtists.length !== previewArtists.length ? ` of ${previewArtists.length}` : ''} artists</span></h3>
                        <div className="flex items-center gap-2">
                          <input type="text" value={recipientSearch} onChange={e => setRecipientSearch(e.target.value)}
                            placeholder="Search artist..."
                            className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 placeholder-zinc-500 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition w-36 sm:w-48" />
                          <select value={sortOrder} onChange={e => setSortOrder(e.target.value as typeof sortOrder)}
                            className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500">
                            <option value="followers-desc">Followers: High → Low</option>
                            <option value="followers-asc">Followers: Low → High</option>
                            <option value="alpha-asc">A → Z</option>
                            <option value="alpha-desc">Z → A</option>
                            <option value="random">Random</option>
                          </select>
                        </div>
                      </div>
                      {visibleArtists.length === 0 && (
                        <div className="px-4 md:px-6 py-4 space-y-3">
                          <p className="text-sm text-zinc-500">No artists match &ldquo;{recipientSearch}&rdquo; in your current filters.</p>
                          {outsideResultsQuery === recipientSearch.trim() && outsideResults.length > 0 ? (
                            <div className="border border-zinc-800 rounded-lg overflow-hidden divide-y divide-zinc-800">
                              {outsideResults.map(a => {
                                const pitchedTracks = a.managerEmails.flatMap(email => pitchedEmailMap.get(email.toLowerCase()) ?? []);
                                const uniquePitched = [...new Set(pitchedTracks)];
                                const alreadyAdded = a.managerEmails.every(e => customContacts.some(c => c.managerEmail.toLowerCase() === e.toLowerCase()));
                                return (
                                  <div key={a.name} className="px-3 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <div className="shrink-0 w-9 h-9 rounded-full overflow-hidden bg-zinc-700">
                                        {a.avatarUrl ? (
                                          <img src={a.avatarUrl} alt={a.name} width={36} height={36} className="w-full h-full object-cover" />
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center text-zinc-500 text-xs font-bold">{a.name.charAt(0)}</div>
                                        )}
                                      </div>
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                                          <p className="text-sm font-medium text-white">{a.name}</p>
                                          {uniquePitched.length > 0 && <PitchedBadge tracks={uniquePitched} />}
                                          {a.instagramHandle && (
                                            <a href={`https://instagram.com/${a.instagramHandle.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                                              onClick={e => e.stopPropagation()}
                                              className="inline-flex items-center bg-zinc-800 hover:bg-zinc-700 text-pink-400 p-1 rounded transition">
                                              <svg viewBox="0 0 24 24" className="w-3 h-3 fill-pink-400 shrink-0"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.012-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.058 1.645-.07 4.849-.07zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.98-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.198-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                                            </a>
                                          )}
                                          {a.spotifyFollowers > 0 && (
                                            <a href={spotifyArtistSearchUrl(a.name)} target="_blank" rel="noopener noreferrer"
                                              onClick={e => e.stopPropagation()}
                                              className="inline-flex items-center gap-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-green-400 px-1.5 py-0.5 rounded font-medium transition">
                                              <svg viewBox="0 0 24 24" className="w-3 h-3 fill-green-400 shrink-0"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
                                              {a.spotifyFollowers >= 1_000_000 ? `${(a.spotifyFollowers / 1_000_000).toFixed(1)}M` : `${Math.round(a.spotifyFollowers / 1_000)}K`}
                                            </a>
                                          )}
                                        </div>
                                        <p className="text-xs text-zinc-500 mt-0.5">{a.managementCompany || 'Independent'}</p>
                                      </div>
                                    </div>
                                    <div className="pl-[46px] sm:pl-0 flex items-center gap-2.5 sm:shrink-0">
                                      <div className="sm:text-right space-y-0.5 min-w-0">
                                        {a.managerEmails.map((email, i) => (
                                          <p key={email} className="text-xs text-violet-400 break-all sm:break-normal">
                                            {a.managerNames[i] ? `${a.managerNames[i]} — ` : ''}{email}
                                          </p>
                                        ))}
                                      </div>
                                      <button onClick={() => addOutsideArtistToContacts(a)} disabled={alreadyAdded}
                                        className="shrink-0 text-xs rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:hover:bg-violet-600 px-2.5 py-1.5 font-medium text-white transition">
                                        {alreadyAdded ? 'Added' : 'Add'}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : outsideResultsQuery === recipientSearch.trim() ? (
                            <p className="text-xs text-zinc-500">No matches found outside your filters either.</p>
                          ) : (
                            <button onClick={() => handleOutsideSearch(recipientSearch)} disabled={outsideSearchLoading || !recipientSearch.trim()}
                              className="text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-40 px-3 py-1.5 font-medium text-zinc-300 transition">
                              {outsideSearchLoading ? 'Searching...' : 'Show results outside your filters'}
                            </button>
                          )}
                        </div>
                      )}
                      <div className="divide-y divide-zinc-800 max-h-[32rem] overflow-y-auto">
                        {visibleArtists.map(a => {
                          const pitchedTracks = a.managerEmails.flatMap(email => pitchedEmailMap.get(email.toLowerCase()) ?? []);
                          const uniquePitched = [...new Set(pitchedTracks)];
                          return (
                            <div key={a.name} className="px-4 md:px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="shrink-0 w-10 h-10 rounded-full overflow-hidden bg-zinc-700">
                                  {a.avatarUrl ? (
                                    <img src={a.avatarUrl} alt={a.name} width={40} height={40} className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-zinc-500 text-xs font-bold">{a.name.charAt(0)}</div>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <p className="text-sm font-medium text-white">{a.name}</p>
                                    {uniquePitched.length > 0 && <PitchedBadge tracks={uniquePitched} />}
                                    {a.instagramHandle && (
                                      <a href={`https://instagram.com/${a.instagramHandle.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                                        onClick={e => e.stopPropagation()}
                                        className="inline-flex items-center gap-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-pink-400 px-1.5 py-0.5 rounded font-medium transition">
                                        <svg viewBox="0 0 24 24" className="w-3 h-3 fill-pink-400 shrink-0"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.012-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.058 1.645-.07 4.849-.07zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.98-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.198-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                                        {a.instagramHandle}
                                      </a>
                                    )}
                                    {a.spotifyFollowers > 0 && (
                                      <a href={spotifyArtistSearchUrl(a.name)} target="_blank" rel="noopener noreferrer"
                                        onClick={e => e.stopPropagation()}
                                        className="inline-flex items-center gap-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-green-400 px-1.5 py-0.5 rounded font-medium transition">
                                        <svg viewBox="0 0 24 24" className="w-3 h-3 fill-green-400 shrink-0"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
                                        {a.spotifyFollowers >= 1_000_000 ? `${(a.spotifyFollowers / 1_000_000).toFixed(1)}M` : `${Math.round(a.spotifyFollowers / 1_000)}K`}
                                      </a>
                                    )}
                                  </div>
                                  <p className="text-xs text-zinc-500 mt-0.5">{a.managementCompany || 'Independent'}</p>
                                  {a.genres.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {a.genres.map(g => {
                                        const active = selectedGenres.includes(g);
                                        return (
                                          <button
                                            key={g}
                                            onClick={() => toggleGenreFromPreview(g)}
                                            title={active ? `Remove "${g}" from genre filters and refresh` : `Add "${g}" to genre filters and refresh`}
                                            className={`text-[11px] px-2 py-0.5 rounded-full font-medium transition ${
                                              active
                                                ? 'bg-violet-600/20 text-violet-300 border border-violet-600/30 hover:bg-violet-600/30 hover:border-violet-500'
                                                : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-violet-500 hover:text-violet-300'
                                            }`}
                                          >
                                            {g}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="pl-[52px] sm:pl-0 sm:text-right sm:shrink-0 space-y-0.5">
                                {a.managerEmails.map((email, i) => (
                                  <p key={email} className="text-xs text-violet-400 break-all sm:break-normal">
                                    {a.managerNames[i] ? `${a.managerNames[i]} — ` : ''}{email}
                                  </p>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {previewDone && previewArtists.length === 0 && !customContacts.length && (
                    <p className="text-sm text-zinc-500">No artists with manager emails found for the selected genres.</p>
                  )}

                  {/* Custom contacts in preview */}
                  {customContacts.length > 0 && (
                    <section className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                      <div className="px-4 md:px-6 py-3 border-b border-zinc-800">
                        <h3 className="text-sm font-semibold text-zinc-300">Custom Contacts <span className="text-zinc-500 font-normal">· {customContacts.length}</span></h3>
                      </div>
                      <div className="divide-y divide-zinc-800">
                        {customContacts.map(c => {
                          const pitchedTracks = pitchedEmailMap.get(c.managerEmail.toLowerCase()) ?? [];
                          return (
                            <div key={c.id} className="px-4 md:px-6 py-3 flex items-center justify-between gap-4">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <p className="text-sm font-medium text-white">{c.artistName}</p>
                                  <span className="text-xs bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded">Custom</span>
                                  {pitchedTracks.length > 0 && <PitchedBadge tracks={pitchedTracks} />}
                                </div>
                                {c.managerName && <p className="text-xs text-zinc-500 mt-0.5">{c.managerName}</p>}
                              </div>
                              <p className="text-xs text-violet-400 text-right shrink-0">{c.managerEmail}</p>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {!sendResult && demosDuplicateRecipients.length > 0 && (
                    <div className="rounded-lg bg-amber-900/20 border border-amber-700/40 px-5 py-3">
                      <p className="text-amber-400 text-sm">
                        {demosDuplicateRecipients.length} recipient{demosDuplicateRecipients.length !== 1 ? 's have' : ' has'} already been pitched &ldquo;{trackTitle}&rdquo; before (via Song Demos or Track Promotion). You can still send.
                      </p>
                    </div>
                  )}

                  {sendResult && (
                    <div className="rounded-lg bg-green-900/30 border border-green-700 px-5 py-4 space-y-2">
                      <p className="text-green-400 font-semibold">
                        Sent {sendResult.sent} of {sendResult.total} emails successfully.
                        {sendResult.failed > 0 && ` ${sendResult.failed} failed.`}
                      </p>
                      {sendFailedEmails.length > 0 && (
                        <button onClick={() => { addFailedToBlacklist(sendFailedEmails); setSendFailedEmails([]); }}
                          className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded-lg text-zinc-300 transition">
                          Add {sendFailedEmails.length} failed address{sendFailedEmails.length !== 1 ? 'es' : ''} to blacklist
                        </button>
                      )}
                    </div>
                  )}
                  {sendError && (
                    <div className="rounded-lg bg-red-900/30 border border-red-700 px-5 py-4">
                      <p className="text-red-400 text-sm">{sendError}</p>
                    </div>
                  )}

                  <div className="space-y-3 pb-6">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <div
                          onClick={() => setUseFollowUp(p => !p)}
                          className={`relative w-9 h-5 rounded-full transition ${useFollowUp ? 'bg-violet-600' : 'bg-zinc-700'}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${useFollowUp ? 'translate-x-4' : 'translate-x-0'}`} />
                        </div>
                        <span className="text-sm text-zinc-300">Send as follow-up</span>
                      </label>
                      {useFollowUp && (
                        <span className="text-xs text-amber-400 bg-amber-600/15 border border-amber-600/30 px-2 py-0.5 rounded-full">Using follow-up template</span>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <button onClick={handleSend} disabled={!canSend || sending}
                        className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-6 py-3 font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-zinc-950 text-sm">
                        {sending ? `Sending... (${(sendResult?.sent ?? 0) + (sendResult?.failed ?? 0)}/${totalEmails})` : canSend ? `Send to ${totalEmails} recipient${totalEmails !== 1 ? 's' : ''}` : 'Preview recipients first'}
                      </button>
                      {selectedAccount ? (
                        <span className="text-xs text-zinc-500">From <span className="text-zinc-300">{selectedAccount.name}</span> ({selectedAccount.email || selectedAccount.smtpUser})</span>
                      ) : (
                        <span className="text-xs text-amber-500">No email account — <button onClick={() => setActiveSection('account')} className="underline hover:text-amber-400">add one</button></span>
                      )}
                    </div>
                  </div>
                </>)}
              </>
            )}

            {/* ── Track Promotion ── */}
            {activeSection === 'promotion' && (
              <>
                <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 w-fit border border-zinc-800">
                  {(['compose', 'template'] as const).map(t => (
                    <button key={t} onClick={() => setPromotionTab(t)}
                      className={`px-3 py-1.5 rounded-md text-xs md:text-sm font-medium transition ${promotionTab === t ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
                      {t === 'compose' ? 'Compose Pitch' : 'Email Template'}
                    </button>
                  ))}
                </div>

                {promotionTab === 'template' && promotionSection === 'radio' && (
                  <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Radio Email Template</h2>
                      <p className="text-sm text-zinc-500 mb-2">Click a variable to copy it:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {['{{stationName}}', '{{trackTitle}}', '{{driveLink}}', '{{senderName}}'].map(v => (
                          <CopyChip key={v} value={v} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Subject line</label>
                      <input type="text" value={radioSubject} onChange={e => setRadioSubject(e.target.value)}
                        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
                    </div>
                    <textarea value={radioTemplate} onChange={e => setRadioTemplate(e.target.value)} rows={16}
                      className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-y" />
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <button onClick={() => { setRadioTemplate(DEFAULT_RADIO_TEMPLATE); setRadioSubject(DEFAULT_RADIO_SUBJECT); }} className="text-xs text-zinc-500 hover:text-zinc-300 transition">
                        Reset to default
                      </button>
                      <SpamScoreBadge template={radioTemplate} />
                    </div>
                    <div className="pt-3 border-t border-zinc-800 space-y-3">
                      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Saved Templates</h3>
                      {radioTemplateLibrary.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {radioTemplateLibrary.map(t => (
                            <div key={t.id} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1">
                              <button onClick={() => loadRadioTemplateFromLibrary(t)} className="text-xs text-zinc-200 hover:text-violet-400 transition">{t.name}</button>
                              <button onClick={() => deleteRadioTemplateFromLibrary(t.id)} className="text-zinc-600 hover:text-red-400 transition text-sm leading-none px-1">×</button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input value={newRadioTemplateName} onChange={e => setNewRadioTemplateName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveRadioTemplateToLibrary(); }}
                          placeholder="Name this template (e.g. Indie Stations)"
                          className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                        <button onClick={saveRadioTemplateToLibrary} disabled={!newRadioTemplateName.trim()}
                          className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition shrink-0">
                          Save Current
                        </button>
                      </div>
                    </div>
                  </section>
                )}

                {promotionTab === 'template' && promotionSection === 'playlists' && (
                  <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Playlist Email Template</h2>
                      <p className="text-sm text-zinc-500 mb-2">Click a variable to copy it:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {['{{curatorName}}', '{{trackTitle}}', '{{driveLink}}', '{{senderName}}'].map(v => (
                          <CopyChip key={v} value={v} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Subject line</label>
                      <input type="text" value={playlistSubject} onChange={e => setPlaylistSubject(e.target.value)}
                        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
                    </div>
                    <textarea value={playlistTemplate} onChange={e => setPlaylistTemplate(e.target.value)} rows={16}
                      className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-y" />
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <button onClick={() => { setPlaylistTemplate(DEFAULT_PLAYLIST_TEMPLATE); setPlaylistSubject(DEFAULT_PLAYLIST_SUBJECT); }} className="text-xs text-zinc-500 hover:text-zinc-300 transition">
                        Reset to default
                      </button>
                      <SpamScoreBadge template={playlistTemplate} />
                    </div>
                    <div className="pt-3 border-t border-zinc-800 space-y-3">
                      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Saved Templates</h3>
                      {playlistTemplateLibrary.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {playlistTemplateLibrary.map(t => (
                            <div key={t.id} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1">
                              <button onClick={() => loadPlaylistTemplateFromLibrary(t)} className="text-xs text-zinc-200 hover:text-violet-400 transition">{t.name}</button>
                              <button onClick={() => deletePlaylistTemplateFromLibrary(t.id)} className="text-zinc-600 hover:text-red-400 transition text-sm leading-none px-1">×</button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input value={newPlaylistTemplateName} onChange={e => setNewPlaylistTemplateName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') savePlaylistTemplateToLibrary(); }}
                          placeholder="Name this template (e.g. Indie Pop Playlists)"
                          className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                        <button onClick={savePlaylistTemplateToLibrary} disabled={!newPlaylistTemplateName.trim()}
                          className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition shrink-0">
                          Save Current
                        </button>
                      </div>
                    </div>
                  </section>
                )}

                {promotionTab === 'compose' && (<>
                  {/* Section toggle: Radio / Playlists */}
                  <div className="flex gap-1.5">
                    {(['radio', 'playlists'] as const).map(sec => (
                      <button key={sec} onClick={() => setPromotionSection(sec)}
                        className={`px-4 py-1.5 rounded-full text-xs font-medium border transition capitalize ${promotionSection === sec ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                        {sec === 'radio' ? 'Radio' : 'Playlist Curators'}
                      </button>
                    ))}
                  </div>

                  {/* Playlists section */}
                  {promotionSection === 'playlists' && (<>
                    {/* Track Info */}
                    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Track Details</h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-zinc-300 mb-1.5">Your Name</label>
                          <input type="text" value={senderName} onChange={e => setSenderName(e.target.value)}
                            placeholder="Eren Senbay"
                            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-zinc-300 mb-1.5">Track Title</label>
                          <input type="text" value={trackTitle} onChange={e => setTrackTitle(e.target.value)}
                            placeholder="e.g. Give Me A Sign"
                            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
                          {playlistPitchCount > 0 && (
                            <p className="text-xs text-amber-400 mt-1.5">Already pitched to {playlistPitchCount} recipient{playlistPitchCount !== 1 ? 's' : ''} for this track.</p>
                          )}
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-zinc-300 mb-1.5">Google Drive Link</label>
                          <input type="url" value={driveLink} onChange={e => setDriveLink(e.target.value)}
                            placeholder="https://drive.google.com/file/d/..."
                            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
                        </div>
                      </div>
                    </section>

                    {/* Saved Filter Presets */}
                    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-3">
                      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Saved Filters</h2>
                      {playlistPresets.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {playlistPresets.map(p => (
                            <div key={p.id} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1">
                              <button onClick={() => loadPlaylistPreset(p)} className="text-xs text-zinc-200 hover:text-violet-400 transition">{p.name}</button>
                              <button onClick={() => deletePlaylistPreset(p.id)} className="text-zinc-600 hover:text-red-400 transition text-sm leading-none px-1">×</button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input value={newPlaylistPresetName} onChange={e => setNewPlaylistPresetName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') savePlaylistPreset(); }}
                          placeholder="Name this filter set (e.g. Indie Pop Playlists)"
                          className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                        <button onClick={savePlaylistPreset} disabled={!newPlaylistPresetName.trim()}
                          className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition shrink-0">
                          Save Current
                        </button>
                      </div>
                    </section>

                    {/* Genre Filter */}
                    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Genre Filter</h2>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-zinc-500">Match:</span>
                          {(['any', 'all'] as const).map(mode => (
                            <button key={mode} onClick={() => { setPlaylistMatchMode(mode); setPlaylistPreviewDone(false); setPlaylistSendResult(null); }}
                              className={`px-3 py-1 rounded-full text-xs font-medium border transition ${playlistMatchMode === mode ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                              {mode === 'any' ? 'Any genre' : 'All genres'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="text-sm text-zinc-500">
                        {playlistMatchMode === 'any' ? 'Curators tagged with at least one selected genre. Leave empty to include all.' : 'Curators tagged with every selected genre.'}
                      </p>
                      {selectedPlaylistGenres.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {selectedPlaylistGenres.map(g => (
                            <button key={g} onClick={() => togglePlaylistGenre(g)}
                              className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium px-3 py-1 rounded-full transition">
                              {g}<span className="text-violet-200">×</span>
                            </button>
                          ))}
                          <button onClick={() => { setSelectedPlaylistGenres([]); setPlaylistPreviewDone(false); setPlaylistSendResult(null); }}
                            className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 transition">Clear all</button>
                        </div>
                      )}
                      <div className="relative">
                        <input type="text" value={playlistGenreSearch} onChange={e => setPlaylistGenreSearch(e.target.value)}
                          onFocus={() => setShowPlaylistGenreDropdown(true)}
                          onBlur={() => setTimeout(() => setShowPlaylistGenreDropdown(false), 150)}
                          placeholder="Search genres (e.g. Pop, Alternative, Indie...)"
                          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
                        {showPlaylistGenreDropdown && filteredPlaylistGenres.length > 0 && (
                          <div className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                            {filteredPlaylistGenres.map(g => (
                              <button key={g} onMouseDown={() => { togglePlaylistGenre(g); setPlaylistGenreSearch(''); }}
                                className="w-full text-left px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700 transition">{g}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    </section>

                    {/* Platform Filter */}
                    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Platform Filter</h2>
                      <p className="text-sm text-zinc-500">Filter curators by streaming platform. Leave empty to include all platforms.</p>
                      <div className="flex flex-wrap gap-2">
                        {PLATFORM_OPTIONS.map(platform => (
                          <button key={platform} onClick={() => togglePlatform(platform)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                              selectedPlatforms.includes(platform)
                                ? 'bg-violet-600 border-violet-500 text-white'
                                : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'
                            }`}>
                            {platform}
                          </button>
                        ))}
                        {selectedPlatforms.length > 0 && (
                          <button onClick={() => { setSelectedPlatforms([]); setPlaylistPreviewDone(false); setPlaylistSendResult(null); }}
                            className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 transition">Clear</button>
                        )}
                      </div>
                    </section>

                    {/* Preview */}
                    <div className="flex flex-wrap items-center gap-3">
                      <button onClick={handlePlaylistPreview} disabled={playlistPreviewLoading}
                        className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-5 py-2.5 text-sm font-semibold text-white transition">
                        {playlistPreviewLoading ? 'Loading...' : 'Preview Curators'}
                      </button>
                      {playlistPreviewDone && (
                        <>
                          <button
                            onClick={() => { setPreviewModalType('playlists'); setPreviewModalIdx(0); }}
                            className="rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition">
                            Preview Email
                          </button>
                          <span className="text-sm text-zinc-400">{playlistCurators.length} curators · {playlistTotalEmails} emails</span>
                        </>
                      )}
                    </div>

                    {playlistPreviewDone && playlistCurators.length > 0 && (
                      <section className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                        <div className="px-4 md:px-6 py-3 md:py-4 border-b border-zinc-800">
                          <h3 className="text-sm font-semibold text-zinc-300">Curators Preview <span className="text-zinc-500 font-normal">· {playlistCurators.length} curators</span></h3>
                        </div>
                        <div className="divide-y divide-zinc-800 max-h-[32rem] overflow-y-auto">
                          {playlistCurators.map(c => {
                            const pitchedTracks = c.emails.flatMap(email => pitchedEmailMap.get(email.toLowerCase()) ?? []);
                            const uniquePitched = [...new Set(pitchedTracks)];
                            return (
                              <div key={c.name} className="px-4 md:px-6 py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <p className="text-sm font-medium text-white">{c.name}</p>
                                    {uniquePitched.length > 0 && <PitchedBadge tracks={uniquePitched} />}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                                    <span className="text-xs text-zinc-500">{c.platform}{c.followers ? ` · ${c.followers.toLocaleString()} followers` : ''}</span>
                                    {c.genres.slice(0, 3).map(g => (
                                      <span key={g} className="text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">{g}</span>
                                    ))}
                                  </div>
                                </div>
                                <div className="sm:text-right sm:shrink-0 space-y-0.5">
                                  {c.emails.map(email => (
                                    <p key={email} className="text-xs text-violet-400 break-all sm:break-normal">{email}</p>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {playlistPreviewDone && playlistCurators.length === 0 && (
                      <p className="text-sm text-zinc-500">No curators found for the selected filters.</p>
                    )}

                    {!playlistSendResult && playlistDuplicateRecipients.length > 0 && (
                      <div className="rounded-lg bg-amber-900/20 border border-amber-700/40 px-5 py-3">
                        <p className="text-amber-400 text-sm">
                          {playlistDuplicateRecipients.length} recipient{playlistDuplicateRecipients.length !== 1 ? 's have' : ' has'} already been pitched &ldquo;{trackTitle}&rdquo; before (via Song Demos or Track Promotion). You can still send.
                        </p>
                      </div>
                    )}

                    {playlistSendResult && (
                      <div className="rounded-lg bg-green-900/30 border border-green-700 px-5 py-4 space-y-2">
                        <p className="text-green-400 font-semibold">
                          Sent {playlistSendResult.sent} of {playlistSendResult.total} emails successfully.
                          {playlistSendResult.failed > 0 && ` ${playlistSendResult.failed} failed.`}
                        </p>
                        {playlistSendFailedEmails.length > 0 && (
                          <button
                            onClick={() => { addFailedToBlacklist(playlistSendFailedEmails); setPlaylistSendFailedEmails([]); }}
                            className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded-lg text-zinc-300 transition"
                          >
                            Add {playlistSendFailedEmails.length} failed address{playlistSendFailedEmails.length !== 1 ? 'es' : ''} to blacklist
                          </button>
                        )}
                      </div>
                    )}
                    {playlistSendError && (
                      <div className="rounded-lg bg-red-900/30 border border-red-700 px-5 py-4">
                        <p className="text-red-400 text-sm">{playlistSendError}</p>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 pb-6">
                      <button onClick={handlePlaylistSend} disabled={!canSendPlaylist || playlistSending}
                        className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-6 py-3 font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-zinc-950 text-sm">
                        {playlistSending ? `Sending... (${(playlistSendResult?.sent ?? 0) + (playlistSendResult?.failed ?? 0)}/${playlistTotalEmails})` : canSendPlaylist ? `Send to ${playlistTotalEmails} curator${playlistTotalEmails !== 1 ? 's' : ''}` : 'Preview curators first'}
                      </button>
                      {selectedAccount ? (
                        <span className="text-xs text-zinc-500">From <span className="text-zinc-300">{selectedAccount.name}</span> ({selectedAccount.email || selectedAccount.smtpUser})</span>
                      ) : (
                        <span className="text-xs text-amber-500">No email account — <button onClick={() => setActiveSection('account')} className="underline hover:text-amber-400">add one</button></span>
                      )}
                    </div>
                  </>)}

                  {/* Radio section */}
                  {promotionSection === 'radio' && (<>
                    {/* Track Info */}
                    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Track Details</h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-zinc-300 mb-1.5">Your Name</label>
                          <input type="text" value={senderName} onChange={e => setSenderName(e.target.value)}
                            placeholder="Eren Senbay"
                            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-zinc-300 mb-1.5">Track Title</label>
                          <input type="text" value={trackTitle} onChange={e => setTrackTitle(e.target.value)}
                            placeholder="e.g. Give Me A Sign"
                            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
                          {radioPitchCount > 0 && (
                            <p className="text-xs text-amber-400 mt-1.5">Already pitched to {radioPitchCount} recipient{radioPitchCount !== 1 ? 's' : ''} for this track.</p>
                          )}
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-zinc-300 mb-1.5">Google Drive Link</label>
                          <input type="url" value={driveLink} onChange={e => setDriveLink(e.target.value)}
                            placeholder="https://drive.google.com/file/d/..."
                            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
                        </div>
                      </div>
                    </section>

                    {/* Saved Filter Presets */}
                    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-3">
                      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Saved Filters</h2>
                      {radioPresets.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {radioPresets.map(p => (
                            <div key={p.id} className="inline-flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-full pl-3 pr-1.5 py-1">
                              <button onClick={() => loadRadioPreset(p)} className="text-xs text-zinc-200 hover:text-violet-400 transition">{p.name}</button>
                              <button onClick={() => deleteRadioPreset(p.id)} className="text-zinc-600 hover:text-red-400 transition text-sm leading-none px-1">×</button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input value={newRadioPresetName} onChange={e => setNewRadioPresetName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveRadioPreset(); }}
                          placeholder="Name this filter set (e.g. Australian Radio)"
                          className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                        <button onClick={saveRadioPreset} disabled={!newRadioPresetName.trim()}
                          className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition shrink-0">
                          Save Current
                        </button>
                      </div>
                    </section>

                    {/* Genre Filter */}
                    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Genre Filter</h2>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-zinc-500">Match:</span>
                          {(['any', 'all'] as const).map(mode => (
                            <button key={mode} onClick={() => { setRadioMatchMode(mode); setRadioPreviewDone(false); setRadioSendResult(null); }}
                              className={`px-3 py-1 rounded-full text-xs font-medium border transition ${radioMatchMode === mode ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                              {mode === 'any' ? 'Any genre' : 'All genres'}
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="text-sm text-zinc-500">
                        {radioMatchMode === 'any' ? 'Stations tagged with at least one selected genre. Leave empty to include all.' : 'Stations tagged with every selected genre.'}
                      </p>
                      {selectedRadioGenres.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {selectedRadioGenres.map(g => (
                            <button key={g} onClick={() => toggleRadioGenre(g)}
                              className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium px-3 py-1 rounded-full transition">
                              {g}<span className="text-violet-200">×</span>
                            </button>
                          ))}
                          <button onClick={() => { setSelectedRadioGenres([]); setRadioPreviewDone(false); setRadioSendResult(null); }}
                            className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 transition">Clear all</button>
                        </div>
                      )}
                      <div className="relative">
                        <input type="text" value={radioGenreSearch} onChange={e => setRadioGenreSearch(e.target.value)}
                          onFocus={() => setShowRadioGenreDropdown(true)}
                          onBlur={() => setTimeout(() => setShowRadioGenreDropdown(false), 150)}
                          placeholder="Search genres (e.g. Pop, Alternative, Indie...)"
                          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition" />
                        {showRadioGenreDropdown && filteredRadioGenres.length > 0 && (
                          <div className="absolute z-10 mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl max-h-56 overflow-y-auto">
                            {filteredRadioGenres.map(g => (
                              <button key={g} onMouseDown={() => { toggleRadioGenre(g); setRadioGenreSearch(''); }}
                                className="w-full text-left px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700 transition">{g}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    </section>

                    {/* Location Filter */}
                    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Location Filter</h2>
                      <p className="text-sm text-zinc-500">Filter stations by region. Leave empty to include all locations.</p>
                      <div className="flex flex-wrap gap-2">
                        {LOCATION_OPTIONS.map(loc => (
                          <button key={loc} onClick={() => toggleLocation(loc)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                              selectedLocations.includes(loc)
                                ? 'bg-violet-600 border-violet-500 text-white'
                                : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'
                            }`}>
                            {loc}
                          </button>
                        ))}
                        {selectedLocations.length > 0 && (
                          <button onClick={() => { setSelectedLocations([]); setRadioPreviewDone(false); setRadioSendResult(null); }}
                            className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 transition">Clear</button>
                        )}
                      </div>
                    </section>

                    {/* Preview */}
                    <div className="flex flex-wrap items-center gap-3">
                      <button onClick={handleRadioPreview} disabled={radioPreviewLoading}
                        className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-5 py-2.5 text-sm font-semibold text-white transition">
                        {radioPreviewLoading ? 'Loading...' : 'Preview Stations'}
                      </button>
                      {radioPreviewDone && (
                        <>
                          <button
                            onClick={() => { setPreviewModalType('radio'); setPreviewModalIdx(0); }}
                            className="rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition">
                            Preview Email
                          </button>
                          <span className="text-sm text-zinc-400">{radioStations.length} stations · {radioTotalEmails} emails</span>
                        </>
                      )}
                    </div>

                    {radioPreviewDone && radioStations.length > 0 && (
                      <section className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                        <div className="px-4 md:px-6 py-3 md:py-4 border-b border-zinc-800">
                          <h3 className="text-sm font-semibold text-zinc-300">Stations Preview <span className="text-zinc-500 font-normal">· {radioStations.length} stations</span></h3>
                        </div>
                        <div className="divide-y divide-zinc-800 max-h-[32rem] overflow-y-auto">
                          {radioStations.map(s => {
                            const pitchedTracks = s.emails.flatMap(email => pitchedEmailMap.get(email.toLowerCase()) ?? []);
                            const uniquePitched = [...new Set(pitchedTracks)];
                            return (
                              <div key={s.name} className="px-4 md:px-6 py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <p className="text-sm font-medium text-white">{s.name}</p>
                                    {uniquePitched.length > 0 && <PitchedBadge tracks={uniquePitched} />}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                                    <span className="text-xs text-zinc-500">{s.region}</span>
                                    {s.genres.slice(0, 3).map(g => (
                                      <span key={g} className="text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">{g}</span>
                                    ))}
                                  </div>
                                </div>
                                <div className="sm:text-right sm:shrink-0 space-y-0.5">
                                  {s.emails.map(email => (
                                    <p key={email} className="text-xs text-violet-400 break-all sm:break-normal">{email}</p>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {radioPreviewDone && radioStations.length === 0 && (
                      <p className="text-sm text-zinc-500">No stations found for the selected filters.</p>
                    )}

                    {!radioSendResult && radioDuplicateRecipients.length > 0 && (
                      <div className="rounded-lg bg-amber-900/20 border border-amber-700/40 px-5 py-3">
                        <p className="text-amber-400 text-sm">
                          {radioDuplicateRecipients.length} recipient{radioDuplicateRecipients.length !== 1 ? 's have' : ' has'} already been pitched &ldquo;{trackTitle}&rdquo; before (via Song Demos or Track Promotion). You can still send.
                        </p>
                      </div>
                    )}

                    {radioSendResult && (
                      <div className="rounded-lg bg-green-900/30 border border-green-700 px-5 py-4 space-y-2">
                        <p className="text-green-400 font-semibold">
                          Sent {radioSendResult.sent} of {radioSendResult.total} emails successfully.
                          {radioSendResult.failed > 0 && ` ${radioSendResult.failed} failed.`}
                        </p>
                        {radioSendFailedEmails.length > 0 && (
                          <button
                            onClick={() => { addFailedToBlacklist(radioSendFailedEmails); setRadioSendFailedEmails([]); }}
                            className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded-lg text-zinc-300 transition"
                          >
                            Add {radioSendFailedEmails.length} failed address{radioSendFailedEmails.length !== 1 ? 'es' : ''} to blacklist
                          </button>
                        )}
                      </div>
                    )}
                    {radioSendError && (
                      <div className="rounded-lg bg-red-900/30 border border-red-700 px-5 py-4">
                        <p className="text-red-400 text-sm">{radioSendError}</p>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 pb-6">
                      <button onClick={handleRadioSend} disabled={!canSendRadio || radioSending}
                        className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-6 py-3 font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-zinc-950 text-sm">
                        {radioSending ? `Sending... (${(radioSendResult?.sent ?? 0) + (radioSendResult?.failed ?? 0)}/${radioTotalEmails})` : canSendRadio ? `Send to ${radioTotalEmails} station${radioTotalEmails !== 1 ? 's' : ''}` : 'Preview stations first'}
                      </button>
                      {selectedAccount ? (
                        <span className="text-xs text-zinc-500">From <span className="text-zinc-300">{selectedAccount.name}</span> ({selectedAccount.email || selectedAccount.smtpUser})</span>
                      ) : (
                        <span className="text-xs text-amber-500">No email account — <button onClick={() => setActiveSection('account')} className="underline hover:text-amber-400">add one</button></span>
                      )}
                    </div>
                  </>)}
                </>)}
              </>
            )}

            {/* ── Account ── */}
            {activeSection === 'account' && (
              <div className="space-y-6 pb-6">
                {/* Email Accounts */}
                <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                  <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Email Accounts</h2>
                  {emailAccounts.length > 0 && (
                    <div className="space-y-2">
                      {emailAccounts.map(acc => (
                        <div key={acc.id} onClick={() => selectAccount(acc.id)}
                          className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border cursor-pointer transition ${
                            selectedAccountId === acc.id ? 'border-violet-500 bg-violet-600/10' : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                          }`}>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white">{acc.name}</p>
                            <p className="text-xs text-zinc-400 truncate">{acc.email || acc.smtpUser} · {acc.smtpHost}:{acc.smtpPort}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {selectedAccountId === acc.id && <span className="text-xs text-violet-400 font-medium">Active</span>}
                            <button onClick={e => { e.stopPropagation(); removeAccount(acc.id); }}
                              className="text-zinc-600 hover:text-red-400 transition text-lg leading-none">×</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {emailAccounts.length === 0 && !showAddAccount && (
                    <p className="text-sm text-zinc-500">No accounts added yet.</p>
                  )}
                  {!showAddAccount ? (
                    <button onClick={() => setShowAddAccount(true)} className="text-sm text-violet-400 hover:text-violet-300 transition">
                      + Add email account
                    </button>
                  ) : (
                    <div className="border border-zinc-700 rounded-xl p-4 space-y-3">
                      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">New Account</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {[
                          { label: 'Display Name', key: 'name', placeholder: 'e.g. Work Email', type: 'text' },
                          { label: 'From Address', key: 'email', placeholder: 'you@example.com', type: 'email' },
                          { label: 'SMTP Host', key: 'smtpHost', placeholder: 'smtp.zoho.com', type: 'text' },
                          { label: 'Port', key: 'smtpPort', placeholder: '465', type: 'text' },
                          { label: 'SMTP Username', key: 'smtpUser', placeholder: 'your@email.com', type: 'text' },
                          { label: 'Password / App Password', key: 'smtpPass', placeholder: '••••••••', type: 'password' },
                        ].map(({ label, key, placeholder, type }) => (
                          <div key={key}>
                            <label className="block text-xs text-zinc-400 mb-1">{label}</label>
                            <input
                              type={type}
                              value={newAccount[key as keyof typeof newAccount]}
                              onChange={e => setNewAccount(p => ({ ...p, [key]: e.target.value }))}
                              placeholder={placeholder}
                              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-zinc-500">For Gmail use an App Password. For Zoho use your account password or an app-specific password.</p>
                      <div className="flex gap-2 pt-1">
                        <button onClick={addAccount} disabled={!newAccount.name || !newAccount.smtpUser || !newAccount.smtpPass}
                          className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition">
                          Save Account
                        </button>
                        <button onClick={() => { setShowAddAccount(false); setNewAccount({ ...BLANK_ACCOUNT }); }}
                          className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 text-sm text-zinc-300 transition">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </section>

                {/* Sign-off */}
                <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-3">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Sign-off</h2>
                    <p className="text-xs text-zinc-500">Appended after every email body. Used for both Song Demos and Track Promotion.</p>
                  </div>
                  <textarea value={signOff} onChange={e => setSignOff(e.target.value)} rows={3}
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-y" />
                  {signOffImage ? (
                    <div className="flex items-start gap-3 pt-1">
                      <img src={signOffImage} alt="Signature" className="max-h-20 max-w-xs rounded border border-zinc-700 object-contain bg-zinc-800" />
                      <button onClick={() => setSignOffImage(null)} className="text-xs text-red-400 hover:text-red-300 transition mt-1">Remove image</button>
                    </div>
                  ) : (
                    <label className="inline-flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 hover:border-zinc-500 text-xs text-zinc-300 transition w-fit">
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                      </svg>
                      Upload signature image
                      <input type="file" accept="image/*" className="hidden" onChange={handleSignOffImageUpload} />
                    </label>
                  )}
                  <button onClick={() => setSignOff(DEFAULT_SIGN_OFF)} className="text-xs text-zinc-500 hover:text-zinc-300 transition">Reset to default</button>
                </section>

                {/* Blacklist */}
                <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Do Not Contact</h2>
                    <p className="text-xs text-zinc-500">Emails on this list are skipped from all sends.</p>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={newBlacklistEmail}
                      onChange={e => setNewBlacklistEmail(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addToBlacklist(); }}
                      placeholder="email@example.com"
                      className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition text-sm"
                    />
                    <button onClick={addToBlacklist} disabled={!newBlacklistEmail}
                      className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2.5 text-sm font-semibold text-white transition shrink-0">
                      Add
                    </button>
                  </div>
                  {blacklist.length > 0 ? (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {blacklist.map(email => (
                        <div key={email} className="flex items-center justify-between px-3 py-2 bg-zinc-800 rounded-lg">
                          <span className="text-xs text-zinc-300 font-mono">{email}</span>
                          <button onClick={() => removeFromBlacklist(email)} className="text-zinc-600 hover:text-red-400 transition text-lg leading-none ml-3">×</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-600">No blocked emails.</p>
                  )}
                </section>

                {/* Potential False Emails */}
                <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Potential False Emails</h2>
                    <p className="text-xs text-zinc-500">Addresses that bounced or failed on a send land here automatically — review them, then move to Do Not Contact or dismiss if it was a fluke.</p>
                  </div>
                  {failedEmails.length > 0 ? (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {failedEmails.map(email => (
                        <div key={email} className="flex items-center justify-between px-3 py-2 bg-zinc-800 rounded-lg gap-3">
                          <span className="text-xs text-zinc-300 font-mono truncate">{email}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <button onClick={() => moveFailedToDoNotContact(email)}
                              className="text-xs text-amber-400 hover:text-amber-300 transition whitespace-nowrap">Do Not Contact</button>
                            <button onClick={() => removeFromFailedEmails(email)} className="text-zinc-600 hover:text-red-400 transition text-lg leading-none">×</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-600">No failed sends recorded.</p>
                  )}
                </section>

                {/* Send Rate Limiter */}
                <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Send Rate</h2>
                    <p className="text-xs text-zinc-500">Delay between each email to avoid triggering spam filters.</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {SEND_DELAY_OPTIONS.map(opt => (
                      <button key={opt.value}
                        onClick={() => { setSendDelay(opt.value); syncStorage.setItem('tp_send_delay', String(opt.value)); }}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${sendDelay === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {sendDelay > 0 && (
                    <p className="text-xs text-zinc-500">{sendDelay / 1000}s delay between each email.</p>
                  )}
                </section>

                {/* Daily Send Limit */}
                <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Daily Send Limit</h2>
                    <p className="text-xs text-zinc-500">Cap how many emails can be sent per day across all campaigns.</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {DAILY_CAP_OPTIONS.map(opt => (
                      <button key={opt.value}
                        onClick={() => setDailyCap(opt.value)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${dailySendCap === opt.value ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-zinc-500">
                    {dailySendCap > 0 ? `${sendsToday} of ${dailySendCap} sent today.` : `${sendsToday} sent today. No limit set.`}
                  </p>
                  {emailAccounts.length > 1 && sendsToday > 0 && (
                    <div className="space-y-1 pt-1 border-t border-zinc-800">
                      <p className="text-xs text-zinc-600 uppercase tracking-wider pt-2">By account</p>
                      {emailAccounts.map(acc => (
                        <div key={acc.id} className="flex items-center justify-between text-xs text-zinc-400">
                          <span>{acc.name || acc.email}</span>
                          <span className="font-mono text-zinc-300">{sendsTodayByAccount[acc.id] ?? 0}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Test Email */}
                <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Send Test Email</h2>
                    <p className="text-xs text-zinc-500">Confirm your email account is connected and working.</p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="email"
                      value={testEmailTo}
                      onChange={e => { setTestEmailTo(e.target.value); setTestEmailResult(null); }}
                      placeholder="recipient@example.com"
                      className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition text-sm"
                    />
                    <button
                      onClick={handleTestEmail}
                      disabled={!testEmailTo || testEmailSending || !selectedAccountId}
                      className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2.5 text-sm font-semibold text-white transition sm:shrink-0"
                    >
                      {testEmailSending ? 'Sending...' : 'Send'}
                    </button>
                  </div>

                  <div>
                    <button
                      onClick={() => setShowTestEmailOptions(p => !p)}
                      className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition"
                    >
                      Optional: customize subject &amp; message
                      <span className={`transition-transform inline-block ${showTestEmailOptions ? 'rotate-180' : ''}`}>▾</span>
                    </button>
                    {showTestEmailOptions && (
                      <div className="mt-3 space-y-3 rounded-lg bg-zinc-800/50 border border-zinc-800 p-3">
                        <div>
                          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Subject</label>
                          <input
                            type="text"
                            value={testEmailSubject}
                            onChange={e => setTestEmailSubject(e.target.value)}
                            placeholder={demosSubject}
                            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Message</label>
                          <textarea
                            value={testEmailMessage}
                            onChange={e => setTestEmailMessage(e.target.value)}
                            placeholder={demosTemplate}
                            rows={6}
                            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-600 font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition resize-y"
                          />
                        </div>
                        <p className="text-xs text-zinc-600">Leave blank to send your Song Demos template as-is. Both support the same {'{{variables}}'}.</p>
                      </div>
                    )}
                  </div>

                  {testEmailResult === 'success' && <p className="text-sm text-green-400">Test email sent successfully. Check your inbox.</p>}
                  {testEmailResult === 'error' && <p className="text-sm text-red-400">{testEmailError}</p>}
                  {!selectedAccountId && <p className="text-xs text-amber-500">Add and select an email account above first.</p>}
                </section>

                {/* Deliverability Checker */}
                <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Deliverability Check</h2>
                    <p className="text-xs text-zinc-500">Checks SPF, DKIM, and MX DNS records for your sending domain.</p>
                  </div>
                  {selectedAccount ? (
                    <div className="space-y-4">
                      <p className="text-xs text-zinc-400">
                        Domain: <span className="text-zinc-200 font-mono">{(selectedAccount.email || selectedAccount.smtpUser).split('@')[1]}</span>
                      </p>
                      <button
                        onClick={handleDeliverabilityCheck}
                        disabled={deliverabilityLoading}
                        className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2.5 text-sm font-semibold text-white transition"
                      >
                        {deliverabilityLoading ? 'Checking...' : 'Run Check'}
                      </button>
                      {deliverabilityResult && (
                        <div className="space-y-2">
                          {[
                            {
                              label: 'SPF',
                              pass: deliverabilityResult.spf,
                              detail: deliverabilityResult.spf ? deliverabilityResult.spfRecord : 'No SPF record found',
                            },
                            {
                              label: 'DKIM',
                              pass: deliverabilityResult.dkim,
                              detail: deliverabilityResult.dkim ? `Selector: ${deliverabilityResult.dkimSelector}` : 'No DKIM record found',
                            },
                            {
                              label: 'MX',
                              pass: deliverabilityResult.mx,
                              detail: deliverabilityResult.mx ? deliverabilityResult.mxRecords.join(', ') : 'No MX records found',
                            },
                          ].map(item => (
                            <div key={item.label} className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${item.pass ? 'border-green-700/50 bg-green-900/10' : 'border-red-700/50 bg-red-900/10'}`}>
                              <span className={`text-lg leading-none mt-0.5 ${item.pass ? 'text-green-400' : 'text-red-400'}`}>
                                {item.pass ? '✓' : '✗'}
                              </span>
                              <div className="min-w-0">
                                <p className={`text-sm font-semibold ${item.pass ? 'text-green-400' : 'text-red-400'}`}>{item.label}</p>
                                <p className="text-xs text-zinc-400 mt-0.5 break-all">{item.detail}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-amber-500">Select an email account above to check its domain.</p>
                  )}
                </section>
              </div>
            )}

            {/* ── History ── */}
            {activeSection === 'history' && (
              <div className="space-y-4 pb-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Campaign History</h2>
                    <p className="text-xs text-zinc-500">{campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''} logged on this device.</p>
                  </div>
                  {campaigns.length > 0 && (
                    <div className="flex gap-2">
                      <button onClick={() => exportCampaignsCsv(filteredCampaigns)}
                        className="rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 transition">
                        Export CSV
                      </button>
                      <button onClick={() => { if (confirm('Clear all campaign history? This cannot be undone.')) clearCampaignHistory(); }}
                        className="rounded-lg bg-zinc-800 hover:bg-red-900/40 border border-zinc-700 hover:border-red-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:text-red-400 transition">
                        Clear History
                      </button>
                    </div>
                  )}
                </div>

                {campaigns.length > 0 && (
                  <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-3">
                    <input
                      type="text"
                      value={historySearch}
                      onChange={e => setHistorySearch(e.target.value)}
                      placeholder="Search by track title..."
                      className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex gap-1.5">
                        {(['all', 'demos', 'radio', 'playlists'] as const).map(t => (
                          <button key={t} onClick={() => setHistoryTypeFilter(t)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${historyTypeFilter === t ? 'bg-violet-600 border-violet-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'}`}>
                            {t === 'all' ? 'All' : t === 'demos' ? 'Demos' : t === 'radio' ? 'Radio' : 'Playlists'}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        <input type="date" value={historyDateFrom} onChange={e => setHistoryDateFrom(e.target.value)}
                          className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-zinc-300 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                        <span>to</span>
                        <input type="date" value={historyDateTo} onChange={e => setHistoryDateTo(e.target.value)}
                          className="rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-zinc-300 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                      </div>
                      {(historySearch || historyTypeFilter !== 'all' || historyDateFrom || historyDateTo) && (
                        <button onClick={() => { setHistorySearch(''); setHistoryTypeFilter('all'); setHistoryDateFrom(''); setHistoryDateTo(''); }}
                          className="text-xs text-zinc-500 hover:text-zinc-300 transition underline">
                          Clear filters
                        </button>
                      )}
                    </div>
                  </section>
                )}

                {campaigns.length === 0 ? (
                  <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 flex flex-col items-center justify-center gap-2 text-center">
                    <p className="text-sm font-semibold text-zinc-300">No campaigns yet</p>
                    <p className="text-xs text-zinc-500">Sent pitches will show up here.</p>
                  </section>
                ) : filteredCampaigns.length === 0 ? (
                  <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 flex flex-col items-center justify-center gap-2 text-center">
                    <p className="text-sm font-semibold text-zinc-300">No campaigns match your filters</p>
                    <button onClick={() => { setHistorySearch(''); setHistoryTypeFilter('all'); setHistoryDateFrom(''); setHistoryDateTo(''); }}
                      className="text-xs text-violet-400 hover:text-violet-300 transition underline">
                      Clear filters
                    </button>
                  </section>
                ) : (
                  <section className="bg-zinc-900 rounded-xl border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
                    {filteredCampaigns.slice().sort((a, b) => b.date.localeCompare(a.date)).map(c => (
                      <div key={c.id}>
                        <button
                          onClick={() => setExpandedCampaignId(p => p === c.id ? null : c.id)}
                          className="w-full flex items-center justify-between gap-3 px-4 md:px-6 py-3.5 text-left hover:bg-zinc-800/50 transition"
                        >
                          <div className="min-w-0 flex items-center gap-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${c.type === 'demos' ? 'bg-violet-600/20 text-violet-400 border border-violet-600/30' : c.type === 'radio' ? 'bg-sky-600/20 text-sky-400 border border-sky-600/30' : 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/30'}`}>
                              {c.type === 'demos' ? 'Demos' : c.type === 'radio' ? 'Radio' : 'Playlists'}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-white truncate">{c.trackTitle}</p>
                              <p className="text-xs text-zinc-500">
                                {new Date(c.date).toLocaleString()} · {c.emails.length} recipient{c.emails.length !== 1 ? 's' : ''}
                                {(c.responded?.length ?? 0) > 0 && <> · {c.responded!.length} responded</>}
                              </p>
                            </div>
                          </div>
                          <svg viewBox="0 0 24 24" className={`w-4 h-4 shrink-0 text-zinc-500 transition-transform ${expandedCampaignId === c.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </button>
                        {expandedCampaignId === c.id && (
                          <div className="px-4 md:px-6 pb-4 -mt-1 space-y-3">
                            {c.accountId && (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => checkReplies(c)}
                                  disabled={checkingRepliesId === c.id}
                                  className="rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition disabled:opacity-40"
                                >
                                  {checkingRepliesId === c.id ? 'Checking inbox…' : 'Check for replies'}
                                </button>
                                {checkingRepliesId === c.id && <span className="text-xs text-zinc-500">This can take a few seconds per recipient.</span>}
                              </div>
                            )}
                            {replyCheckError && checkingRepliesId === null && (
                              <p className="text-xs text-red-400">{replyCheckError}</p>
                            )}
                            <div className="flex flex-wrap gap-1.5">
                              {c.emails.map(email => {
                                const responded = c.responded?.includes(email);
                                return (
                                  <span
                                    key={email}
                                    className={`text-xs px-2 py-1 rounded font-mono border ${responded ? 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40' : 'bg-zinc-800 text-zinc-300 border-transparent'}`}
                                  >
                                    {email}{responded && ' ✓'}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </section>
                )}
              </div>
            )}

          </div>
        </main>
      </div>

      {/* Floating save bar */}
      {isDirty && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:w-auto z-50 flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl shadow-black/50 px-4 py-3">
          <span className="text-xs text-zinc-400 mr-1 flex-1 md:flex-none">Unsaved changes</span>
          <button onClick={discardChanges} className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1.5 rounded transition hover:bg-zinc-800">Discard</button>
          <button onClick={saveAll} className="text-xs bg-violet-600 hover:bg-violet-500 text-white font-semibold px-3 py-1.5 rounded-lg transition">Save</button>
        </div>
      )}

      {/* Email Preview Modal */}
      {previewModalType && previewModalEntries.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 md:p-8 bg-black/70 backdrop-blur-sm overflow-y-auto">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-2xl mt-4 mb-8">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h2 className="text-sm font-semibold text-white">Email Preview</h2>
              <button onClick={() => setPreviewModalType(null)} className="text-zinc-500 hover:text-white transition text-xl leading-none">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Recipient</label>
                <select
                  value={previewModalIdx}
                  onChange={e => setPreviewModalIdx(Number(e.target.value))}
                  className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  {previewModalEntries.map((entry, i) => (
                    <option key={i} value={i}>{entry.label}</option>
                  ))}
                </select>
              </div>
              {previewModalEntries[previewModalIdx] && (
                <div className="space-y-3">
                  <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-4 py-3 space-y-1.5">
                    <p className="text-xs text-zinc-500"><span className="text-zinc-400 font-medium">To:</span> {previewModalEntries[previewModalIdx].to}</p>
                    <p className="text-xs text-zinc-500"><span className="text-zinc-400 font-medium">Subject:</span> {previewModalEntries[previewModalIdx].subject}</p>
                  </div>
                  <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-4 py-3">
                    <pre className="text-sm text-zinc-200 whitespace-pre-wrap font-sans leading-relaxed">{previewModalEntries[previewModalIdx].body}</pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
