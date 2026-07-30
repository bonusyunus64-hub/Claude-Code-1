'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { hydrateFromRemote, syncStorage } from '@/lib/remoteSync';
import type {
  Artist, RadioStation, PlaylistCurator, EmailAccount, NewAccountForm,
  CampaignRecipient, Campaign, CustomContact, DeliverabilityResult, ReplyClassification, RateBreakdown,
  DemosFilterPreset, SavedTemplate,
} from './types';
import {
  DEFAULT_DEMOS_TEMPLATE, DEFAULT_FOLLOWUP_TEMPLATE, DEFAULT_RADIO_TEMPLATE, DEFAULT_PLAYLIST_TEMPLATE,
  DEFAULT_DEMOS_SUBJECT, DEFAULT_FOLLOWUP_SUBJECT, DEFAULT_RADIO_SUBJECT, DEFAULT_PLAYLIST_SUBJECT,
  DEFAULT_SIGN_OFF, BLANK_ACCOUNT,
} from './constants';
import {
  sendInBatches, downloadCsv, parseContactsCsv, shuffle, countUniqueRecipients,
  renderTemplateClient, pronounForClient, findDuplicateRecipients, messageIdsFromResults, checkRecipientsValidity,
} from './utils';
import { usePromotionChannel } from './hooks/usePromotionChannel';
import { OverviewSection } from './sections/OverviewSection';
import { DemosSection } from './sections/DemosSection';
import { PromotionSection } from './sections/PromotionSection';
import { AccountSection } from './sections/AccountSection';
import { HistorySection } from './sections/HistorySection';

export default function Dashboard() {
  const [activeSection, setActiveSection] = useState<'overview' | 'demos' | 'promotion' | 'account' | 'history'>('demos');
  const [demosTab, setDemosTab] = useState<'compose' | 'template'>('compose');
  const [promotionTab, setPromotionTab] = useState<'compose' | 'template'>('compose');
  const [promotionSection, setPromotionSection] = useState<'radio' | 'playlists'>('radio');
  const [demosMatchMode, setDemosMatchMode] = useState<'any' | 'all'>('any');

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

  // Track Promotion (Radio/Playlists) — template/subject text stays here since it
  // participates in the shared dirty-tracking/save-all below; everything else
  // (genre/secondary-filter selection, preview, send, presets, template library)
  // is owned by usePromotionChannel, instantiated further down for each channel.
  const [radioTemplate, setRadioTemplate] = useState(DEFAULT_RADIO_TEMPLATE);
  const [radioSubject, setRadioSubject] = useState(DEFAULT_RADIO_SUBJECT);
  const [playlistTemplate, setPlaylistTemplate] = useState(DEFAULT_PLAYLIST_TEMPLATE);
  const [playlistSubject, setPlaylistSubject] = useState(DEFAULT_PLAYLIST_SUBJECT);

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
  const [autoFollowUpEnabled, setAutoFollowUpEnabled] = useState(false);
  const [autoFollowUpDays, setAutoFollowUpDays] = useState(5);
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

  // Radio and Playlists were near-exact duplicates of each other (genre/secondary-filter
  // selection, preview, send, presets, template library) — one hook, instantiated twice,
  // instead of two copies. See usePromotionChannel for what it owns vs. what stays here
  // (template/subject text, which participates in the dirty-tracking below). Declared
  // before the initial-load effect below so that effect can hydrate radio/playlists'
  // presets and template library via the hook's exposed setters.
  const radio = usePromotionChannel<RadioStation>({
    campaignType: 'radio',
    genresEndpoint: '/api/radio-genres',
    previewEndpoint: '/api/radio-preview',
    sendEndpoint: '/api/radio-send',
    resultsKey: 'stations',
    secondaryFilterKey: 'locations',
    nameVar: 'stationName',
    trackTitle, driveLink, senderName,
    template: radioTemplate, subject: radioSubject, setTemplate: setRadioTemplate, setSubject: setRadioSubject,
    signOff, signOffImage, selectedAccountId, sendDelay, blacklist, dailySendCap, sendsToday,
    accountCapError, refreshSendsToday, recordFailedEmails, pitchedEmailMap, upsertCampaign,
  });

  const playlists = usePromotionChannel<PlaylistCurator>({
    campaignType: 'playlists',
    genresEndpoint: '/api/playlist-genres',
    previewEndpoint: '/api/playlist-preview',
    sendEndpoint: '/api/playlist-send',
    resultsKey: 'curators',
    secondaryFilterKey: 'platforms',
    nameVar: 'curatorName',
    trackTitle, driveLink, senderName,
    template: playlistTemplate, subject: playlistSubject, setTemplate: setPlaylistTemplate, setSubject: setPlaylistSubject,
    signOff, signOffImage, selectedAccountId, sendDelay, blacklist, dailySendCap, sendsToday,
    accountCapError, refreshSendsToday, recordFailedEmails, pitchedEmailMap, upsertCampaign,
  });

  useEffect(() => {
    fetch('/api/genres').then(r => r.json()).then(d => { setAllGenres(d.genres || []); setTopGenres(d.topGenres || []); });
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
      if (savedRadioPresets) radio.setPresets(JSON.parse(savedRadioPresets));

      const savedPlaylistPresets = localStorage.getItem('tp_playlist_presets');
      if (savedPlaylistPresets) playlists.setPresets(JSON.parse(savedPlaylistPresets));

      const savedDemosTemplates = localStorage.getItem('tp_demos_templates');
      if (savedDemosTemplates) setDemosTemplateLibrary(JSON.parse(savedDemosTemplates));

      const savedFollowUpTemplates = localStorage.getItem('tp_followup_templates');
      if (savedFollowUpTemplates) setFollowUpTemplateLibrary(JSON.parse(savedFollowUpTemplates));

      const savedRadioTemplates = localStorage.getItem('tp_radio_templates');
      if (savedRadioTemplates) radio.setTemplateLibrary(JSON.parse(savedRadioTemplates));

      const savedPlaylistTemplates = localStorage.getItem('tp_playlist_templates');
      if (savedPlaylistTemplates) playlists.setTemplateLibrary(JSON.parse(savedPlaylistTemplates));

      const savedDailyCap = localStorage.getItem('tp_daily_cap');
      if (savedDailyCap !== null) setDailySendCap(Number(savedDailyCap));

      const savedAutoFollowUpEnabled = localStorage.getItem('tp_auto_followup_enabled');
      if (savedAutoFollowUpEnabled !== null) setAutoFollowUpEnabled(savedAutoFollowUpEnabled === 'true');

      const savedAutoFollowUpDays = localStorage.getItem('tp_auto_followup_days');
      if (savedAutoFollowUpDays !== null) setAutoFollowUpDays(Number(savedAutoFollowUpDays));
    } catch {}
    })();
    // radio/playlists are plain objects rebuilt every render, so listing them here
    // would re-run this mount-only hydration on every render; only their setPresets/
    // setTemplateLibrary setters (stable, from useState) are actually called below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    const totalResponded = campaigns.reduce((s, c) => s + (c.responded?.length ?? 0), 0);
    const totalBounced = campaigns.reduce((s, c) => s + (c.bounced?.length ?? 0), 0);
    const replyRate = totalEmailsSent > 0 ? totalResponded / totalEmailsSent : 0;
    const bounceRate = totalEmailsSent > 0 ? totalBounced / totalEmailsSent : 0;

    const classificationCounts = { interested: 0, pass: 0, autoReply: 0, unclassified: 0 };
    campaigns.forEach(c => {
      Object.values(c.classifications ?? {}).forEach(cls => {
        if (cls === 'interested') classificationCounts.interested++;
        else if (cls === 'pass') classificationCounts.pass++;
        else if (cls === 'auto-reply') classificationCounts.autoReply++;
        else classificationCounts.unclassified++;
      });
    });

    const rate = (sent: number, responded: number): number => (sent > 0 ? responded / sent : 0);

    const byType: RateBreakdown[] = ([
      ['Song Demos', demosCampaigns], ['Track Promotion (Radio)', radioCampaigns], ['Playlist Curators', playlistCampaigns],
    ] as const).map(([label, list]) => {
      const sent = list.reduce((s, c) => s + c.emails.length, 0);
      const responded = list.reduce((s, c) => s + (c.responded?.length ?? 0), 0);
      return { label, sent, responded, replyRate: rate(sent, responded) };
    }).filter(b => b.sent > 0);

    // Genre and follower-tier breakdowns only make sense against recipient metadata
    // (genres, spotifyFollowers), which currently only Demos sends record.
    const genreTotals = new Map<string, { sent: number; responded: number }>();
    const FOLLOWER_TIERS: [string, (n: number) => boolean][] = [
      ['Under 10K', n => n < 10_000],
      ['10K–100K', n => n >= 10_000 && n < 100_000],
      ['100K–1M', n => n >= 100_000 && n < 1_000_000],
      ['1M+', n => n >= 1_000_000],
    ];
    const tierTotals = new Map<string, { sent: number; responded: number }>(FOLLOWER_TIERS.map(([label]) => [label, { sent: 0, responded: 0 }]));

    demosCampaigns.forEach(c => {
      const respondedSet = new Set((c.responded ?? []).map(e => e.toLowerCase()));
      (c.recipients ?? []).forEach(r => {
        const didRespond = respondedSet.has(r.email.toLowerCase());
        r.genres.forEach(genre => {
          const entry = genreTotals.get(genre) ?? { sent: 0, responded: 0 };
          entry.sent++;
          if (didRespond) entry.responded++;
          genreTotals.set(genre, entry);
        });
        const tierLabel = FOLLOWER_TIERS.find(([, test]) => test(r.spotifyFollowers))?.[0];
        if (tierLabel) {
          const entry = tierTotals.get(tierLabel)!;
          entry.sent++;
          if (didRespond) entry.responded++;
        }
      });
    });

    const byGenre: RateBreakdown[] = Array.from(genreTotals.entries())
      .map(([label, { sent, responded }]) => ({ label, sent, responded, replyRate: rate(sent, responded) }))
      .sort((a, b) => b.sent - a.sent)
      .slice(0, 10);

    const byFollowerTier: RateBreakdown[] = FOLLOWER_TIERS
      .map(([label]) => ({ label, ...tierTotals.get(label)! }))
      .filter(b => b.sent > 0)
      .map(b => ({ ...b, replyRate: rate(b.sent, b.responded) }));

    return {
      totalCampaigns, totalEmailsSent,
      demosCampaignCount: demosCampaigns.length, radioCampaignCount: radioCampaigns.length, playlistCampaignCount: playlistCampaigns.length,
      demosEmailsSent, radioEmailsSent, playlistEmailsSent,
      topTracks, last14Days, maxDayCount,
      lastCampaignDate: campaigns.length ? campaigns.slice().sort((a, b) => b.date.localeCompare(a.date))[0].date : null,
      totalResponded, totalBounced, replyRate, bounceRate, classificationCounts,
      byType, byGenre, byFollowerTier,
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

      // Best-effort keyword classification of what each reply actually said
      // (lib/checkReplies.ts's classifyReply) — keyed lowercase, since that's how
      // the check-replies route derives it from inbox envelopes.
      const foundClassifications = (data.classifications as Record<string, ReplyClassification> | undefined) ?? {};
      const classifications = { ...(c.classifications ?? {}), ...foundClassifications };

      // checkReplies only ever runs from a button's onClick (passed down to
      // HistorySection), never during render, so Date.now() here is safe — this is
      // the react-compiler plugin flagging a callback-prop function's body more
      // strictly than the many identical Date.now()/inline-object patterns used in
      // page.tsx's own onClick handlers, which it doesn't scrutinize the same way.
      // eslint-disable-next-line react-hooks/purity
      const checkedAt = Date.now();
      upsertCampaign({ ...c, responded, bounced, classifications, lastChecked: checkedAt });
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
   * loop in handleSend and usePromotionChannel's handleSend after every batch, so
   * at most the one in-flight batch when the interruption happened gets re-sent.
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

  function setAutoFollowUp(enabled: boolean) {
    setAutoFollowUpEnabled(enabled);
    syncStorage.setItem('tp_auto_followup_enabled', String(enabled));
  }

  function setAutoFollowUpDaysValue(days: number) {
    setAutoFollowUpDays(days);
    syncStorage.setItem('tp_auto_followup_days', String(days));
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
   * Client-side mirror of the per-account check in lib/sendQuota.ts's
   * checkCapAllows — lets a send be blocked before any network request instead of
   * only after the server rejects the first batch. The server still enforces this
   * independently, since sendsTodayByAccount here can be stale.
   */
  function accountCapError(accountId: string, additionalSends: number): string | null {
    const account = emailAccounts.find(a => a.id === accountId);
    const cap = account?.dailyCap ?? 0;
    if (cap <= 0) return null;
    const sentSoFar = sendsTodayByAccount[accountId] ?? 0;
    if (sentSoFar + additionalSends <= cap) return null;
    return `This account has reached its daily limit (${sentSoFar}/${cap} sent today). Switch accounts, wait until tomorrow, or raise its limit in Account settings.`;
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
    const accountCapErr = selectedAccountId && accountCapError(selectedAccountId, totalEmails);
    if (accountCapErr) { setSendError(accountCapErr); return; }
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
          driveLink, senderName,
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
    () => findDuplicateRecipients(pitchedEmailMap, trackTitle, [...includedArtists.flatMap(a => a.managerEmails), ...customContacts.map(c => c.managerEmail)]),
    [includedArtists, customContacts, trackTitle, pitchedEmailMap]
  );

  const selectedAccount = emailAccounts.find(a => a.id === selectedAccountId);

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
      playlists.results.slice(0, 20).forEach(c => {
        c.emails.forEach(email => {
          const vars = { curatorName: c.name, trackTitle, driveLink, senderName };
          const bodyParts = [renderTemplateClient(playlists.template, vars)];
          if (signOff?.trim()) bodyParts.push(renderTemplateClient(signOff, vars));
          entries.push({
            label: `${c.name} <${email}>`,
            to: email,
            subject: renderTemplateClient(playlists.subject, vars),
            body: bodyParts.join('\n\n'),
          });
        });
      });
      return entries;
    }
    const entries: PreviewEntry[] = [];
    radio.results.slice(0, 20).forEach(s => {
      s.emails.forEach(email => {
        const vars = { stationName: s.name, trackTitle, driveLink, senderName };
        const bodyParts = [renderTemplateClient(radio.template, vars)];
        if (signOff?.trim()) bodyParts.push(renderTemplateClient(signOff, vars));
        entries.push({
          label: `${s.name} <${email}>`,
          to: email,
          subject: renderTemplateClient(radio.subject, vars),
          body: bodyParts.join('\n\n'),
        });
      });
    });
    return entries;
  }, [previewModalType, includedArtists, radio.results, playlists.results, demosTemplate, demosSubject, demosFollowUpTemplate, demosFollowUpSubject, useFollowUp, radio.template, radio.subject, playlists.template, playlists.subject, signOff, trackTitle, driveLink, senderName, customContacts]);

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
              <DemosSection
                demosTab={demosTab} setDemosTab={setDemosTab}
                demosSubject={demosSubject} setDemosSubject={setDemosSubject} demosTemplate={demosTemplate} setDemosTemplate={setDemosTemplate}
                demosTemplateLibrary={demosTemplateLibrary} newDemosTemplateName={newDemosTemplateName} setNewDemosTemplateName={setNewDemosTemplateName}
                saveDemosTemplateToLibrary={saveDemosTemplateToLibrary} loadDemosTemplateFromLibrary={loadDemosTemplateFromLibrary} deleteDemosTemplateFromLibrary={deleteDemosTemplateFromLibrary}
                demosFollowUpSubject={demosFollowUpSubject} setDemosFollowUpSubject={setDemosFollowUpSubject} demosFollowUpTemplate={demosFollowUpTemplate} setDemosFollowUpTemplate={setDemosFollowUpTemplate}
                followUpTemplateLibrary={followUpTemplateLibrary} newFollowUpTemplateName={newFollowUpTemplateName} setNewFollowUpTemplateName={setNewFollowUpTemplateName}
                saveFollowUpTemplateToLibrary={saveFollowUpTemplateToLibrary} loadFollowUpTemplateFromLibrary={loadFollowUpTemplateFromLibrary} deleteFollowUpTemplateFromLibrary={deleteFollowUpTemplateFromLibrary}
                senderName={senderName} setSenderName={setSenderName} trackTitle={trackTitle} setTrackTitle={setTrackTitle} demosPitchCount={demosPitchCount}
                driveLink={driveLink} setDriveLink={setDriveLink}
                demosPresets={demosPresets} newDemosPresetName={newDemosPresetName} setNewDemosPresetName={setNewDemosPresetName}
                saveDemosPreset={saveDemosPreset} loadDemosPreset={loadDemosPreset} deleteDemosPreset={deleteDemosPreset}
                demosMatchMode={demosMatchMode} setDemosMatchMode={setDemosMatchMode} selectedGenres={selectedGenres} setSelectedGenres={setSelectedGenres} toggleGenre={toggleGenre}
                genreSearch={genreSearch} setGenreSearch={setGenreSearch} showGenreDropdown={showGenreDropdown} setShowGenreDropdown={setShowGenreDropdown}
                topGenres={topGenres} filteredGenres={filteredGenres} resetFilters={resetFilters} setPreviewDone={setPreviewDone} setSendResult={setSendResult}
                minAudience={minAudience} setMinAudience={setMinAudience} maxAudience={maxAudience} setMaxAudience={setMaxAudience}
                showInstagram={showInstagram} setShowInstagram={setShowInstagram} minInstagram={minInstagram} setMinInstagram={setMinInstagram}
                maxInstagram={maxInstagram} setMaxInstagram={setMaxInstagram} gender={gender} setGender={setGender} artistType={artistType} setArtistType={setArtistType}
                customContacts={customContacts} removeCustomContact={removeCustomContact} showAddCustomContact={showAddCustomContact} setShowAddCustomContact={setShowAddCustomContact}
                newCustomContact={newCustomContact} setNewCustomContact={setNewCustomContact} addCustomContact={addCustomContact} handleCustomContactsCsv={handleCustomContactsCsv}
                handlePreview={handlePreview} previewDone={previewDone} previewLoading={previewLoading} previewArtists={previewArtists}
                includedArtists={includedArtists} visibleArtists={visibleArtists} totalEmails={totalEmails}
                setExcludedArtistNames={setExcludedArtistNames} excludedArtistNames={excludedArtistNames} toggleArtistExclusion={toggleArtistExclusion} toggleGenreFromPreview={toggleGenreFromPreview}
                recipientSearch={recipientSearch} setRecipientSearch={setRecipientSearch} sortOrder={sortOrder} setSortOrder={setSortOrder}
                outsideResults={outsideResults} outsideResultsQuery={outsideResultsQuery} outsideSearchLoading={outsideSearchLoading}
                handleOutsideSearch={handleOutsideSearch} addOutsideArtistToContacts={addOutsideArtistToContacts} pitchedEmailMap={pitchedEmailMap}
                setPreviewModalType={setPreviewModalType} setPreviewModalIdx={setPreviewModalIdx}
                demosDuplicateRecipients={demosDuplicateRecipients} demosInvalidEmails={demosInvalidEmails} setDemosInvalidEmails={setDemosInvalidEmails} addFailedToBlacklist={addFailedToBlacklist}
                sendResult={sendResult} sendFailedEmails={sendFailedEmails} setSendFailedEmails={setSendFailedEmails} sendError={sendError}
                useFollowUp={useFollowUp} setUseFollowUp={setUseFollowUp} handleSend={handleSend} canSend={canSend} sending={sending}
                selectedAccount={selectedAccount} setActiveSection={setActiveSection}
                testEmailTo={testEmailTo} setTestEmailTo={setTestEmailTo} setTestEmailResult={setTestEmailResult} handleTestEmail={handleTestEmail}
                testEmailSending={testEmailSending} selectedAccountId={selectedAccountId} testEmailResult={testEmailResult} testEmailError={testEmailError}
              />
            )}

            {/* ── Track Promotion ── */}
            {activeSection === 'promotion' && (
              <PromotionSection
                promotionTab={promotionTab} setPromotionTab={setPromotionTab} promotionSection={promotionSection} setPromotionSection={setPromotionSection}
                senderName={senderName} setSenderName={setSenderName} trackTitle={trackTitle} setTrackTitle={setTrackTitle}
                driveLink={driveLink} setDriveLink={setDriveLink}
                pitchedEmailMap={pitchedEmailMap} selectedAccount={selectedAccount} setActiveSection={setActiveSection}
                addFailedToBlacklist={addFailedToBlacklist} setPreviewModalType={setPreviewModalType} setPreviewModalIdx={setPreviewModalIdx}
                radio={radio} radioPitchCount={radioPitchCount}
                playlists={playlists} playlistPitchCount={playlistPitchCount}
              />
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
                autoFollowUpEnabled={autoFollowUpEnabled} setAutoFollowUp={setAutoFollowUp}
                autoFollowUpDays={autoFollowUpDays} setAutoFollowUpDaysValue={setAutoFollowUpDaysValue}
                demosFollowUpTemplate={demosFollowUpTemplate}
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
