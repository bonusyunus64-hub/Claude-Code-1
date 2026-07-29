'use client';

import { useState } from 'react';

export function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      onClick={copy}
      className={`text-xs px-2 py-1 rounded font-mono transition select-none ${
        copied
          ? 'bg-green-700/40 text-green-400 border border-green-600'
          : 'bg-zinc-800 text-violet-400 border border-zinc-700 hover:border-violet-500 hover:bg-zinc-700'
      }`}
    >
      {copied ? '✓ Copied' : value}
    </button>
  );
}
