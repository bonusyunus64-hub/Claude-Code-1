'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { sendInBatches, downloadCsv, messageIdsFromResults, payloadForPendingSend } from '../utils';
import { assignSubjectVariant } from '@/lib/recipients';
import type { Campaign, CampaignRecipient, EmailAccount, CustomContact, ReplyClassification } from '../types';

export interface CampaignHistoryConfig {
  emailAccounts: EmailAccount[];
  customContacts: CustomContact[];
  addFailedToBlacklist: (emails: string[]) => void;
  refreshSendsToday: () => void;
  /** Current signature image (Account tab) — pendingSend.payload never carries one (see
   *  payloadForPendingSend), so resumeSend injects whatever's configured now instead. */
  signOffImage: string | null;
  /** Current sign-off text and inter-message delay (Account tab) — sendFollowUp below
   *  reads these live, the same way resumeSend re-supplies signOffImage, since a manual
   *  follow-up send has no pendingSend payload of its own to fall back to. */
  signOff: string;
  sendDelay: number;
}

// How often the send-window drain effect (further down) checks for a queued
// campaign whose scheduledFor has arrived. A plain interval rather than
// scheduling a precise setTimeout for the next known scheduledFor: settings can
// change, new campaigns can get queued, and the tab can be backgrounded/resumed
// at any time, all of which would need to reschedule a single timeout anyway —
// polling once a minute is simpler and more than frequent enough for a feature
// whose whole premise is hour-granularity scheduling, not second-granularity.
const DRAIN_CHECK_INTERVAL_MS = 60_000;

/**
 * Everything campaign-history-related: the campaigns themselves (fetched once on
 * mount, written one record at a time via upsertCampaign), the History tab's
 * filters/search, and its three async actions (check replies, backfill recipient
 * details, resume an interrupted send). Owning `campaigns` here — rather than in
 * page.tsx — makes this the single source of truth other flows (Demos/Radio/
 * Playlists sends, which call upsertCampaign after each batch) read and write
 * through, instead of duplicating campaign state ownership.
 */
export function useCampaignHistory(config: CampaignHistoryConfig) {
  const { emailAccounts, customContacts, addFailedToBlacklist, refreshSendsToday, signOffImage, signOff, sendDelay } = config;

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  useEffect(() => {
    fetch('/api/campaigns').then(r => r.json()).then(d => setCampaigns(d.campaigns || [])).catch(() => {});
  }, []);

  const [historySearch, setHistorySearch] = useState('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'all' | Campaign['type']>('all');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);

  /**
   * Creates or updates a single campaign record. Campaign history lives server-side
   * as one record per campaign (see lib/campaigns.ts), so this only ever writes the
   * one record that changed — cheap enough to call after every batch of a long send,
   * which is what makes mid-send persistence (see the send flows' progress callbacks)
   * practical.
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
      // HistorySection), never during render, so Date.now() here is safe.
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
   * through. c.pendingSend was written by the batch loop in handleSend and
   * usePromotionChannel's handleSend after every batch; there's no offset to pick up
   * from any more (paging is by exclusion set now, not index — see sendInBatches),
   * so this seeds the exclusion set from c.emails, the addresses already recorded as
   * successfully sent. That's also what makes this backward compatible with campaign
   * records written before this change: they never had anything but `emails` to go
   * on anyway. A transient failure from the interrupted run isn't in `emails` (only
   * successes are), so it gets retried here — that's the desired behavior, not a bug.
   *
   * New recipients picked up here don't have artist metadata to attach (the roster
   * lookup that built it lived in the original send's closure, long gone by now) —
   * they land with blank fields, same as a custom contact with no name. "Show
   * artists sent to" already exists to backfill exactly this from just the address.
   *
   * pending.payload never carries a signature image (see payloadForPendingSend) —
   * the outgoing request needs one regardless, so it's injected here from whatever
   * the Account tab currently has configured, which is also the behavior we want:
   * a resumed send should reflect the user's current signature, not a stale one.
   * Assigning `undefined` rather than `null` when there's no current image means
   * JSON.stringify drops the key entirely (see sendInBatches), so the send just
   * goes out unsigned, matching current settings. This also self-heals records
   * from before this change, whose stored payload may still have an embedded
   * image: it's overwritten here rather than sent alongside a second copy, and
   * payloadForPendingSend below strips it back out before the next persist so it
   * doesn't linger in Redis either.
   */
  async function resumeSend(c: Campaign) {
    const pending = c.pendingSend;
    if (!pending) return;
    setResumingCampaignId(c.id);
    setResumeError('');
    setResumeProgress({ campaignId: c.id, sent: 0, total: 0 });
    try {
      const sendPayload = { ...pending.payload, signOffImage: signOffImage ?? undefined };
      const persistedPending = { endpoint: pending.endpoint, payload: payloadForPendingSend(pending.payload) };
      const outcome = await sendInBatches(pending.endpoint, sendPayload, (progress, resultsSoFar, nextOffset) => {
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
        // c.subjectB is only ever set alongside subjectA/subjectVariants (see
        // Campaign's doc comment), so its presence is what tells this resume
        // whether the original send was running a subject test at all — unlike
        // useDemosFlow's handleSend, resumeSend only sees `newlySent` (this
        // batch/round), not the campaign's full recipient list, so previously
        // recorded assignments have to be merged forward rather than
        // recomputed from scratch. assignSubjectVariant is still a pure
        // function of the address alone, so a newly-sent recipient lands in
        // the exact same variant here as it would have in the original send.
        const subjectVariants = c.subjectB
          ? { ...(c.subjectVariants ?? {}), ...Object.fromEntries(newlySent.map(email => [email.toLowerCase(), assignSubjectVariant(email)])) }
          : c.subjectVariants;
        upsertCampaign({
          ...c,
          emails,
          recipients,
          subjectVariants,
          messageIds: { ...(c.messageIds ?? {}), ...messageIdsFromResults(resultsSoFar) },
          pendingSend: nextOffset != null ? persistedPending : undefined,
        });
      }, c.emails);
      if (!outcome.ok) setResumeError(outcome.error);
      else if (outcome.results.some(r => r.success)) refreshSendsToday();
    } catch (err) {
      setResumeError(`Could not resume send: ${String(err)}`);
    } finally {
      setResumingCampaignId(null);
    }
  }

  const [followUpSendingId, setFollowUpSendingId] = useState<string | null>(null);
  const [followUpError, setFollowUpError] = useState('');
  const [followUpProgress, setFollowUpProgress] = useState<{ campaignId: string; sent: number; total: number } | null>(null);

  /**
   * Sends this campaign's follow-up template to exactly its current non-responders
   * (the same set app/dashboard/utils.ts's campaignsNeedingFollowUp counted to put
   * this campaign in the Overview tab's "Needs follow-up" panel in the first
   * place) via POST /api/send-followup, batched through sendInBatches the same
   * way every other send flow in this app is — see that route (lib/followUpSend.ts)
   * for why its response is shaped identically to /api/send's.
   *
   * Modeled on resumeSend above (progress state, error state, refreshSendsToday),
   * but doesn't persist campaign state itself: unlike a resumed original send,
   * /api/send-followup already writes followUpSent/messageIds/followUpSentAt to
   * Redis server-side after every batch (that's what decides when a campaign is
   * fully followed-up), so duplicating that bookkeeping here would just be a second,
   * potentially racing writer. Instead this re-fetches the campaign list once the
   * send settles, which is what makes the row disappear from the Overview panel —
   * campaignsNeedingFollowUp is recomputed from that fresh `campaigns` state on
   * every render, so a campaign that just became fully followed-up (or ran out of
   * pending recipients) simply stops qualifying.
   *
   * This mails real people, so it confirms up front — with the exact recipient
   * count and track name — before doing anything: a misclick on the button alone
   * must not be enough to send.
   */
  async function sendFollowUp(campaign: Campaign, pendingCount: number) {
    const confirmed = confirm(
      `Send a follow-up to ${pendingCount} recipient${pendingCount === 1 ? '' : 's'} who haven't replied to "${campaign.trackTitle}"?`
    );
    if (!confirmed) return;
    setFollowUpSendingId(campaign.id);
    setFollowUpError('');
    setFollowUpProgress({ campaignId: campaign.id, sent: 0, total: 0 });
    try {
      const payload = { campaignId: campaign.id, signOffImage: signOffImage ?? undefined, sendDelay, signOff };
      const outcome = await sendInBatches('/api/send-followup', payload, (progress) => {
        setFollowUpProgress({ campaignId: campaign.id, sent: progress.sent, total: progress.total });
      });
      if (!outcome.ok) { setFollowUpError(outcome.error); return; }
      const res = await fetch('/api/campaigns');
      const data = await res.json();
      setCampaigns(data.campaigns ?? []);
      if (outcome.results.some(r => r.success)) refreshSendsToday();
    } catch (err) {
      setFollowUpError(`Could not send follow-up: ${String(err)}`);
    } finally {
      setFollowUpSendingId(null);
    }
  }

  /**
   * A campaign a send-window queue put here (pendingSend set, nothing sent yet —
   * see useDemosFlow/usePromotionChannel's handleSend) was never actually
   * started; cancelling it just deletes the record outright rather than leaving
   * an empty "0 recipients" entry sitting in history forever. Distinct from an
   * *interrupted* send (pendingSend set, but emails.length > 0): those already
   * represent real progress, so there's deliberately no "cancel" for them —
   * only "resume".
   */
  function cancelQueuedSend(c: Campaign) {
    setCampaigns(prev => prev.filter(x => x.id !== c.id));
    fetch(`/api/campaigns?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' }).catch(() => {});
  }

  // --- Send-window queue draining ---
  //
  // A campaign queued by handleSend (pendingSend set, emails still empty,
  // scheduledFor in the future) has never actually sent anything — it's just
  // waiting for its send window to open. Rather than a second queue/poller
  // mechanism, this drains it by calling resumeSend itself: a campaign with no
  // emails sent yet resumes cleanly from scratch (its exclusion set is empty),
  // exactly like any interrupted send. The two effects below only ever decide
  // *when* to make that call.
  //
  // app/api/cron/drain-send-window is the backstop for when the dashboard isn't
  // open at all; see that route's own doc comment for why Vercel's Hobby plan
  // means it can only run once a day rather than build the real guarantee these
  // effects give while the tab is open — see README/AGENTS.md's note that this
  // is a single-tenant, one-operator tool, so there's no other browser tab that
  // could also be racing this one to drain the same queue.
  //
  // `resumeSend` is a fresh closure every render (it closes over `signOffImage`
  // etc.), and `campaigns` changes on every batch of every active send — refs
  // keep the periodic interval effect below from needing to depend on either
  // directly, which would mean tearing the interval down and rebuilding it far
  // more often than its own DRAIN_CHECK_INTERVAL_MS actually calls for (worst
  // case, never letting it reach a full interval before being reset again).
  // Reading through a ref rather than a setState-updater callback also keeps
  // this side-effecting (it can call resumeSend) instead of needing to be a
  // pure state transition, which a setCampaigns updater is required to be —
  // React may invoke one more than once (e.g. Strict Mode) to check for that.
  const campaignsRef = useRef(campaigns);
  useEffect(() => { campaignsRef.current = campaigns; }, [campaigns]);
  const resumingCampaignIdRef = useRef(resumingCampaignId);
  useEffect(() => { resumingCampaignIdRef.current = resumingCampaignId; }, [resumingCampaignId]);
  const resumeSendRef = useRef(resumeSend);
  useEffect(() => { resumeSendRef.current = resumeSend; });

  // `drainDueSends` itself stays a stable useCallback (empty deps, reads
  // everything through the refs above) so both effects below can safely list
  // it as a dependency without either one re-running more often than its own
  // trigger actually changed.
  const drainDueSends = useCallback(() => {
    if (resumingCampaignIdRef.current) return; // one resume in flight at a time — resumeSend isn't reentrant-safe
    const due = campaignsRef.current.find(c => c.pendingSend && c.emails.length === 0 && c.scheduledFor != null && c.scheduledFor <= Date.now());
    if (due) resumeSendRef.current(due);
  }, []);

  // Checks the instant campaigns load or change (a fresh campaign just got
  // queued, an earlier resume just finished) rather than waiting for the next
  // periodic tick below — so a campaign that's already due doesn't sit around
  // for up to DRAIN_CHECK_INTERVAL_MS after the dashboard finishes loading.
  useEffect(() => { drainDueSends(); }, [campaigns, resumingCampaignId, drainDueSends]);

  // ...and also on a plain interval, purely to notice time passing on its own —
  // a queued campaign whose scheduledFor arrives while nothing else changes
  // wouldn't otherwise trigger the effect above again.
  useEffect(() => {
    const id = setInterval(drainDueSends, DRAIN_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [drainDueSends]);

  return {
    campaigns, upsertCampaign, clearCampaignHistory, exportCampaignsCsv, threadIdsFor,
    filteredCampaigns, demosSendoutGroups,
    historySearch, setHistorySearch, historyTypeFilter, setHistoryTypeFilter,
    historyDateFrom, setHistoryDateFrom, historyDateTo, setHistoryDateTo,
    expandedCampaignId, setExpandedCampaignId,
    checkingRepliesId, checkReplies, replyCheckResult, replyCheckError, formatCheckedAt,
    backfillingId, backfillRecipients, backfillError,
    resumingCampaignId, resumeSend, resumeError, resumeProgress,
    cancelQueuedSend,
    followUpSendingId, sendFollowUp, followUpError, followUpProgress,
  };
}
