'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { syncStorage } from '@/lib/remoteSync';
import { assignSubjectVariant } from '@/lib/recipients';
import { isWithinSendWindow, nextWindowOpenTime, type SendWindowSettings } from '@/lib/sendWindow';
import type { Artist, Campaign, CampaignRecipient, CustomContact, DemosFilterPreset, FailedEmailEntry, SavedTemplate, SendResultEntry } from '../types';
import {
  sendInBatches, countSendableRecipients, findDuplicateRecipients, findCooldownRecipients, messageIdsFromResults,
  permanentlyFailedEmails, checkRecipientsValidity, shuffle, payloadForPendingSend,
} from '../utils';

export type SortOrder = 'followers-desc' | 'followers-asc' | 'alpha-asc' | 'alpha-desc' | 'random';

/**
 * The management-company-size threshold behind the "Independent contacts
 * only" reachability toggle (see AudienceFiltersPanel.tsx). 2 rather than a
 * user-adjustable number: it's not exposed as a raw input because the point
 * of this control is a single plain-English on/off, not another number for a
 * non-technical solo operator to guess at — and 2 is where the roster's own
 * shape draws a natural line (1,960 of 2,666 management companies on the
 * roster represent 2 artists or fewer; the next size bracket up is already a
 * multi-artist operation with a triaged inbox, the exact kind of address this
 * filter exists to screen out). Combined with freemailOnly via OR at the
 * lib/roster.ts level — see getArtistsByGenres' doc comment on why.
 */
export const REACHABILITY_MAX_COMPANY_SIZE = 2;

/** A lightweight, debounced re-run of the same /api/preview query the real
 *  Preview button uses, just to show a live "how many does this match"
 *  number next to the audience filters — see the `audienceEstimate` state
 *  below. Debounced so a burst of filter clicks (follower step buttons,
 *  toggling reachability, etc.) doesn't fire one request per click. */
const AUDIENCE_ESTIMATE_DEBOUNCE_MS = 350;

export interface DemosFlowConfig {
  trackTitle: string;
  driveLink: string;
  senderName: string;
  /** Current template/subject text (both the initial-pitch and follow-up pair) — owned by
   *  the parent (participates in its dirty-tracking/save-all), not this hook. */
  demosTemplate: string;
  demosSubject: string;
  setDemosTemplate: (value: string) => void;
  setDemosSubject: (value: string) => void;
  /** Second subject line for A/B testing (see subjectTestEnabled below) — a plain
   *  sibling of demosSubject, owned by the parent the same way for the same
   *  dirty-tracking/save-all reason. Empty string when the user hasn't set one. */
  demosSubjectB: string;
  setDemosSubjectB: (value: string) => void;
  demosFollowUpTemplate: string;
  demosFollowUpSubject: string;
  setDemosFollowUpTemplate: (value: string) => void;
  setDemosFollowUpSubject: (value: string) => void;
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
  /** Lowercased recipient -> most recent campaign timestamp, across every track/channel —
   *  see app/dashboard/utils.ts's buildLastContactedMap/findCooldownRecipients for why this
   *  is a separate map from pitchedEmailMap rather than reusing it. */
  lastContactedMap: Map<string, number>;
  /** Account settings' cross-campaign contact cooldown (days); 0 disables it. */
  contactCooldownDays: number;
  upsertCampaign: (campaign: Campaign) => void;
  threadIdsFor: (type: Campaign['type'], title: string) => Record<string, string>;
  /** Read-only: custom contacts are managed by the parent (also read by
   *  useCampaignHistory's backfillRecipients), not owned by this hook. */
  customContacts: CustomContact[];
  /** Account settings' Send Window (lib/sendWindow.ts) — when enabled and "now"
   *  falls outside it, handleSend queues the campaign instead of sending
   *  immediately; see handleSend's own comment for how. */
  sendWindowSettings: SendWindowSettings;
}

/**
 * Everything the Song Demos tab needs beyond the shared track fields and custom
 * contacts: genre/audience/Instagram/gender filters, preview, exclusions, outside-
 * artist search, sort/search over the preview list, send, filter presets, and
 * both template libraries (initial pitch + follow-up). Unlike Radio/Playlists,
 * Demos has no twin to share an implementation with — the win here is pulling a
 * genuinely large, tightly-coupled cluster out of page.tsx, not deduplication.
 *
 * Returns fields under the same names app/dashboard/sections/DemosSection.tsx's
 * props already use, so page.tsx can spread `{...demos}` at the call site without
 * DemosSection.tsx itself needing any changes.
 */
export function useDemosFlow(config: DemosFlowConfig) {
  const {
    trackTitle, driveLink, senderName,
    demosTemplate, demosSubject, setDemosTemplate, setDemosSubject,
    demosSubjectB, setDemosSubjectB,
    demosFollowUpTemplate, demosFollowUpSubject, setDemosFollowUpTemplate, setDemosFollowUpSubject,
    signOff, signOffImage, selectedAccountId, sendDelay, blacklist, dailySendCap, sendsToday,
    accountCapError, refreshSendsToday, recordFailedEmails, pitchedEmailMap, lastContactedMap, contactCooldownDays,
    upsertCampaign, threadIdsFor,
    customContacts, sendWindowSettings,
  } = config;

  const [allGenres, setAllGenres] = useState<string[]>([]);
  const [topGenres, setTopGenres] = useState<string[]>([]);
  useEffect(() => {
    fetch('/api/genres').then(r => r.json()).then(d => { setAllGenres(d.genres || []); setTopGenres(d.topGenres || []); });
  }, []);

  const [genreSearch, setGenreSearch] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [showGenreDropdown, setShowGenreDropdown] = useState(false);
  const [demosMatchMode, setDemosMatchMode] = useState<'any' | 'all'>('any');
  const [minAudience, setMinAudience] = useState(0);
  const [maxAudience, setMaxAudience] = useState(0);
  const [gender, setGender] = useState('');
  const [artistType, setArtistType] = useState('');
  const [minInstagram, setMinInstagram] = useState(0);
  const [maxInstagram, setMaxInstagram] = useState(0);
  const [showInstagram, setShowInstagram] = useState(false);
  // The "Independent contacts only" reachability toggle (Task A) — a single
  // plain-English on/off rather than exposing maxCompanySize/freemailOnly as
  // two raw controls, since neither number means anything to a non-technical
  // operator on its own. See REACHABILITY_MAX_COMPANY_SIZE for the threshold
  // this maps to, and getArtistsByGenres for why the two signals OR together.
  const [reachableOnly, setReachableOnly] = useState(false);
  // The "search every genre" opt-in (Task B) — an empty selectedGenres no
  // longer silently means "match nothing" at the lib/roster.ts level, so this
  // flag is what actually lets that reach the roster: off by default, and the
  // only thing that turns "no genres picked" into "every artist, including
  // the 41.6% with no genre tagged at all" instead of the pre-existing
  // "nothing." See handleSend's confirm() and lib/demosSend.ts's
  // matchAllGenres doc comment for the send-time guard this feeds into.
  const [matchAllGenres, setMatchAllGenres] = useState(false);
  // Live "how many does this match" estimate shown next to the audience
  // filters, independent of the real Preview button/previewDone (which still
  // gates Send) — see the debounced effect below. null = not fetched yet
  // (e.g. nothing selected), so the UI can tell "haven't checked" apart from
  // "checked, and it's zero."
  const [audienceEstimate, setAudienceEstimate] = useState<{ artists: number; inboxes: number } | null>(null);
  const [audienceEstimateLoading, setAudienceEstimateLoading] = useState(false);
  const [useFollowUp, setUseFollowUp] = useState(false);
  // Not persisted (unlike demosSubjectB's text) — same reasoning as useFollowUp
  // above: whether to run a test is a per-sending-session choice, not a saved
  // template setting, so it resets to off on reload rather than silently
  // re-enabling a test the user isn't actively thinking about.
  const [subjectTestEnabled, setSubjectTestEnabled] = useState(false);

  const [previewArtists, setPreviewArtists] = useState<Artist[]>([]);
  const [excludedArtistNames, setExcludedArtistNames] = useState<Set<string>>(new Set());
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDone, setPreviewDone] = useState(false);
  const [demosInvalidEmails, setDemosInvalidEmails] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>('followers-desc');
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

  const resetFilters = useCallback(() => { setPreviewDone(false); setSendResult(null); }, []);

  const filteredGenres = useMemo(() =>
    allGenres.filter(g => g.toLowerCase().includes(genreSearch.toLowerCase()) && !selectedGenres.includes(g)).slice(0, 50),
    [allGenres, genreSearch, selectedGenres]
  );

  const toggleGenre = useCallback((genre: string) => {
    setSelectedGenres(prev => prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]);
    setPreviewDone(false); setSendResult(null);
  }, []);

  // Shared with the debounced audience-estimate effect below so the "how many
  // does this match" number and the real Preview button are always asking
  // /api/preview the exact same question — a body built two different ways
  // could silently drift and show a live count that doesn't match what
  // Preview (and therefore Send) actually finds.
  function audienceQueryBody(genresOverride?: string[], matchModeOverride?: 'any' | 'all') {
    return {
      genres: genresOverride ?? selectedGenres, minAudience, maxAudience, gender, artistType, minInstagram, maxInstagram,
      matchMode: matchModeOverride ?? demosMatchMode,
      maxCompanySize: reachableOnly ? REACHABILITY_MAX_COMPANY_SIZE : 0,
      freemailOnly: reachableOnly,
      matchAllGenres,
    };
  }

  async function handlePreview(genresOverride?: string[], matchModeOverride?: 'any' | 'all') {
    setPreviewLoading(true);
    setDemosInvalidEmails([]);
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(audienceQueryBody(genresOverride, matchModeOverride)),
      });
      const data = await res.json();
      const artists = data.artists || [];
      setPreviewArtists(artists);
      setPreviewDone(true);
      setExcludedArtistNames(new Set());
      checkRecipientsValidity((artists as Artist[]).flatMap(a => a.managerEmails)).then(setDemosInvalidEmails);
    } finally { setPreviewLoading(false); }
  }

  // Live "how many artists/inboxes does this match" estimate for the
  // Reachability control (Task A) and the "search every genre" toggle (Task
  // B) — reruns /api/preview in the background as the relevant filters
  // change, debounced so a burst of clicks (e.g. stepping through follower
  // brackets) fires one request, not one per click. Deliberately separate
  // from previewArtists/previewDone: this is a lightweight estimate, not the
  // "official" preview that gates Send — clicking Preview still requires an
  // explicit action, this just answers "is it worth clicking" beforehand.
  useEffect(() => {
    let cancelled = false;
    // The "nothing to estimate" reset lives inside the timeout callback too
    // (rather than as an early return that calls setState directly in the
    // effect body) so every state update this effect makes happens from an
    // async callback, not synchronously during render — see
    // react-hooks/set-state-in-effect.
    const timer = setTimeout(async () => {
      if (selectedGenres.length === 0 && !matchAllGenres) { setAudienceEstimate(null); return; }
      setAudienceEstimateLoading(true);
      try {
        const res = await fetch('/api/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(audienceQueryBody()),
        });
        const data = await res.json();
        if (cancelled) return;
        const artists: Artist[] = data.artists || [];
        const inboxes = new Set(artists.flatMap(a => a.managerEmails.map(e => e.toLowerCase()))).size;
        setAudienceEstimate({ artists: artists.length, inboxes });
      } finally {
        if (!cancelled) setAudienceEstimateLoading(false);
      }
    }, AUDIENCE_ESTIMATE_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- audienceQueryBody closes over these same values; listing it too would defeat the debounce by recreating the effect every render.
  }, [selectedGenres, matchAllGenres, minAudience, maxAudience, gender, artistType, minInstagram, maxInstagram, demosMatchMode, reachableOnly]);

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

  const includedArtists = useMemo(
    () => previewArtists.filter(a => !excludedArtistNames.has(a.name)),
    [previewArtists, excludedArtistNames]
  );

  const { sendable: totalEmails, excludedByBlacklist } = countSendableRecipients(
    blacklist,
    includedArtists.flatMap(a => a.managerEmails),
    customContacts.map(c => c.managerEmail)
  );
  // "Wants roster artists" now also covers the matchAllGenres opt-in (Task B):
  // with it on, an empty selectedGenres still means a real roster query (every
  // genre, including untagged artists), so Send must wait for an actual
  // Preview the same way a genre-scoped query always has — unlike the
  // customContacts-only case, where there's nothing to preview.
  const wantsRosterArtists = selectedGenres.length > 0 || matchAllGenres;
  const canSend = !!trackTitle && !!driveLink && (wantsRosterArtists || customContacts.length > 0) &&
    (previewDone || !wantsRosterArtists) && totalEmails > 0;

  const demosDuplicateRecipients = useMemo(
    () => findDuplicateRecipients(pitchedEmailMap, trackTitle, [...includedArtists.flatMap(a => a.managerEmails), ...customContacts.map(c => c.managerEmail)]),
    [includedArtists, customContacts, trackTitle, pitchedEmailMap]
  );

  const cooldownRecipients = useMemo(
    () => findCooldownRecipients(lastContactedMap, contactCooldownDays, [...includedArtists.flatMap(a => a.managerEmails), ...customContacts.map(c => c.managerEmail)]),
    [includedArtists, customContacts, lastContactedMap, contactCooldownDays]
  );

  async function handleSend() {
    if (!trackTitle || !driveLink) return;
    // Client-side half of the unfiltered-send guard (Task B) — the server-side
    // half is lib/demosSend.ts requiring this same matchAllGenres flag before
    // it will run an empty genre selection as "every artist" at all, so a
    // stale tab or a request replayed without going through this function
    // can't reach it. This one is deliberately a native confirm() (matching
    // useCampaignHistory.ts's sendFollowUp — the one other place in this app
    // that confirms a real-people-get-emailed action) with the *actual*
    // recipient count from the completed Preview, not a vague warning: the
    // number is what makes "I meant to narrow this down first" obvious before
    // it's too late to stop.
    if (matchAllGenres && selectedGenres.length === 0) {
      const confirmed = confirm(
        `No genre is selected, so this sends to every matching artist across the whole roster — ${totalEmails} recipient${totalEmails === 1 ? '' : 's'} for "${trackTitle}". Continue?`
      );
      if (!confirmed) return;
    }
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
      // A/B testing only ever applies to the initial pitch subject, never the
      // follow-up one: the follow-up template/subject pair has no B field of its
      // own, and threading a follow-up onto whichever variant a recipient
      // originally got is a stronger reason to leave it alone than a reason to
      // add a second random split on top of it. subjectTemplateB simply isn't
      // sent when useFollowUp is on, or when there's no B text to test against —
      // both cases behave exactly like a payload from before this feature existed.
      const subjectTestActive = !useFollowUp && subjectTestEnabled && demosSubjectB.trim() !== '';
      const sendPayload = {
        trackTitle, driveLink, genres: selectedGenres,
        emailTemplate: useFollowUp ? demosFollowUpTemplate : demosTemplate,
        subjectTemplate: useFollowUp ? demosFollowUpSubject : demosSubject,
        subjectTemplateB: subjectTestActive ? demosSubjectB : undefined,
        senderName, signOff, signOffImage, minAudience, maxAudience, gender, artistType, minInstagram, maxInstagram,
        matchMode: demosMatchMode,
        maxCompanySize: reachableOnly ? REACHABILITY_MAX_COMPANY_SIZE : 0,
        freemailOnly: reachableOnly,
        matchAllGenres,
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

      // Builds the campaign record for however far this send has gotten.
      // `sentEmails`/`resultsSoFar` both empty is the "queued, nothing sent yet"
      // shape (see the send-window check below) — everything else about the
      // record is identical to a normal in-progress/completed one, so this one
      // function covers both instead of duplicating the shape between them.
      function buildCampaignRecord(sentEmails: string[], resultsSoFar: SendResultEntry[], pendingSend: Campaign['pendingSend']): Campaign {
        const recipients: CampaignRecipient[] = sentEmails.map(email => ({
          email,
          ...(artistByEmail.get(email.toLowerCase()) ?? {
            artistName: '', managerName: '', avatarUrl: '', genres: [], instagramHandle: '', spotifyFollowers: 0,
          }),
        }));
        return {
          id: campaignId, trackTitle, date: campaignDate, type: 'demos',
          emails: sentEmails, accountId: selectedAccountId, recipients,
          messageIds: messageIdsFromResults(resultsSoFar),
          // A permanently-rejected address never generates a bounce message, so this
          // is the only chance to record it — see lib/followUpSend.ts's identical
          // treatment of `bounced` and permanentlyFailedEmails's doc comment.
          // Recomputed from the full cumulative resultsSoFar each tick, same
          // reasoning as messageIds above rather than merged incrementally.
          bounced: permanentlyFailedEmails(resultsSoFar),
          pendingSend,
          driveLink, senderName,
          // Snapshot of the follow-up template/subject as currently configured —
          // see lib/campaigns.ts's doc comment on these fields for why the cron
          // route needs its own copy rather than reading current settings later.
          followUpTemplate: demosFollowUpTemplate, followUpSubject: demosFollowUpSubject,
          // subjectVariants is recomputed from `sentEmails` (the full cumulative
          // list-so-far, not just this batch — see sendInBatches's doc comment on
          // resultsSoFar) on every tick rather than merged incrementally: since
          // assignSubjectVariant is a pure function of the address alone, redoing
          // it is exactly as correct as merging and doesn't need `campaigns`
          // (the pre-update record) in scope here the way resumeSend's merge does.
          ...(subjectTestActive ? {
            subjectA: demosSubject,
            subjectB: demosSubjectB,
            subjectVariants: Object.fromEntries(sentEmails.map(email => [email.toLowerCase(), assignSubjectVariant(email)])),
          } : {}),
        };
      }

      // Account settings' Send Window: a send started outside the chosen hours
      // isn't blocked, it's queued — reusing the exact same pendingSend/resumeSend
      // machinery an interrupted send already relies on (app/dashboard/hooks/
      // useCampaignHistory.ts's resumeSend), since a campaign that hasn't sent
      // anything yet (emails: []) resumes from scratch exactly the same way a
      // partially-sent one resumes from where it left off. Nothing has gone out
      // yet, so the daily cap / Do Not Contact list haven't been touched either —
      // both are re-checked server-side (checkCapAllows, getBlacklist) the moment
      // this actually sends, whether that's the drain effect, the cron backstop,
      // or the user hitting "Send now" in History.
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
        // Persisted as each batch lands: closing the tab mid-send loses at most the
        // in-flight batch, not the whole campaign record. pendingSend carries enough
        // to resume the remaining recipients later instead of restarting from scratch.
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

  function saveDemosPreset() {
    const name = newDemosPresetName.trim();
    if (!name) return;
    const preset: DemosFilterPreset = {
      id: Date.now().toString(), name, genres: selectedGenres, minAudience, maxAudience,
      gender, artistType, minInstagram, maxInstagram, matchMode: demosMatchMode,
      reachableOnly, matchAllGenres,
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
    // ?? false rather than ||, and read with the same fallback on both — a
    // preset saved before these fields existed has them as undefined, which
    // must load as "off" (its only possible prior meaning), not skip the
    // assignment and leave whatever was already selected in the form.
    setReachableOnly(preset.reachableOnly ?? false);
    setMatchAllGenres(preset.matchAllGenres ?? false);
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

  return {
    demosTemplate, demosSubject, setDemosTemplate, setDemosSubject,
    demosSubjectB, setDemosSubjectB, subjectTestEnabled, setSubjectTestEnabled,
    demosTemplateLibrary, newDemosTemplateName, setNewDemosTemplateName,
    saveDemosTemplateToLibrary, loadDemosTemplateFromLibrary, deleteDemosTemplateFromLibrary,

    demosFollowUpTemplate, demosFollowUpSubject, setDemosFollowUpTemplate, setDemosFollowUpSubject,
    followUpTemplateLibrary, newFollowUpTemplateName, setNewFollowUpTemplateName,
    saveFollowUpTemplateToLibrary, loadFollowUpTemplateFromLibrary, deleteFollowUpTemplateFromLibrary,

    demosPresets, newDemosPresetName, setNewDemosPresetName, saveDemosPreset, loadDemosPreset, deleteDemosPreset,
    /** For page.tsx's initial-load effect to hydrate from localStorage after hydrateFromRemote() resolves. */
    setDemosPresets, setDemosTemplateLibrary, setFollowUpTemplateLibrary,

    demosMatchMode, setDemosMatchMode, selectedGenres, setSelectedGenres, toggleGenre,
    genreSearch, setGenreSearch, showGenreDropdown, setShowGenreDropdown, topGenres, filteredGenres,
    resetFilters, setPreviewDone, setSendResult,

    minAudience, setMinAudience, maxAudience, setMaxAudience, showInstagram, setShowInstagram,
    minInstagram, setMinInstagram, maxInstagram, setMaxInstagram, gender, setGender, artistType, setArtistType,
    reachableOnly, setReachableOnly, matchAllGenres, setMatchAllGenres, audienceEstimate, audienceEstimateLoading,

    handlePreview, previewDone, previewLoading, previewArtists, includedArtists, sortedArtists, visibleArtists, totalEmails,
    excludedByBlacklist,
    setExcludedArtistNames, excludedArtistNames, toggleArtistExclusion, toggleGenreFromPreview,
    recipientSearch, setRecipientSearch, sortOrder, setSortOrder,
    outsideResults, outsideResultsQuery, outsideSearchLoading, handleOutsideSearch,

    demosDuplicateRecipients, cooldownRecipients, demosInvalidEmails, setDemosInvalidEmails,

    sendResult, sendFailedEmails, setSendFailedEmails, sendError,
    useFollowUp, setUseFollowUp, handleSend, canSend, sending,
  };
}
