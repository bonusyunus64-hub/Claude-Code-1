import { useEffect, useState } from 'react';
import type { AnalyticsStats, Campaign, RateBreakdown, SubjectTestSummary } from '../types';
import { campaignsNeedingFollowUp, type ReplyToChase } from '../utils';
import { CopyableName } from '../components/CopyableName';
import { CopyChip } from '../components/CopyChip';

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** What /api/genres reports about the roster snapshot, beyond the genre list
 *  itself — used only for the freshness note below, so it's kept local to this
 *  component rather than in types.ts alongside the shapes that flow through
 *  page.tsx's state. */
interface RosterStats {
  artistCount: number;
  generatedAt: string;
  radioStationCount: number;
}

/**
 * "Artist roster: N contacts · updated <date>" note. Fetched independently by
 * this section (rather than owned by page.tsx like most dashboard state) since
 * it's read-only, has no dirty-tracking/save story, and every other consumer of
 * /api/genres already fetches it the same self-contained way (see
 * useDemosFlow.ts). Static per server process, so one fetch on mount is enough.
 */
function RosterFreshnessNote() {
  const [stats, setStats] = useState<RosterStats | null>(null);

  useEffect(() => {
    fetch('/api/genres')
      .then(r => r.json())
      .then(d => {
        if (typeof d.artistCount === 'number' && d.generatedAt) {
          setStats({ artistCount: d.artistCount, generatedAt: d.generatedAt, radioStationCount: d.radioStationCount ?? 0 });
        }
      })
      .catch(() => {});
  }, []);

  if (!stats) return null;

  const updated = new Date(stats.generatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <p className="text-xs text-zinc-600">
      Artist roster: {stats.artistCount.toLocaleString()} contacts · updated {updated}
      {stats.radioStationCount > 0 && <> · Radio: {stats.radioStationCount.toLocaleString()} stations</>}
    </p>
  );
}

/** Horizontal bar list for a reply-rate breakdown (by type / genre / follower tier). */
function RateBreakdownList({ title, rows, emptyHint }: { title: string; rows: RateBreakdown[]; emptyHint?: string }) {
  if (!rows.length) {
    return emptyHint ? (
      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-1">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{title}</h3>
        <p className="text-xs text-zinc-600">{emptyHint}</p>
      </section>
    ) : null;
  }
  const maxRate = Math.max(...rows.map(r => r.replyRate), 0.01);
  return (
    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-3">
      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{title}</h3>
      <div className="space-y-2.5">
        {rows.map(row => (
          <div key={row.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-300 truncate">{row.label}</span>
              <span className="text-zinc-500 font-mono shrink-0 ml-3">{pct(row.replyRate)} · {row.responded}/{row.sent}</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full rounded-full bg-violet-600" style={{ width: `${Math.max(2, (row.replyRate / maxRate) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** One campaign's subject-line A/B result — two side-by-side cards (Subject A vs
 *  Subject B) with a "too early to tell" note in plain English when the sample's
 *  too small to trust the gap (see app/dashboard/utils.ts's subjectTestWinner). */
function SubjectTestCard({ test }: { test: SubjectTestSummary }) {
  const variants: { key: 'A' | 'B'; subject: string; sent: number; responded: number; replyRate: number }[] = [
    { key: 'A', subject: test.subjectA, sent: test.sentA, responded: test.respondedA, replyRate: test.replyRateA },
    { key: 'B', subject: test.subjectB, sent: test.sentB, responded: test.respondedB, replyRate: test.replyRateB },
  ];
  return (
    <div className="space-y-2 border-b border-zinc-800 last:border-0 pb-3 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-zinc-400 font-medium truncate">{test.trackTitle}</span>
        <span className="text-xs text-zinc-600 shrink-0">{new Date(test.date).toLocaleDateString()}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {variants.map(v => {
          const isWinner = test.winner === v.key;
          return (
            <div key={v.key} className={`rounded-lg border px-3 py-2 ${isWinner ? 'border-emerald-600/50 bg-emerald-900/10' : 'border-zinc-800 bg-zinc-950/40'}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-zinc-300 break-words">
                  <span className="text-zinc-500">Subject {v.key}: </span>{v.subject || '(blank)'}
                </p>
                {isWinner && <span className="text-[10px] font-semibold text-emerald-400 shrink-0 whitespace-nowrap">Ahead</span>}
              </div>
              <p className="text-xs text-zinc-500 mt-1">{pct(v.replyRate)} reply rate · {v.responded} of {v.sent} replied</p>
            </div>
          );
        })}
      </div>
      {test.winner === null && (
        <p className="text-xs text-zinc-600">Too early to tell — send to more people (or wait for more replies) before picking a favorite.</p>
      )}
    </div>
  );
}

/**
 * "Needs follow-up" action panel — one row per Song Demos campaign that's old
 * enough and still has recipients who haven't replied, per campaignsNeedingFollowUp
 * (app/dashboard/utils.ts, which is also exactly what /api/send-followup targets —
 * see that function's doc comment for why the count here can't disagree with what
 * pressing the button actually sends). Rendered above the stat tiles below since
 * this is something to act on, not just a number to read. Renders nothing when
 * there's nothing due, or when reminders are turned off in Account settings
 * (tp_auto_followup_enabled, repurposed by this feature to mean "show reminders",
 * not "send automatically" — see AccountSection.tsx) — an empty heading would just
 * be noise either way.
 */
function NeedsFollowUpPanel({
  campaigns, followUpDays, blacklist, remindersEnabled,
  sendFollowUp, followUpSendingId, followUpProgress, followUpError,
}: {
  campaigns: Campaign[];
  followUpDays: number;
  blacklist: string[];
  remindersEnabled: boolean;
  sendFollowUp: (campaign: Campaign, pendingCount: number) => void;
  followUpSendingId: string | null;
  followUpProgress: { campaignId: string; sent: number; total: number } | null;
  followUpError: string;
}) {
  if (!remindersEnabled) return null;
  const due = campaignsNeedingFollowUp(campaigns, followUpDays, blacklist);
  if (due.length === 0) return null;

  return (
    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-3">
      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Needs follow-up</h3>
      <div className="space-y-2">
        {due.map(({ campaign, daysSinceSent, pendingCount, totalCount }) => {
          const sending = followUpSendingId === campaign.id;
          return (
            <div key={campaign.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm text-zinc-200 truncate">
                  <span className="font-medium">&ldquo;{campaign.trackTitle}&rdquo;</span>
                  <span className="text-zinc-500"> · sent {daysSinceSent}d ago</span>
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">{pendingCount} of {totalCount} haven&rsquo;t replied</p>
              </div>
              <button
                onClick={() => sendFollowUp(campaign, pendingCount)}
                disabled={followUpSendingId !== null}
                className="shrink-0 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-3 py-2 text-xs font-semibold text-white transition whitespace-nowrap"
              >
                {sending
                  ? `Sending… (${followUpProgress?.campaignId === campaign.id ? followUpProgress.sent : 0}/${followUpProgress?.campaignId === campaign.id ? followUpProgress.total : '?'})`
                  : 'Send follow-up →'}
              </button>
            </div>
          );
        })}
      </div>
      {followUpSendingId === null && followUpError && (
        <p className="text-xs text-red-400">{followUpError}</p>
      )}
    </section>
  );
}

/** How long the "Undo" link after marking a reply handled stays up — long enough
 *  to catch a misclick, short enough that it doesn't linger as clutter once the
 *  moment's passed. Not persisted anywhere; purely local UI state (see
 *  RepliesToChasePanel below), unlike the mark itself. */
const UNDO_WINDOW_MS = 8_000;

/** One row in the RepliesToChasePanel worklist below — who replied, what track,
 *  and the two actions available: copy their email (CopyChip, reused from the
 *  variable-copy chips elsewhere in this app) and mark it dealt with. */
function ReplyToChaseRow({ reply, onMarkHandled }: { reply: ReplyToChase; onMarkHandled: (reply: ReplyToChase) => void }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <CopyableName name={reply.artistName || reply.managerName || reply.email} className="text-sm font-medium text-white" />
          <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium border shrink-0 ${
            reply.classification === 'interested'
              ? 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30'
              : 'bg-sky-600/20 text-sky-400 border-sky-600/30'
          }`}>
            {reply.classification === 'interested' ? 'Interested' : 'Unread reply'}
          </span>
        </div>
        <p className="text-xs text-zinc-500 mt-0.5 truncate">
          {reply.managerName && reply.artistName && <>{reply.managerName} · </>}
          &ldquo;{reply.trackTitle}&rdquo;
          {reply.lastChecked && <> · found {new Date(reply.lastChecked).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</>}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0 pl-0 sm:pl-3">
        <CopyChip value={reply.email} />
        <button
          onClick={() => onMarkHandled(reply)}
          className="rounded-lg bg-zinc-800 hover:bg-emerald-900/40 border border-zinc-700 hover:border-emerald-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-emerald-400 transition whitespace-nowrap"
        >
          Mark handled
        </button>
      </div>
    </div>
  );
}

/**
 * Cross-campaign "which interested replies haven't I dealt with yet" worklist —
 * the counterpart to HistorySection's per-campaign reply list, built from
 * collectInterestedReplies (app/dashboard/utils.ts) so the grouping/sorting/
 * "handled" filtering logic is unit-tested independent of this rendering. The
 * `interested` bucket is the main list; `unclassified` (replies neither
 * classifyReply's keywords nor the AI classifier could call) renders underneath
 * as a visually secondary group, so an ambiguous reply is still surfaced —
 * someone still has to read it — without crowding out the actionable "yes"es
 * above it.
 *
 * Distinguishes two empty states rather than collapsing them into one "nothing
 * here" card: a campaign history that's never been checked for replies at all
 * (nudges toward History) reads very differently from "checked plenty, nothing
 * outstanding right now" (a quiet all-clear).
 */
function RepliesToChasePanel({
  campaigns, repliesToChase, markReplyHandled, unmarkReplyHandled,
}: {
  campaigns: Campaign[];
  repliesToChase: { interested: ReplyToChase[]; unclassified: ReplyToChase[] };
  markReplyHandled: (key: string) => void;
  unmarkReplyHandled: (key: string) => void;
}) {
  // Brief "Undo" affordance for the reply just marked handled — it disappears
  // from the list immediately (a worklist that empties is the entire point),
  // but a misclick shouldn't be unrecoverable short of digging back through
  // History. Deliberately local/unpersisted state: only the mark itself
  // (handledReplies in page.tsx) needs to survive a reload or another device.
  const [lastHandled, setLastHandled] = useState<{ key: string; label: string } | null>(null);
  useEffect(() => {
    if (!lastHandled) return;
    const id = setTimeout(() => setLastHandled(null), UNDO_WINDOW_MS);
    return () => clearTimeout(id);
  }, [lastHandled]);

  function handleMark(reply: ReplyToChase) {
    markReplyHandled(reply.key);
    setLastHandled({ key: reply.key, label: reply.artistName || reply.email });
  }

  function handleUndo() {
    if (!lastHandled) return;
    unmarkReplyHandled(lastHandled.key);
    setLastHandled(null);
  }

  const { interested, unclassified } = repliesToChase;

  return (
    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Replies to chase</h3>
        {lastHandled && (
          <button onClick={handleUndo} className="text-xs text-zinc-500 hover:text-zinc-300 transition underline shrink-0">
            Marked &ldquo;{lastHandled.label}&rdquo; handled · Undo
          </button>
        )}
      </div>

      {interested.length === 0 && unclassified.length === 0 ? (
        campaigns.some(c => c.lastChecked != null) ? (
          <p className="text-xs text-zinc-600">Nothing outstanding — every reply on record has been dealt with.</p>
        ) : (
          <p className="text-xs text-zinc-600">
            No reply data yet — use &ldquo;Check for replies&rdquo; on a campaign in History to look for responses.
          </p>
        )
      ) : (
        <div className="space-y-3">
          {interested.length > 0 && (
            <div className="space-y-2">
              {interested.map(reply => <ReplyToChaseRow key={reply.key} reply={reply} onMarkHandled={handleMark} />)}
            </div>
          )}
          {unclassified.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-[11px] text-zinc-600 uppercase tracking-wider">
                {unclassified.length} more repl{unclassified.length === 1 ? 'y' : 'ies'} nobody&rsquo;s read yet
              </p>
              {unclassified.map(reply => <ReplyToChaseRow key={reply.key} reply={reply} onMarkHandled={handleMark} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function OverviewSection({
  analyticsStats, campaigns, followUpDays, blacklist, followUpRemindersEnabled,
  sendFollowUp, followUpSendingId, followUpProgress, followUpError,
  repliesToChase, markReplyHandled, unmarkReplyHandled,
}: {
  analyticsStats: AnalyticsStats;
  campaigns: Campaign[];
  followUpDays: number;
  blacklist: string[];
  followUpRemindersEnabled: boolean;
  sendFollowUp: (campaign: Campaign, pendingCount: number) => void;
  followUpSendingId: string | null;
  followUpProgress: { campaignId: string; sent: number; total: number } | null;
  followUpError: string;
  repliesToChase: { interested: ReplyToChase[]; unclassified: ReplyToChase[] };
  markReplyHandled: (key: string) => void;
  unmarkReplyHandled: (key: string) => void;
}) {
  return (
    <div className="space-y-5 pb-6">
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Overview</h2>
        <p className="text-xs text-zinc-500">All-time stats derived from your campaign history on this device.</p>
        <RosterFreshnessNote />
      </div>

      <NeedsFollowUpPanel
        campaigns={campaigns} followUpDays={followUpDays} blacklist={blacklist} remindersEnabled={followUpRemindersEnabled}
        sendFollowUp={sendFollowUp} followUpSendingId={followUpSendingId} followUpProgress={followUpProgress} followUpError={followUpError}
      />

      <RepliesToChasePanel
        campaigns={campaigns} repliesToChase={repliesToChase}
        markReplyHandled={markReplyHandled} unmarkReplyHandled={unmarkReplyHandled}
      />

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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <p className="text-2xl font-bold text-emerald-400">{pct(analyticsStats.replyRate)}</p>
              <p className="text-xs text-zinc-500 mt-1">Reply rate ({analyticsStats.totalResponded} of {analyticsStats.totalDelivered} delivered)</p>
              {analyticsStats.totalAutoReplies > 0 && (
                <p className="text-xs text-zinc-600 mt-0.5">{analyticsStats.totalAutoReplies} auto-repl{analyticsStats.totalAutoReplies === 1 ? 'y' : 'ies'} excluded</p>
              )}
            </div>
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <p className="text-2xl font-bold text-red-400">{pct(analyticsStats.bounceRate)}</p>
              <p className="text-xs text-zinc-500 mt-1">Bounce rate ({analyticsStats.totalBounced} of {analyticsStats.totalEmailsSent})</p>
            </div>
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <p className="text-2xl font-bold text-white">{analyticsStats.classificationCounts.interested}</p>
              <p className="text-xs text-zinc-500 mt-1">Replies marked interested</p>
            </div>
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <p className="text-2xl font-bold text-zinc-400">{analyticsStats.classificationCounts.autoReply}</p>
              <p className="text-xs text-zinc-500 mt-1">Auto-replies (out of office, etc.)</p>
            </div>
          </div>

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

          {analyticsStats.subjectTests.length > 0 && (
            <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-3">
              <div>
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Subject line tests</h3>
                <p className="text-xs text-zinc-600 mt-0.5">Song Demos sends that tried two subject lines against each other.</p>
              </div>
              <div className="space-y-3">
                {analyticsStats.subjectTests.map(t => <SubjectTestCard key={t.campaignId} test={t} />)}
              </div>
            </section>
          )}

          <RateBreakdownList title="Reply rate by campaign type" rows={analyticsStats.byType} />
          <RateBreakdownList
            title="Reply rate by genre (Song Demos)"
            rows={analyticsStats.byGenre}
            emptyHint="No genre data yet — genres are recorded per recipient when a Song Demos campaign is sent, or via &ldquo;Show artists sent to&rdquo; in History for older campaigns."
          />
          <RateBreakdownList
            title="Reply rate by artist size (Song Demos)"
            rows={analyticsStats.byFollowerTier}
            emptyHint="No follower data yet — recorded per recipient the same way genre data is."
          />

          {analyticsStats.lastCampaignDate && (
            <p className="text-xs text-zinc-600">Last campaign: {new Date(analyticsStats.lastCampaignDate).toLocaleString()}</p>
          )}
        </>
      )}
    </div>
  );
}
