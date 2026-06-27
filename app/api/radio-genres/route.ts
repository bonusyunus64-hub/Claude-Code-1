import { NextResponse } from 'next/server';
import { getAllRadioGenres, getAllRadioRegions } from '@/lib/radio';

export async function GET() {
  return NextResponse.json({
    genres: getAllRadioGenres(),
    regions: getAllRadioRegions(),
  });
}
