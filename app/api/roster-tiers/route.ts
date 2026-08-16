import { NextRequest, NextResponse } from 'next/server';
import { getEmailTiers, type EmailTierInfo } from '@/lib/roster';
import { readJsonBody } from '@/lib/readJsonBody';

/**
 * Backs the Overview tab's "reply rate by who was contacted" segmentation
 * (app/dashboard/utils.ts's computeRosterTierStats).
 * roster.json is only ever read server-side (lib/roster.ts uses `fs`), so the
 * client — which already has every campaign's `emails` list in memory —
 * posts those addresses here and gets back just the two numbers per address
 * it needs (representative Spotify followers + management-company size),
 * rather than this route shipping the roster itself down to the browser.
 *
 * Mirrors app/api/campaign-recipients/route.ts's shape (a list of addresses
 * in, a per-address lookup out) — that route backfills *display* fields for
 * older campaigns; this one backfills the *tier* numbers the segmentation
 * buckets on. Kept separate because the two have different join rules (this
 * one needs getEmailTiers' max-across-artists tie-break, not "whichever
 * artist happened to be indexed last").
 */
export async function POST(req: NextRequest) {
  const parsed = await readJsonBody<{ emails?: string[] }>(req);
  if (!parsed.ok) return parsed.response;

  const { emails } = parsed.data;
  if (!emails || !emails.length) return NextResponse.json({ tiers: {} });

  const tierMap = getEmailTiers(emails);
  const tiers: Record<string, EmailTierInfo | null> = {};
  tierMap.forEach((value, email) => {
    tiers[email] = value;
  });

  return NextResponse.json({ tiers });
}
