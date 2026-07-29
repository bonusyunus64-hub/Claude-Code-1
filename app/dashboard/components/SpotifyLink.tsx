'use client';

import { spotifyArtistSearchUrl } from '../constants';

export function SpotifyLink({ name, followers }: { name: string; followers: number }) {
  const fallbackUrl = spotifyArtistSearchUrl(name);

  // Land on the search fallback immediately (works with popup blockers since it's
  // synchronous with the click), then upgrade the tab to the real artist page once
  // the server resolves it via the Spotify API — best case the user never sees the
  // fallback at all.
  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    const win = window.open(fallbackUrl, '_blank');
    fetch('/api/spotify-artist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
      .then(res => (res.ok ? res.json() : null))
      .then((data: { url?: string | null } | null) => {
        if (data?.url && win && !win.closed) win.location.href = data.url;
      })
      .catch(() => {});
  }

  return (
    <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" onClick={handleClick}
      className="inline-flex items-center gap-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-green-400 px-1.5 py-0.5 rounded font-medium transition">
      <svg viewBox="0 0 24 24" className="w-3 h-3 fill-green-400 shrink-0"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
      {followers >= 1_000_000 ? `${(followers / 1_000_000).toFixed(1)}M` : `${Math.round(followers / 1_000)}K`}
    </a>
  );
}
