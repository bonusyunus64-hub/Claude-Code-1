'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { hydrateFromRemote, syncStorage } from '@/lib/remoteSync';
import type {
  Artist, RadioStation, EmailAccount,
  CustomContact,
} from './types';
import {
  renderTemplateClient, pronounForClient, computeAnalyticsStats, buildLastContactedMap,
  collectInterestedReplies,
} from './utils';
import {
  buildPreviewEntries, buildDemosPreviewEntries, PREVIEW_MODAL_RECIPIENT_CAP,
  type PreviewCandidate, type PreviewEntry,
} from './previewEntries';
import { usePromotionChannel } from './hooks/usePromotionChannel';
import { useCampaignHistory } from './hooks/useCampaignHistory';
import { useDemosFlow } from './hooks/useDemosFlow';
import { useAccountSettings, parseFailedEmails } from './hooks/useAccountSettings';
import { useTemplateDrafts } from './hooks/useTemplateDrafts';
import { useCustomContacts } from './hooks/useCustomContacts';
import { OverviewSection } from './sections/OverviewSection';
import { DemosSection } from './sections/DemosSection';
import { PromotionSection } from './sections/PromotionSection';
import { AccountSection } from './sections/AccountSection';
import { HistorySection } from './sections/HistorySection';


export default function Dashboard() {
  const [activeSection, setActiveSection] = useState<'overview' | 'demos' | 'promotion' | 'account' | 'history'>('demos');
  const [demosTab, setDemosTab] = useState<'compose' | 'template'>('compose');
  const [promotionTab, setPromotionTab] = useState<'compose' | 'template'>('compose');

  // Shared track details
  const [trackTitle, setTrackTitle] = useState('');
  const [driveLink, setDriveLink] = useState('');
  const [senderName, setSenderName] = useState('');

  // Test email — stays here (not in useAccountSettings) since it needs a sample
  // artist from useDemosFlow's preview list; see useAccountSettings's own comment
  // for why that would otherwise be a circular hook dependency.
  const [testEmailTo, setTestEmailTo] = useState('');
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<'success' | 'error' | null>(null);
  const [testEmailError, setTestEmailError] = useState('');
  const [showTestEmailOptions, setShowTestEmailOptions] = useState(false);
  const [testEmailSubject, setTestEmailSubject] = useState('');
  const [testEmailMessage, setTestEmailMessage] = useState('');

  // Overview tab's cross-campaign "Replies to chase" worklist — which interested/
  // unclassified replies (collectInterestedReplies in utils.ts) the user has
  // already dealt with. Keyed by `${campaignId}:${email}` (see ReplyToChase's doc
  // comment) rather than anything derived from the reply's content, so a mark
  // survives that campaign later being re-checked for replies. Synced like every
  // other tp_* setting (tp_handled_replies in lib/remoteSync.ts's SYNCED_KEYS) so
  // "handled" travels with the user across devices, not just this browser.
  const [handledReplies, setHandledReplies] = useState<Record<string, number>>({});

  // Email preview modal
  const [previewModalType, setPreviewModalType] = useState<'demos' | 'radio' | null>(null);
  const [previewModalIdx, setPreviewModalIdx] = useState(0);

  // Accounts, sign-off, blacklist, failed-sends, send-pacing settings, deliverability —
  // instantiated first since history/radio/demos below all read config
  // from it (account.signOff, account.blacklist, account.accountCapError, etc.).
  const account = useAccountSettings();

  // Custom contacts — instantiated before useCampaignHistory/useDemosFlow below,
  // both of which take contacts.customContacts as read-only config; see
  // this hook's own doc comment for why addOutsideArtistToContacts stays here
  // instead of moving into it.
  const contacts = useCustomContacts();

  // Template/subject drafts (Demos + Radio) and the sign-off they share a
  // dirty-tracking/save-all with — instantiated before usePromotionChannel/
  // useDemosFlow below, both of which take these drafts as config. signOff/
  // signOffImage stay owned by useAccountSettings (see this hook's own doc
  // comment on the CRITICAL HAZARD of moving them) and are threaded in here.
  const templateDrafts = useTemplateDrafts({
    signOff: account.signOff, setSignOff: account.setSignOff,
    signOffImage: account.signOffImage, setSignOffImage: account.setSignOffImage,
  });

  // Owns campaigns state itself (fetched once on mount) plus everything History-tab
  // specific — the single source of truth the send flows below write through via
  // history.upsertCampaign, instead of duplicating campaign-state ownership.
  const history = useCampaignHistory({
    emailAccounts: account.emailAccounts, customContacts: contacts.customContacts,
    addFailedToBlacklist: account.addFailedToBlacklist, refreshSendsToday: account.refreshSendsToday,
    signOffImage: account.signOffImage, signOff: account.signOff, sendDelay: account.sendDelay,
  });

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

  // Feeds the cross-campaign contact-cooldown warning (findCooldownRecipients in
  // utils.ts) — distinct from pitchedEmailMap above, which only tracks which
  // *tracks* an address has seen; this tracks *when* it was last mailed at all,
  // across every track/channel. Built the same way (once per campaigns list) so
  // it's cheap to recompute per render without redoing the work per keystroke.
  const lastContactedMap = useMemo(() => buildLastContactedMap(history.campaigns), [history.campaigns]);

  // Overview tab's "Replies to chase" panel — recomputed only when the campaign
  // list or the handled-state changes, not on every render, since this walks
  // every campaign's classifications the same way pitchedEmailMap/lastContactedMap
  // above walk every campaign's emails.
  const repliesToChase = useMemo(
    () => collectInterestedReplies(history.campaigns, handledReplies),
    [history.campaigns, handledReplies]
  );

  // Radio is the one remaining instantiation of usePromotionChannel — it used to be
  // shared with an equivalent Playlists channel (genre/secondary-filter selection,
  // preview, send, presets, template library), removed along with the rest of the
  // Playlists tab since data/playlists.json has no curator records to send to. The
  // hook itself stays generic (still named usePromotionChannel, not usePromotionRadio)
  // in case a future channel needs the same shape again. Declared before the
  // initial-load effect below so that effect can hydrate Radio's presets and
  // template library via the hook's exposed setters.
  const radio = usePromotionChannel<RadioStation>({
    campaignType: 'radio',
    genresEndpoint: '/api/radio-genres',
    previewEndpoint: '/api/radio-preview',
    sendEndpoint: '/api/radio-send',
    resultsKey: 'stations',
    secondaryFilterKey: 'locations',
    nameVar: 'stationName',
    trackTitle, driveLink, senderName,
    template: templateDrafts.radioTemplate, subject: templateDrafts.radioSubject,
    setTemplate: templateDrafts.setRadioTemplate, setSubject: templateDrafts.setRadioSubject,
    signOff: account.signOff, signOffImage: account.signOffImage, selectedAccountId: account.selectedAccountId,
    sendDelay: account.sendDelay, blacklist: account.blacklist, dailySendCap: account.dailySendCap, sendsToday: account.sendsToday,
    accountCapError: account.accountCapError, refreshSendsToday: account.refreshSendsToday, recordFailedEmails: account.recordFailedEmails,
    pitchedEmailMap, lastContactedMap, contactCooldownDays: account.contactCooldownDays, upsertCampaign: history.upsertCampaign,
    sendWindowSettings: account.sendWindowSettings,
  });

  // No twin to share an implementation with (unlike Radio, which shares
  // usePromotionChannel) — this is the one place page.tsx's Demos-tab complexity
  // (audience/Instagram/gender filters, exclusions, outside-artist search,
  // sort/search, both template libraries) lives now instead of inline. Declared
  // before the initial-load effect below for the same reason as radio above.
  const demos = useDemosFlow({
    trackTitle, driveLink, senderName,
    demosTemplate: templateDrafts.demosTemplate, demosSubject: templateDrafts.demosSubject,
    setDemosTemplate: templateDrafts.setDemosTemplate, setDemosSubject: templateDrafts.setDemosSubject,
    demosSubjectB: templateDrafts.demosSubjectB, setDemosSubjectB: templateDrafts.setDemosSubjectB,
    demosFollowUpTemplate: templateDrafts.demosFollowUpTemplate, demosFollowUpSubject: templateDrafts.demosFollowUpSubject,
    setDemosFollowUpTemplate: templateDrafts.setDemosFollowUpTemplate, setDemosFollowUpSubject: templateDrafts.setDemosFollowUpSubject,
    demosMultiArtistTemplate: templateDrafts.demosMultiArtistTemplate, demosMultiArtistSubject: templateDrafts.demosMultiArtistSubject,
    signOff: account.signOff, signOffImage: account.signOffImage, selectedAccountId: account.selectedAccountId,
    sendDelay: account.sendDelay, blacklist: account.blacklist, dailySendCap: account.dailySendCap, sendsToday: account.sendsToday,
    accountCapError: account.accountCapError, refreshSendsToday: account.refreshSendsToday, recordFailedEmails: account.recordFailedEmails,
    pitchedEmailMap, lastContactedMap, contactCooldownDays: account.contactCooldownDays,
    upsertCampaign: history.upsertCampaign, threadIdsFor: history.threadIdsFor,
    customContacts: contacts.customContacts,
    sendWindowSettings: account.sendWindowSettings,
  });

  useEffect(() => {
    fetch('/api/send-quota').then(r => r.json()).then(d => { account.setSendsToday(d.count ?? 0); account.setSendsTodayByAccount(d.byAccount ?? {}); }).catch(() => {});
    (async () => {
    await hydrateFromRemote(); // pull latest settings from the server so a second device picks up what was saved elsewhere
    try {
      const accountsRes = await fetch('/api/accounts');
      const accountsData = await accountsRes.json();
      const accounts = (accountsData.accounts ?? []) as EmailAccount[];
      account.setEmailAccounts(accounts);
      const savedId = localStorage.getItem('tp_selected_account');
      if (savedId && accounts.find(a => a.id === savedId)) account.setSelectedAccountId(savedId);
      else if (accounts.length > 0) account.setSelectedAccountId(accounts[0].id);

      // Sign-off + every template/subject draft, plus their lastSaved mirrors —
      // see useTemplateDrafts.ts's own hydrateFromStorage doc comment.
      templateDrafts.hydrateFromStorage();

      // No tp_blacklist read here any more: the Do Not Contact list moved to a Redis
      // set behind /api/blacklist, which useAccountSettings loads itself on mount.
      // Seeding it from localStorage as well would race that fetch — and a stale
      // local copy winning is exactly the bug the move to a server-authoritative
      // list was meant to end, since it would silently un-blacklist an address
      // someone was already on the Do Not Contact list.

      // parseFailedEmails tolerates both the current shape and the legacy plain
      // string[] a device may still have saved from before permanent/transient
      // failures were distinguished — see its own doc comment.
      const savedFailedEmails = localStorage.getItem('tp_failed_emails');
      if (savedFailedEmails) account.setFailedEmails(parseFailedEmails(JSON.parse(savedFailedEmails)));

      contacts.hydrateFromStorage();

      const savedHandledReplies = localStorage.getItem('tp_handled_replies');
      if (savedHandledReplies) setHandledReplies(JSON.parse(savedHandledReplies));

      const savedSendDelay = localStorage.getItem('tp_send_delay');
      if (savedSendDelay !== null) account.setSendDelay(Number(savedSendDelay));

      const savedDemosPresets = localStorage.getItem('tp_demos_presets');
      if (savedDemosPresets) demos.setDemosPresets(JSON.parse(savedDemosPresets));

      const savedRadioPresets = localStorage.getItem('tp_radio_presets');
      if (savedRadioPresets) radio.setPresets(JSON.parse(savedRadioPresets));

      const savedDemosTemplates = localStorage.getItem('tp_demos_templates');
      if (savedDemosTemplates) demos.setDemosTemplateLibrary(JSON.parse(savedDemosTemplates));

      const savedFollowUpTemplates = localStorage.getItem('tp_followup_templates');
      if (savedFollowUpTemplates) demos.setFollowUpTemplateLibrary(JSON.parse(savedFollowUpTemplates));

      const savedRadioTemplates = localStorage.getItem('tp_radio_templates');
      if (savedRadioTemplates) radio.setTemplateLibrary(JSON.parse(savedRadioTemplates));

      const savedDailyCap = localStorage.getItem('tp_daily_cap');
      if (savedDailyCap !== null) account.setDailySendCap(Number(savedDailyCap));

      const savedContactCooldown = localStorage.getItem('tp_contact_cooldown_days');
      if (savedContactCooldown !== null) account.setContactCooldownDays(Number(savedContactCooldown));

      const savedAutoFollowUpEnabled = localStorage.getItem('tp_auto_followup_enabled');
      if (savedAutoFollowUpEnabled !== null) account.setAutoFollowUpEnabled(savedAutoFollowUpEnabled === 'true');

      const savedAutoFollowUpDays = localStorage.getItem('tp_auto_followup_days');
      if (savedAutoFollowUpDays !== null) account.setAutoFollowUpDays(Number(savedAutoFollowUpDays));

      const savedSendWindowEnabled = localStorage.getItem('tp_send_window_enabled');
      if (savedSendWindowEnabled !== null) account.setSendWindowEnabled(savedSendWindowEnabled === 'true');

      const savedSendWindowStartHour = localStorage.getItem('tp_send_window_start_hour');
      if (savedSendWindowStartHour !== null) account.setSendWindowStartHour(Number(savedSendWindowStartHour));

      const savedSendWindowEndHour = localStorage.getItem('tp_send_window_end_hour');
      if (savedSendWindowEndHour !== null) account.setSendWindowEndHour(Number(savedSendWindowEndHour));

      // No saved timezone yet on this device (or anywhere it's synced from) means
      // this is the first time the Send Window has been touched — default to the
      // browser's own zone (Intl.DateTimeFormat().resolvedOptions().timeZone)
      // rather than making the user hunt for their own IANA zone name. This is a
      // live default, not persisted here: it's only written to storage once the
      // user actually saves a Send Window setting (setSendWindowTimezoneOption),
      // same as every other tp_* field's hardcoded default in this effect.
      const savedSendWindowTimezone = localStorage.getItem('tp_send_window_timezone');
      if (savedSendWindowTimezone !== null) account.setSendWindowTimezone(savedSendWindowTimezone);
      else account.setSendWindowTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {}
    })();
    // account/radio/demos/contacts/templateDrafts are plain objects rebuilt
    // every render, so listing them here would re-run this mount-only hydration on
    // every render; only their setX setters (stable, from useState) and the two
    // hydrateFromStorage functions (called imperatively, not depended on for
    // identity) are actually used below.
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

  const analyticsStats = useMemo(() => computeAnalyticsStats(history.campaigns), [history.campaigns]);

  /** Marks one reply (see ReplyToChase.key) dealt with, dropping it out of the
   *  Overview tab's worklist. unmarkReplyHandled below is what backs that
   *  panel's brief "Undo" affordance for an accidental click. */
  function markReplyHandled(key: string) {
    const updated = { ...handledReplies, [key]: Date.now() };
    setHandledReplies(updated);
    syncStorage.setItem('tp_handled_replies', JSON.stringify(updated));
  }

  function unmarkReplyHandled(key: string) {
    const updated = { ...handledReplies };
    delete updated[key];
    setHandledReplies(updated);
    syncStorage.setItem('tp_handled_replies', JSON.stringify(updated));
  }

  function addOutsideArtistToContacts(a: Artist) {
    const existingEmails = new Set(contacts.customContacts.map(c => c.managerEmail.toLowerCase()));
    const additions: CustomContact[] = a.managerEmails
      .filter(email => !existingEmails.has(email.toLowerCase()))
      .map((email, i) => ({
        id: `${Date.now()}-${i}`,
        artistName: a.name,
        managerName: a.managerNames[i] || '',
        managerEmail: email,
      }));
    if (!additions.length) return;
    const updated = [...contacts.customContacts, ...additions];
    contacts.setCustomContacts(updated);
    syncStorage.setItem('tp_custom_contacts', JSON.stringify(updated));
  }

  async function handleTestEmail() {
    if (!testEmailTo) return;
    setTestEmailSending(true); setTestEmailResult(null); setTestEmailError('');
    try {
      // Use a real matched artist's data when one is available, so the test
      // reflects exactly how {{managerName}}, {{pronoun}}, etc. will resolve
      // for an actual recipient rather than generic placeholders.
      const sampleArtist = demos.sortedArtists[0];
      const sampleContact = contacts.customContacts[0];
      const res = await fetch('/api/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testEmailTo,
          accountId: account.selectedAccountId || undefined,
          emailTemplate: testEmailMessage.trim() || (demos.useFollowUp ? templateDrafts.demosFollowUpTemplate : templateDrafts.demosTemplate),
          subjectTemplate: testEmailSubject.trim() || (demos.useFollowUp ? templateDrafts.demosFollowUpSubject : templateDrafts.demosSubject),
          signOff: account.signOff,
          signOffImage: account.signOffImage,
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

  // Build email preview modal entries. Candidates are cheap (no template rendering)
  // so building the *full*, unsliced list per branch costs nothing; buildPreviewEntries
  // is what dedupes them by address and renders only the capped survivors.
  const { entries: previewModalEntries, total: previewModalTotal, excludedByBlacklist: previewModalExcludedByBlacklist } = useMemo((): { entries: PreviewEntry[]; total: number; excludedByBlacklist: number } => {
    if (!previewModalType) return { entries: [], total: 0, excludedByBlacklist: 0 };
    if (previewModalType === 'demos') {
      // Moved to previewEntries.ts's buildDemosPreviewEntries so the grouping
      // logic (rank, then group by manager address, then multi- vs
      // single-artist copy per group) can be unit-tested against the same
      // inputs lib/demosSend.ts's sendDemos takes, without rendering this
      // whole component — see that function's own doc comment.
      return buildDemosPreviewEntries({
        includedArtists: demos.includedArtists,
        selectedGenres: demos.selectedGenres,
        customContacts: contacts.customContacts,
        demosTemplate: templateDrafts.demosTemplate, demosSubject: templateDrafts.demosSubject, demosSubjectB: templateDrafts.demosSubjectB,
        demosFollowUpTemplate: templateDrafts.demosFollowUpTemplate, demosFollowUpSubject: templateDrafts.demosFollowUpSubject,
        demosMultiArtistTemplate: templateDrafts.demosMultiArtistTemplate, demosMultiArtistSubject: templateDrafts.demosMultiArtistSubject,
        useFollowUp: demos.useFollowUp, subjectTestEnabled: demos.subjectTestEnabled,
        signOff: account.signOff, blacklist: account.blacklist,
        trackTitle, driveLink, senderName,
      });
    }
    const render = (vars: Record<string, string>) => {
      const bodyParts = [renderTemplateClient(radio.template, vars)];
      if (account.signOff?.trim()) bodyParts.push(renderTemplateClient(account.signOff, vars));
      return { subject: renderTemplateClient(radio.subject, vars), body: bodyParts.join('\n\n') };
    };
    const candidates: PreviewCandidate[] = [];
    radio.results.forEach(s => {
      s.emails.forEach(email => {
        candidates.push({
          to: email, subject: '', body: '',
          label: `${s.name} <${email}>`,
          vars: { stationName: s.name, trackTitle, driveLink, senderName },
        });
      });
    });
    return buildPreviewEntries(candidates, PREVIEW_MODAL_RECIPIENT_CAP, render, account.blacklist);
  }, [previewModalType, demos.includedArtists, demos.selectedGenres, radio.results, templateDrafts.demosTemplate, templateDrafts.demosSubject, templateDrafts.demosSubjectB, demos.subjectTestEnabled, templateDrafts.demosFollowUpTemplate, templateDrafts.demosFollowUpSubject, templateDrafts.demosMultiArtistTemplate, templateDrafts.demosMultiArtistSubject, demos.useFollowUp, radio.template, radio.subject, account.signOff, account.blacklist, trackTitle, driveLink, senderName, contacts.customContacts]);

  // Keyboard/focus handling for the preview modal (see the modal markup below):
  // Escape closes it, and focus moves into the dialog on open and back to
  // whatever triggered it on close, since there's no focus-trap library in this
  // project to reach for.
  const previewModalPanelRef = useRef<HTMLDivElement>(null);
  const previewModalTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!previewModalType) return;
    previewModalTriggerRef.current = document.activeElement as HTMLElement | null;
    previewModalPanelRef.current?.focus();
    return () => {
      previewModalTriggerRef.current?.focus();
    };
  }, [previewModalType]);

  useEffect(() => {
    if (!previewModalType) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPreviewModalType(null);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewModalType]);

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
            {activeSection === 'overview' && (
              <OverviewSection
                analyticsStats={analyticsStats}
                campaigns={history.campaigns}
                followUpDays={account.autoFollowUpDays}
                blacklist={account.blacklist}
                followUpRemindersEnabled={account.autoFollowUpEnabled}
                sendFollowUp={history.sendFollowUp}
                followUpSendingId={history.followUpSendingId}
                followUpProgress={history.followUpProgress}
                followUpError={history.followUpError}
                repliesToChase={repliesToChase}
                markReplyHandled={markReplyHandled}
                unmarkReplyHandled={unmarkReplyHandled}
              />
            )}

            {/* ── Song Demos ── */}
            {activeSection === 'demos' && (
              <DemosSection
                {...demos}
                setDemosMultiArtistTemplate={templateDrafts.setDemosMultiArtistTemplate}
                setDemosMultiArtistSubject={templateDrafts.setDemosMultiArtistSubject}
                demosTab={demosTab} setDemosTab={setDemosTab}
                senderName={senderName} setSenderName={setSenderName} trackTitle={trackTitle} setTrackTitle={setTrackTitle} demosPitchCount={demosPitchCount}
                driveLink={driveLink} setDriveLink={setDriveLink}
                customContacts={contacts.customContacts} removeCustomContact={contacts.removeCustomContact} showAddCustomContact={contacts.showAddCustomContact} setShowAddCustomContact={contacts.setShowAddCustomContact}
                newCustomContact={contacts.newCustomContact} setNewCustomContact={contacts.setNewCustomContact} addCustomContact={contacts.addCustomContact} handleCustomContactsCsv={contacts.handleCustomContactsCsv}
                addOutsideArtistToContacts={addOutsideArtistToContacts} pitchedEmailMap={pitchedEmailMap}
                setPreviewModalType={setPreviewModalType} setPreviewModalIdx={setPreviewModalIdx}
                addFailedToBlacklist={account.addFailedToBlacklist} contactCooldownDays={account.contactCooldownDays}
                selectedAccount={account.selectedAccount} setActiveSection={setActiveSection}
                testEmailTo={testEmailTo} setTestEmailTo={setTestEmailTo} setTestEmailResult={setTestEmailResult} handleTestEmail={handleTestEmail}
                testEmailSending={testEmailSending} selectedAccountId={account.selectedAccountId} testEmailResult={testEmailResult} testEmailError={testEmailError}
              />
            )}

            {/* ── Track Promotion ── */}
            {activeSection === 'promotion' && (
              <PromotionSection
                promotionTab={promotionTab} setPromotionTab={setPromotionTab}
                senderName={senderName} setSenderName={setSenderName} trackTitle={trackTitle} setTrackTitle={setTrackTitle}
                driveLink={driveLink} setDriveLink={setDriveLink}
                pitchedEmailMap={pitchedEmailMap} selectedAccount={account.selectedAccount} setActiveSection={setActiveSection}
                addFailedToBlacklist={account.addFailedToBlacklist} setPreviewModalType={setPreviewModalType} setPreviewModalIdx={setPreviewModalIdx}
                radio={radio} radioPitchCount={radioPitchCount} contactCooldownDays={account.contactCooldownDays}
              />
            )}

            {/* ── Account ── */}
            {activeSection === 'account' && (
              <AccountSection
                {...account}
                demosFollowUpTemplate={templateDrafts.demosFollowUpTemplate}
                testEmailTo={testEmailTo} setTestEmailTo={setTestEmailTo} testEmailSending={testEmailSending} handleTestEmail={handleTestEmail}
                showTestEmailOptions={showTestEmailOptions} setShowTestEmailOptions={setShowTestEmailOptions}
                testEmailSubject={testEmailSubject} setTestEmailSubject={setTestEmailSubject}
                testEmailMessage={testEmailMessage} setTestEmailMessage={setTestEmailMessage}
                demosSubject={templateDrafts.demosSubject} demosTemplate={templateDrafts.demosTemplate}
                testEmailResult={testEmailResult} setTestEmailResult={setTestEmailResult} testEmailError={testEmailError}
              />
            )}

            {/* ── History ── */}
            {activeSection === 'history' && <HistorySection {...history} sendWindowTimezone={account.sendWindowSettings.timezone} />}

          </div>
        </main>
      </div>

      {/* Floating save bar */}
      {templateDrafts.isDirty && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:w-auto z-50 flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl shadow-black/50 px-4 py-3">
          <span className="text-xs text-zinc-400 mr-1 flex-1 md:flex-none">Unsaved changes</span>
          <button onClick={templateDrafts.discardChanges} className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1.5 rounded transition hover:bg-zinc-800">Discard</button>
          <button onClick={templateDrafts.saveAll} className="text-xs bg-violet-600 hover:bg-violet-500 text-white font-semibold px-3 py-1.5 rounded-lg transition">Save</button>
        </div>
      )}

      {!templateDrafts.isDirty && templateDrafts.saveLocalWarning && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:w-auto md:max-w-sm z-50 flex items-start gap-2 bg-zinc-900 border border-amber-700/50 rounded-xl shadow-2xl shadow-black/50 px-4 py-3">
          <span className="text-xs text-amber-400 flex-1">{templateDrafts.saveLocalWarning}</span>
          <button onClick={() => templateDrafts.setSaveLocalWarning('')} className="text-zinc-500 hover:text-white transition text-sm leading-none shrink-0">×</button>
        </div>
      )}

      {/* Email Preview Modal */}
      {previewModalType && previewModalEntries.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center p-4 md:p-8 bg-black/70 backdrop-blur-sm overflow-y-auto"
          onClick={() => setPreviewModalType(null)}
        >
          <div
            ref={previewModalPanelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="email-preview-modal-heading"
            tabIndex={-1}
            onClick={e => e.stopPropagation()}
            className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-2xl mt-4 mb-8 focus:outline-none"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h2 id="email-preview-modal-heading" className="text-sm font-semibold text-white">Email Preview</h2>
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
                {previewModalTotal > previewModalEntries.length ? (
                  <p className="text-xs text-amber-400 mt-1.5">
                    Showing the first {previewModalEntries.length} of {previewModalTotal} recipients — the rest will still be sent, just not previewed here.
                  </p>
                ) : (
                  <p className="text-xs text-zinc-500 mt-1.5">{previewModalTotal} recipient{previewModalTotal === 1 ? '' : 's'}</p>
                )}
                {previewModalExcludedByBlacklist > 0 && (
                  <p className="text-xs text-zinc-600 mt-1">
                    {previewModalExcludedByBlacklist} more on your Do Not Contact list, excluded automatically.
                  </p>
                )}
              </div>
              {previewModalEntries[previewModalIdx] && (
                <div className="space-y-3">
                  <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-4 py-3 space-y-1.5">
                    <p className="text-xs text-zinc-500"><span className="text-zinc-400 font-medium">To:</span> {previewModalEntries[previewModalIdx].to}</p>
                    <p className="text-xs text-zinc-500"><span className="text-zinc-400 font-medium">Subject:</span> {previewModalEntries[previewModalIdx].subject}</p>
                  </div>
                  <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-4 py-3 space-y-3">
                    <pre className="text-sm text-zinc-200 whitespace-pre-wrap font-sans leading-relaxed">{previewModalEntries[previewModalIdx].body}</pre>
                    {account.signOffImage && (
                      // A base64 data URI held in settings, not a served asset — next/image
                      // has no URL to fetch, resize or cache, so it would add a wrapper and
                      // optimize nothing.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={account.signOffImage} alt="Signature" className="max-h-24 max-w-xs rounded border border-zinc-700 object-contain bg-zinc-800" />
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
