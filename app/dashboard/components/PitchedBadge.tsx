'use client';

import { useState, useEffect, useRef } from 'react';

export function PitchedBadge({ tracks }: { tracks: string[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (tracks.length === 1) {
    return (
      <span className="text-xs bg-amber-600/20 text-amber-400 border border-amber-600/30 px-2 py-0.5 rounded-full whitespace-nowrap">
        Pitched: {tracks[0]}
      </span>
    );
  }
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(p => !p); }}
        className="text-xs bg-amber-600/20 text-amber-400 border border-amber-600/30 px-2 py-0.5 rounded-full flex items-center gap-1 whitespace-nowrap"
      >
        Pitched ({tracks.length}) <span className={`transition-transform inline-block ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl p-1.5 min-w-[180px]">
          {tracks.map(t => (
            <p key={t} className="text-xs text-zinc-300 py-1 px-2 hover:bg-zinc-700 rounded">{t}</p>
          ))}
        </div>
      )}
    </div>
  );
}
