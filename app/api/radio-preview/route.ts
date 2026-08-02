import { NextRequest, NextResponse } from 'next/server';
import { filterRadioStations } from '@/lib/radio';
import { readJsonBody } from '@/lib/readJsonBody';

export async function POST(req: NextRequest) {
  const parsed = await readJsonBody<{ genres: string[]; locations: string[]; matchMode?: 'any' | 'all' }>(req);
  if (!parsed.ok) return parsed.response;

  const { genres, locations, matchMode } = parsed.data;
  const stations = filterRadioStations(genres ?? [], locations ?? [], matchMode ?? 'any');
  return NextResponse.json({ stations, total: stations.length });
}
