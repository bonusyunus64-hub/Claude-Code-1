import { NextRequest, NextResponse } from 'next/server';
import { filterRadioStations } from '@/lib/radio';

export async function POST(req: NextRequest) {
  const { genres, locations } = await req.json() as { genres: string[]; locations: string[] };
  const stations = filterRadioStations(genres ?? [], locations ?? []);
  return NextResponse.json({ stations, total: stations.length });
}
