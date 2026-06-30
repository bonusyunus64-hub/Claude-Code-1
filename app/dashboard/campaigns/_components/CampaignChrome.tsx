'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';

export default function CampaignChrome({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-zinc-950">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between shrink-0">
        <Link href="/dashboard" className="text-lg font-bold tracking-tight text-white">TrackPitch</Link>
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-sm text-zinc-400 hover:text-white transition">Back to dashboard</Link>
          <a href="/api/logout" className="text-sm text-zinc-400 hover:text-white transition">Log out</a>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-5 md:px-8 md:py-10 space-y-5 md:space-y-6 pb-12">
          {children}
        </div>
      </main>
    </div>
  );
}
