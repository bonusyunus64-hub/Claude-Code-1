import { NextRequest } from 'next/server';
import { sendDemos, DemosSendPayload } from '@/lib/demosSend';
import { readJsonBody } from '@/lib/readJsonBody';

// A batch of DEFAULT_SEND_BATCH_SIZE emails with SMTP retries (up to 2, ~1-2s each)
// and a configurable inter-message sendDelay stacked on top can comfortably exceed
// Vercel's 10s default — this raises the ceiling to 60s, the max the Hobby plan
// allows, rather than risk the function getting killed mid-batch.
export const maxDuration = 60;

// The actual send lives in lib/demosSend.ts, leaving this a thin HTTP wrapper —
// the same shape app/api/radio-send already had around lib/broadcastSend.ts.
// Splitting it out lets the send-window drain cron (app/api/cron/drain-send-window)
// run a queued campaign by calling the function directly, in-process, instead of
// re-POSTing to this route over HTTP. That distinction matters for more than
// tidiness: an HTTP round trip would have needed its own way past proxy.ts's
// session gate, which in practice meant letting a CRON_SECRET bearer token reach
// a route that accepts an arbitrary recipient list and an arbitrary message body.
// A leaked cron secret would then be enough to send anything to anyone through
// the user's own mailbox. Calling the function directly keeps that door shut
// while still sharing one implementation of dedupe, the blacklist union, the
// daily cap check and subject A/B assignment.
export async function POST(req: NextRequest) {
  const parsed = await readJsonBody<DemosSendPayload>(req);
  if (!parsed.ok) return parsed.response;

  return sendDemos(parsed.data);
}
