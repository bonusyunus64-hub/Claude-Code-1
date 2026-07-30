import { NextRequest } from 'next/server';
import { filterRadioStations } from '@/lib/radio';
import { sendBroadcast, BroadcastSendPayload } from '@/lib/broadcastSend';

// Same reasoning as app/api/send/route.ts: a batch's SMTP retries plus sendDelay can
// exceed Vercel's 10s default, so this raises the ceiling to 60s (the Hobby-plan max).
export const maxDuration = 60;

interface RadioSendPayload extends BroadcastSendPayload {
  genres: string[];
  locations: string[];
  matchMode?: 'any' | 'all';
}

export async function POST(req: NextRequest) {
  const payload = await req.json() as RadioSendPayload;
  const stations = filterRadioStations(payload.genres ?? [], payload.locations ?? [], payload.matchMode ?? 'any');
  return sendBroadcast(payload, stations, 'stationName');
}
