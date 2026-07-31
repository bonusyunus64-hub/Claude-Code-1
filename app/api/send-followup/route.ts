import { NextRequest } from 'next/server';
import { sendFollowUp, FollowUpSendPayload } from '@/lib/followUpSend';

// Same reasoning as app/api/send/route.ts: a batch of DEFAULT_SEND_BATCH_SIZE
// emails with SMTP retries and a configurable inter-message sendDelay can
// comfortably exceed Vercel's 10s default.
export const maxDuration = 60;

// Thin HTTP wrapper around lib/followUpSend.ts, mirroring how app/api/send/route.ts
// wraps lib/demosSend.ts. This route is reached only through proxy.ts's dashboard
// session gate — it is deliberately NOT in proxy.ts's PUBLIC_API_PATHS and does NOT
// accept a CRON_SECRET, unlike the old auto-followup cron this replaces. See the
// long comment in proxy.ts on why send routes stay session-only.
export async function POST(req: NextRequest) {
  const payload = await req.json() as FollowUpSendPayload;
  return sendFollowUp(payload);
}
