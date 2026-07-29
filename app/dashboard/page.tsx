'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { hydrateFromRemote, syncStorage } from '@/lib/remoteSync';
import type {
  Artist, RadioStation, PlaylistCurator, EmailAccount, NewAccountForm,
  CampaignRecipient, Campaign, CustomContact, DeliverabilityResult,
  DemosFilterPreset, RadioFilterPreset, PlaylistFilterPreset, SavedTemplate, SendResultEntry,
} from './types';
import {
  DEFAULT_DEMOS_TEMPLATE, DEFAULT_FOLLOWUP_TEMPLATE, DEFAULT_RADIO_TEMPLATE, DEFAULT_PLAYLIST_TEMPLATE,
  DEFAULT_DEMOS_SUBJECT, DEFAULT_FOLLOWUP_SUBJECT, DEFAULT_RADIO_SUBJECT, DEFAULT_PLAYLIST_SUBJECT,
  DEFAULT_SIGN_OFF, LOCATION_OPTIONS, PLATFORM_OPTIONS, BLANK_ACCOUNT,
} from './constants';
import {
  sendInBatches, downloadCsv, parseContactsCsv, shuffle, countUniqueRecipients,
  renderTemplateClient, pronounForClient,
} from './utils';
import { CopyChip } from './components/CopyChip';
import { CopyableName } from './components/CopyableName';
import { SpotifyLink } from './components/SpotifyLink';
import { PitchedBadge } from './components/PitchedBadge';
import { SpamScoreBadge } from './components/SpamScoreBadge';
import { OverviewSection } from './sections/OverviewSection';
import { AccountSection } from './sections/AccountSection';
import { HistorySection } from './sections/HistorySection';

export default function Dashboard() {
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
  const [excludedArtistNames, setExcludedArtistNames] = useState<Set<string>>(new Set());
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDone, setPreviewDone] = useState(false);
  const [demosInvalidEmails, setDemosInvalidEmails] = useState<string[]>([]);
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
  const [radioInvalidEmails, setRadioInvalidEmails] = useState<string[]>([]);
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
  const [playlistInvalidEmails, setPlaylistInvalidEmails] = useState<string[]>([]);
  const [playlistPreviewLoading, setPlaylistPreviewLoading] = useState(false);
  const [playlistSending, setPlaylistSending] = useState(false);
  const [playlistSendResult, setPlaylistSendResult] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [playlistSendError, setPlaylistSendError] = useState('');
  const [playlistSendFailedEmails, setPlaylistSendFailedEmails] = useState<string[]>([]);
  const [playlistPresets, setPlaylistPresets] = useState<PlaylistFilterPreset[]>([]);
  const [newPlaylistPresetName, setNewPlaylistPresetName] = useState('');
  const [playlistTemplateLibrary, setPlaylistTemplateLibrary] = useState<SavedTemplate[]>([]);
  const [newPlaylistTemplateName, setNewPlaylistTemplateName] = useState('');

  // Account state — accounts (and their SMTP passwords) live server-side behind
  // /api/accounts; the client only ever holds the password transiently in the add-account form.
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccount, setNewAccount] = useState<NewAccountForm>({ ...BLANK_ACCOUNT });
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountError, setAccountError] = useState('');
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

  // The cap is enforced server-side (see checkCapAllows in the send routes) against a
  // Redis counter, so after any send this just re-reads that counter rather than
  // keeping its own running total — one source of truth, no drift across tabs/devices.
  async function refreshSendsToday() {
    try {
      const res = await fetch('/api/send-quota');
      const data = await res.json();
      setSendsToday(data.count ?? 0);
      setSendsTodayByAccount(data.byAccount ?? {});
    } catch {}
  }

  useEffect(() => {
    fetch('/api/genres').then(r => r.json()).then(d => { setAllGenres(d.genres || []); setTopGenres(d.topGenres || []); });
    fetch('/api/radio-genres').then(r => r.json()).then(d => setRadioAllGenres(d.genres || []));
    fetch('/api/playlist-genres').then(r => r.json()).then(d => setPlaylistAllGenres(d.genres || []));
    fetch('/api/send-quota').then(r => r.json()).then(d => { setSendsToday(d.count ?? 0); setSendsTodayByAccount(d.byAccount ?? {}); }).catch(() => {});
    fetch('/api/campaigns').then(r => r.json()).then(d => setCampaigns(d.campaigns || [])).catch(() => {});
    (async () => {
    await hydrateFromRemote(); // pull latest settings from the server so a second device picks up what was saved elsewhere
    try {
      const accountsRes = await fetch('/api/accounts');
      const accountsData = await accountsRes.json();
      const accounts = (accountsData.accounts ?? []) as EmailAccount[];
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

  // Groups Demos campaigns by song (case-insensitive title match) in send order,
  // so each one can be labeled "Sendout 1", "Sendout 2", etc.
  const demosSendoutGroups = useMemo(() => {
    const groups = new Map<string, Campaign[]>();
    campaigns
      .filter(c => c.type === 'demos')
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach(c => {
        const key = c.trackTitle.trim().toLowerCase();
        const group = groups.get(key);
        if (group) group.push(c); else groups.set(key, [c]);
      });
    return groups;
  }, [campaigns]);

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

  async function addAccount() {
    if (!newAccount.name || !newAccount.smtpUser || !newAccount.smtpPass) return;
    setSavingAccount(true);
    setAccountError('');
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAccount),
      });
      const data = await res.json();
      if (!res.ok) { setAccountError(data.error || 'Could not save account.'); return; }
      const account = data.account as EmailAccount;
      setEmailAccounts(prev => [...prev, account]);
      setSelectedAccountId(account.id);
      syncStorage.setItem('tp_selected_account', account.id);
      setShowAddAccount(false);
      setNewAccount({ ...BLANK_ACCOUNT });
    } catch {
      setAccountError('Network error. Please try again.');
    } finally {
      setSavingAccount(false);
    }
  }

  async function removeAccount(id: string) {
    const updated = emailAccounts.filter(a => a.id !== id);
    setEmailAccounts(updated);
    if (selectedAccountId === id) {
      const next = updated[0]?.id ?? '';
      setSelectedAccountId(next);
      syncStorage.setItem('tp_selected_account', next);
    }
    await fetch(`/api/accounts?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
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

  /**
   * Creates or updates a single campaign record. Campaign history lives server-side
   * as one record per campaign (see lib/campaigns.ts), so this only ever writes the
   * one record that changed — cheap enough to call after every batch of a long send,
   * which is what makes mid-send persistence (see handleSend et al.) practical.
   */
  function upsertCampaign(campaign: Campaign) {
    setCampaigns(prev => {
      const idx = prev.findIndex(c => c.id === campaign.id);
      if (idx >= 0) { const copy = [...prev]; copy[idx] = campaign; return copy; }
      return [...prev, campaign];
    });
    fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(campaign),
    }).catch(() => {});
  }

  /** Looks up the Message-ID each address was originally pitched under, for the same track,
   *  so a follow-up threads onto it instead of landing as an unrelated new email. */
  function threadIdsFor(type: Campaign['type'], title: string): Record<string, string> {
    const key = title.trim().toLowerCase();
    const ids: Record<string, string> = {};
    campaigns
      .filter(c => c.type === type && c.trackTitle.trim().toLowerCase() === key)
      .forEach(c => Object.entries(c.messageIds ?? {}).forEach(([email, id]) => { ids[email] = id; }));
    return ids;
  }

  function messageIdsFromResults(results: SendResultEntry[]): Record<string, string> {
    const ids: Record<string, string> = {};
    results.forEach(r => { if (r.success && r.messageId) ids[r.to.toLowerCase()] = r.messageId; });
    return ids;
  }

  const [checkingRepliesId, setCheckingRepliesId] = useState<string | null>(null);
  const [replyCheckError, setReplyCheckError] = useState('');
  const [replyCheckResult, setReplyCheckResult] = useState<{ campaignId: string; newCount: number; totalCount: number; newBounceCount: number } | null>(null);

  async function checkReplies(c: Campaign) {
    if (!c.accountId || !emailAccounts.some(a => a.id === c.accountId)) {
      setReplyCheckError('The account this was sent from is no longer available.');
      return;
    }
    setCheckingRepliesId(c.id);
    setReplyCheckError('');
    setReplyCheckResult(null);
    try {
      const res = await fetch('/api/check-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails: c.emails,
          since: new Date(c.date).getTime(),
          accountId: c.accountId,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setReplyCheckError(data.error || 'Could not check replies.'); return; }

      const before = new Set(c.responded ?? []);
      const found = data.responded as string[];
      const newCount = found.filter(e => !before.has(e)).length;
      const responded = Array.from(new Set([...(c.responded ?? []), ...found]));

      // A bounce means the address is dead, not "no reply yet" — repeatedly re-pitching
      // it just burns sender reputation, so a confirmed bounce is auto-blacklisted the
      // same way a hard send failure already is (see addFailedToBlacklist).
      const beforeBounced = new Set(c.bounced ?? []);
      const foundBounced = (data.bounced as string[] | undefined) ?? [];
      const newBounceCount = foundBounced.filter(e => !beforeBounced.has(e)).length;
      const bounced = Array.from(new Set([...(c.bounced ?? []), ...foundBounced]));
      if (foundBounced.length) addFailedToBlacklist(foundBounced);

      // checkReplies only ever runs from a button's onClick (passed down to
      // HistorySection), never during render, so Date.now() here is safe — this is
      // the react-compiler plugin flagging a callback-prop function's body more
      // strictly than the many identical Date.now()/inline-object patterns used in
      // page.tsx's own onClick handlers, which it doesn't scrutinize the same way.
      // eslint-disable-next-line react-hooks/purity
      const checkedAt = Date.now();
      upsertCampaign({ ...c, responded, bounced, lastChecked: checkedAt });
      setReplyCheckResult({ campaignId: c.id, newCount, totalCount: responded.length, newBounceCount });
    } catch (err) {
      setReplyCheckError(`Could not check replies: ${String(err)}`);
    } finally {
      setCheckingRepliesId(null);
    }
  }

  function formatCheckedAt(ts: number) {
    return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  const [backfillingId, setBackfillingId] = useState<string | null>(null);
  const [backfillError, setBackfillError] = useState('');

  async function backfillRecipients(c: Campaign) {
    setBackfillingId(c.id);
    setBackfillError('');
    try {
      const res = await fetch('/api/campaign-recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: c.emails }),
      });
      const data = await res.json();
      if (!res.ok) { setBackfillError(data.error || 'Could not load artist details.'); return; }
      const recipients: CampaignRecipient[] = (data.recipients as CampaignRecipient[]).map(r => {
        if (r.artistName) return r;
        const contact = customContacts.find(cc => cc.managerEmail.toLowerCase() === r.email.toLowerCase());
        return contact ? { ...r, artistName: contact.artistName, managerName: contact.managerName } : r;
      });
      upsertCampaign({ ...c, recipients });
    } catch (err) {
      setBackfillError(`Could not load artist details: ${String(err)}`);
    } finally {
      setBackfillingId(null);
    }
  }

  const [resumingCampaignId, setResumingCampaignId] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState('');
  const [resumeProgress, setResumeProgress] = useState<{ campaignId: string; sent: number; total: number } | null>(null);

  /**
   * Continues a send that was interrupted (tab closed, network drop, crash) partway
   * through, from the offset it last got to — c.pendingSend was written by the batch
   * loop in handleSend/handleRadioSend/handlePlaylistSend after every batch, so at
   * most the one in-flight batch when the interruption happened gets re-sent.
   *
   * New recipients picked up here don't have artist metadata to attach (the roster
   * lookup that built it lived in the original send's closure, long gone by now) —
   * they land with blank fields, same as a custom contact with no name. "Show
   * artists sent to" already exists to backfill exactly this from just the address.
   */
  async function resumeSend(c: Campaign) {
    const pending = c.pendingSend;
    if (!pending) return;
    setResumingCampaignId(c.id);
    setResumeError('');
    setResumeProgress({ campaignId: c.id, sent: 0, total: 0 });
    try {
      const outcome = await sendInBatches(pending.endpoint, pending.payload, (progress, resultsSoFar, nextOffset) => {
        setResumeProgress({ campaignId: c.id, sent: progress.sent, total: progress.total });
        const newlySent = resultsSoFar.filter(r => r.success).map(r => r.to);
        const emails = Array.from(new Set([...c.emails, ...newlySent]));
        const existingRecipientEmails = new Set((c.recipients ?? []).map(r => r.email.toLowerCase()));
        const recipients = c.recipients
          ? [
              ...c.recipients,
              ...newlySent
                .filter(email => !existingRecipientEmails.has(email.toLowerCase()))
                .map(email => ({ email, artistName: '', managerName: '', avatarUrl: '', genres: [], instagramHandle: '', spotifyFollowers: 0 })),
            ]
          : undefined;
        upsertCampaign({
          ...c,
          emails,
          recipients,
          messageIds: { ...(c.messageIds ?? {}), ...messageIdsFromResults(resultsSoFar) },
          pendingSend: nextOffset != null ? { ...pending, offset: nextOffset } : undefined,
        });
      }, pending.offset);
      if (!outcome.ok) setResumeError(outcome.error);
      else if (outcome.results.some(r => r.success)) refreshSendsToday();
    } catch (err) {
      setResumeError(`Could not resume send: ${String(err)}`);
    } finally {
      setResumingCampaignId(null);
    }
  }

  function clearCampaignHistory() {
    setCampaigns([]);
    fetch('/api/campaigns?all=true', { method: 'DELETE' }).catch(() => {});
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

  /**
   * Screens a freshly-loaded recipient list for addresses that are guaranteed to
   * bounce (malformed, or a domain with no usable mail DNS) so they can be flagged
   * before a send ever reaches them, rather than only discovered as a failure
   * afterward. Runs after the preview response lands rather than blocking it —
   * the DNS lookups take longer than the roster lookup itself.
   */
  async function checkRecipientsValidity(emails: string[]): Promise<string[]> {
    if (!emails.length) return [];
    try {
      const res = await fetch('/api/mx-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails }),
      });
      if (!res.ok) return [];
      const data = await res.json() as { malformed: string[]; noMx: string[] };
      return [...data.malformed, ...data.noMx];
    } catch {
      return [];
    }
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
      // Use a real matched artist's data when one is available, so the test
      // reflects exactly how {{managerName}}, {{pronoun}}, etc. will resolve
      // for an actual recipient rather than generic placeholders.
      const sampleArtist = sortedArtists[0];
      const sampleContact = customContacts[0];
      const res = await fetch('/api/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testEmailTo,
          accountId: selectedAccountId || undefined,
          emailTemplate: testEmailMessage.trim() || (useFollowUp ? demosFollowUpTemplate : demosTemplate),
          subjectTemplate: testEmailSubject.trim() || (useFollowUp ? demosFollowUpSubject : demosSubject),
          signOff,
          signOffImage,
          senderName,
          trackTitle,
          driveLink,
          managerName: sampleArtist?.managerNames[0] || sampleContact?.managerName,
          artistName: sampleArtist?.name || sampleContact?.artistName,
          managementCompany: sampleArtist?.managementCompany,
          pronoun: sampleArtist ? pronounForClient(sampleArtist.gender, sampleArtist.type) : undefined,
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

  async function handlePreview(genresOverride?: string[], matchModeOverride?: 'any' | 'all') {
    setPreviewLoading(true);
    setDemosInvalidEmails([]);
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genres: genresOverride ?? selectedGenres, minAudience, maxAudience, gender, artistType, minInstagram, maxInstagram, matchMode: matchModeOverride ?? demosMatchMode }),
      });
      const data = await res.json();
      const artists = data.artists || [];
      setPreviewArtists(artists);
      setPreviewDone(true);
      setExcludedArtistNames(new Set());
      checkRecipientsValidity((artists as Artist[]).flatMap(a => a.managerEmails)).then(setDemosInvalidEmails);
    } finally { setPreviewLoading(false); }
  }

  // Clicking a genre chip on a preview card toggles it in the active filters
  // and immediately re-runs the preview with the updated genre list, instead
  // of just clearing the results like toggleGenre does. Adding a genre this way
  // also switches match mode to "all" — otherwise the artist that chip came from
  // could drop out of an "any" match once a second genre they don't have is added.
  function toggleGenreFromPreview(genre: string) {
    const adding = !selectedGenres.includes(genre);
    const updated = adding ? [...selectedGenres, genre] : selectedGenres.filter(g => g !== genre);
    setSelectedGenres(updated);
    const nextMatchMode = adding ? 'all' : demosMatchMode;
    if (adding) setDemosMatchMode('all');
    handlePreview(updated, nextMatchMode);
  }

  function toggleArtistExclusion(name: string) {
    setExcludedArtistNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  async function handleSend() {
    if (!trackTitle || !driveLink) return;
    if (dailySendCap > 0 && sendsToday + totalEmails > dailySendCap) {
      setSendError(`Daily send limit reached (${sendsToday}/${dailySendCap} sent today). Wait until tomorrow or raise the limit in Account settings.`);
      return;
    }
    setSending(true); setSendError(''); setSendResult(null); setSendFailedEmails([]);
    try {
      // Built once up front — it depends only on the current preview/contacts, not on
      // anything the send returns — so every progress tick below can reuse it to
      // attach recipient details to whatever's been sent so far.
      const artistByEmail = new Map<string, Omit<CampaignRecipient, 'email'>>();
      previewArtists.filter(a => !excludedArtistNames.has(a.name)).forEach(a => {
        a.managerEmails.forEach((email, i) => {
          artistByEmail.set(email.toLowerCase(), {
            artistName: a.name, managerName: a.managerNames[i] || '', avatarUrl: a.avatarUrl,
            genres: a.genres, instagramHandle: a.instagramHandle, spotifyFollowers: a.spotifyFollowers,
          });
        });
      });
      customContacts.forEach(c => {
        artistByEmail.set(c.managerEmail.toLowerCase(), {
          artistName: c.artistName, managerName: c.managerName, avatarUrl: '',
          genres: [], instagramHandle: '', spotifyFollowers: 0,
        });
      });

      const campaignId = Date.now().toString();
      const campaignDate = new Date().toISOString();
      const sendEndpoint = '/api/send';
      const sendPayload = {
        trackTitle, driveLink, genres: selectedGenres,
        emailTemplate: useFollowUp ? demosFollowUpTemplate : demosTemplate,
        subjectTemplate: useFollowUp ? demosFollowUpSubject : demosSubject,
        senderName, signOff, signOffImage, minAudience, maxAudience, gender, artistType, minInstagram, maxInstagram,
        matchMode: demosMatchMode,
        sendDelay: sendDelay > 0 ? sendDelay : undefined,
        blacklist: blacklist.length > 0 ? blacklist : undefined,
        excludeEmails: excludedArtistNames.size > 0
          ? previewArtists.filter(a => excludedArtistNames.has(a.name)).flatMap(a => a.managerEmails)
          : undefined,
        customContacts: customContacts.length > 0
          ? customContacts.map(c => ({ artistName: c.artistName, managerName: c.managerName, managerEmail: c.managerEmail }))
          : undefined,
        accountId: selectedAccountId || undefined,
        threadIds: useFollowUp ? threadIdsFor('demos', trackTitle) : undefined,
      };

      const outcome = await sendInBatches(sendEndpoint, sendPayload, (progress, resultsSoFar, nextOffset) => {
        setSendResult(progress);
        // Persisted as each batch lands: closing the tab mid-send loses at most the
        // in-flight batch, not the whole campaign record. pendingSend carries enough
        // to resume the remaining recipients later instead of restarting from scratch.
        const sentEmails = resultsSoFar.filter(r => r.success).map(r => r.to);
        const recipients: CampaignRecipient[] = sentEmails.map(email => ({
          email,
          ...(artistByEmail.get(email.toLowerCase()) ?? {
            artistName: '', managerName: '', avatarUrl: '', genres: [], instagramHandle: '', spotifyFollowers: 0,
          }),
        }));
        upsertCampaign({
          id: campaignId, trackTitle, date: campaignDate, type: 'demos',
          emails: sentEmails, accountId: selectedAccountId, recipients,
          messageIds: messageIdsFromResults(resultsSoFar),
          pendingSend: nextOffset != null ? { endpoint: sendEndpoint, payload: sendPayload, offset: nextOffset } : undefined,
        });
      });
      if (!outcome.ok) { setSendError(outcome.error); }
      else {
        const failed = outcome.results.filter(r => !r.success).map(r => r.to);
        setSendFailedEmails(failed);
        recordFailedEmails(failed);
        if (outcome.results.some(r => r.success)) refreshSendsToday();
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
      case 'random':         return shuffle(arr);
    }
  }, [previewArtists, sortOrder]);

  const visibleArtists = useMemo(() => {
    const q = recipientSearch.trim().toLowerCase();
    if (!q) return sortedArtists;
    return sortedArtists.filter(a => a.name.toLowerCase().includes(q));
  }, [sortedArtists, recipientSearch]);

  const includedArtists = useMemo(
    () => previewArtists.filter(a => !excludedArtistNames.has(a.name)),
    [previewArtists, excludedArtistNames]
  );

  const totalEmails = countUniqueRecipients(
    includedArtists.flatMap(a => a.managerEmails),
    customContacts.map(c => c.managerEmail)
  );
  const canSend = !!trackTitle && !!driveLink && (selectedGenres.length > 0 || customContacts.length > 0) &&
    (previewDone || selectedGenres.length === 0) && totalEmails > 0;

  const demosDuplicateRecipients = useMemo(
    () => findDuplicateRecipients([...includedArtists.flatMap(a => a.managerEmails), ...customContacts.map(c => c.managerEmail)]),
    [includedArtists, customContacts, trackTitle, pitchedEmailMap]
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
    setRadioPreviewLoading(true); setRadioPreviewDone(false); setRadioInvalidEmails([]);
    try {
      const res = await fetch('/api/radio-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genres: selectedRadioGenres, locations: selectedLocations, matchMode: radioMatchMode }),
      });
      const data = await res.json();
      const stations = data.stations || [];
      setRadioStations(stations);
      setRadioPreviewDone(true);
      checkRecipientsValidity((stations as RadioStation[]).flatMap(s => s.emails)).then(setRadioInvalidEmails);
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
      const campaignId = Date.now().toString();
      const campaignDate = new Date().toISOString();
      const sendEndpoint = '/api/radio-send';
      const sendPayload = {
        trackTitle, driveLink, genres: selectedRadioGenres, locations: selectedLocations,
        emailTemplate: radioTemplate, subjectTemplate: radioSubject, senderName, signOff, signOffImage, matchMode: radioMatchMode,
        sendDelay: sendDelay > 0 ? sendDelay : undefined,
        blacklist: blacklist.length > 0 ? blacklist : undefined,
        accountId: selectedAccountId || undefined,
      };
      const outcome = await sendInBatches(sendEndpoint, sendPayload, (progress, resultsSoFar, nextOffset) => {
        setRadioSendResult(progress);
        const sentEmails = resultsSoFar.filter(r => r.success).map(r => r.to);
        upsertCampaign({
          id: campaignId, trackTitle, date: campaignDate, type: 'radio',
          emails: sentEmails, accountId: selectedAccountId, messageIds: messageIdsFromResults(resultsSoFar),
          pendingSend: nextOffset != null ? { endpoint: sendEndpoint, payload: sendPayload, offset: nextOffset } : undefined,
        });
      });
      if (!outcome.ok) { setRadioSendError(outcome.error); }
      else {
        const failed = outcome.results.filter(r => !r.success).map(r => r.to);
        setRadioSendFailedEmails(failed);
        recordFailedEmails(failed);
        if (outcome.results.some(r => r.success)) refreshSendsToday();
      }
    } finally { setRadioSending(false); }
  }

  const radioTotalEmails = countUniqueRecipients(radioStations.flatMap(s => s.emails));
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
    setPlaylistPreviewLoading(true); setPlaylistPreviewDone(false); setPlaylistInvalidEmails([]);
    try {
      const res = await fetch('/api/playlist-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genres: selectedPlaylistGenres, platforms: selectedPlatforms, matchMode: playlistMatchMode }),
      });
      const data = await res.json();
      const curators = data.curators || [];
      setPlaylistCurators(curators);
      setPlaylistPreviewDone(true);
      checkRecipientsValidity((curators as PlaylistCurator[]).flatMap(c => c.emails)).then(setPlaylistInvalidEmails);
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
      const campaignId = Date.now().toString();
      const campaignDate = new Date().toISOString();
      const sendEndpoint = '/api/playlist-send';
      const sendPayload = {
        trackTitle, driveLink, genres: selectedPlaylistGenres, platforms: selectedPlatforms,
        emailTemplate: playlistTemplate, subjectTemplate: playlistSubject, senderName, signOff, signOffImage, matchMode: playlistMatchMode,
        sendDelay: sendDelay > 0 ? sendDelay : undefined,
        blacklist: blacklist.length > 0 ? blacklist : undefined,
        accountId: selectedAccountId || undefined,
      };
      const outcome = await sendInBatches(sendEndpoint, sendPayload, (progress, resultsSoFar, nextOffset) => {
        setPlaylistSendResult(progress);
        const sentEmails = resultsSoFar.filter(r => r.success).map(r => r.to);
        upsertCampaign({
          id: campaignId, trackTitle, date: campaignDate, type: 'playlists',
          emails: sentEmails, accountId: selectedAccountId, messageIds: messageIdsFromResults(resultsSoFar),
          pendingSend: nextOffset != null ? { endpoint: sendEndpoint, payload: sendPayload, offset: nextOffset } : undefined,
        });
      });
      if (!outcome.ok) { setPlaylistSendError(outcome.error); }
      else {
        const failed = outcome.results.filter(r => !r.success).map(r => r.to);
        setPlaylistSendFailedEmails(failed);
        recordFailedEmails(failed);
        if (outcome.results.some(r => r.success)) refreshSendsToday();
      }
    } finally { setPlaylistSending(false); }
  }

  const playlistTotalEmails = countUniqueRecipients(playlistCurators.flatMap(c => c.emails));
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
      includedArtists.slice(0, 20).forEach(a => {
        a.managerEmails.forEach((email, idx) => {
          const vars = { managerName: a.managerNames[idx] || 'there', artistName: a.name, trackTitle, driveLink, senderName, managementCompany: a.managementCompany, pronoun: pronounForClient(a.gender, a.type) };
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
        const vars = { managerName: cc.managerName || 'there', artistName: cc.artistName, trackTitle, driveLink, senderName, managementCompany: '', pronoun: 'they' };
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
  }, [previewModalType, includedArtists, radioStations, playlistCurators, demosTemplate, demosSubject, demosFollowUpTemplate, demosFollowUpSubject, useFollowUp, radioTemplate, radioSubject, playlistTemplate, playlistSubject, signOff, trackTitle, driveLink, senderName, customContacts]);

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
            onClick={() => setActiveSection(item.id)}
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
              onClick={() => setActiveSection(item.id)}
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
            {activeSection === 'overview' && <OverviewSection analyticsStats={analyticsStats} />}

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
                          {['{{managerName}}', '{{artistName}}', '{{trackTitle}}', '{{driveLink}}', '{{senderName}}', '{{managementCompany}}', '{{pronoun}}'].map(v => (
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
                        {['{{managerName}}', '{{artistName}}', '{{trackTitle}}', '{{driveLink}}', '{{senderName}}', '{{pronoun}}'].map(v => (
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
                      <span className="text-sm text-zinc-400">
                        {includedArtists.length}{includedArtists.length !== previewArtists.length ? ` of ${previewArtists.length}` : ''} artists selected · {totalEmails} emails
                      </span>
                    )}
                    {!previewDone && customContacts.length > 0 && (
                      <span className="text-sm text-zinc-400">{customContacts.length} custom contact{customContacts.length !== 1 ? 's' : ''}</span>
                    )}
                  </div>

                  {previewDone && previewArtists.length > 0 && (
                    <section className={`bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden transition-opacity ${previewLoading ? 'opacity-60' : ''}`}>
                      <div className="px-4 md:px-6 py-3 md:py-4 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-zinc-300">Recipients Preview <span className="text-zinc-500 font-normal">· {previewLoading ? 'Updating…' : `${visibleArtists.length}${visibleArtists.length !== previewArtists.length ? ` of ${previewArtists.length}` : ''} artists`}</span></h3>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setExcludedArtistNames(prev => {
                              const next = new Set(prev);
                              visibleArtists.forEach(a => next.add(a.name));
                              return next;
                            })}
                            className="text-xs text-zinc-400 hover:text-zinc-200 transition"
                            title="Uncheck all artists currently shown">
                            Deselect all
                          </button>
                          <button
                            onClick={() => setExcludedArtistNames(prev => {
                              const next = new Set(prev);
                              visibleArtists.forEach(a => next.delete(a.name));
                              return next;
                            })}
                            className="text-xs text-zinc-400 hover:text-zinc-200 transition"
                            title="Check all artists currently shown">
                            Select all
                          </button>
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
                                          <CopyableName name={a.name} className="text-sm font-medium text-white" />
                                          {uniquePitched.length > 0 && <PitchedBadge tracks={uniquePitched} />}
                                          {a.instagramHandle && (
                                            <a href={`https://instagram.com/${a.instagramHandle.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                                              onClick={e => e.stopPropagation()}
                                              className="inline-flex items-center bg-zinc-800 hover:bg-zinc-700 text-pink-400 p-1 rounded transition">
                                              <svg viewBox="0 0 24 24" className="w-3 h-3 fill-pink-400 shrink-0"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.012-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.058 1.645-.07 4.849-.07zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.98-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.198-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                                            </a>
                                          )}
                                          {a.spotifyFollowers > 0 && (
                                            <SpotifyLink name={a.name} followers={a.spotifyFollowers} />
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
                          const isExcluded = excludedArtistNames.has(a.name);
                          return (
                            <div key={a.name} onClick={() => toggleArtistExclusion(a.name)}
                              className={`cursor-pointer px-4 md:px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 transition hover:bg-zinc-800/40 ${isExcluded ? 'opacity-40' : ''}`}>
                              <div className="flex items-center gap-3 min-w-0">
                                <input type="checkbox" checked={!isExcluded} onChange={() => toggleArtistExclusion(a.name)}
                                  onClick={e => e.stopPropagation()}
                                  title={isExcluded ? 'Excluded from this send — click to include' : 'Click to exclude from this send'}
                                  className="shrink-0 w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-violet-600 focus:ring-2 focus:ring-violet-500 focus:ring-offset-0 cursor-pointer accent-violet-600" />
                                <div className="shrink-0 w-10 h-10 rounded-full overflow-hidden bg-zinc-700">
                                  {a.avatarUrl ? (
                                    <img src={a.avatarUrl} alt={a.name} width={40} height={40} className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-zinc-500 text-xs font-bold">{a.name.charAt(0)}</div>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <CopyableName name={a.name} className="text-sm font-medium text-white" />
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
                                      <SpotifyLink name={a.name} followers={a.spotifyFollowers} />
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
                                            onClick={e => { e.stopPropagation(); toggleGenreFromPreview(g); }}
                                            disabled={previewLoading}
                                            title={active ? `Remove "${g}" from genre filters and refresh` : `Add "${g}" to genre filters and refresh`}
                                            className={`text-[11px] px-2 py-0.5 rounded-full font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
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
                                  <CopyableName name={c.artistName} className="text-sm font-medium text-white" />
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

                  {!sendResult && demosInvalidEmails.length > 0 && (
                    <div className="rounded-lg bg-red-900/20 border border-red-700/40 px-5 py-3 space-y-2">
                      <p className="text-red-400 text-sm">
                        {demosInvalidEmails.length} address{demosInvalidEmails.length !== 1 ? 'es' : ''} {demosInvalidEmails.length !== 1 ? "don't" : "doesn't"} look deliverable (no working mail server found) and will likely bounce.
                      </p>
                      <button onClick={() => { addFailedToBlacklist(demosInvalidEmails); setDemosInvalidEmails([]); }}
                        className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded-lg text-zinc-300 transition">
                        Add {demosInvalidEmails.length} address{demosInvalidEmails.length !== 1 ? 'es' : ''} to blacklist
                      </button>
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

                  <div className="pt-3 mt-1 border-t border-zinc-800 space-y-2">
                    <p className="text-xs text-zinc-500">Happy with it? Send yourself a test with the real subject, template and merge fields filled in before sending to everyone.</p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="email"
                        value={testEmailTo}
                        onChange={e => { setTestEmailTo(e.target.value); setTestEmailResult(null); }}
                        placeholder="your-own-email@example.com"
                        className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
                      />
                      <button
                        onClick={handleTestEmail}
                        disabled={!testEmailTo || testEmailSending || !selectedAccountId}
                        className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition sm:shrink-0"
                      >
                        {testEmailSending ? 'Sending…' : 'Send test email'}
                      </button>
                    </div>
                    {testEmailResult === 'success' && <p className="text-xs text-green-400">Test email sent. Check your inbox.</p>}
                    {testEmailResult === 'error' && <p className="text-xs text-red-400">{testEmailError}</p>}
                    {!selectedAccountId && <p className="text-xs text-amber-500">Add and select an email account in the Account tab first.</p>}
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
                    {playlistAllGenres.length === 0 && (
                      <div className="rounded-lg bg-amber-900/20 border border-amber-700/40 px-5 py-3">
                        <p className="text-amber-400 text-sm">
                          The playlist curator database (<code className="text-amber-300">data/playlists.json</code>) is empty, so this tab has no one to send to yet.
                          Add curator records there matching the <code className="text-amber-300">PlaylistCurator</code> shape in <code className="text-amber-300">lib/playlists.ts</code> to enable it.
                        </p>
                      </div>
                    )}
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

                    {!playlistSendResult && playlistInvalidEmails.length > 0 && (
                      <div className="rounded-lg bg-red-900/20 border border-red-700/40 px-5 py-3 space-y-2">
                        <p className="text-red-400 text-sm">
                          {playlistInvalidEmails.length} address{playlistInvalidEmails.length !== 1 ? 'es' : ''} {playlistInvalidEmails.length !== 1 ? "don't" : "doesn't"} look deliverable (no working mail server found) and will likely bounce.
                        </p>
                        <button onClick={() => { addFailedToBlacklist(playlistInvalidEmails); setPlaylistInvalidEmails([]); }}
                          className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded-lg text-zinc-300 transition">
                          Add {playlistInvalidEmails.length} address{playlistInvalidEmails.length !== 1 ? 'es' : ''} to blacklist
                        </button>
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

                    {!radioSendResult && radioInvalidEmails.length > 0 && (
                      <div className="rounded-lg bg-red-900/20 border border-red-700/40 px-5 py-3 space-y-2">
                        <p className="text-red-400 text-sm">
                          {radioInvalidEmails.length} address{radioInvalidEmails.length !== 1 ? 'es' : ''} {radioInvalidEmails.length !== 1 ? "don't" : "doesn't"} look deliverable (no working mail server found) and will likely bounce.
                        </p>
                        <button onClick={() => { addFailedToBlacklist(radioInvalidEmails); setRadioInvalidEmails([]); }}
                          className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-1.5 rounded-lg text-zinc-300 transition">
                          Add {radioInvalidEmails.length} address{radioInvalidEmails.length !== 1 ? 'es' : ''} to blacklist
                        </button>
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
              <AccountSection
                emailAccounts={emailAccounts} selectedAccountId={selectedAccountId} selectAccount={selectAccount} removeAccount={removeAccount}
                showAddAccount={showAddAccount} setShowAddAccount={setShowAddAccount} newAccount={newAccount} setNewAccount={setNewAccount}
                addAccount={addAccount} savingAccount={savingAccount} accountError={accountError} setAccountError={setAccountError}
                signOff={signOff} setSignOff={setSignOff} signOffImage={signOffImage} setSignOffImage={setSignOffImage}
                handleSignOffImageUpload={handleSignOffImageUpload}
                blacklist={blacklist} newBlacklistEmail={newBlacklistEmail} setNewBlacklistEmail={setNewBlacklistEmail}
                addToBlacklist={addToBlacklist} removeFromBlacklist={removeFromBlacklist}
                failedEmails={failedEmails} moveFailedToDoNotContact={moveFailedToDoNotContact} removeFromFailedEmails={removeFromFailedEmails}
                sendDelay={sendDelay} setSendDelay={setSendDelay}
                dailySendCap={dailySendCap} setDailyCap={setDailyCap} sendsToday={sendsToday} sendsTodayByAccount={sendsTodayByAccount}
                testEmailTo={testEmailTo} setTestEmailTo={setTestEmailTo} testEmailSending={testEmailSending} handleTestEmail={handleTestEmail}
                showTestEmailOptions={showTestEmailOptions} setShowTestEmailOptions={setShowTestEmailOptions}
                testEmailSubject={testEmailSubject} setTestEmailSubject={setTestEmailSubject}
                testEmailMessage={testEmailMessage} setTestEmailMessage={setTestEmailMessage}
                demosSubject={demosSubject} demosTemplate={demosTemplate}
                testEmailResult={testEmailResult} setTestEmailResult={setTestEmailResult} testEmailError={testEmailError}
                selectedAccount={selectedAccount} deliverabilityLoading={deliverabilityLoading}
                handleDeliverabilityCheck={handleDeliverabilityCheck} deliverabilityResult={deliverabilityResult}
              />
            )}

            {/* ── History ── */}
            {activeSection === 'history' && (
              <HistorySection
                campaigns={campaigns} filteredCampaigns={filteredCampaigns} exportCampaignsCsv={exportCampaignsCsv} clearCampaignHistory={clearCampaignHistory}
                historySearch={historySearch} setHistorySearch={setHistorySearch} historyTypeFilter={historyTypeFilter} setHistoryTypeFilter={setHistoryTypeFilter}
                historyDateFrom={historyDateFrom} setHistoryDateFrom={setHistoryDateFrom} historyDateTo={historyDateTo} setHistoryDateTo={setHistoryDateTo}
                demosSendoutGroups={demosSendoutGroups} expandedCampaignId={expandedCampaignId} setExpandedCampaignId={setExpandedCampaignId}
                checkingRepliesId={checkingRepliesId} checkReplies={checkReplies} replyCheckResult={replyCheckResult} replyCheckError={replyCheckError}
                formatCheckedAt={formatCheckedAt}
                backfillingId={backfillingId} backfillRecipients={backfillRecipients} backfillError={backfillError}
                resumingCampaignId={resumingCampaignId} resumeSend={resumeSend} resumeError={resumeError} resumeProgress={resumeProgress}
              />
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
                  <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-4 py-3 space-y-3">
                    <pre className="text-sm text-zinc-200 whitespace-pre-wrap font-sans leading-relaxed">{previewModalEntries[previewModalIdx].body}</pre>
                    {signOffImage && (
                      <img src={signOffImage} alt="Signature" className="max-h-24 max-w-xs rounded border border-zinc-700 object-contain bg-zinc-800" />
                    )}
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
