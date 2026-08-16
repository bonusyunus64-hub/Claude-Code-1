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

  // computeSpamScore no longer returns a 0-100 number — see the header comment
  // in lib/spamScore.ts for why a made-up precise-looking score was dropped in
  // favor of a plain list of specific, actionable issues. The badge now just
  // reports how many there are; the dropdown is where the detail lives.
  if (result.issues.length === 0) {
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${styles}`}>
        No copy issues found
      </span>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(p => !p)}
        className={`text-xs px-2 py-0.5 rounded-full border flex items-center gap-1 whitespace-nowrap ${styles}`}
      >
        {result.issues.length} copy issue{result.issues.length !== 1 ? 's' : ''} ({result.risk} risk) <span className={`transition-transform inline-block ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl p-2 min-w-[260px] max-w-[320px]">
          <p className="text-xs text-zinc-400 font-semibold mb-1">Possible deliverability issues:</p>
          {result.issues.map(issue => (
            <p key={issue.message} className="text-xs text-zinc-300 py-0.5 flex items-start gap-1.5">
              <span className={`mt-0.5 ${issue.severity === 'high' ? 'text-red-400' : 'text-amber-400'}`}>●</span>
              <span>{issue.message}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
