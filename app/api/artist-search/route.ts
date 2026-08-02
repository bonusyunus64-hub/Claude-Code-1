import { NextRequest, NextResponse } from 'next/server';
import { searchArtistsByName } from '@/lib/roster';
import { readJsonBody } from '@/lib/readJsonBody';

export async function POST(req: NextRequest) {
  const parsed = await readJsonBody<{ query: string }>(req);
  if (!parsed.ok) return parsed.response;

  const { query } = parsed.data;

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
