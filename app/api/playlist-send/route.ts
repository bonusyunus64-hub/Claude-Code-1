import { NextRequest } from 'next/server';
import { filterPlaylistCurators } from '@/lib/playlists';
import { sendBroadcast, BroadcastSendPayload } from '@/lib/broadcastSend';

interface PlaylistSendPayload extends BroadcastSendPayload {
  genres: string[];
  platforms: string[];
  matchMode?: 'any' | 'all';
}

export async function POST(req: NextRequest) {
  const payload = await req.json() as PlaylistSendPayload;
  const curators = filterPlaylistCurators(payload.genres ?? [], payload.platforms ?? [], payload.matchMode ?? 'any');
  return sendBroadcast(payload, curators, 'curatorName');
}
