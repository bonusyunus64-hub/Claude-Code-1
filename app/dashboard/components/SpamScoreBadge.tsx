'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { computeSpamScore } from '@/lib/spamScore';

export function SpamScoreBadge({ template }: { template: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const result = useMemo(() => computeSpamScore(template), [template]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const styles = result.risk === 'high'
    ? 'bg-red-600/20 text-red-400 border-red-600/30'
    : result.risk === 'medium'
    ? 'bg-amber-600/20 text-amber-400 border-amber-600/30'
    : 'bg-green-600/20 text-green-400 border-green-600/30';

  if (result.issues.length === 0) {
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${styles}`}>
        Spam score: {result.score} (low risk)
      </span>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(p => !p)}
        className={`text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 whitespace-nowrap ${styles}`}
      >
        Spam score: {result.score} ({result.risk} risk) <span className={`transition-transform inline-block ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl p-2 min-w-[260px] max-w-[320px]">
          <p className="text-xs text-zinc-400 font-semibold mb-1">Possible deliverability issues:</p>
          {result.issues.map(issue => (
            <p key={issue} className="text-xs text-zinc-300 py-0.5">• {issue}</p>
          ))}
        </div>
      )}
    </div>
  );
}
