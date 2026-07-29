'use client';

import { useState } from 'react';

export function CopyableName({ name, className }: { name: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <p
      onClick={e => {
        e.stopPropagation();
        navigator.clipboard.writeText(name).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      title="Click to copy name"
      className={`cursor-pointer select-none hover:text-violet-300 transition ${className ?? ''}`}
    >
      {copied ? 'Copied!' : name}
    </p>
  );
}
