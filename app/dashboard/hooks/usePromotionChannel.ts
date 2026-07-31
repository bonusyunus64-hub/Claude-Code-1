'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { syncStorage } from '@/lib/remoteSync';
import { isWithinSendWindow, nextWindowOpenTime, type SendWindowSettings } from '@/lib/sendWindow';
import type { Campaign, FailedEmailEntry, SavedTemplate, SendResultEntry } from '../types';
import {
  sendInBatches, countSendableRecipients, findDuplicateRecipients, findCooldownRecipients, messageIdsFromResults,
  permanentlyFailedEmails, checkRecipientsValidity, payloadForPendingSend,
} from '../utils';

export type SendOutcome = { sent: number; failed: number; total: number };

/**
 * A saved filter preset for one promotion channel. `[secondaryFilterKey]` holds
 * whichever array this channel's secondary filter actually is (radio: `locations`,
 * playlists: `platforms`) — kept as an index signature rather than a fixed field
 * name so the on-disk/synced shape stays byte-identical to what each channel
 * already stores under `tp_radio_presets`/`tp_playlist_presets`.
 */
export interface ChannelFilterPreset {
  id: string;
  name: string;
  genres: string[];
  matchMode: 'any' | 'all';
  [secondaryFilterKey: string]: unknown;
}

export interface PromotionChannelConfig {
  /** 'radio' | 'playlists' — the Campaign.type this channel writes. */
  campaignType: Campaign['type'];
  genresEndpoint: string;
  previewEndpoint: string;
  sendEndpoint: string;
  /** Key holding the target array in the preview response, e.g. 'stations' | 'curators'. */
  resultsKey: string;
  /** Payload/preset field name for this channel's secondary filter, e.g. 'locations' | 'platforms'. */
  secondaryFilterKey: string;
  /** Template variable carrying the target's name, e.g. 'stationName' | 'curatorName'. */
  nameVar: string;

  trackTitle: string;
  driveLink: string;
  senderName: string;
  /** Current template/subject text — owned by the parent (participates in its dirty-tracking/save-all), not this hook. */
  template: string;
  subject: string;
  setTemplate: (value: string) => void;
  setSubject: (value: string) => void;
  signOff: string;
  signOffImage: string | null;
  selectedAccountId: string;
  sendDelay: number;
  blacklist: string[];
  dailySendCap: number;
  sendsToday: number;
  accountCapError: (accountId: string, additionalSends: number) => string | null;
  refreshSendsToday: () => void;
  recordFailedEmails: (entries: FailedEmailEntry[]) => void;
  pitchedEmailMap: Map<string, string[]>;
  /** See useDemosFlow's identical field for what this is and why it's separate from pitchedEmailMap. */
  lastContactedMap: Map<string, number>;
  /** Account settings' cross-campaign contact cooldown (days); 0 disables it. */
  contactCooldownDays: number;
  upsertCampaign: (campaign: Campaign) => void;
  /** Account settings' Send Window (lib/sendWindow.ts) — see useDemosFlow's
   *  identical field and handleSend for how it's used. */
  sendWindowSettings: SendWindowSettings;
}

/**
 * Everything one promotion channel (Radio, Playlists) needs: genre/secondary-filter
 * selection, preview, send, filter presets, and template library. Radio and
 * Playlists were near-exact duplicates of each other in page.tsx (same shape the
 * server-side radio-send/playlist-send routes had before lib/broadcastSend.ts) —
 * this is one implementation instantiated twice instead of two copies.
 */
export function usePromotionChannel<Target extends { name: string; emails: string[] }>(
  config: PromotionChannelConfig
) {
  const {
    campaignType, genresEndpoint, previewEndpoint, sendEndpoint, resultsKey, secondaryFilterKey, nameVar,
    trackTitle, driveLink, senderName, template, subject, setTemplate, setSubject, signOff, signOffImage,
    selectedAccountId, sendDelay, blacklist, dailySendCap, sendsToday, accountCapError, refreshSendsToday,
    recordFailedEmails, pitchedEmailMap, lastContactedMap, contactCooldownDays, upsertCampaign, sendWindowSettings,
  } = config;

  // Genres list has no synced-settings dependency (unlike presets/template library
  // below), so it's safe for this hook to fetch it itself on mount rather than
  // needing the parent to hydrate it after hydrateFromRemote().
  const [allGenres, setAllGenres] = useState<string[]>([]);
  useEffect(() => {
    fetch(genresEndpoint).then(r => r.json()).then(d => setAllGenres(d.genres || [])).catch(() => {});
  }, [genresEndpoint]);

  const [genreSearch, setGenreSearch] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [showGenreDropdown, setShowGenreDropdown] = useState(false);
  const [matchMode, setMatchMode] = useState<'any' | 'all'>('any');
  const [selectedSecondary, setSelectedSecondary] = useState<string[]>([]);

  const [results, setResults] = useState<Target[]>([]);
  const [previewDone, setPreviewDone] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [invalidEmails, setInvalidEmails] = useState<string[]>([]);

  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendOutcome | null>(null);
  const [sendError, setSendError] = useState('');
  const [sendFailedEmails, setSendFailedEmails] = useState<string[]>([]);

  const [presets, setPresets] = useState<ChannelFilterPreset[]>([]);
  const [newPresetName, setNewPresetName] = useState('');
  const [templateLibrary, setTemplateLibrary] = useState<SavedTemplate[]>([]);
  const [newTemplateName, setNewTemplateName] = useState('');

  const resetPreview = useCallback(() => {
    setPreviewDone(false);
    setSendResult(null);
  }, []);

  const filteredGenres = useMemo(() =>
    allGenres.filter(g => g.toLowerCase().includes(genreSearch.toLowerCase()) && !selectedGenres.includes(g)).slice(0, 50),
    [allGenres, genreSearch, selectedGenres]
  );

  const toggleGenre = useCallback((genre: string) => {
    setSelectedGenres(prev => prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]);
    resetPreview();
  }, [resetPreview]);

  const toggleSecondary = useCallback((value: string) => {
    setSelectedSecondary(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
    resetPreview();
  }, [resetPreview]);

  const presetsStorageKey = `tp_${campaignType}_presets`;
  const templatesStorageKey = `tp_${campaignType}_templates`;

  const handlePreview = useCallback(async () => {
    setPreviewLoading(true); setPreviewDone(false); setInvalidEmails([]);
    try {
      const res = await fetch(previewEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genres: selectedGenres, [secondaryFilterKey]: selectedSecondary, matchMode }),
      });
      const data = await res.json();
      const items = (data[resultsKey] || []) as Target[];
      setResults(items);
      setPreviewDone(true);
      checkRecipientsValidity(items.flatMap(t => t.emails)).then(setInvalidEmails);
    } finally {
      setPreviewLoading(false);
    }
  }, [previewEndpoint, resultsKey, secondaryFilterKey, selectedGenres, selectedSecondary, matchMode]);

  const { sendable: totalEmails, excludedByBlacklist } = countSendableRecipients(blacklist, results.flatMap(t => t.emails));
  const canSend = !!trackTitle && !!driveLink && previewDone;
  const duplicateRecipients = useMemo(
    () => findDuplicateRecipients(pitchedEmailMap, trackTitle, results.flatMap(t => t.emails)),
    [results, trackTitle, pitchedEmailMap]
  );
  const cooldownRecipients = useMemo(
    () => findCooldownRecipients(lastContactedMap, contactCooldownDays, results.flatMap(t => t.emails)),
    [results, lastContactedMap, contactCooldownDays]
  );

  const handleSend = useCallback(async () => {
    if (!trackTitle || !driveLink) return;
    if (dailySendCap > 0 && sendsToday + totalEmails > dailySendCap) {
      setSendError(`Daily send limit reached (${sendsToday}/${dailySendCap} sent today). Wait until tomorrow or raise the limit in Account settings.`);
      return;
    }
    const capErr = selectedAccountId && accountCapError(selectedAccountId, totalEmails);
    if (capErr) { setSendError(capErr); return; }
    setSending(true); setSendError(''); setSendResult(null); setSendFailedEmails([]);
    try {
      const campaignId = Date.now().toString();
      const campaignDate = new Date().toISOString();
      const sendPayload = {
        trackTitle, driveLink, genres: selectedGenres, [secondaryFilterKey]: selectedSecondary,
        emailTemplate: template, subjectTemplate: subject, senderName, signOff, signOffImage, matchMode,
        sendDelay: sendDelay > 0 ? sendDelay : undefined,
        blacklist: blacklist.length > 0 ? blacklist : undefined,
        accountId: selectedAccountId || undefined,
      };

      // Builds the campaign record for however far this send has gotten — see
      // useDemosFlow's identical helper for why `sentEmails`/`resultsSoFar` both
      // empty (the send-window "queue it" branch below) reuses the same shape as
      // a normal in-progress/completed record instead of a separate one.
      function buildCampaignRecord(sentEmails: string[], resultsSoFar: SendResultEntry[], pendingSend: Campaign['pendingSend']): Campaign {
        return {
          id: campaignId, trackTitle, date: campaignDate, type: campaignType,
          emails: sentEmails, accountId: selectedAccountId, messageIds: messageIdsFromResults(resultsSoFar),
          // See useDemosFlow's identical field — a permanently-rejected address never
          // generates a bounce message, so this is the only chance to record it.
          bounced: permanentlyFailedEmails(resultsSoFar),
          pendingSend, driveLink, senderName,
        };
      }

      // Account settings' Send Window: queue instead of blocking — see
      // useDemosFlow's handleSend for the full reasoning (same machinery, same
      // cap/blacklist guarantee, just a simpler campaign shape here).
      if (sendWindowSettings.enabled && !isWithinSendWindow(Date.now(), sendWindowSettings)) {
        const scheduledFor = nextWindowOpenTime(Date.now(), sendWindowSettings);
        upsertCampaign({
          ...buildCampaignRecord([], [], { endpoint: sendEndpoint, payload: payloadForPendingSend(sendPayload) }),
          scheduledFor,
        });
        setSendResult(null);
        return;
      }

      const outcome = await sendInBatches(sendEndpoint, sendPayload, (progress, resultsSoFar, nextOffset) => {
        setSendResult(progress);
        const sentEmails = resultsSoFar.filter(r => r.success).map(r => r.to);
        // Persisted without signOffImage — see payloadForPendingSend — while sendPayload
        // itself (with the image intact) keeps driving sendInBatches above.
        const pendingSend = nextOffset != null ? { endpoint: sendEndpoint, payload: payloadForPendingSend(sendPayload) } : undefined;
        upsertCampaign(buildCampaignRecord(sentEmails, resultsSoFar, pendingSend));
      });
      if (!outcome.ok) { setSendError(outcome.error); }
      else {
        const failedResults = outcome.results.filter(r => !r.success);
        setSendFailedEmails(failedResults.map(r => r.to));
        // Permanent failures are auto-suppressed to Do Not Contact inside
        // recordFailedEmails (see useAccountSettings.ts) — this just hands over
        // which ones those were.
        recordFailedEmails(failedResults.map(r => ({ email: r.to, permanent: !!r.permanent })));
        if (outcome.results.some(r => r.success)) refreshSendsToday();
      }
    } finally {
      setSending(false);
    }
  }, [
    trackTitle, driveLink, dailySendCap, sendsToday, totalEmails, selectedAccountId, accountCapError,
    selectedGenres, selectedSecondary, secondaryFilterKey, template, subject, senderName, signOff, signOffImage,
    matchMode, sendDelay, blacklist, sendEndpoint, campaignType, upsertCampaign, recordFailedEmails, refreshSendsToday,
    sendWindowSettings,
  ]);

  const savePreset = useCallback(() => {
    const name = newPresetName.trim();
    if (!name) return;
    const preset: ChannelFilterPreset = { id: Date.now().toString(), name, genres: selectedGenres, matchMode, [secondaryFilterKey]: selectedSecondary };
    setPresets(prev => {
      const updated = [...prev, preset];
      syncStorage.setItem(presetsStorageKey, JSON.stringify(updated));
      return updated;
    });
    setNewPresetName('');
  }, [newPresetName, selectedGenres, matchMode, selectedSecondary, secondaryFilterKey, presetsStorageKey]);

  const loadPreset = useCallback((preset: ChannelFilterPreset) => {
    setSelectedGenres(preset.genres);
    setSelectedSecondary((preset[secondaryFilterKey] as string[] | undefined) ?? []);
    setMatchMode(preset.matchMode);
    resetPreview();
  }, [secondaryFilterKey, resetPreview]);

  const deletePreset = useCallback((id: string) => {
    setPresets(prev => {
      const updated = prev.filter(p => p.id !== id);
      syncStorage.setItem(presetsStorageKey, JSON.stringify(updated));
      return updated;
    });
  }, [presetsStorageKey]);

  const saveTemplateToLibrary = useCallback(() => {
    const name = newTemplateName.trim();
    if (!name) return;
    const saved: SavedTemplate = { id: Date.now().toString(), name, body: template, subject };
    setTemplateLibrary(prev => {
      const updated = [...prev, saved];
      syncStorage.setItem(templatesStorageKey, JSON.stringify(updated));
      return updated;
    });
    setNewTemplateName('');
  }, [newTemplateName, template, subject, templatesStorageKey]);

  const loadTemplateFromLibrary = useCallback((saved: SavedTemplate) => {
    setTemplate(saved.body);
    if (saved.subject !== undefined) setSubject(saved.subject);
  }, [setTemplate, setSubject]);

  const deleteTemplateFromLibrary = useCallback((id: string) => {
    setTemplateLibrary(prev => {
      const updated = prev.filter(t => t.id !== id);
      syncStorage.setItem(templatesStorageKey, JSON.stringify(updated));
      return updated;
    });
  }, [templatesStorageKey]);

  return {
    allGenres, genreSearch, setGenreSearch, selectedGenres, setSelectedGenres, toggleGenre,
    showGenreDropdown, setShowGenreDropdown, filteredGenres, matchMode, setMatchMode,
    selectedSecondary, setSelectedSecondary, toggleSecondary,

    template, subject, setTemplate, setSubject,
    templateLibrary, newTemplateName, setNewTemplateName, saveTemplateToLibrary, loadTemplateFromLibrary, deleteTemplateFromLibrary,

    presets, newPresetName, setNewPresetName, savePreset, loadPreset, deletePreset,
    /** For page.tsx's initial-load effect to hydrate from localStorage after hydrateFromRemote() resolves. */
    setPresets, setTemplateLibrary,

    handlePreview, previewLoading, previewDone, results, invalidEmails, setInvalidEmails, resetPreview,

    handleSend, sending, sendResult, sendFailedEmails, setSendFailedEmails, sendError,

    totalEmails, excludedByBlacklist, canSend, duplicateRecipients, cooldownRecipients,

    nameVar,
  };
}

export type PromotionChannel<Target extends { name: string; emails: string[] }> = ReturnType<typeof usePromotionChannel<Target>>;
