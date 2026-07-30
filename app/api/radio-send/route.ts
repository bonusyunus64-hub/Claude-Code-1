import { NextRequest } from 'next/server';
import { filterRadioStations } from '@/lib/radio';
import { sendBroadcast, BroadcastSendPayload } from '@/lib/broadcastSend';

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
