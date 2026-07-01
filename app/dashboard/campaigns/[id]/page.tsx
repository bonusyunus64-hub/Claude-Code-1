'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import CampaignChrome from '../_components/CampaignChrome';
import ConfirmDeleteModal from '../_components/ConfirmDeleteModal';
import {
  getCampaign,
  upsertCampaign,
  deleteCampaign,
  campaignProgress,
  type OutreachCampaign,
  type CampaignTargetState,
  type TargetStatus,
} from '@/lib/campaigns';
import { GOAL_META, fetchCampaignTargets } from '@/lib/campaignTargets';
import { draftOutreachMessage } from '@/lib/draftOutreach';

const STATUS_LABEL: Record<TargetStatus, string> = {
  not_contacted: 'Not contacted',
  contacted: 'Contacted',
  responded: 'Responded',
};

const STATUS_CLASS: Record<TargetStatus, string> = {
  not_contacted: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  contacted: 'bg-amber-900/30 text-amber-300 border-amber-700/40',
  responded: 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40',
};

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<OutreachCampaign | null | undefined>(undefined);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [draftDrafts, setDraftDrafts] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [senderName, setSenderName] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const c = getCampaign(params.id);
    setCampaign(c ?? null);
  }, [params.id]);

  function persist(updated: OutreachCampaign) {
    upsertCampaign(updated);
    setCampaign(updated);
  }

  function toggleSelect(targetId: string) {
    if (!campaign) return;
    const targets = campaign.targets.map(t => t.id === targetId ? { ...t, selected: !t.selected } : t);
    persist({ ...campaign, targets });
  }

  function openDraft(target: CampaignTargetState) {
    if (!campaign) return;
    setActiveDraftId(prev => (prev === target.id ? null : target.id));
    if (!(target.id in draftDrafts)) {
      const filled = target.draft ?? draftOutreachMessage(campaign.goal, {
        senderName,
        songTitle: campaign.songTitle,
        songLink: campaign.songDriveLink,
        target,
      });
      setDraftDrafts(prev => ({ ...prev, [target.id]: filled }));
    }
  }

  function updateDraftText(targetId: string, text: string) {
    setDraftDrafts(prev => ({ ...prev, [targetId]: text }));
  }

  function markStatus(targetId: string, status: TargetStatus) {
    if (!campaign) return;
    const targets = campaign.targets.map(t =>
      t.id === targetId ? { ...t, status, draft: draftDrafts[targetId] ?? t.draft } : t
    );
    persist({ ...campaign, targets });
  }

  function confirmDelete() {
    if (!campaign) return;
    deleteCampaign(campaign.id);
    router.push('/dashboard/campaigns');
  }

  async function handleRefresh() {
    if (!campaign) return;
    setRefreshing(true);
    try {
      const fresh = await fetchCampaignTargets(campaign.goal, campaign.criteria);
      const existingIds = new Set(campaign.targets.map(t => t.id));
      const additions: CampaignTargetState[] = fresh
        .filter(t => !existingIds.has(t.id))
        .map(t => ({ ...t, selected: false, status: 'not_contacted', draft: null }));
      persist({ ...campaign, targets: [...campaign.targets, ...additions] });
    } finally {
      setRefreshing(false);
    }
  }

  const queue = useMemo(() => campaign?.targets.filter(t => t.selected) ?? [], [campaign]);

  if (campaign === undefined) {
    return (
      <CampaignChrome>
        <p className="text-sm text-zinc-500">Loading…</p>
      </CampaignChrome>
    );
  }

  if (campaign === null) {
    return (
      <CampaignChrome>
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center space-y-3">
          <p className="text-sm text-zinc-400">Campaign not found.</p>
          <button onClick={() => router.push('/dashboard/campaigns')} className="text-violet-400 hover:text-violet-300 text-sm font-medium">
            Back to campaigns
          </button>
        </section>
      </CampaignChrome>
    );
  }

  const progress = campaignProgress(campaign);

  return (
    <CampaignChrome>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">{campaign.songTitle}</h2>
          <p className="text-xs text-zinc-500">{GOAL_META[campaign.goal].label}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-center">
            <div className="text-sm font-bold text-white">{progress.found}</div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Found</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-center">
            <div className="text-sm font-bold text-white">{progress.contacted}</div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Contacted</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-center">
            <div className="text-sm font-bold text-white">{progress.responded}</div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Responded</div>
          </div>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-red-900/40 border border-zinc-800 hover:border-red-700/60 text-zinc-400 hover:text-red-300 text-xs font-medium transition"
          >
            Delete
          </button>
        </div>
      </div>

      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Targets ({campaign.targets.length})</h3>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-xs font-medium transition disabled:opacity-40"
          >
            {refreshing ? 'Refreshing…' : 'Refresh targets'}
          </button>
        </div>
        <p className="text-xs text-zinc-500">Select the ones you want to reach out to — selecting adds them to your queue below. Each draft is sent one at a time.</p>
        <div className="divide-y divide-zinc-800">
          {campaign.targets.map(t => (
            <label key={t.id} className="flex items-start gap-3 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={t.selected}
                onChange={() => toggleSelect(t.id)}
                className="mt-1 accent-violet-600 w-4 h-4 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-medium text-white truncate">{t.name}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${STATUS_CLASS[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                </div>
                <p className="text-xs text-zinc-500">{t.subtitle}</p>
                {t.genres.length > 0 && <p className="text-xs text-zinc-600 mt-0.5">{t.genres.join(', ')}</p>}
              </div>
            </label>
          ))}
          {campaign.targets.length === 0 && <p className="text-sm text-zinc-500 py-4">No targets found for this criteria yet.</p>}
        </div>
      </section>

      {queue.length > 0 && (
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 md:p-6 space-y-3">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Queue ({queue.length})</h3>
          <p className="text-xs text-zinc-500">Draft and send to each recipient individually — no bulk send.</p>

          {activeDraftId === null && (
            <div className="space-y-1">
              <input
                type="text"
                value={senderName}
                onChange={e => setSenderName(e.target.value)}
                placeholder="Your name (used in drafts)"
                className="w-full sm:w-72 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition"
              />
            </div>
          )}

          <div className="divide-y divide-zinc-800">
            {queue.map(t => (
              <div key={t.id} className="py-3 space-y-3">
                <button onClick={() => openDraft(t)} className="w-full flex items-center justify-between gap-2 text-left">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{t.name}</p>
                    <p className="text-xs text-zinc-500">{t.email}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_CLASS[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                    <svg viewBox="0 0 24 24" className={`w-4 h-4 fill-none stroke-current stroke-2 text-zinc-500 transition-transform ${activeDraftId === t.id ? 'rotate-180' : ''}`} strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </button>

                {activeDraftId === t.id && (
                  <div className="space-y-3 pl-1">
                    <textarea
                      value={draftDrafts[t.id] ?? ''}
                      onChange={e => updateDraftText(t.id, e.target.value)}
                      rows={10}
                      className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition font-mono"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => navigator.clipboard?.writeText(draftDrafts[t.id] ?? '')}
                        className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-xs font-medium transition"
                      >
                        Copy
                      </button>
                      <a
                        href={`mailto:${t.email}?subject=${encodeURIComponent(campaign.songTitle)}&body=${encodeURIComponent(draftDrafts[t.id] ?? '')}`}
                        className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-xs font-medium transition"
                      >
                        Open in email
                      </a>
                      <button
                        onClick={() => markStatus(t.id, 'contacted')}
                        className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition"
                      >
                        Mark as Contacted
                      </button>
                      {t.status === 'contacted' && (
                        <button
                          onClick={() => markStatus(t.id, 'responded')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium transition"
                        >
                          Mark as Responded
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {showDeleteConfirm && (
        <ConfirmDeleteModal
          songTitle={campaign.songTitle}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={confirmDelete}
        />
      )}
    </CampaignChrome>
  );
}
