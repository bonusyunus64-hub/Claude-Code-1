'use client';

import { useState, useEffect, useMemo } from 'react';
import { sendInBatches, downloadCsv, messageIdsFromResults } from '../utils';
import type { Campaign, CampaignRecipient, EmailAccount, CustomContact, ReplyClassification } from '../types';

export interface CampaignHistoryConfig {
  emailAccounts: EmailAccount[];
  customContacts: CustomContact[];
  addFailedToBlacklist: (emails: string[]) => void;
  refreshSendsToday: () => void;
}

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
  const { emailAccounts, customContacts, addFailedToBlacklist, refreshSendsToday } = config;

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
          pendingSend: nextOffset != null ? pending : undefined,
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

  return {
    campaigns, upsertCampaign, clearCampaignHistory, exportCampaignsCsv, threadIdsFor,
    filteredCampaigns, demosSendoutGroups,
    historySearch, setHistorySearch, historyTypeFilter, setHistoryTypeFilter,
    historyDateFrom, setHistoryDateFrom, historyDateTo, setHistoryDateTo,
    expandedCampaignId, setExpandedCampaignId,
    checkingRepliesId, checkReplies, replyCheckResult, replyCheckError, formatCheckedAt,
    backfillingId, backfillRecipients, backfillError,
    resumingCampaignId, resumeSend, resumeError, resumeProgress,
  };
}
