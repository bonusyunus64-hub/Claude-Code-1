import { NextRequest, NextResponse } from 'next/server';
import { filterPlaylistCurators } from '@/lib/playlists';

export async function POST(req: NextRequest) {
  const { genres, platforms, matchMode } = await req.json() as { genres: string[]; platforms: string[]; matchMode?: 'any' | 'all' };
  const curators = filterPlaylistCurators(genres ?? [], platforms ?? [], matchMode ?? 'any');
  return NextResponse.json({ curators, total: curators.length });
}
