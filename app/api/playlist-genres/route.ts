import { NextResponse } from 'next/server';
import { getAllPlaylistGenres, getAllPlaylistPlatforms, getPlaylistCuratorCount } from '@/lib/playlists';

export async function GET() {
  return NextResponse.json({
    genres: getAllPlaylistGenres(),
    platforms: getAllPlaylistPlatforms(),
    // curatorCount lets the Playlists tab in PromotionSection.tsx decide whether
    // to render itself as a disabled "Coming soon" tab — data-driven off
    // data/playlists.json rather than a hardcoded flag, so it self-enables once
    // curator records exist.
    curatorCount: getPlaylistCuratorCount(),
  });
}
