import { NextRequest, NextResponse } from 'next/server';
import { filterRadioStations } from '@/lib/radio';

export async function POST(req: NextRequest) {
  const { genres, locations, matchMode } = await req.json() as { genres: string[]; locations: string[]; matchMode?: 'any' | 'all' };
  const stations = filterRadioStations(genres ?? [], locations ?? [], matchMode ?? 'any');
  return NextResponse.json({ stations, total: stations.length });
}
