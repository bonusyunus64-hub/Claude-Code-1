import { NextRequest } from 'next/server';
import { filterPlaylistCurators } from '@/lib/playlists';
import { sendBroadcast, BroadcastSendPayload } from '@/lib/broadcastSend';

// Same reasoning as app/api/send/route.ts: a batch's SMTP retries plus sendDelay can
// exceed Vercel's 10s default, so this raises the ceiling to 60s (the Hobby-plan max).
export const maxDuration = 60;

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
