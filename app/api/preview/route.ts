import { NextRequest, NextResponse } from 'next/server';
import { getArtistsByGenres } from '@/lib/roster';
import { readJsonBody } from '@/lib/readJsonBody';

interface PreviewPayload {
  genres: string[];
  minAudience?: number;
  maxAudience?: number;
  gender?: string;
  artistType?: string;
  minInstagram?: number;
  maxInstagram?: number;
  matchMode?: 'any' | 'all';
}

export async function POST(req: NextRequest) {
  const parsed = await readJsonBody<PreviewPayload>(req);
  if (!parsed.ok) return parsed.response;

  const { genres, minAudience, maxAudience, gender, artistType, minInstagram, maxInstagram, matchMode } =
    parsed.data;

  if (!genres || !genres.length) {
    return NextResponse.json({ artists: [] });
  }

  const matched = getArtistsByGenres(genres, minAudience ?? 0, maxAudience ?? 0, gender ?? '', artistType ?? '', minInstagram ?? 0, maxInstagram ?? 0, matchMode ?? 'any');

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
    gender: a.gender,
    type: a.type,
  }));

  return NextResponse.json({ artists: result, total: result.length });
}
