import { NextRequest, NextResponse } from 'next/server';
import { isKvConfigured } from '@/lib/kv';
import { listCampaigns, saveCampaign, deleteCampaign, clearCampaigns, type CampaignRecord } from '@/lib/campaigns';

// Campaign history lives server-side, one Redis hash field per campaign, so a
// send or a reply-check only ever writes the single record it changed instead of
// rewriting the entire history array.

export async function GET() {
  if (!isKvConfigured()) return NextResponse.json({ campaigns: [] });
  return NextResponse.json({ campaigns: await listCampaigns() });
}

export async function POST(req: NextRequest) {
  if (!isKvConfigured()) {
    return NextResponse.json({ error: 'Campaign history storage is not configured on the server.' }, { status: 500 });
  }
  const campaign = await req.json() as CampaignRecord;
  if (!campaign?.id || !campaign.trackTitle || !campaign.type || !Array.isArray(campaign.emails)) {
    return NextResponse.json({ error: 'Invalid campaign record.' }, { status: 400 });
  }
  await saveCampaign(campaign);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!isKvConfigured()) return NextResponse.json({ ok: true });
  const id = req.nextUrl.searchParams.get('id');
  const all = req.nextUrl.searchParams.get('all');
  if (all === 'true') {
    await clearCampaigns();
    return NextResponse.json({ ok: true });
  }
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  await deleteCampaign(id);
  return NextResponse.json({ ok: true });
}
