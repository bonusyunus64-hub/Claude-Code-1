import { NextResponse } from 'next/server';
import { sendDemos, DemosSendPayload } from '@/lib/demosSend';
import { sendBroadcast, BroadcastSendPayload } from '@/lib/broadcastSend';
import { filterRadioStations } from '@/lib/radio';
import { filterPlaylistCurators } from '@/lib/playlists';

/**
 * Runs a queued campaign's saved send in-process, given the `pendingSend.endpoint`
 * it was originally headed for.
 *
 * A campaign queued by the send window (lib/sendWindow.ts) stores the endpoint it
 * was going to POST to plus the payload it was going to send, exactly the way an
 * interrupted send already does — see CampaignRecord.pendingSend. When the browser
 * drains that queue it genuinely re-POSTs over HTTP, because it's a browser and
 * that's its only option. The drain cron (app/api/cron/drain-send-window) is
 * already running on the server, so it doesn't need the HTTP hop at all, and
 * taking it would have been actively worse: a server-to-self request still has to
 * get past proxy.ts's session gate, and the only way to do that without a browser
 * cookie is a shared secret — which would mean a CRON_SECRET bearer token being
 * accepted by /api/send, a route that takes an arbitrary recipient list
 * (customContacts) and an arbitrary message body. Anyone holding that secret could
 * then send anything to anyone from the user's own authenticated mailbox. Calling
 * these functions directly avoids widening the auth surface at all, and skips a
 * network round trip per batch inside a function that only has 60s to work with.
 *
 * Endpoint strings rather than an enum because that's what's already persisted in
 * Redis on existing pendingSend records; an unknown one is rejected rather than
 * assumed, so a malformed or hand-edited record can't be coerced into a send.
 */
export async function dispatchQueuedSend(
  endpoint: string,
  payload: Record<string, unknown>
): Promise<Response> {
  switch (endpoint) {
    case '/api/send':
      return sendDemos(payload as unknown as DemosSendPayload);

    case '/api/radio-send': {
      const p = payload as unknown as BroadcastSendPayload & { genres?: string[]; locations?: string[]; matchMode?: 'any' | 'all' };
      const stations = filterRadioStations(p.genres ?? [], p.locations ?? [], p.matchMode ?? 'any');
      return sendBroadcast(p, stations, 'stationName');
    }

    case '/api/playlist-send': {
      const p = payload as unknown as BroadcastSendPayload & { genres?: string[]; platforms?: string[]; matchMode?: 'any' | 'all' };
      const curators = filterPlaylistCurators(p.genres ?? [], p.platforms ?? [], p.matchMode ?? 'any');
      return sendBroadcast(p, curators, 'curatorName');
    }

    default:
      return NextResponse.json({ error: `Unknown send endpoint: ${endpoint}` }, { status: 400 });
  }
}
