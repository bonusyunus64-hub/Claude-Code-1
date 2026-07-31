import { NextResponse } from 'next/server';
import { getRoster, getTopGenres, getRosterGeneratedAt } from '@/lib/roster';
// Read-only import — lib/radio.ts itself isn't touched here, just its already-exported
// station count, so the Overview tab's "roster freshness" summary can include the
// radio roster size in the same round trip instead of adding a second endpoint.
import { getRadioData } from '@/lib/radio';

export async function GET() {
  const { genres, artists } = getRoster();
  return NextResponse.json({
    genres,
    topGenres: getTopGenres(),
    artistCount: artists.length,
    generatedAt: getRosterGeneratedAt(),
    radioStationCount: getRadioData().stations.length,
  });
}
