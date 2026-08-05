import { NextRequest, NextResponse } from 'next/server';
import { isKvConfigured } from '@/lib/kv';
import {
  listCampaignSummaries, getCampaign, saveCampaignPreservingDetail,
  deleteCampaign, clearCampaigns, type CampaignRecord,
} from '@/lib/campaigns';
import { readJsonBody } from '@/lib/readJsonBody';

// Campaign history lives server-side, one Redis hash field per campaign, so a
// send or a reply-check only ever writes the single record it changed instead of
// rewriting the entire history array.
//
// Reads come in two shapes. The bare GET returns *summaries* — every campaign
// minus its `recipients` — because the list is fetched on every dashboard load
// and grows without bound, while the per-recipient artist metadata is only
// rendered for the one row the user expands. `GET ?id=` returns that single
// record in full, which is what the client hydrates an expanded row (or a send
// it is about to resume) with. See lib/campaigns.ts's CampaignSummary for the
// size reasoning, and mergePreservingDetail for why a client holding a summary
// can still safely POST the record back.

export async function GET(req: NextRequest) {
  if (!isKvConfigured()) return NextResponse.json({ campaigns: [] });

  const id = req.nextUrl.searchParams.get('id');
  if (id) {
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: 'No such campaign.' }, { status: 404 });
    return NextResponse.json({ campaign });
  }

  return NextResponse.json({ campaigns: await listCampaignSummaries() });
}

export async function POST(req: NextRequest) {
  if (!isKvConfigured()) {
    return NextResponse.json({ error: 'Campaign history storage is not configured on the server.' }, { status: 500 });
  }
  const parsed = await readJsonBody<CampaignRecord>(req);
  if (!parsed.ok) return parsed.response;

  const campaign = parsed.data;
  if (!campaign?.id || !campaign.trackTitle || !campaign.type || !Array.isArray(campaign.emails)) {
    return NextResponse.json({ error: 'Invalid campaign record.' }, { status: 400 });
  }
  // Preserving rather than plain-saving: the browser POSTs the whole record back
  // on every write, and a client working from a summary has no `recipients` to
  // send — that must not erase the stored copy.
  await saveCampaignPreservingDetail(campaign);
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
