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
  maxCompanySize?: number;
  freemailOnly?: boolean;
  /**
   * Explicit opt-in required to actually run an empty `genres` selection as
   * "every artist" (see lib/roster.ts's getArtistsByGenres). Without it, an
   * empty selection previews as empty exactly like before that behavior
   * existed — this endpoint never infers "the user wants everyone" just from
   * an empty array, since that's also what a genuinely-in-progress genre pick
   * looks like. See app/dashboard/hooks/useDemosFlow.ts's matchAllGenres for
   * where this actually gets set to true.
   */
  matchAllGenres?: boolean;
}

export async function POST(req: NextRequest) {
  const parsed = await readJsonBody<PreviewPayload>(req);
  if (!parsed.ok) return parsed.response;

  const { genres, minAudience, maxAudience, gender, artistType, minInstagram, maxInstagram, matchMode, maxCompanySize, freemailOnly, matchAllGenres } =
    parsed.data;

  if ((!genres || !genres.length) && !matchAllGenres) {
    return NextResponse.json({ artists: [] });
  }

  const matched = getArtistsByGenres({
    genres: genres ?? [], minFollowers: minAudience ?? 0, maxFollowers: maxAudience ?? 0,
    gender: gender ?? '', artistType: artistType ?? '', minInstagram: minInstagram ?? 0, maxInstagram: maxInstagram ?? 0,
    matchMode: matchMode ?? 'any', maxCompanySize: maxCompanySize ?? 0, freemailOnly: !!freemailOnly,
  });

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
