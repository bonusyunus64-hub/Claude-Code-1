import { useEffect, useState } from 'react';
import type { AnalyticsStats, RateBreakdown } from '../types';

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

export function OverviewSection({ analyticsStats }: { analyticsStats: AnalyticsStats }) {
  return (
    <div className="space-y-5 pb-6">
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Overview</h2>
        <p className="text-xs text-zinc-500">All-time stats derived from your campaign history on this device.</p>
        <RosterFreshnessNote />
      </div>

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
              <p className="text-xs text-zinc-500 mt-1">Reply rate ({analyticsStats.totalResponded} of {analyticsStats.totalEmailsSent})</p>
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
