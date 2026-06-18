import { NextRequest, NextResponse } from 'next/server';
import { getArtistsByGenres } from '@/lib/roster';

export async function POST(req: NextRequest) {
  const { genres } = await req.json() as { genres: string[] };

  if (!genres || !genres.length) {
    return NextResponse.json({ artists: [] });
  }

  const matched = getArtistsByGenres(genres);

  const result = matched.map(a => ({
    name: a.name,
    genres: a.genres,
    spotifyFollowers: a.spotifyFollowers,
    managementCompany: a.managementCompany,
    managerNames: a.managerNames,
    managerEmails: a.managerEmails,
    labels: a.labels,
  }));

  return NextResponse.json({ artists: result, total: result.length });
}
