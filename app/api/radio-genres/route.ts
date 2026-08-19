import { NextResponse } from 'next/server';
import { getAllRadioGenres, getAllRadioRegions, countNewsroomExcludedStations } from '@/lib/radio';

export async function GET() {
  return NextResponse.json({
    genres: getAllRadioGenres(),
    regions: getAllRadioRegions(),
    // Unfiltered baseline so the "Exclude newsroom addresses" toggle can show its
    // impact (~32 stations) as soon as the page loads, before the operator has
    // run a Preview or touched any filter — see PromotionSection's toggle copy.
    newsroomExcludedCount: countNewsroomExcludedStations([], [], 'any'),
  });
}
