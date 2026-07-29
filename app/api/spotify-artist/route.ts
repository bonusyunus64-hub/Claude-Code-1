import { NextRequest, NextResponse } from 'next/server';
import { findArtistUrl, isSpotifyConfigured } from '@/lib/spotify';
import { getRedis, isKvConfigured } from '@/lib/kv';
import { isAuthed } from '@/lib/auth';

const CACHE_KEY_PREFIX = 'trackpitch:spotifyUrl:';

// Per-instance fallback so repeated clicks don't re-hit Spotify even when KV
// isn't configured; when KV is configured this doubles as a warm first layer.
const memCache = new Map<string, string | null>();

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name } = await req.json() as { name?: string };
  if (!name || !name.trim()) return NextResponse.json({ url: null });
  const cacheKey = name.trim().toLowerCase();

  if (memCache.has(cacheKey)) return NextResponse.json({ url: memCache.get(cacheKey) });

  if (isKvConfigured()) {
    // Empty string is our "looked up, no match" sentinel — distinct from
    // undefined ("never looked up"), so we don't keep re-querying misses.
    const cached = await getRedis().get<string>(CACHE_KEY_PREFIX + cacheKey);
    if (cached !== null && cached !== undefined) {
      const url = cached || null;
      memCache.set(cacheKey, url);
      return NextResponse.json({ url });
    }
  }

  if (!isSpotifyConfigured()) return NextResponse.json({ url: null });

  const url = await findArtistUrl(name.trim());
  memCache.set(cacheKey, url);
  if (isKvConfigured()) {
    await getRedis().set(CACHE_KEY_PREFIX + cacheKey, url ?? '');
  }
  return NextResponse.json({ url });
}
