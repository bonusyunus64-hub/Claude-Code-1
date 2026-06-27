import { NextRequest, NextResponse } from 'next/server';
import { getArtistsByGenres } from '@/lib/roster';

export async function POST(req: NextRequest) {
  const { genres, minAudience, maxAudience, gender, artistType, minInstagram, maxInstagram } =
    await req.json() as { genres: string[]; minAudience?: number; maxAudience?: number; gender?: string; artistType?: string; minInstagram?: number; maxInstagram?: number };

  if (!genres || !genres.length) {
    return NextResponse.json({ artists: [] });
  }

  const matched = getArtistsByGenres(genres, minAudience ?? 0, maxAudience ?? 0, gender ?? '', artistType ?? '', minInstagram ?? 0, maxInstagram ?? 0);

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

  return NextResponse.json({ artists: result, total: result.length });
}
