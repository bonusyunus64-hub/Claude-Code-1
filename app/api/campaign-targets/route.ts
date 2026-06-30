import { NextRequest, NextResponse } from 'next/server';
import { filterRadioStations } from '@/lib/radio';
import { filterPlaylistCurators } from '@/lib/playlists';
import { filterCollaborators } from '@/lib/collaborators';
import { filterLabels } from '@/lib/labels';

// ---------------------------------------------------------------------------
// BOUNDARY: fetch-on-demand target assembly.
//
// This route is the *only* place that turns a campaign's target criteria
// into an actual list of people/orgs to contact. It is intentionally a thin
// dispatcher: each goal type below reads from a local mock JSON file via the
// existing lib/*.ts filter helpers, simulating "assemble a list right now"
// rather than "browse a stored directory."
//
// To wire this up to a real source later (a live API, a scraped index, an
// AI-driven search agent, etc.), replace the body of each case below with a
// call to that source. Nothing outside this file needs to change — callers
// only ever see the common CampaignTargetDTO shape returned at the bottom.
// ---------------------------------------------------------------------------

interface TargetCriteria {
  genres: string[];
  locations: string[];
  subtypes: string[];
  matchMode: 'any' | 'all';
}

interface CampaignTargetDTO {
  id: string;
  name: string;
  subtitle: string;
  genres: string[];
  email: string;
  meta?: string;
}

export async function POST(req: NextRequest) {
  const { goal, criteria } = await req.json() as { goal: string; criteria: TargetCriteria };
  const { genres = [], locations = [], subtypes = [], matchMode = 'any' } = criteria ?? {};

  let targets: CampaignTargetDTO[] = [];

  switch (goal) {
    case 'radio': {
      const stations = filterRadioStations(genres, locations, matchMode);
      targets = stations.map(s => ({
        id: `radio:${s.name}`,
        name: s.name,
        subtitle: s.region,
        genres: s.genres,
        email: s.emails[0] ?? '',
        meta: s.phone,
      }));
      break;
    }
    case 'playlist': {
      const curators = filterPlaylistCurators(genres, subtypes, matchMode);
      targets = curators.map(c => ({
        id: `playlist:${c.name}`,
        name: c.name,
        subtitle: c.platform,
        genres: c.genres,
        email: c.emails[0] ?? '',
        meta: c.followers ? `${c.followers.toLocaleString()} followers` : undefined,
      }));
      break;
    }
    case 'collaborator': {
      const collaborators = filterCollaborators(genres, locations, subtypes, matchMode);
      targets = collaborators.map(c => ({
        id: `collaborator:${c.name}`,
        name: c.name,
        subtitle: `${c.role} · ${c.location}`,
        genres: c.genres,
        email: c.email,
        meta: c.credits,
      }));
      break;
    }
    case 'label': {
      const labels = filterLabels(genres, locations, subtypes, matchMode);
      targets = labels.map(l => ({
        id: `label:${l.name}`,
        name: l.name,
        subtitle: `${l.type} · ${l.region}`,
        genres: l.genres,
        email: l.submissionEmail,
        meta: l.notes,
      }));
      break;
    }
    default:
      return NextResponse.json({ error: 'Unknown goal' }, { status: 400 });
  }

  return NextResponse.json({ targets, total: targets.length });
}
