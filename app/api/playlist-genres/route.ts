import { NextResponse } from 'next/server';
import { getAllPlaylistGenres, getAllPlaylistPlatforms } from '@/lib/playlists';

export async function GET() {
  return NextResponse.json({
    genres: getAllPlaylistGenres(),
    platforms: getAllPlaylistPlatforms(),
  });
}
