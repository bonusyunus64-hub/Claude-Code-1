'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { hydrateFromRemote, syncStorage } from '@/lib/remoteSync';
import { subjectTemplateFor } from '@/lib/recipients';
import type {
  Artist, RadioStation, EmailAccount,
  CustomContact,
} from './types';
import {
  DEFAULT_DEMOS_TEMPLATE, DEFAULT_FOLLOWUP_TEMPLATE, DEFAULT_RADIO_TEMPLATE,
  DEFAULT_DEMOS_SUBJECT, DEFAULT_FOLLOWUP_SUBJECT, DEFAULT_RADIO_SUBJECT,
  DEFAULT_SIGN_OFF,
} from './constants';
import {
  parseContactsCsv, renderTemplateClient, pronounForClient, computeAnalyticsStats, buildLastContactedMap,
} from './utils';
import {
  buildPreviewEntries, PREVIEW_MODAL_RECIPIENT_CAP, CUSTOM_CONTACT_RANK,
  type PreviewCandidate, type PreviewEntry,
} from './previewEntries';
import { usePromotionChannel } from './hooks/usePromotionChannel';
import { useCampaignHistory } from './hooks/useCampaignHistory';
import { useDemosFlow } from './hooks/useDemosFlow';
import { useAccountSettings, parseFailedEmails } from './hooks/useAccountSettings';
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

  // Song Demos — template/subject text (both the initial-pitch and follow-up pair)
  // stays here since it participates in the shared dirty-tracking/save-all below;
  // everything else is owned by useDemosFlow, instantiated further down.
  const [demosTemplate, setDemosTemplate] = useState(DEFAULT_DEMOS_TEMPLATE);
  const [demosSubject, setDemosSubject] = useState(DEFAULT_DEMOS_SUBJECT);
  // Second subject line for A/B testing (DemosSection's "Test a second subject
  // line" toggle) — empty by default, same as demosSubject would be for a fresh
  // account if it didn't have DEFAULT_DEMOS_SUBJECT to fall back to. Lives here
  // rather than in useDemosFlow for the same reason demosSubject does: it
  // participates in the shared dirty-tracking/save-all below.
  const [demosSubjectB, setDemosSubjectB] = useState('');
  const [demosFollowUpTemplate, setDemosFollowUpTemplate] = useState(DEFAULT_FOLLOWUP_TEMPLATE);
  const [demosFollowUpSubject, setDemosFollowUpSubject] = useState(DEFAULT_FOLLOWUP_SUBJECT);

  // Track Promotion (Radio) — template/subject text stays here since it
  // participates in the shared dirty-tracking/save-all below; everything else
  // (genre/secondary-filter selection, preview, send, presets, template library)
  // is owned by usePromotionChannel, instantiated further down.
  const [radioTemplate, setRadioTemplate] = useState(DEFAULT_RADIO_TEMPLATE);
  const [radioSubject, setRadioSubject] = useState(DEFAULT_RADIO_SUBJECT);

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

  // Custom contacts
  const [customContacts, setCustomContacts] = useState<CustomContact[]>([]);
  const [newCustomContact, setNewCustomContact] = useState({ artistName: '', managerName: '', managerEmail: '' });
  const [showAddCustomContact, setShowAddCustomContact] = useState(false);

  // Email preview modal
  const [previewModalType, setPreviewModalType] = useState<'demos' | 'radio' | null>(null);
  const [previewModalIdx, setPreviewModalIdx] = useState(0);

  // Save tracking
  const [lastSavedDemosTemplate, setLastSavedDemosTemplate] = useState(DEFAULT_DEMOS_TEMPLATE);
  const [lastSavedDemosSubject, setLastSavedDemosSubject] = useState(DEFAULT_DEMOS_SUBJECT);
  const [lastSavedDemosSubjectB, setLastSavedDemosSubjectB] = useState('');
  const [lastSavedFollowUpTemplate, setLastSavedFollowUpTemplate] = useState(DEFAULT_FOLLOWUP_TEMPLATE);
  const [lastSavedFollowUpSubject, setLastSavedFollowUpSubject] = useState(DEFAULT_FOLLOWUP_SUBJECT);
  const [lastSavedRadioTemplate, setLastSavedRadioTemplate] = useState(DEFAULT_RADIO_TEMPLATE);
  const [lastSavedRadioSubject, setLastSavedRadioSubject] = useState(DEFAULT_RADIO_SUBJECT);
  const [lastSavedSignOff, setLastSavedSignOff] = useState(DEFAULT_SIGN_OFF);
  const [lastSavedSignOffImage, setLastSavedSignOffImage] = useState<string | null>(null);

  // Set when saveAll() finds that one of its syncStorage.setItem calls couldn't write to
  // localStorage (see the return-value comment on syncStorage.setItem) — most likely the
  // signature image pushing the synced-settings blob over the browser's 5MB quota. The
  // server copy still saved fine, so this is informational rather than blocking.
  const [saveLocalWarning, setSaveLocalWarning] = useState('');

  // Accounts, sign-off, blacklist, failed-sends, send-pacing settings, deliverability —
  // instantiated first since history/radio/demos below all read config
  // from it (account.signOff, account.blacklist, account.accountCapError, etc.).
  const account = useAccountSettings();

  // Owns campaigns state itself (fetched once on mount) plus everything History-tab
  // specific — the single source of truth the send flows below write through via
  // history.upsertCampaign, instead of duplicating campaign-state ownership.
  const history = useCampaignHistory({
    emailAccounts: account.emailAccounts, customContacts,
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
    template: radioTemplate, subject: radioSubject, setTemplate: setRadioTemplate, setSubject: setRadioSubject,
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
    demosTemplate, demosSubject, setDemosTemplate, setDemosSubject,
    demosSubjectB, setDemosSubjectB,
    demosFollowUpTemplate, demosFollowUpSubject, setDemosFollowUpTemplate, setDemosFollowUpSubject,
    signOff: account.signOff, signOffImage: account.signOffImage, selectedAccountId: account.selectedAccountId,
    sendDelay: account.sendDelay, blacklist: account.blacklist, dailySendCap: account.dailySendCap, sendsToday: account.sendsToday,
    accountCapError: account.accountCapError, refreshSendsToday: account.refreshSendsToday, recordFailedEmails: account.recordFailedEmails,
    pitchedEmailMap, lastContactedMap, contactCooldownDays: account.contactCooldownDays,
    upsertCampaign: history.upsertCampaign, threadIdsFor: history.threadIdsFor,
    customContacts,
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

      const savedSignOff = localStorage.getItem('tp_sign_off');
      if (savedSignOff !== null) { account.setSignOff(savedSignOff); setLastSavedSignOff(savedSignOff); }

      const savedImage = localStorage.getItem('tp_sign_off_image');
      if (savedImage) { account.setSignOffImage(savedImage); setLastSavedSignOffImage(savedImage); }

      const savedDemosTemplate = localStorage.getItem('tp_email_template');
      if (savedDemosTemplate !== null) { setDemosTemplate(savedDemosTemplate); setLastSavedDemosTemplate(savedDemosTemplate); }

      const savedDemosSubject = localStorage.getItem('tp_email_subject');
      if (savedDemosSubject !== null) { setDemosSubject(savedDemosSubject); setLastSavedDemosSubject(savedDemosSubject); }

      const savedDemosSubjectB = localStorage.getItem('tp_email_subject_b');
      if (savedDemosSubjectB !== null) { setDemosSubjectB(savedDemosSubjectB); setLastSavedDemosSubjectB(savedDemosSubjectB); }

      const savedFollowUp = localStorage.getItem('tp_followup_template');
      if (savedFollowUp !== null) { setDemosFollowUpTemplate(savedFollowUp); setLastSavedFollowUpTemplate(savedFollowUp); }

      const savedFollowUpSubject = localStorage.getItem('tp_followup_subject');
      if (savedFollowUpSubject !== null) { setDemosFollowUpSubject(savedFollowUpSubject); setLastSavedFollowUpSubject(savedFollowUpSubject); }

      const savedRadioTemplate = localStorage.getItem('tp_radio_template');
      if (savedRadioTemplate !== null) { setRadioTemplate(savedRadioTemplate); setLastSavedRadioTemplate(savedRadioTemplate); }

      const savedRadioSubject = localStorage.getItem('tp_radio_subject');
      if (savedRadioSubject !== null) { setRadioSubject(savedRadioSubject); setLastSavedRadioSubject(savedRadioSubject); }

      // No tp_blacklist read here any more: the Do Not Contact list moved to a Redis
      // set behind /api/blacklist, which useAccountSettings loads itself on mount.
      // Seeding it from localStorage as well would race that fetch — and a stale
      // local copy winning is exactly the bug the move to a server-authoritative
      // list was meant to end, since it would silently un-blacklist an address
      // someone had already unsubscribed.

      // parseFailedEmails tolerates both the current shape and the legacy plain
      // string[] a device may still have saved from before permanent/transient
      // failures were distinguished — see its own doc comment.
      const savedFailedEmails = localStorage.getItem('tp_failed_emails');
      if (savedFailedEmails) account.setFailedEmails(parseFailedEmails(JSON.parse(savedFailedEmails)));

      const savedCustomContacts = localStorage.getItem('tp_custom_contacts');
      if (savedCustomContacts) setCustomContacts(JSON.parse(savedCustomContacts));

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
    // account/radio/demos are plain objects rebuilt every render, so listing them
    // here would re-run this mount-only hydration on every render; only their setX
    // setters (stable, from useState) are actually called below.
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

  const isDirty =
    demosTemplate !== lastSavedDemosTemplate ||
    demosSubject !== lastSavedDemosSubject ||
    demosSubjectB !== lastSavedDemosSubjectB ||
    demosFollowUpTemplate !== lastSavedFollowUpTemplate ||
    demosFollowUpSubject !== lastSavedFollowUpSubject ||
    radioTemplate !== lastSavedRadioTemplate ||
    radioSubject !== lastSavedRadioSubject ||
    account.signOff !== lastSavedSignOff ||
    account.signOffImage !== lastSavedSignOffImage;

  function saveAll() {
    // syncStorage.setItem returns false when the localStorage half of the write failed
    // (e.g. quota exceeded) — it still pushes to the server regardless, so nothing here
    // is actually lost, but the user should know their next page-load might not reflect
    // it instantly if this browser goes offline before the server copy is fetched again.
    let localWriteFailed = false;
    const track = (ok: boolean) => { if (!ok) localWriteFailed = true; };
    track(syncStorage.setItem('tp_email_template', demosTemplate));
    track(syncStorage.setItem('tp_email_subject', demosSubject));
    track(syncStorage.setItem('tp_email_subject_b', demosSubjectB));
    track(syncStorage.setItem('tp_followup_template', demosFollowUpTemplate));
    track(syncStorage.setItem('tp_followup_subject', demosFollowUpSubject));
    track(syncStorage.setItem('tp_radio_template', radioTemplate));
    track(syncStorage.setItem('tp_radio_subject', radioSubject));
    track(syncStorage.setItem('tp_sign_off', account.signOff));
    if (account.signOffImage) track(syncStorage.setItem('tp_sign_off_image', account.signOffImage));
    else syncStorage.removeItem('tp_sign_off_image');
    setSaveLocalWarning(localWriteFailed
      ? "Saved to your account, but this browser's local storage is full (likely the signature image) — clear some space or shrink the image so this device stays in sync while offline."
      : '');
    setLastSavedDemosTemplate(demosTemplate);
    setLastSavedDemosSubject(demosSubject);
    setLastSavedDemosSubjectB(demosSubjectB);
    setLastSavedFollowUpTemplate(demosFollowUpTemplate);
    setLastSavedFollowUpSubject(demosFollowUpSubject);
    setLastSavedRadioTemplate(radioTemplate);
    setLastSavedRadioSubject(radioSubject);
    setLastSavedSignOff(account.signOff);
    setLastSavedSignOffImage(account.signOffImage);
  }

  function discardChanges() {
    setDemosTemplate(lastSavedDemosTemplate);
    setDemosSubject(lastSavedDemosSubject);
    setDemosSubjectB(lastSavedDemosSubjectB);
    setDemosFollowUpTemplate(lastSavedFollowUpTemplate);
    setDemosFollowUpSubject(lastSavedFollowUpSubject);
    setRadioTemplate(lastSavedRadioTemplate);
    setRadioSubject(lastSavedRadioSubject);
    account.setSignOff(lastSavedSignOff);
    account.setSignOffImage(lastSavedSignOffImage);
    setSaveLocalWarning('');
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
          accountId: account.selectedAccountId || undefined,
          emailTemplate: testEmailMessage.trim() || (demos.useFollowUp ? demosFollowUpTemplate : demosTemplate),
          subjectTemplate: testEmailSubject.trim() || (demos.useFollowUp ? demosFollowUpSubject : demosSubject),
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
      const tpl = demos.useFollowUp ? demosFollowUpTemplate : demosTemplate;
      const subjectA = demos.useFollowUp ? demosFollowUpSubject : demosSubject;
      // Mirrors useDemosFlow's handleSend: A/B testing never applies to a
      // follow-up send, and only kicks in once the toggle is on with real text
      // in Subject B — matching exactly what a send would actually do.
      const subjectB = (!demos.useFollowUp && demos.subjectTestEnabled) ? demosSubjectB : undefined;
      const render = (vars: Record<string, string>, to: string) => {
        const subjectTpl = subjectTemplateFor(to, subjectA, subjectB);
        const bodyParts = [renderTemplateClient(tpl, vars)];
        if (account.signOff?.trim()) bodyParts.push(renderTemplateClient(account.signOff, vars));
        return { subject: renderTemplateClient(subjectTpl, vars), body: bodyParts.join('\n\n') };
      };
      const candidates: PreviewCandidate[] = [];
      // Custom contacts first: they always outrank roster suggestions for the same
      // address (CUSTOM_CONTACT_RANK), and putting them first also means a hand-added
      // contact — the whole reason someone added it — isn't the entry that falls off
      // the end when a large roster match pushes the deduped list past the cap.
      customContacts.forEach(cc => {
        candidates.push({
          to: cc.managerEmail, subject: '', body: '', rank: CUSTOM_CONTACT_RANK,
          label: `${cc.artistName}${cc.managerName ? ` (${cc.managerName})` : ''} <${cc.managerEmail}> [Custom]`,
          vars: { managerName: cc.managerName || 'there', artistName: cc.artistName, trackTitle, driveLink, senderName, managementCompany: '', pronoun: 'they' },
        });
      });
      demos.includedArtists.forEach(a => {
        a.managerEmails.forEach((email, idx) => {
          candidates.push({
            to: email, subject: '', body: '', rank: a.spotifyFollowers ?? 0,
            label: `${a.name}${a.managerNames[idx] ? ` (${a.managerNames[idx]})` : ''} <${email}>`,
            vars: { managerName: a.managerNames[idx] || 'there', artistName: a.name, trackTitle, driveLink, senderName, managementCompany: a.managementCompany, pronoun: pronounForClient(a.gender, a.type) },
          });
        });
      });
      return buildPreviewEntries(candidates, PREVIEW_MODAL_RECIPIENT_CAP, render, account.blacklist);
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
  }, [previewModalType, demos.includedArtists, radio.results, demosTemplate, demosSubject, demosSubjectB, demos.subjectTestEnabled, demosFollowUpTemplate, demosFollowUpSubject, demos.useFollowUp, radio.template, radio.subject, account.signOff, account.blacklist, trackTitle, driveLink, senderName, customContacts]);

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
              />
            )}

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
                demosFollowUpTemplate={demosFollowUpTemplate}
                testEmailTo={testEmailTo} setTestEmailTo={setTestEmailTo} testEmailSending={testEmailSending} handleTestEmail={handleTestEmail}
                showTestEmailOptions={showTestEmailOptions} setShowTestEmailOptions={setShowTestEmailOptions}
                testEmailSubject={testEmailSubject} setTestEmailSubject={setTestEmailSubject}
                testEmailMessage={testEmailMessage} setTestEmailMessage={setTestEmailMessage}
                demosSubject={demosSubject} demosTemplate={demosTemplate}
                testEmailResult={testEmailResult} setTestEmailResult={setTestEmailResult} testEmailError={testEmailError}
              />
            )}

            {/* ── History ── */}
            {activeSection === 'history' && <HistorySection {...history} sendWindowTimezone={account.sendWindowSettings.timezone} />}

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

      {!isDirty && saveLocalWarning && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:w-auto md:max-w-sm z-50 flex items-start gap-2 bg-zinc-900 border border-amber-700/50 rounded-xl shadow-2xl shadow-black/50 px-4 py-3">
          <span className="text-xs text-amber-400 flex-1">{saveLocalWarning}</span>
          <button onClick={() => setSaveLocalWarning('')} className="text-zinc-500 hover:text-white transition text-sm leading-none shrink-0">×</button>
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
