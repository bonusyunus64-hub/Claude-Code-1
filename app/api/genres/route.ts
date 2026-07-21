import { NextResponse } from 'next/server';
import { getRoster, getTopGenres } from '@/lib/roster';

export async function GET() {
  const { genres } = getRoster();
  return NextResponse.json({ genres, topGenres: getTopGenres() });
}
