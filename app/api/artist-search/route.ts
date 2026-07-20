import { NextRequest, NextResponse } from 'next/server';
import { searchArtistsByName } from '@/lib/roster';

export async function POST(req: NextRequest) {
  const { query } = await req.json() as { query: string };

  if (!query || !query.trim()) {
    return NextResponse.json({ artists: [] });
  }

  const matched = searchArtistsByName(query);

  const result = matched.map(a => ({
    name: a.name,
    genres: a.genres,
    spotifyFollowers: a.spotifyFollowers,
    managementCompany: a.managementCompany,
    managerNames: a.managerNames,
    managerEmails: a.managerEmails,
    labels: a.labels,
    instagramHandle: a.instagramHandle,
    avatarUrl: a.avatarUrl,
  }));

  return NextResponse.json({ artists: result });
}
