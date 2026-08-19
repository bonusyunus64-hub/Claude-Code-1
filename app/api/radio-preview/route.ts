import { NextRequest, NextResponse } from 'next/server';
import { filterRadioStations, countNewsroomExcludedStations } from '@/lib/radio';
import { readJsonBody } from '@/lib/readJsonBody';

export async function POST(req: NextRequest) {
  const parsed = await readJsonBody<{ genres: string[]; locations: string[]; matchMode?: 'any' | 'all'; excludeNewsroom?: boolean }>(req);
  if (!parsed.ok) return parsed.response;

  const { genres, locations, matchMode, excludeNewsroom } = parsed.data;
  const stations = filterRadioStations(genres ?? [], locations ?? [], matchMode ?? 'any', excludeNewsroom ?? false);
  return NextResponse.json({
    stations,
    total: stations.length,
    // Impact of the toggle for these same filters, regardless of whether
    // excludeNewsroom is currently on or off — see countNewsroomExcludedStations.
    newsroomExcludedCount: countNewsroomExcludedStations(genres ?? [], locations ?? [], matchMode ?? 'any'),
  });
}
