'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import CampaignChrome from './_components/CampaignChrome';
import ConfirmDeleteModal from './_components/ConfirmDeleteModal';
import { loadCampaigns, deleteCampaign, campaignProgress, type OutreachCampaign } from '@/lib/campaigns';
import { GOAL_META } from '@/lib/campaignTargets';

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<OutreachCampaign | null>(null);

  useEffect(() => {
    setCampaigns(loadCampaigns().sort((a, b) => b.createdAt - a.createdAt));
  }, []);

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteCampaign(deleteTarget.id);
    setCampaigns(prev => prev.filter(c => c.id !== deleteTarget.id));
    setDeleteTarget(null);
  }

  return (
    <CampaignChrome>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Campaigns</h2>
          <p className="text-xs text-zinc-500">One job per campaign: a song, a goal, and a target list to work through.</p>
        </div>
        <Link
          href="/dashboard/campaigns/new"
          className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition shrink-0"
        >
          + New Campaign
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center space-y-3">
          <p className="text-sm text-zinc-400">You don&apos;t have any campaigns yet.</p>
          <Link
            href="/dashboard/campaigns/new"
            className="inline-block px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition"
          >
            Start your first campaign
          </Link>
        </section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {campaigns.map(c => {
            const progress = campaignProgress(c);
            return (
              <div key={c.id} className="group relative bg-zinc-900 rounded-xl border border-zinc-800 hover:border-zinc-700 transition">
                <button
                  onClick={() => setDeleteTarget(c)}
                  aria-label={`Delete campaign for ${c.songTitle}`}
                  className="absolute -top-2 -right-2 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 hover:bg-red-600 hover:border-red-500 hover:text-white opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 transition"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
                <Link href={`/dashboard/campaigns/${c.id}`} className="block p-4 md:p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-white">{c.songTitle}</h3>
                    <span className="shrink-0 text-xs px-2 py-1 rounded-full bg-violet-600/20 text-violet-300 border border-violet-700/40">
                      {GOAL_META[c.goal].label}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-zinc-800/60 rounded-lg py-2">
                      <div className="text-lg font-bold text-white">{progress.found}</div>
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">Found</div>
                    </div>
                    <div className="bg-zinc-800/60 rounded-lg py-2">
                      <div className="text-lg font-bold text-white">{progress.contacted}</div>
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">Contacted</div>
                    </div>
                    <div className="bg-zinc-800/60 rounded-lg py-2">
                      <div className="text-lg font-bold text-white">{progress.responded}</div>
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">Responded</div>
                    </div>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDeleteModal
          songTitle={deleteTarget.songTitle}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </CampaignChrome>
  );
}
