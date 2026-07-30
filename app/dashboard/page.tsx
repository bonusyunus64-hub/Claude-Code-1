'use client';

import { useState, useEffect, useMemo } from 'react';
import { hydrateFromRemote, syncStorage } from '@/lib/remoteSync';
import type {
  Artist, RadioStation, PlaylistCurator, EmailAccount, NewAccountForm,
  CustomContact, DeliverabilityResult,
} from './types';
import {
  DEFAULT_DEMOS_TEMPLATE, DEFAULT_FOLLOWUP_TEMPLATE, DEFAULT_RADIO_TEMPLATE, DEFAULT_PLAYLIST_TEMPLATE,
  DEFAULT_DEMOS_SUBJECT, DEFAULT_FOLLOWUP_SUBJECT, DEFAULT_RADIO_SUBJECT, DEFAULT_PLAYLIST_SUBJECT,
  DEFAULT_SIGN_OFF, BLANK_ACCOUNT,
} from './constants';
import {
  parseContactsCsv, renderTemplateClient, pronounForClient, computeAnalyticsStats,
} from './utils';
import { usePromotionChannel } from './hooks/usePromotionChannel';
import { useCampaignHistory } from './hooks/useCampaignHistory';
import { useDemosFlow } from './hooks/useDemosFlow';
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

  // Shared track details
  const [trackTitle, setTrackTitle] = useState('');
  const [driveLink, setDriveLink] = useState('');
  const [senderName, setSenderName] = useState('');

  // Song Demos — template/subject text (both the initial-pitch and follow-up pair)
  // stays here since it participates in the shared dirty-tracking/save-all below;
  // everything else is owned by useDemosFlow, instantiated further down.
  const [demosTemplate, setDemosTemplate] = useState(DEFAULT_DEMOS_TEMPLATE);
  const [demosSubject, setDemosSubject] = useState(DEFAULT_DEMOS_SUBJECT);
  const [demosFollowUpTemplate, setDemosFollowUpTemplate] = useState(DEFAULT_FOLLOWUP_TEMPLATE);
  const [demosFollowUpSubject, setDemosFollowUpSubject] = useState(DEFAULT_FOLLOWUP_SUBJECT);

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

  // Owns campaigns state itself (fetched once on mount) plus everything History-tab
  // specific — the single source of truth the send flows below write through via
  // history.upsertCampaign, instead of duplicating campaign-state ownership.
  const history = useCampaignHistory({ emailAccounts, customContacts, addFailedToBlacklist, refreshSendsToday });

  const pitchedEmailMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const campaign of history.campaigns) {
      for (const email of campaign.emails) {
        const key = email.toLowerCase();
        const existing = map.get(key) ?? [];
        if (!existing.includes(campaign.trackTitle)) {
          map.set(key, [...existing, campaign.trackTitle]);
        }
      }
    }
    return map;
  }, [history.campaigns]);

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
    accountCapError, refreshSendsToday, recordFailedEmails, pitchedEmailMap, upsertCampaign: history.upsertCampaign,
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
    accountCapError, refreshSendsToday, recordFailedEmails, pitchedEmailMap, upsertCampaign: history.upsertCampaign,
  });

  // No twin to share an implementation with (unlike Radio/Playlists) — this is the
  // one place page.tsx's Demos-tab complexity (audience/Instagram/gender filters,
  // exclusions, outside-artist search, sort/search, both template libraries) lives
  // now instead of inline. Declared before the initial-load effect below for the
  // same reason as radio/playlists above.
  const demos = useDemosFlow({
    trackTitle, driveLink, senderName,
    demosTemplate, demosSubject, setDemosTemplate, setDemosSubject,
    demosFollowUpTemplate, demosFollowUpSubject, setDemosFollowUpTemplate, setDemosFollowUpSubject,
    signOff, signOffImage, selectedAccountId, sendDelay, blacklist, dailySendCap, sendsToday,
    accountCapError, refreshSendsToday, recordFailedEmails, pitchedEmailMap,
    upsertCampaign: history.upsertCampaign, threadIdsFor: history.threadIdsFor,
    customContacts,
  });

  useEffect(() => {
    fetch('/api/send-quota').then(r => r.json()).then(d => { setSendsToday(d.count ?? 0); setSendsTodayByAccount(d.byAccount ?? {}); }).catch(() => {});
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
      if (savedDemosPresets) demos.setDemosPresets(JSON.parse(savedDemosPresets));

      const savedRadioPresets = localStorage.getItem('tp_radio_presets');
      if (savedRadioPresets) radio.setPresets(JSON.parse(savedRadioPresets));

      const savedPlaylistPresets = localStorage.getItem('tp_playlist_presets');
      if (savedPlaylistPresets) playlists.setPresets(JSON.parse(savedPlaylistPresets));

      const savedDemosTemplates = localStorage.getItem('tp_demos_templates');
      if (savedDemosTemplates) demos.setDemosTemplateLibrary(JSON.parse(savedDemosTemplates));

      const savedFollowUpTemplates = localStorage.getItem('tp_followup_templates');
      if (savedFollowUpTemplates) demos.setFollowUpTemplateLibrary(JSON.parse(savedFollowUpTemplates));

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
    // radio/playlists/demos are plain objects rebuilt every render, so listing them
    // here would re-run this mount-only hydration on every render; only their
    // setPresets/setTemplateLibrary-family setters (stable, from useState) are
    // actually called below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const demosPitchCount = useMemo(() => {
    const title = trackTitle.trim().toLowerCase();
    if (!title) return 0;
    return history.campaigns
      .filter(c => c.type === 'demos' && c.trackTitle.trim().toLowerCase() === title)
      .reduce((sum, c) => sum + c.emails.length, 0);
  }, [history.campaigns, trackTitle]);

  const radioPitchCount = useMemo(() => {
    const title = trackTitle.trim().toLowerCase();
    if (!title) return 0;
    return history.campaigns
      .filter(c => c.type === 'radio' && c.trackTitle.trim().toLowerCase() === title)
      .reduce((sum, c) => sum + c.emails.length, 0);
  }, [history.campaigns, trackTitle]);

  const playlistPitchCount = useMemo(() => {
    const title = trackTitle.trim().toLowerCase();
    if (!title) return 0;
    return history.campaigns
      .filter(c => c.type === 'playlists' && c.trackTitle.trim().toLowerCase() === title)
      .reduce((sum, c) => sum + c.emails.length, 0);
  }, [history.campaigns, trackTitle]);

  const analyticsStats = useMemo(() => computeAnalyticsStats(history.campaigns), [history.campaigns]);

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
      const sampleArtist = demos.sortedArtists[0];
      const sampleContact = customContacts[0];
      const res = await fetch('/api/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testEmailTo,
          accountId: selectedAccountId || undefined,
          emailTemplate: testEmailMessage.trim() || (demos.useFollowUp ? demosFollowUpTemplate : demosTemplate),
          subjectTemplate: testEmailSubject.trim() || (demos.useFollowUp ? demosFollowUpSubject : demosSubject),
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

  const selectedAccount = emailAccounts.find(a => a.id === selectedAccountId);

  // Build email preview modal entries
  type PreviewEntry = { label: string; to: string; subject: string; body: string };
  const previewModalEntries = useMemo((): PreviewEntry[] => {
    if (!previewModalType) return [];
    if (previewModalType === 'demos') {
      const entries: PreviewEntry[] = [];
      demos.includedArtists.slice(0, 20).forEach(a => {
        a.managerEmails.forEach((email, idx) => {
          const vars = { managerName: a.managerNames[idx] || 'there', artistName: a.name, trackTitle, driveLink, senderName, managementCompany: a.managementCompany, pronoun: pronounForClient(a.gender, a.type) };
          const tpl = demos.useFollowUp ? demosFollowUpTemplate : demosTemplate;
          const subjectTpl = demos.useFollowUp ? demosFollowUpSubject : demosSubject;
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
        const tpl = demos.useFollowUp ? demosFollowUpTemplate : demosTemplate;
        const subjectTpl = demos.useFollowUp ? demosFollowUpSubject : demosSubject;
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
  }, [previewModalType, demos.includedArtists, radio.results, playlists.results, demosTemplate, demosSubject, demosFollowUpTemplate, demosFollowUpSubject, demos.useFollowUp, radio.template, radio.subject, playlists.template, playlists.subject, signOff, trackTitle, driveLink, senderName, customContacts]);

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
                {...demos}
                demosTab={demosTab} setDemosTab={setDemosTab}
                senderName={senderName} setSenderName={setSenderName} trackTitle={trackTitle} setTrackTitle={setTrackTitle} demosPitchCount={demosPitchCount}
                driveLink={driveLink} setDriveLink={setDriveLink}
                customContacts={customContacts} removeCustomContact={removeCustomContact} showAddCustomContact={showAddCustomContact} setShowAddCustomContact={setShowAddCustomContact}
                newCustomContact={newCustomContact} setNewCustomContact={setNewCustomContact} addCustomContact={addCustomContact} handleCustomContactsCsv={handleCustomContactsCsv}
                addOutsideArtistToContacts={addOutsideArtistToContacts} pitchedEmailMap={pitchedEmailMap}
                setPreviewModalType={setPreviewModalType} setPreviewModalIdx={setPreviewModalIdx}
                addFailedToBlacklist={addFailedToBlacklist}
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
            {activeSection === 'history' && <HistorySection {...history} />}

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
